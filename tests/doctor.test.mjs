// doctor.mjs: the self-check. Each check a line (ok, warn or fail, a name,
// what was found, a step after "->" for a warn or a fail), a summary line,
// exit code 1 only when a check failed; --json the same as one JSON line.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, plugin, RESET } from './helpers.mjs';
import { projectSlug } from '../pacing/skills/pacing/scripts/paths.mjs';

const NOW = '2026-11-13T12:00:00.000Z';
const at = min => new Date(Date.parse(NOW) + min * 60000).toISOString();
const VERSION = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const NAMES = ['version', 'hooks', 'reading', 'per-model', 'week', 'settings', 'token rate', 'agents', 'folders'];

const reading = (min, more = {}) => ({ t: at(min), all: 20, premium: 30, premiumModel: 'fable', premiumOut: false, line: 25, level: 'ahead', reset: RESET, source: 'hook', full: true, ...more });
const writeLog = (s, entries) => s.write('log.jsonl', entries.map(e => JSON.stringify(e) + '\n').join(''));
const writeState = (s, e) => s.write('state.json', JSON.stringify(e, null, 2) + '\n');
const agentsFile = s => path.join('agents', projectSlug(s.project) + '.jsonl');
const record = (min, more = {}) => JSON.stringify({ t: at(min), role: 'implementer', id: 'a1', model: 'sonnet', effort: 'medium', tokens: 84000, resumed: false, ...more }) + '\n';
const installCopy = (s, version) => {
  const b = path.join(s.env.LOCALAPPDATA, 'Claude-Data', 'claude_x', 'rpm', 'aa', 'bb');
  fs.mkdirSync(path.join(b, 'plugin_01', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({ plugins: [{ id: 'plugin_01', name: 'pacing' }] }));
  fs.writeFileSync(path.join(b, 'plugin_01', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'pacing', version }));
};
// a setup where pacing works: a fresh automatic full reading, the settings,
// a learned rate, agent records, the app's copy the same as this one
const healthy = () => {
  const s = sandbox();
  const e = reading(-10);
  writeLog(s, [reading(-200, { source: undefined, full: undefined }), e]);
  writeState(s, { ...e, delta: -5, next: { model: 'fable', label: 'Fable 5.2', effort: 'high' } });
  s.writeConfig({ tiers: [{ model: 'fable', label: 'Fable 5.2', effort: 'high' }, { model: 'opus', label: 'Opus 5.5', effort: 'medium' }, { model: 'sonnet', label: 'Sonnet 5.5', effort: 'medium' }],
    lastDayWeight: 1.5, setNextModel: true, compactAsk: true, agentNotices: true, switchAsk: true, autoReload: true, agentsPanel: 'auto', premium: 'fable',
    fallback: { model: 'opus', effort: 'high' }, reader: { model: 'haiku', effort: 'medium' }, verifier: { model: 'haiku', effort: 'medium' }, installed: '2026-11-01' });
  s.write('rate.json', JSON.stringify({ reset: RESET, from: 10, to: 16, tokens: 6000000, carried: null }) + '\n');
  s.write(agentsFile(s), record(-60) + record(-30, { resumed: true }));
  installCopy(s, VERSION);
  return s;
};
const doctor = (s, args = []) => {
  const r = s.run('doctor.mjs', ['--now', NOW, ...args]);
  const rows = r.lines.filter(Boolean);
  // the check named, as { status, text }
  const line = name => {
    const l = rows.find(x => x.slice(6, 16).trim() === name);
    return l ? { status: l.slice(0, 4).trim(), text: l.slice(18) } : null;
  };
  return { ...r, rows, line, summary: rows.at(-1) };
};
const isWarn = (r, name, re) => { const l = r.line(name); assert.equal(l.status, 'warn', name + ': ' + l.text); assert.match(l.text, re); };
const isOk = (r, name, re) => { const l = r.line(name); assert.equal(l.status, 'ok', name + ': ' + l.text); if (re) assert.match(l.text, re); };

describe('doctor.mjs', () => {
  test('a healthy setup: every check ok, short lines, exit code 0', () => {
    const s = healthy();
    try {
      const r = doctor(s);
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.rows.length, 10);
      assert.deepEqual(r.rows.slice(0, 9).map(l => l.slice(6, 16).trim()), NAMES);
      for (const n of NAMES) isOk(r, n);
      assert.equal(r.summary, 'All 9 checks pass.');
      for (const l of r.rows) assert.ok(l.length <= 100, l);
      isOk(r, 'version', new RegExp('^running ' + VERSION.replace(/\./g, '\\.') + ', the app holds '));
      isOk(r, 'hooks', /^it took a reading 10 min ago$/);
      isOk(r, 'reading', /^the last is 10 min old, automatic and full$/);
      isOk(r, 'per-model', /^Fable 5\.2 read 10 min ago, at 30 %$/);
      isOk(r, 'week', /^resets Thu 19 Nov 12:00, in 6 days; the log agrees$/);
      isOk(r, 'settings', /^compact on, notify on, switch on, reload on, 3 tiers$/);
      isOk(r, 'token rate', /^1M tokens per point, from 6 points this week$/);
      isOk(r, 'agents', /^2 records, the last 30 min ago$/);
      isOk(r, 'folders', /^the data folder and the notes folder take writes$/);
    } finally { s.cleanup(); }
  });

  test('nothing set up yet: no crash, the readings missing are the warnings, the rest says why it is fine', () => {
    const s = sandbox();
    try {
      const r = doctor(s);
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.err, '');
      isOk(r, 'version', /no installed copy found/);
      isWarn(r, 'hooks', /^no automatic reading in the log -> turn pacing on in the plugin list$/);
      isWarn(r, 'reading', /^no reading yet -> type \/pacing usage now$/);
      isOk(r, 'per-model', /^no reading yet: nothing to check$/);
      isOk(r, 'week', /^no reading yet: nothing to check$/);
      isOk(r, 'settings', /^no config\.json yet: the defaults stand$/);
      isOk(r, 'token rate', /^not learned yet$/);
      isOk(r, 'agents', /^no agent recorded for this project yet$/);
      isOk(r, 'folders');
      assert.equal(r.summary, '2 warnings: see above.');
      assert.ok(!fs.existsSync(s.data), 'the data folder is not made by a check');
    } finally { s.cleanup(); }
  });

  test('a newer installed copy: reload, and never a step to switch model or effort', () => {
    const s = healthy();
    try {
      installCopy(s, '99.0.0');
      const r = doctor(s);
      assert.equal(r.code, 0);
      isWarn(r, 'version', new RegExp('^running ' + VERSION.replace(/\./g, '\\.') + ', but 99\\.0\\.0 is installed -> type /reload-plugins or press Reload above the prompt$'));
      assert.equal(r.summary, '1 warning: see above.');
      assert.doesNotMatch(r.out, /switch (the|this|to)|model menu|effort to/i);
    } finally { s.cleanup(); }
  });

  test('an installed copy older than the running one is fine', () => {
    const s = healthy();
    try {
      installCopy(s, '0.0.1');
      isOk(doctor(s), 'version', /, the app holds 0\.0\.1$/);
    } finally { s.cleanup(); }
  });

  test('hooks module: no automatic reading in 24 h, and one 30 h old', () => {
    const s = healthy();
    try {
      const e = reading(-10, { source: undefined, full: undefined });
      writeLog(s, [e]); writeState(s, e);
      let r = doctor(s);
      isWarn(r, 'hooks', /^no automatic reading in the log -> /);
      isOk(r, 'reading', /^the last is 10 min old, full$/);
      writeLog(s, [reading(-30 * 60), e]);
      r = doctor(s);
      isWarn(r, 'hooks', /^its last reading was 30 h ago -> turn pacing on in the plugin list$/);
    } finally { s.cleanup(); }
  });

  test('last reading: 3 h old is a warning that says its kind; dated ahead names the clock', () => {
    const s = healthy();
    try {
      const e = reading(-180, { full: undefined, premiumAt: at(-200) });
      writeLog(s, [e]); writeState(s, e);
      isWarn(doctor(s), 'reading', /^the last is 3 h old, automatic -> type \/pacing usage now for a fresh one$/);
      const ahead = reading(120);
      writeLog(s, [ahead]); writeState(s, ahead);
      isWarn(doctor(s), 'reading', /^the last is dated 2 h ahead of now -> check the computer's clock$/);
    } finally { s.cleanup(); }
  });

  test('a damaged state.json: the log stands in, and a warning says so', () => {
    const s = healthy();
    try {
      s.write('state.json', '{"t": "2026-11-13T11:5');
      const r = doctor(s);
      assert.equal(r.code, 0);
      isWarn(r, 'reading', /^state\.json does not parse; the log's last is 10 min old -> type \/pacing usage now to rewrite it$/);
      isOk(r, 'week', /^resets Thu 19 Nov 12:00, in 6 days$/);
    } finally { s.cleanup(); }
  });

  test('per-model meter: carried over 7 h warns, 2 h is fine, none read warns, none set is fine, out is fine', () => {
    const s = healthy();
    try {
      const set = e => { writeLog(s, [e]); writeState(s, e); };
      set(reading(-10, { full: undefined, premiumAt: at(-7 * 60) }));
      isWarn(doctor(s), 'per-model', /^Fable 5\.2 carried over for 7 h, at 30 % -> type \/pacing usage now to read it$/);
      set(reading(-10, { full: undefined, premiumAt: at(-120) }));
      isOk(doctor(s), 'per-model', /^Fable 5\.2 read 2 h ago, carried over since$/);
      set(reading(-10, { premium: null, full: undefined }));
      isWarn(doctor(s), 'per-model', /^Fable 5\.2 not read this week yet -> type \/pacing usage now to read it$/);
      set(reading(-10, { premium: 100, premiumOut: true }));
      isOk(doctor(s), 'per-model', /^Fable 5\.2 is out until the reset$/);
      s.writeConfig({ premium: null });
      isOk(doctor(s), 'per-model', /^none: the settings say the plan has no per-model meter$/);
    } finally { s.cleanup(); }
  });

  test('week: a reset gone by, and a log in another week than state.json', () => {
    const s = healthy();
    try {
      const old = reading(-10, { reset: '2026-11-13T11:00:00.000Z' });
      writeLog(s, [old]); writeState(s, old);
      isWarn(doctor(s), 'week', /^the week reset Fri 13 Nov 11:00, no reading since -> type \/pacing usage now to start the new one$/);
      writeLog(s, [reading(-20, { reset: '2026-11-26T12:00:00.000Z' })]);
      writeState(s, reading(-10));
      isWarn(doctor(s), 'week', /^the log's week ends Thu 26 Nov 12:00, state\.json's Thu 19 Nov 12:00 -> type \/pacing usage now$/);
    } finally { s.cleanup(); }
  });

  test('settings: a damaged config.json fails with exit code 1', () => {
    const s = healthy();
    try {
      s.write('config.json', '{"tiers": [');
      const r = doctor(s);
      assert.equal(r.code, 1);
      const l = r.line('settings');
      assert.equal(l.status, 'fail');
      assert.equal(l.text, 'config.json does not parse; the defaults stand in -> type /pacing reset: it rewrites it and keeps a copy');
      assert.equal(r.summary, '1 failure: see above.');
      assert.equal(s.read('config.json'), '{"tiers": [', 'the file is left as it is');
    } finally { s.cleanup(); }
  });

  test('settings: an unknown key and a value no command writes are named', () => {
    const s = healthy();
    try {
      s.writeConfig({ compactAsk: true, colour: 'blue', speed: 2 });
      isWarn(doctor(s), 'settings', /^unknown settings: colour, speed -> remove it from config\.json: nothing reads it$/);
      s.writeConfig({ switchAsk: 'yes', compactAsk: 'no', theme: 1 });
      isWarn(doctor(s), 'settings', /^the offers to compact are not on or off, and 1 more; unknown setting: theme -> type \/pacing setup to set it again$/);
      // the panel's setting is gone: an old key is ignored, never named
      s.writeConfig({ compactAsk: false, agentsPanel: 'off', tiers: [{ model: 'opus', effort: 'high' }, { model: 'haiku', effort: 'low' }] });
      isOk(doctor(s), 'settings', /^compact off, notify on, switch on, reload on, 2 tiers$/);
    } finally { s.cleanup(); }
  });

  test('token rate: damaged, carried from last week, early, still learning', () => {
    const s = healthy();
    try {
      s.write('rate.json', '{"from": 1');
      isWarn(doctor(s), 'token rate', /^rate\.json does not parse -> type \/pacing usage now to start it afresh$/);
      s.write('rate.json', JSON.stringify({ reset: RESET, from: 10, to: 11, tokens: 500000, carried: 850000 }));
      isOk(doctor(s), 'token rate', /^850K tokens per point, carried from last week$/);
      s.write('rate.json', JSON.stringify({ reset: RESET, from: 10, to: 13, tokens: 3600000, carried: null }));
      isOk(doctor(s), 'token rate', /^1\.2M tokens per point, from only 3 points so far$/);
      s.write('rate.json', JSON.stringify({ reset: RESET, from: 10, to: 11, tokens: 900000, carried: null }));
      isOk(doctor(s), 'token rate', /^not learned yet: 1 point this week so far$/);
    } finally { s.cleanup(); }
  });

  test('agents: a line that does not parse and records without tokens or effort', () => {
    const s = healthy();
    try {
      s.write(agentsFile(s), record(-60) + '{"t": "cut off\n' + record(-50, { tokens: undefined }) + record(-40, { effort: 'turbo' }));
      const r = doctor(s);
      assert.equal(r.code, 0);
      isWarn(r, 'agents', new RegExp('^1 line does not parse; 2 of 3 records lack a token count or effort -> remove those lines from agents/' + projectSlug(s.project) + '\\.jsonl$'));
    } finally { s.cleanup(); }
  });

  test('folders: a data folder that takes no write fails', () => {
    const s = sandbox();
    try {
      fs.mkdirSync(path.dirname(s.data), { recursive: true });
      fs.writeFileSync(s.data, 'not a folder');
      const r = doctor(s);
      assert.equal(r.code, 1, r.out + r.err);
      const l = r.line('folders');
      assert.equal(l.status, 'fail');
      assert.match(l.text, /^cannot write in the data folder \(E[A-Z]+\) -> give your user write access to /);
    } finally { s.cleanup(); }
  });

  test('--json: the same checks as one JSON line, and the same exit code', () => {
    const s = healthy();
    try {
      let r = doctor(s, ['--json']);
      assert.equal(r.code, 0);
      assert.equal(r.rows.length, 1);
      const j = JSON.parse(r.out);
      assert.deepEqual(Object.keys(j), ['checks', 'counts', 'summary']);
      assert.deepEqual(j.checks.map(c => c.name), NAMES);
      for (const c of j.checks) {
        assert.ok(['ok', 'warn', 'fail'].includes(c.status));
        assert.equal(typeof c.found, 'string');
        assert.equal(c.fix, null);
      }
      assert.deepEqual(j.counts, { ok: 9, warn: 0, fail: 0 });
      assert.equal(j.summary, 'All 9 checks pass.');
      assert.equal(j.checks.find(c => c.name === 'token rate').tokensPerPoint, 1000000);
      assert.equal(j.checks.find(c => c.name === 'version').running, VERSION);
      s.write('config.json', 'nope');
      installCopy(s, '99.0.0');
      r = doctor(s, ['--json']);
      assert.equal(r.code, 1);
      const k = JSON.parse(r.out);
      assert.deepEqual(k.counts, { ok: 7, warn: 1, fail: 1 });
      assert.equal(k.summary, '1 warning, 1 failure: see above.');
      assert.equal(k.checks.find(c => c.name === 'version').fix, 'type /reload-plugins or press Reload above the prompt');
    } finally { s.cleanup(); }
  });
});
