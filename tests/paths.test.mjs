// paths.mjs: where Claude Code's folder is (CLAUDE_CONFIG_DIR moves it, and
// the data folder with it), the one reader of the .jsonl files, and the
// desktop app's own files: which preset a reading writes (the entry of the
// account the session runs under, on Windows only) and what doctor.mjs says
// of it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sandbox, scripts, RESET } from './helpers.mjs';
import { MODELS } from '../pacing/skills/pacing/scripts/models.mjs';
import { installOf, readJsonl, isReading } from '../pacing/skills/pacing/scripts/paths.mjs';

const NOW = '2026-11-13T12:00:00.000Z';
// 30 % against a line of 20 %: throttle, so new sessions belong on Opus 5.5 medium
const READING = ['--all', '30', '--reset', RESET, '--now', NOW];
const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };
const doctorLine = (s, name, opts, now = NOW) => {
  const l = s.run('doctor.mjs', ['--now', now], opts).lines.find(x => x.slice(6, 16).trim() === name);
  return l ? l.slice(0, 4).trim() + ': ' + l.slice(18) : null;
};

describe('CLAUDE_CONFIG_DIR: Claude Code\'s folder somewhere else', () => {
  test('settings.json, the data folder and the transcripts are taken from it, by every script', withHome(s => {
    const dir = path.join(s.home, 'elsewhere'), there = { env: { CLAUDE_CONFIG_DIR: dir } };
    const data = (...p) => path.join(dir, 'pacing', ...p);
    // a transcript there, and one in ~/.claude that must not count
    const usage = (id, tokens) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-13T10:00:00Z', message: { id, model: MODELS.opus.id, usage: { input_tokens: tokens } } }) + '\n';
    fs.mkdirSync(path.join(dir, 'projects', 'p'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects', 'p', 's.jsonl'), usage('a', 1e6));
    fs.mkdirSync(path.join(s.home, '.claude', 'projects', 'p'), { recursive: true });
    fs.writeFileSync(path.join(s.home, '.claude', 'projects', 'p', 's.jsonl'), usage('b', 5e6));

    assert.equal(s.config(['where'], there).out.trim(), path.join(dir, 'pacing'));
    assert.match(s.config(['show'], there).out, /^config\.json created from the defaults$/m);
    assert.ok(fs.existsSync(data('config.json')));
    const r = s.budget(READING, there);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(JSON.parse(fs.readFileSync(data('state.json'), 'utf8')).all, 30);
    assert.equal(fs.readFileSync(data('log.jsonl'), 'utf8').trim().split('\n').length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { model: 'opus', effortLevel: 'medium' });
    // the rate's first estimate, made at that reading: the million input
    // tokens of the transcript there, over its 30 points
    const j = JSON.parse(s.budget(['--all', '31', '--reset', RESET, '--now', '2026-11-13T12:10:00.000Z', '--source', 'hook'], there).out.trim());
    assert.deepEqual([j.rateFrom, j.usdPerPoint], ['estimate', Math.round(MODELS.opus.price[0] / 30 * 1e4) / 1e4]);
    // the other scripts read the same folder
    assert.match(JSON.parse(s.hook(there).out).systemMessage, /weekly meter 31 % used/);
    assert.equal(doctorLine(s, 'reading', there, '2026-11-13T12:20:00.000Z'), 'ok: the last is 10 min old, automatic');
    assert.equal(doctorLine(s, 'folders', there), 'ok: the data folder and the notes folder take writes');
    assert.equal(JSON.parse(s.run('saved.mjs', ['--json', '--now', NOW], there).out).week.known, true);
    assert.match(s.config(['note', 'reader', 'a fact'], there).out.replace(/\\/g, '/'), new RegExp('^noted in ' + dir.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&') + '/pacing/notes/'));
    // nothing was written under ~/.claude
    assert.deepEqual(fs.readdirSync(path.join(s.home, '.claude')), ['projects']);
    // without the variable: ~/.claude, as before
    assert.equal(s.config(['where']).out.trim(), s.data);
  }));
});

describe('the .jsonl reader', () => {
  test('objects are rows; what does not parse or is no object is counted; a missing file and an unreadable one are told apart', withHome(s => {
    const f = s.write('x.jsonl', '{"t":"2026-11-13T12:00:00Z","all":5}\n\n{cut off\n[1,2]\n7\nnull\n  \r\n{"role":"reader"}\r\n');
    const r = readJsonl(f);
    assert.deepEqual([r.missing, r.damaged, r.bad], [false, false, 4]);
    assert.deepEqual(r.rows, [{ t: '2026-11-13T12:00:00Z', all: 5 }, { role: 'reader' }]);
    assert.deepEqual(readJsonl(s.file('none.jsonl')), { missing: true, damaged: false, rows: [], bad: 0 });
    // a folder in the file's place
    assert.deepEqual(readJsonl(s.data), { missing: false, damaged: true, rows: [], bad: 0 });
  }));
  test('a reading has a time and the weekly figure', () => {
    assert.ok(isReading({ t: '2026-11-13T12:00:00Z', all: 0 }));
    for (const e of [null, undefined, 5, 'x', [], [{ t: '2026-11-13T12:00:00Z', all: 5 }], {}, { all: 5 }, { t: 'when', all: 5 }, { t: '2026-11-13T12:00:00Z' }, { t: '2026-11-13T12:00:00Z', all: '5' }]) assert.ok(!isReading(e), JSON.stringify(e));
  });
  test('a log that is no file is an empty one for a dry reading, a damaged one for the self-check: neither crashes', withHome(s => {
    fs.mkdirSync(s.file('log.jsonl'), { recursive: true });
    const r = s.budget([...READING, '--dry']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(s.budget(['log']).out.trim(), 'no readings yet');
    assert.equal(doctorLine(s, 'reading'), 'warn: no reading yet -> type /pacing usage now');
  }));
});

// ---- the desktop app's preset ----
const A = 'aaaaaaaa-1111-4111-8111-111111111111', B = 'bbbbbbbb-2222-4222-8222-222222222222';
const WAS = { modelId: 'claude-sonnet-5-5', effort: 'low', worktree: false }, SET = { modelId: 'claude-opus-5-5', effort: 'medium', worktree: false };
const presetFile = (s, app) => path.join(s.env.LOCALAPPDATA, 'Claude-Data', app, 'ccd-session-presets.json');
const writePreset = (s, app, ids) => {
  fs.mkdirSync(path.dirname(presetFile(s, app)), { recursive: true });
  fs.writeFileSync(presetFile(s, app), JSON.stringify({ byAccount: Object.fromEntries(ids.map(id => [id, { presets: [{ id: 'p', settings: { modelId: 'claude-haiku-5-5', effort: 'low' } }], builtIns: { local: { settings: { ...WAS } } } }])) }));
};
const local = (s, app) => Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(presetFile(s, app), 'utf8')).byAccount).map(([id, a]) => [id, a.builtIns.local.settings]));
const presetLines = out => out.split(/\r?\n/).filter(l => l.startsWith('desktop app preset'));

describe('the desktop app\'s preset: the entry of the account the session runs under', () => {
  test('the engine names the account: its entry alone is written, in every profile\'s file', withHome(s => {
    writePreset(s, 'app1', [A, B]);
    writePreset(s, 'app2', [B, A]);
    // the id as the engine gives it, whatever its case
    const named = { env: { CLAUDE_CODE_ACCOUNT_UUID: A.toUpperCase() } };
    const r = s.budget(READING, named);
    assert.equal(r.code, 0, r.out + r.err);
    for (const app of ['app1', 'app2']) assert.deepEqual(local(s, app), { [A]: SET, [B]: WAS }, app);
    assert.deepEqual(presetLines(r.out), ['app1', 'app2'].map(app => 'desktop app preset: new local sessions now start on Opus 5.5 medium (' + presetFile(s, app) + ')'));
    // the account's own presets, and the file's shape, stay
    const j = JSON.parse(fs.readFileSync(presetFile(s, 'app1'), 'utf8'));
    assert.deepEqual(j.byAccount[A].presets, [{ id: 'p', settings: { modelId: 'claude-haiku-5-5', effort: 'low' } }]);
    assert.equal(doctorLine(s, 'next model', named), 'ok: a reading sets settings.json and the desktop app\'s preset (this account\'s)');
  }));
  test('an account the file does not hold: nothing is written, and nothing said', withHome(s => {
    writePreset(s, 'app1', [B]);
    const r = s.budget(READING, { env: { CLAUDE_CODE_ACCOUNT_UUID: A } });
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(local(s, 'app1'), { [B]: WAS });
    assert.deepEqual(presetLines(r.out), []);
    assert.match(r.out, /^settings\.json: the terminal CLI now defaults to Opus 5\.5 medium/m);
  }));
  test('a copy the app installed lies under its account\'s folder: that profile\'s file, that account\'s entry', withHome(s => {
    writePreset(s, 'app1', [A, B]);
    writePreset(s, 'app2', [A, B]);
    // <Claude-Data>/<app>/rpm/<account, 8 characters>/<organisation>/plugin_<id>/skills/pacing/scripts
    const installed = path.join(s.env.LOCALAPPDATA, 'Claude-Data', 'app1', 'rpm', 'aaaaaaaa', 'cccccccc', 'plugin_01', 'skills', 'pacing', 'scripts');
    fs.mkdirSync(installed, { recursive: true });
    for (const f of fs.readdirSync(scripts)) fs.copyFileSync(path.join(scripts, f), path.join(installed, f));
    const r = spawnSync(process.execPath, [path.join(installed, 'budget.mjs'), ...READING], { cwd: s.project, env: s.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(local(s, 'app1'), { [A]: SET, [B]: WAS });
    assert.deepEqual(local(s, 'app2'), { [A]: WAS, [B]: WAS }, 'another profile is left alone');
    assert.deepEqual(presetLines(r.stdout), ['desktop app preset: new local sessions now start on Opus 5.5 medium (' + presetFile(s, 'app1') + ')']);
    // the account the engine names goes before the folder's
    writePreset(s, 'app1', [A, B]);
    spawnSync(process.execPath, [path.join(installed, 'budget.mjs'), ...READING], { cwd: s.project, env: { ...s.env, CLAUDE_CODE_ACCOUNT_UUID: B }, encoding: 'utf8' });
    assert.deepEqual(local(s, 'app1'), { [A]: WAS, [B]: SET });
    assert.deepEqual(local(s, 'app2'), { [A]: WAS, [B]: WAS });
  }));
  test('told neither way (a terminal session, a copy from elsewhere): every entry, as before', withHome(s => {
    writePreset(s, 'app1', [A, B]);
    const r = s.budget(READING);
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(local(s, 'app1'), { [A]: SET, [B]: SET });
    assert.equal(presetLines(r.out).length, 1);
    assert.equal(doctorLine(s, 'next model'), 'ok: a reading sets settings.json and the desktop app\'s preset (every account\'s)');
    // a name that is no id is no account
    writePreset(s, 'app1', [A, B]);
    s.budget(['--all', '10', '--reset', RESET, '--now', '2026-11-13T12:05:00.000Z'], { env: { CLAUDE_CODE_ACCOUNT_UUID: 'me' } });
    assert.deepEqual(Object.values(local(s, 'app1')).map(x => x.modelId), ['claude-fable-5-2', 'claude-fable-5-2']);
  }));
  test('where an install lies: the path\'s folders, by the app\'s layout only', () => {
    const base = path.join(path.resolve('/'), 'Local', 'Claude-Data');
    const inst = installOf(path.join(base, 'claude_x', 'rpm', '6CBAB818', 'e61a5252', 'plugin_01Aq', 'skills', 'pacing', 'scripts', 'budget.mjs'), base);
    assert.deepEqual(inst, { app: path.join(base, 'claude_x'), account: '6cbab818' });
    for (const p of [path.join(base, 'claude_x', 'rpm', '6cbab818', 'plugin_01Aq', 'x.mjs'), path.join(base, 'claude_x', 'other', 'a', 'b', 'plugin_1', 'x.mjs'),
      path.join(path.resolve('/'), 'home', '.claude', 'plugins', 'rpm', 'a', 'b', 'plugin_1', 'x.mjs'), base, undefined]) assert.equal(installOf(p, base), null, String(p));
    assert.equal(installOf(path.join(base, 'claude_x', 'rpm', 'a', 'b', 'plugin_1', 'x.mjs'), null), null);
  });
});

describe('off Windows the desktop app\'s folder is not known', () => {
  const mac = { env: { PACING_TEST_PLATFORM: 'darwin' } };
  test('the preset is not written, settings.json is, and the self-check says so plainly', withHome(s => {
    writePreset(s, 'app1', [A]);
    const before = fs.readFileSync(presetFile(s, 'app1'), 'utf8');
    const r = s.budget(READING, mac);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(fs.readFileSync(presetFile(s, 'app1'), 'utf8'), before);
    assert.deepEqual(presetLines(r.out), []);
    assert.deepEqual(JSON.parse(s.read('../settings.json')), { model: 'opus', effortLevel: 'medium' });
    assert.equal(doctorLine(s, 'next model', mac), 'ok: a reading sets settings.json; the desktop app\'s preset is written on Windows only');
    for (const p of ['linux', 'freebsd']) assert.match(doctorLine(s, 'next model', { env: { PACING_TEST_PLATFORM: p } }), /written on Windows only$/);
  }));
  test('nor are the installed copies or a side session\'s record looked for there', withHome(s => {
    const b = path.join(s.env.LOCALAPPDATA, 'Claude-Data', 'claude_x', 'rpm', 'aa', 'bb');
    fs.mkdirSync(path.join(b, 'plugin_01', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(b, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(b, 'plugin_01', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'pacing', version: '99.0.0' }));
    assert.match(doctorLine(s, 'version'), /^warn: running .*, but 99\.0\.0 is installed/);
    assert.match(doctorLine(s, 'version', mac), /^ok: running .*; no installed copy found to compare$/);
    s.write('../../AppData/Local/Claude-Data/app/claude-code-sessions/acct/org/local_1.json', JSON.stringify({ sessionId: 'local_1', spawnedFrom: { sessionId: 'local_0' } }));
    const spawned = env => JSON.parse(s.budget(['--all', '10', '--reset', RESET, '--now', NOW, '--source', 'hook', '--dry'], { env: { CLAUDE_CODE_HOST_SESSION_ID: 'local_1', ...env } }).out.trim()).spawned;
    assert.equal(spawned({}), true);
    assert.equal(spawned(mac.env), null);
  }));
});

describe('the self-check\'s line on what new sessions start on', () => {
  test('no preset found; the switch off; a settings.json that does not parse', withHome(s => {
    assert.equal(doctorLine(s, 'next model'), 'ok: a reading sets settings.json; no desktop app preset found');
    s.write('../settings.json', '{"model": ');
    assert.equal(doctorLine(s, 'next model'), 'warn: settings.json does not parse: a reading leaves it alone -> repair ' + path.join(s.home, '.claude', 'settings.json'));
    const r = s.budget(READING);
    assert.match(r.out, /^settings\.json not changed: /m);
    assert.equal(s.read('../settings.json'), '{"model": ');
    s.config(['next', 'off']);
    assert.equal(doctorLine(s, 'next model'), 'ok: off: a reading leaves settings.json and the desktop app\'s preset alone');
  }));
});
