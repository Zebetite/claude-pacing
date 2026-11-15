// Automatic readings: budget.mjs --source hook, as the plugin's hooks module
// runs it after a turn. It carries the per-model meter over, keeps the log
// thin, never changes a setting, and answers in one JSON line.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RESET } from './helpers.mjs';

const NOW = '2026-11-13T12:00:00.000Z';
const at = min => new Date(Date.parse(NOW) + min * 60000).toISOString();
const auto = (s, all, now = NOW, more = []) => {
  const r = s.budget(['--all', String(all), '--reset', RESET, '--now', now, '--source', 'hook', ...more]);
  assert.equal(r.code, 0, r.out);
  const lines = r.out.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'one line: ' + r.out);
  return JSON.parse(lines[0]);
};
const log = s => (s.exists('log.jsonl') ? s.read('log.jsonl').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

describe('budget.mjs --source hook', () => {
  test('one JSON line: the level, the meter, the line and the do: words', () => {
    const s = sandbox();
    try {
      const j = auto(s, 10);
      assert.equal(j.level, 'ahead');
      assert.equal(j.all, 10);
      assert.equal(j.line, 20);
      assert.equal(j.logged, true);
      assert.equal(j.premiumOut, false);
      assert.equal(j.do, 'the session model does nearly everything');
      assert.equal(j.ofBudget, 50);
    } finally { s.cleanup(); }
  });
  test('the meter as a share of the line: under 100 % below it, over above', () => {
    const s = sandbox();
    try {
      const at = all => auto(s, all, NOW, ['--dry']).ofBudget;
      assert.deepEqual([at(10), at(20), at(30)], [50, 100, 150]);
    } finally { s.cleanup(); }
  });
  test('each model\'s tier for the module: the ladder, then the reader', () => {
    const s = sandbox();
    try {
      const j = auto(s, 10, NOW, ['--dry']);
      assert.deepEqual(j.tierOf, { 'claude-fable-5-2': 1, 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 4 });
      assert.deepEqual(j.prices['claude-opus-5-5'], [4, 20, 0.2, 5]);
      // the reader on the ladder takes no tier of its own; a model twice on
      // the ladder keeps its first place
      s.config(['reader', 'ladder']);
      s.config(['add', 'opus', 'low']);
      assert.deepEqual(auto(s, 10, NOW, ['--dry']).tierOf, { 'claude-fable-5-2': 1, 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3 });
    } finally { s.cleanup(); }
  });
  test('a fallback off the ladder counts as tier 1, the place it takes', () => {
    const s = sandbox();
    try {
      s.config(['remove', '2']);
      s.config(['fallback', 'opus', 'high']);
      assert.equal(auto(s, 10, NOW, ['--dry']).tierOf['claude-opus-5-5'], 1);
    } finally { s.cleanup(); }
  });
  test('logs it as automatic and writes state.json, but never a setting', () => {
    const s = sandbox();
    try {
      const preset = { byAccount: { a: { builtIns: { local: { settings: { modelId: 'claude-sonnet-5-5', effort: 'low' } } } } } };
      s.write('../../AppData/Local/Claude-Data/acct/ccd-session-presets.json', JSON.stringify(preset));
      auto(s, 30);
      const [e] = log(s);
      assert.equal(e.source, 'hook');
      assert.equal(e.level, 'throttle');
      assert.equal(JSON.parse(s.read('state.json')).source, 'hook');
      assert.ok(!s.exists('../settings.json'), 'settings.json untouched');
      const p = JSON.parse(s.read('../../AppData/Local/Claude-Data/acct/ccd-session-presets.json'));
      assert.deepEqual(p.byAccount.a.builtIns.local.settings, { modelId: 'claude-sonnet-5-5', effort: 'low' });
    } finally { s.cleanup(); }
  });
  test('a reading by the skill has no source and is not thinned', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--now', NOW]);
      s.budget(['--all', '10', '--reset', RESET, '--now', at(1)]);
      assert.equal(log(s).length, 2);
      assert.equal(log(s)[0].source, undefined);
    } finally { s.cleanup(); }
  });
  test('--source takes skill or hook only', () => {
    const s = sandbox();
    try {
      const r = s.budget(['--all', '10', '--reset', RESET, '--source', 'cron']);
      assert.equal(r.code, 1);
      assert.match(r.out, /--source is skill or hook/);
    } finally { s.cleanup(); }
  });
});

describe('the per-model meter, carried over', () => {
  test('from the last reading of the same week, with the time it was read', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '100', '--now', NOW]);
      const j = auto(s, 12, at(40));
      assert.equal(j.premiumOut, true);
      assert.equal(j.premiumAt, NOW);
      assert.match(j.do, /^Fable 5\.2 is out until the reset: SWITCH the session to Opus 5\.5 high now/);
      const e = log(s).at(-1);
      assert.equal(e.premium, 100);
      assert.equal(e.premiumAt, NOW);
    } finally { s.cleanup(); }
  });
  test('an automatic reading passes on the time of the original figure', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '40', '--now', NOW]);
      auto(s, 12, at(40));
      const j = auto(s, 14, at(80));
      assert.equal(j.premiumAt, NOW);
      assert.equal(log(s).at(-1).premium, 40);
    } finally { s.cleanup(); }
  });
  test('not from another week, and none before the first reading of the week', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '90', '--reset', '2026-11-12T12:00:00.000Z', '--premium', '100', '--now', '2026-11-12T10:00:00.000Z']);
      const j = auto(s, 10);
      assert.equal(j.premiumOut, false);
      assert.equal(j.premiumAt, null);
      assert.equal(log(s).at(-1).premium, null);
    } finally { s.cleanup(); }
  });
  test('not with premium none', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '100', '--now', NOW]);
      s.config(['premium', 'none']);
      const j = auto(s, 12, at(40));
      assert.equal(j.premiumOut, false);
      assert.equal(log(s).at(-1).premium, null);
    } finally { s.cleanup(); }
  });
  test('a figure passed in is used as it is', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '100', '--now', NOW]);
      const j = auto(s, 12, at(40), ['--premium', '50']);
      assert.equal(j.premiumOut, false);
      assert.equal(j.premiumAt, null);
    } finally { s.cleanup(); }
  });
});

describe('a thin log', () => {
  test('not logged within 30 min when nothing moved', () => {
    const s = sandbox();
    try {
      auto(s, 10);
      const j = auto(s, 10.9, at(10));
      assert.equal(j.logged, false);
      assert.equal(j.level, 'ahead');
      assert.equal(log(s).length, 1);
    } finally { s.cleanup(); }
  });
  test('logged after 30 min, on a whole point, or on a new level', () => {
    const s = sandbox();
    try {
      auto(s, 10);
      assert.equal(auto(s, 11, at(5)).logged, true, 'a whole point');
      assert.equal(auto(s, 11, at(35)).logged, true, '30 min');
      assert.equal(auto(s, 11.5, at(36)).logged, false);
      assert.equal(log(s).length, 3);
    } finally { s.cleanup(); }
    const t = sandbox();
    try {
      // 15.5 % is on pace against a 20 % line, 14.9 % ahead
      auto(t, 14.9);
      assert.equal(auto(t, 15.5, at(5)).logged, true, 'a new level');
    } finally { t.cleanup(); }
  });
  test('a reading by the skill just before does count as the last one', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--now', NOW]);
      assert.equal(auto(s, 10, at(5)).logged, false);
    } finally { s.cleanup(); }
  });
  test('--dry logs nothing and says so', () => {
    const s = sandbox();
    try {
      assert.equal(auto(s, 10, NOW, ['--dry']).logged, false);
      assert.ok(!s.exists('log.jsonl'));
    } finally { s.cleanup(); }
  });
});

describe('where an automatic reading shows', () => {
  test('`log` marks it', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--now', NOW]);
      auto(s, 12, at(40));
      const rows = s.budget(['log']).out.trim().split(/\r?\n/);
      assert.ok(!rows[0].endsWith('(auto)'));
      assert.ok(rows[1].endsWith('ahead  (auto)'), rows[1]);
    } finally { s.cleanup(); }
  });
  test('the start line says it was automatic', () => {
    const s = sandbox();
    try {
      auto(s, 10, new Date().toISOString().replace(/T.*/, 'T00:00:01.000Z'));
      const state = JSON.parse(s.read('state.json'));
      // the hook judges the age by the clock: move the reading to now
      state.t = new Date().toISOString();
      s.write('state.json', JSON.stringify(state));
      const j = JSON.parse(s.hook().out);
      assert.match(j.systemMessage, /^Pacing \(0 h ago, automatic\): /);
    } finally { s.cleanup(); }
  });
});
