// safe.mjs: the files the scripts read, change and write back, written by
// many processes at once against one home. No update may be lost and no file
// left malformed. PACING_TEST_WRITE_GAP_MS widens the gap between a writer's
// read and its write, so that the writers really overlap: without the
// compare-and-swap under a lock, these tests lose updates every time.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sandbox, scripts, RESET } from './helpers.mjs';

const { atomicWrite, updateFile, updateJson, withLock, LOCK_WAIT_MS, LOCK_STALE_MS } = await import(pathToFileURL(path.join(scripts, 'safe.mjs')).href);

// run the commands side by side; resolves with each one's exit code and output
const together = (s, script, cmds, env = {}) => Promise.all(cmds.map(args => new Promise(resolve => {
  const p = spawn(process.execPath, [path.join(scripts, script), ...args], { env: { ...s.env, ...env }, cwd: s.project });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('exit', code => resolve({ code, out, args }));
})));
const GAP = { PACING_TEST_WRITE_GAP_MS: '40' };

describe('many processes at once', () => {
  test('ten settings written side by side: every one is kept', async () => {
    const s = sandbox();
    try {
      s.config(['show']);
      const cmds = [['set', '1', 'opus', 'xhigh'], ['set', '2', 'sonnet', 'low'], ['set', '3', 'haiku', 'low'], ['weight', '2'], ['premium', 'opus'], ['fallback', 'sonnet', 'high'],
        ['reader', 'ladder'], ['verifier', 'sonnet', 'low'], ['next', 'off'], ['add', 'haiku', 'medium']];
      const done = await together(s, 'config.mjs', cmds, GAP);
      for (const d of done) assert.equal(d.code, 0, d.args.join(' ') + ': ' + d.out);
      const c = JSON.parse(s.read('config.json'));
      assert.deepEqual(c.tiers.map(t => t.model + ' ' + t.effort), ['opus xhigh', 'sonnet low', 'haiku low', 'haiku medium']);
      assert.deepEqual([c.lastDayWeight, c.premium, c.fallback, c.reader, c.verifier, c.setNextModel],
        [2, 'opus', { model: 'sonnet', effort: 'high' }, 'ladder', { model: 'sonnet', effort: 'low' }, false]);
      assert.ok(!fs.readdirSync(s.data).some(f => f.endsWith('.tmp') || f.endsWith('.lock')), 'no temporary or lock file is left');
    } finally { s.cleanup(); }
  });
  test('twenty agents noting a fact each, and one replacing a line: all lines are there', async () => {
    const s = sandbox();
    try {
      s.config(['note', 'reader', 'the stale fact']);
      const cmds = [...Array.from({ length: 20 }, (_, i) => ['note', 'reader', 'fact number ' + i]), ['note', 'reader', '--replace', 'stale fact', 'the fact as it is now']];
      const done = await together(s, 'config.mjs', cmds, GAP);
      for (const d of done) assert.equal(d.code, 0, d.args.join(' ') + ': ' + d.out);
      const dir = path.join(s.data, 'notes');
      const file = path.join(dir, fs.readdirSync(dir)[0], 'reader.md');
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.startsWith('- '));
      assert.equal(lines.length, 21, lines.join('\n'));
      for (let i = 0; i < 20; i++) assert.ok(lines.some(l => l.startsWith('- fact number ' + i + ' (')), 'fact ' + i);
      assert.ok(lines.some(l => l.startsWith('- the fact as it is now (')));
      assert.ok(!lines.some(l => l.includes('stale fact')));
      assert.equal(fs.readFileSync(file, 'utf8').match(/^# reader notes for /gm).length, 1, 'one header');
    } finally { s.cleanup(); }
  });
  test('the first note of a role from many agents at once: one header, every line', async () => {
    const s = sandbox();
    try {
      const done = await together(s, 'config.mjs', Array.from({ length: 12 }, (_, i) => ['note', 'verifier', 'first fact ' + i]), GAP);
      for (const d of done) assert.equal(d.code, 0, d.out);
      const dir = path.join(s.data, 'notes');
      const text = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0], 'verifier.md'), 'utf8');
      assert.equal(text.match(/^# verifier notes for /gm).length, 1);
      assert.equal(text.split(/\r?\n/).filter(l => l.startsWith('- ')).length, 12);
    } finally { s.cleanup(); }
  });
  test('readings from several sessions at once: the log has every one, state.json is whole and the newest', async () => {
    const s = sandbox();
    try {
      s.write('../settings.json', JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } }));
      const cmds = Array.from({ length: 10 }, (_, i) => ['--all', String(10 + i), '--reset', RESET, '--now', '2026-11-13T12:' + String(10 + i) + ':00.000Z']);
      const done = await together(s, 'budget.mjs', cmds, GAP);
      for (const d of done) assert.equal(d.code, 0, d.out);
      const log = s.read('log.jsonl').trim().split('\n').map(l => JSON.parse(l));
      assert.equal(log.length, 10);
      assert.deepEqual(log.map(e => e.all).sort((a, b) => a - b), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      // never an older reading over a newer one
      assert.equal(JSON.parse(s.read('state.json')).t, '2026-11-13T12:19:00.000Z');
      // the user's settings file keeps its other keys, and parses
      const settings = JSON.parse(s.read('../settings.json'));
      assert.deepEqual([settings.theme, settings.permissions.allow[0], settings.model], ['dark', 'Bash(ls)', 'fable']);
    } finally { s.cleanup(); }
  });
  test('two sessions filing the same handover away, and two asking for a new one in the same minute', async () => {
    const s = sandbox();
    try {
      const made = await together(s, 'config.mjs', [['handover', 'new'], ['handover', 'new'], ['handover', 'new']]);
      const names = made.map(d => d.out.match(/to: (.*)$/m)[1]);
      assert.equal(new Set(names).size, 3, 'three names: ' + names.join(', '));
      fs.writeFileSync(names[0], '# handover\n');
      const done = await together(s, 'config.mjs', [['handover', 'done'], ['handover', 'done'], ['handover', 'done']]);
      for (const d of done) assert.equal(d.code, 0, d.out);
      assert.equal(done.filter(d => /^picked up: /m.test(d.out)).length, 1, done.map(d => d.out).join('|'));
      assert.ok(fs.existsSync(path.join(path.dirname(names[0]), 'done', path.basename(names[0]))));
    } finally { s.cleanup(); }
  });
  test('two first runs at once: one config, one BRIEF.local.md, both end well', async () => {
    const s = sandbox();
    try {
      const done = await together(s, 'config.mjs', [['init'], ['init'], ['init'], ['init']], GAP);
      for (const d of done) assert.equal(d.code, 0, d.out);
      assert.equal(JSON.parse(s.read('config.json')).tiers.length, 3);
      assert.equal(done.filter(d => /BRIEF\.local\.md created/.test(d.out)).length, 1);
    } finally { s.cleanup(); }
  });
});

describe('the helper itself', () => {
  const tmp = () => { const s = sandbox(); return { s, f: path.join(s.home, 'x', 'file.json') }; };
  test('updateFile makes the change again when the file changed under it', () => {
    const { s, f } = tmp();
    try {
      atomicWrite(f, '1');
      let runs = 0;
      const out = updateFile(f, text => { runs++; if (runs === 1) fs.writeFileSync(f, '10'); return String(Number(text) + 1); });
      assert.equal(runs, 2);
      assert.equal(out, '11');
      assert.equal(fs.readFileSync(f, 'utf8'), '11');
    } finally { s.cleanup(); }
  });
  test('it gives up with a clear message when the file never holds still', () => {
    const { s, f } = tmp();
    try {
      atomicWrite(f, '0');
      let n = 0;
      assert.throws(() => updateFile(f, text => { fs.writeFileSync(f, String(++n)); return text + '!'; }, { tries: 3 }), /could not write file\.json: it kept changing under the write \(3 tries\); try again/);
    } finally { s.cleanup(); }
  });
  test('null from the change leaves the file alone; a missing file is created', () => {
    const { s, f } = tmp();
    try {
      assert.equal(updateFile(f, () => null), null);
      assert.ok(!fs.existsSync(f));
      assert.deepEqual(updateJson(f, v => ({ n: (v ? v.n : 0) + 1 })), { n: 1 });
      assert.deepEqual(updateJson(f, v => ({ n: v.n + 1 })), { n: 2 });
      const before = fs.statSync(f).mtimeMs;
      updateJson(f, () => null);
      assert.equal(fs.statSync(f).mtimeMs, before);
    } finally { s.cleanup(); }
  });
  test('a lock left by a process that died is taken over; a living one is waited for, then reported', () => {
    const { s, f } = tmp();
    try {
      atomicWrite(f, 'a');
      fs.writeFileSync(f + '.lock', '');
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(f + '.lock', old, old);
      assert.equal(updateFile(f, () => 'b'), 'b');
      assert.deepEqual(fs.readdirSync(path.dirname(f)), ['file.json'], 'no lock, and no renamed stale lock');
      // a fresh lock that nobody releases
      fs.writeFileSync(f + '.lock', '');
      assert.throws(() => withLock(f, () => 1, { waitMs: 150 }), /another process holds its lock/);
      fs.unlinkSync(f + '.lock');
    } finally { s.cleanup(); }
  });
  test('the wait outlasts the stale age: a writer that meets the lock of a process just killed waits, takes it over and writes', () => {
    const { s, f } = tmp();
    try {
      assert.ok(LOCK_WAIT_MS > LOCK_STALE_MS, 'by default too: ' + LOCK_WAIT_MS + ' against ' + LOCK_STALE_MS);
      atomicWrite(f, 'a');
      fs.writeFileSync(f + '.lock', '');
      const t0 = Date.now();
      assert.equal(updateFile(f, () => 'b', { waitMs: 3000, staleMs: 300 }), 'b');
      assert.ok(Date.now() - t0 >= 250, 'not before it was stale: ' + (Date.now() - t0) + ' ms');
      assert.deepEqual(fs.readdirSync(path.dirname(f)), ['file.json']);
    } finally { s.cleanup(); }
  });
  // one call of the fs module answered by `fake` while fn runs (safe.mjs
  // calls them on the same module object); fake returns undefined to let the
  // real one answer
  const stubbed = (name, fake, fn) => {
    const real = fs[name];
    fs[name] = (...a) => { const r = fake(...a); return r === undefined ? real(...a) : r; };
    try { return fn(); } finally { fs[name] = real; }
  };
  const refuse = code => { throw Object.assign(new Error(code + ': refused'), { code }); };
  const isLock = p => String(p).endsWith('.lock');
  test('a folder that refuses the lock file is an error after a few tries, never a spin: no lock was in the way', () => {
    const { s, f } = tmp();
    try {
      for (const code of ['EACCES', 'EPERM']) {
        const t0 = Date.now();
        let ran = false, tries = 0;
        assert.throws(() => stubbed('openSync', p => { if (isLock(p)) { tries++; refuse(code); } }, () => withLock(f, () => { ran = true; }, { waitMs: 5000 })),
          new RegExp('^Error: could not write file\\.json: its folder cannot be written \\(.*[\\\\/]x, ' + code + '\\)$'));
        assert.equal(ran, false);
        assert.equal(tries, 10);
        assert.ok(Date.now() - t0 < 2500, 'well within the wait: ' + (Date.now() - t0) + ' ms');
      }
      // one refusal while a lock just deleted is still open elsewhere is waited out
      let once = 0;
      assert.equal(stubbed('openSync', p => { if (isLock(p) && !once++) refuse('EPERM'); }, () => withLock(f, () => 7, { waitMs: 5000 })), 7);
      assert.ok(!fs.existsSync(f + '.lock'));
    } finally { s.cleanup(); }
  });
  test('a lock that can be neither looked at nor taken over is waited for, then reported: every round checks the wait', () => {
    const { s, f } = tmp();
    try {
      // refused, and the look at the lock is refused too
      let t0 = Date.now();
      assert.throws(() => stubbed('openSync', p => { if (isLock(p)) refuse('EACCES'); },
        () => stubbed('statSync', p => { if (isLock(p)) refuse('EPERM'); }, () => withLock(f, () => 1, { waitMs: 200 }))), /another process holds its lock/);
      assert.ok(Date.now() - t0 < 2500, (Date.now() - t0) + ' ms');
      // a stale lock that will not move
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.lock', '');
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(f + '.lock', old, old);
      t0 = Date.now();
      assert.throws(() => stubbed('renameSync', p => { if (isLock(p)) refuse('EPERM'); }, () => withLock(f, () => 1, { waitMs: 200 })), /another process holds its lock/);
      assert.ok(Date.now() - t0 < 2500, (Date.now() - t0) + ' ms');
      assert.ok(fs.existsSync(f + '.lock'));
    } finally { s.cleanup(); }
  });
  test('a takeover never removes a fresh lock: one that replaced the stale lock between the look and the takeover is put back', () => {
    const { s, f } = tmp();
    try {
      // another process took the stale lock over a moment ago: this one still
      // sees the old age at its first look
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.lock', 'theirs');
      let looks = 0;
      const real = fs.statSync;
      assert.throws(() => stubbed('statSync', p => { if (isLock(p) && !looks++) return { ...real(p), mtimeMs: Date.now() - 60000 }; },
        () => withLock(f, () => 1, { waitMs: 200 })), /another process holds its lock/);
      assert.ok(looks > 1);
      assert.equal(fs.readFileSync(f + '.lock', 'utf8'), 'theirs');
      assert.deepEqual(fs.readdirSync(path.dirname(f)), ['file.json.lock'], 'nothing left beside it');
    } finally { s.cleanup(); }
  });
  test('many processes finding one stale lock at once: one takes it over at a time, and every change is kept', async () => {
    const { s, f } = tmp();
    try {
      atomicWrite(f, JSON.stringify({ n: 0 }));
      fs.writeFileSync(f + '.lock', '');
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(f + '.lock', old, old);
      const code = 'const { updateJson } = await import(process.argv[1]); updateJson(process.argv[2], v => ({ n: v.n + 1 }), { tries: 40 });';
      const done = await Promise.all(Array.from({ length: 12 }, () => new Promise(resolve => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', code, pathToFileURL(path.join(scripts, 'safe.mjs')).href, f], { env: { ...s.env, ...GAP } });
        let out = '';
        p.stderr.on('data', d => { out += d; });
        p.on('exit', c => resolve({ code: c, out }));
      })));
      for (const d of done) assert.equal(d.code, 0, d.out);
      assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).n, 12);
      assert.deepEqual(fs.readdirSync(path.dirname(f)), ['file.json'], 'no lock, no renamed stale lock, no temporary file');
    } finally { s.cleanup(); }
  });
  test('the lock file holds its owner\'s token, the process id and a random part: a new one for every lock', () => {
    const { s, f } = tmp();
    try {
      const seen = [];
      for (let i = 0; i < 2; i++) assert.equal(withLock(f, () => { seen.push(fs.readFileSync(f + '.lock', 'utf8')); return i; }), i);
      for (const t of seen) assert.match(t, new RegExp('^' + process.pid + '\\.[0-9a-f]{16}$'));
      assert.notEqual(seen[0], seen[1]);
      assert.ok(!fs.existsSync(f + '.lock'), 'released by its owner');
    } finally { s.cleanup(); }
  });
  test('a holder that stalled past the stale age does not remove its successor\'s lock', () => {
    const { s, f } = tmp();
    try {
      // inside this holder's change its lock went stale and another process
      // took it over: the file under the lock's name is that one's now
      assert.equal(withLock(f, () => {
        fs.unlinkSync(f + '.lock');
        fs.writeFileSync(f + '.lock', '4242.0123456789abcdef');
        return 'done';
      }), 'done');
      assert.equal(fs.readFileSync(f + '.lock', 'utf8'), '4242.0123456789abcdef', 'the successor still holds it');
      // and so when the change throws
      assert.throws(() => withLock(f + '2', () => { fs.writeFileSync(f + '2.lock', 'theirs'); throw new Error('stop'); }), /stop/);
      assert.equal(fs.readFileSync(f + '2.lock', 'utf8'), 'theirs');
      // a lock taken over and released meanwhile: nothing to remove, no error
      assert.equal(withLock(f + '3', () => { fs.unlinkSync(f + '3.lock'); return 1; }), 1);
      fs.unlinkSync(f + '.lock');
      fs.unlinkSync(f + '2.lock');
    } finally { s.cleanup(); }
  });
  test('the real course of it: the lock goes stale under a holder, a successor takes it over and is still at work when the holder ends', () => {
    const { s, f } = tmp();
    try {
      let inner = null, outer = null;
      withLock(f, () => {
        outer = fs.readFileSync(f + '.lock', 'utf8');
        const old = new Date(Date.now() - 60000);
        fs.utimesSync(f + '.lock', old, old);
        // the successor (here the same process, with a token of its own)
        withLock(f, () => { inner = fs.readFileSync(f + '.lock', 'utf8'); });
        // a third writer makes its lock while the first is still inside
        fs.writeFileSync(f + '.lock', 'third', { flag: 'wx' });
      });
      assert.ok(inner && outer && inner !== outer, 'two tokens');
      assert.equal(fs.readFileSync(f + '.lock', 'utf8'), 'third');
      assert.deepEqual(fs.readdirSync(path.dirname(f)), ['file.json.lock'], 'no renamed stale lock left');
    } finally { s.cleanup(); }
  });
  test('a command that ends inside a change removes its own lock, and only its own', async () => {
    const { s, f } = tmp();
    try {
      const code = 'const fs = (await import("node:fs")).default; const { withLock } = await import(process.argv[1]); const f = process.argv[2];'
        + 'withLock(f, () => { if (process.argv[3] === "taken") { fs.unlinkSync(f + ".lock"); fs.writeFileSync(f + ".lock", "successor"); } process.exit(3); });';
      const run = how => new Promise(resolve => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', code, pathToFileURL(path.join(scripts, 'safe.mjs')).href, f, how], { env: s.env });
        p.on('exit', resolve);
      });
      assert.equal(await run('own'), 3);
      assert.ok(!fs.existsSync(f + '.lock'), 'its own lock is gone');
      assert.equal(await run('taken'), 3);
      assert.equal(fs.readFileSync(f + '.lock', 'utf8'), 'successor');
    } finally { s.cleanup(); }
  });
  // what the file system says of a path, answered for one path (safe.mjs
  // asks through the same module object): a link can be tested where the
  // system lets no test make one
  const linked = (link, to, fn) => stubbed('lstatSync', p => (p === link ? { isSymbolicLink: () => true } : undefined),
    () => stubbed('realpathSync', p => (p === link ? (to === null ? refuse('ENOENT') : to) : undefined), fn));
  test('a target that is a symbolic link is written through: the temporary file and the rename are at the file it leads to', () => {
    const { s, f } = tmp();
    try {
      const real = path.join(s.home, 'dotfiles', 'settings.json'), link = path.join(s.home, 'x', 'settings.json');
      atomicWrite(real, 'old');
      fs.mkdirSync(path.dirname(link), { recursive: true });
      linked(link, real, () => atomicWrite(link, 'new'));
      assert.equal(fs.readFileSync(real, 'utf8'), 'new');
      assert.ok(!fs.existsSync(link), 'nothing was put in the link\'s place');
      assert.deepEqual(fs.readdirSync(path.dirname(real)), ['settings.json'], 'no temporary file left');
      // a link to a file that is not there yet: followed one step, relative to the link's folder
      const later = path.join(s.home, 'x', 'later', 'made.json');
      linked(link, null, () => stubbed('readlinkSync', p => (p === link ? path.join('later', 'made.json') : undefined), () => atomicWrite(link, 'first')));
      assert.equal(fs.readFileSync(later, 'utf8'), 'first');
      assert.ok(!fs.existsSync(link));
      // a plain file, and one not there yet, are written as before
      atomicWrite(f, 'plain');
      atomicWrite(f, 'again');
      assert.equal(fs.readFileSync(f, 'utf8'), 'again');
    } finally { s.cleanup(); }
  });
  test('a settings.json that is a real symbolic link stays one after a reading', t => {
    const s = sandbox();
    try {
      const real = path.join(s.home, 'dotfiles', 'settings.json'), link = path.join(s.home, '.claude', 'settings.json');
      atomicWrite(real, JSON.stringify({ theme: 'dark' }));
      fs.mkdirSync(path.dirname(link), { recursive: true });
      try { fs.symlinkSync(real, link, 'file'); } catch (e) {
        // Windows without the right to make links
        if (e.code === 'EPERM') { t.skip('this system does not let the test make a symbolic link'); return; }
        throw e;
      }
      assert.deepEqual(updateJson(link, v => ({ ...v, a: 1 })), { theme: 'dark', a: 1 });
      assert.ok(fs.lstatSync(link).isSymbolicLink(), 'still a link');
      assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { theme: 'dark', a: 1 });
      const r = s.budget(['--all', '30', '--reset', RESET, '--now', '2026-11-13T12:00:00.000Z']);
      assert.equal(r.code, 0, r.out + r.err);
      assert.ok(fs.lstatSync(link).isSymbolicLink(), 'still a link after a reading');
      assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { theme: 'dark', a: 1, model: 'opus', effortLevel: 'medium' });
      assert.deepEqual(fs.readdirSync(path.dirname(real)), ['settings.json']);
    } finally { s.cleanup(); }
  });
  test('atomicWrite waits out another process that has the file open (Windows refuses the rename meanwhile), and leaves no temporary file', async () => {
    const { s, f } = tmp();
    try {
      atomicWrite(f, 'old');
      // another process holds the target open for a moment, as a reader or a
      // virus scanner would
      const holder = spawn(process.execPath, ['-e', 'const fs=require("fs");fs.openSync(process.argv[1],"r");console.log("open");setTimeout(()=>{},300)', f]);
      await new Promise(resolve => holder.stdout.once('data', resolve));
      atomicWrite(f, 'new');
      await new Promise(resolve => holder.on('exit', resolve));
      assert.equal(fs.readFileSync(f, 'utf8'), 'new');
      assert.deepEqual(fs.readdirSync(path.dirname(f)).filter(n => n.endsWith('.tmp')), []);
    } finally { s.cleanup(); }
  });
});
