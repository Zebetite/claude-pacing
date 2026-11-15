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

const { atomicWrite, updateFile, updateJson, withLock } = await import(pathToFileURL(path.join(scripts, 'safe.mjs')).href);

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
      assert.ok(!fs.existsSync(f + '.lock'));
      // a fresh lock that nobody releases
      fs.writeFileSync(f + '.lock', '');
      assert.throws(() => withLock(f, () => 1, { waitMs: 150 }), /another process holds its lock/);
      fs.unlinkSync(f + '.lock');
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
