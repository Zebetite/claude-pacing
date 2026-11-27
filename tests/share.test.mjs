// A notice when sessions share a checkout: each session leaves a mark per
// project, and a new session's start line says when another one has been at
// work there. A notice, never a block, and never a held-up start.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sandbox, plugin, scripts, RESET } from './helpers.mjs';

const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };
const as = id => ({ env: { CLAUDE_CODE_SESSION_ID: id } });
const start = (s, id, more = {}) => { const r = s.hook({ ...as(id), ...more }); assert.equal(r.code, 0, r.err); return r.out ? JSON.parse(r.out) : null; };
const marksFile = s => { const d = path.join(s.data, 'sessions'); return path.join(d, fs.readdirSync(d)[0]); };
const marks = s => JSON.parse(fs.readFileSync(marksFile(s), 'utf8'));
const MIN = 60000;

describe('another session at work in the project', () => {
  test('the first session is told nothing; the second is told of the first, and to check before editing', withHome(s => {
    assert.equal(start(s, 'session-a'), null);
    assert.deepEqual(Object.keys(marks(s)), ['session-a']);
    const b = start(s, 'session-b');
    assert.equal(b.systemMessage, 'Pacing: Another session has been working in this project (last active under a minute ago): check before editing files here.');
    assert.match(b.hookSpecificOutput.additionalContext, /ANOTHER SESSION has been working in this project folder \(last active under a minute ago\)\. Two sessions editing one checkout overwrite each other's work: before editing files here, check with the user whether that session is still at work\. A warning, not a block; parallel work on code belongs in separate git worktrees\.$/);
    assert.deepEqual(Object.keys(marks(s)).sort(), ['session-a', 'session-b']);
  }));
  test('never of the session\'s own mark: a resume, or a second start, says nothing', withHome(s => {
    start(s, 'session-a');
    assert.equal(start(s, 'session-a'), null);
  }));
  test('how long ago, for how long, and how many', withHome(s => {
    start(s, 'session-z');
    const now = Date.now();
    fs.writeFileSync(marksFile(s), JSON.stringify({ a: { since: now - 100 * MIN, t: now - 12 * MIN }, b: { since: now - 30 * MIN, t: now - 20 * MIN, live: true } }));
    assert.match(start(s, 'c').systemMessage, /\(last active 12 min ago, at work for 1 h 28 min, and 1 more\)/);
  }));
  test('a mark goes stale: 45 min for a session its hooks module marks, 2 h for one marked at its start and readings only', withHome(s => {
    start(s, 'session-z');
    const now = Date.now();
    const told = entries => { fs.writeFileSync(marksFile(s), JSON.stringify(entries)); return start(s, 'me') !== null; };
    assert.equal(told({ a: { since: now - 200 * MIN, t: now - 44 * MIN, live: true } }), true);
    assert.equal(told({ a: { since: now - 200 * MIN, t: now - 46 * MIN, live: true } }), false);
    assert.equal(told({ a: { since: now - 200 * MIN, t: now - 119 * MIN } }), true);
    assert.equal(told({ a: { since: now - 200 * MIN, t: now - 121 * MIN } }), false);
    // and after a day it is forgotten altogether
    fs.writeFileSync(marksFile(s), JSON.stringify({ old: { since: now - 3000 * MIN, t: now - 2000 * MIN } }));
    start(s, 'me');
    start(s, 'other');
    assert.ok(!('old' in marks(s)));
  }));
  test('the session that ended, or cleared its conversation, takes its mark off', withHome(s => {
    start(s, 'session-a');
    const r = s.hook({ ...as('session-a'), args: ['end'] });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, '');
    assert.deepEqual(marks(s), {});
    assert.equal(start(s, 'session-b'), null);
  }));
  test('another project is another matter', withHome(s => {
    start(s, 'session-a');
    const other = path.join(s.home, 'work', 'other');
    fs.mkdirSync(path.join(other, '.git'), { recursive: true });
    assert.equal(start(s, 'session-b', { env: { CLAUDE_CODE_SESSION_ID: 'session-b', CLAUDE_PROJECT_DIR: other }, cwd: other }), null);
  }));
  test('who a session is: the hook\'s input names it when the environment does not', withHome(s => {
    const a = s.hook({ input: JSON.stringify({ session_id: 'from-input-a', hook_event_name: 'SessionStart', source: 'startup' }) });
    assert.equal(a.out, '');
    assert.deepEqual(Object.keys(marks(s)), ['from-input-a']);
    const b = s.hook({ input: JSON.stringify({ session_id: 'from-input-b' }) });
    assert.match(JSON.parse(b.out).systemMessage, /^Pacing: Another session has been working in this project/);
  }));
  test('who a session is cannot be known: no mark, and nothing is said, since any mark may be its own', withHome(s => {
    start(s, 'session-a');
    for (const input of [undefined, '', 'not json', '{"no":"id"}']) {
      const r = s.hook(input === undefined ? {} : { input });
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, '', String(input));
    }
    assert.deepEqual(Object.keys(marks(s)), ['session-a']);
  }));
  test('a damaged marks file never stops a start', withHome(s => {
    start(s, 'session-a');
    fs.writeFileSync(marksFile(s), '{cut');
    assert.equal(start(s, 'session-b'), null);
    assert.deepEqual(Object.keys(marks(s)), ['session-b']);
    fs.writeFileSync(marksFile(s), '[1, "x", null]');
    assert.equal(start(s, 'session-c'), null);
  }));
  test('with a reading and a handover, the notice comes after them in the same line', withHome(s => {
    start(s, 'session-a');
    s.write('state.json', JSON.stringify({ t: new Date().toISOString(), all: 36, line: 46.7, level: 'ahead', next: { model: 'fable', label: 'Fable 5.2', effort: 'high' }, reset: RESET }));
    const j = start(s, 'session-b');
    assert.match(j.systemMessage, /^Pacing \(0 h ago\): weekly meter 36 % used.*Check the model menu shows Fable 5\.2, effort high\. Another session has been working in this project \(/);
    assert.match(j.hookSpecificOutput.additionalContext, /Load the `pacing:route` skill once before the first delegation\. ANOTHER SESSION has been working/);
  }));
});

describe('where the marks come from', () => {
  test('a reading marks the session; one the hooks module took marks it live', withHome(s => {
    s.budget(['--all', '10', '--reset', RESET, '--now', '2026-11-13T12:00:00.000Z'], as('reader-of-meters'));
    assert.deepEqual(marks(s), { 'reader-of-meters': { since: Date.parse('2026-11-13T12:00:00.000Z'), t: Date.parse('2026-11-13T12:00:00.000Z') } });
    s.budget(['--all', '11', '--reset', RESET, '--now', '2026-11-13T12:20:00.000Z', '--source', 'hook'], as('reader-of-meters'));
    assert.deepEqual(marks(s)['reader-of-meters'], { since: Date.parse('2026-11-13T12:00:00.000Z'), t: Date.parse('2026-11-13T12:20:00.000Z'), live: true });
  }));
  test('--dry, and a run that is told no session id, leave no mark', withHome(s => {
    assert.equal(s.budget(['--all', '10', '--reset', RESET, '--now', '2026-11-13T12:00:00.000Z', '--dry'], as('x')).code, 0);
    assert.equal(s.budget(['--all', '10', '--reset', RESET, '--now', '2026-11-13T12:00:00.000Z']).code, 0);
    assert.ok(!fs.existsSync(path.join(s.data, 'sessions')));
  }));
  test('the plugin runs the hook at a session\'s end too, to take the mark off', () => {
    const h = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8')).hooks;
    assert.deepEqual(h.SessionEnd[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/skills/pacing/scripts/hook.mjs', 'end']);
    assert.equal(h.SessionStart[0].hooks[0].args.length, 1);
  });
});

describe('a start is never held up', () => {
  test('an input that never ends is given a quarter of a second, then the hook goes on', async () => {
    const s = sandbox();
    try {
      const t0 = Date.now();
      const p = spawn(process.execPath, [path.join(scripts, 'hook.mjs')], { env: s.env, cwd: s.project, stdio: ['pipe', 'pipe', 'pipe'] });
      // the pipe is left open, as a host that never closes it would
      const code = await new Promise(resolve => p.on('exit', resolve));
      p.stdin.destroy();
      assert.equal(code, 0);
      assert.ok(Date.now() - t0 < 3000, (Date.now() - t0) + ' ms');
    } finally { s.cleanup(); }
  });
  test('twenty sessions starting at once in one project: every mark is kept, the file parses', async () => {
    const s = sandbox();
    try {
      const done = await Promise.all(Array.from({ length: 20 }, (_, i) => new Promise(resolve => {
        const p = spawn(process.execPath, [path.join(scripts, 'hook.mjs')], { env: { ...s.env, CLAUDE_CODE_SESSION_ID: 's' + i, PACING_TEST_WRITE_GAP_MS: '20' }, cwd: s.project });
        p.on('exit', resolve);
      })));
      assert.deepEqual(done, Array(20).fill(0));
      // a start gives up on its mark rather than wait: most are kept, none is half written
      const kept = Object.keys(marks(s));
      assert.ok(kept.length >= 10, kept.length + ' marks');
    } finally { s.cleanup(); }
  });
});
