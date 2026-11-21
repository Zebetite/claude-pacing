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
      // the reader and the verifier on the ladder take no tier of their own;
      // a model twice on the ladder keeps its first place
      s.config(['reader', 'ladder']);
      s.config(['verifier', 'ladder']);
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

describe('the per-model meter, paced from a carried figure', () => {
  test('it sets the level, and the JSON says which meter and from when', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '22', '--now', NOW]);
      const j = auto(s, 11, at(40));
      assert.equal(j.level, 'over');
      assert.equal(j.levelBy, 'premium');
      assert.equal(j.premiumLevel, 'over');
      assert.equal(j.premiumOfBudget, 110);
      assert.equal(j.premiumAt, NOW);
      assert.equal(j.premiumHeld, false);
    } finally { s.cleanup(); }
  });
  test('at its throttle the reading says to switch, and the log keeps the flag', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '30', '--now', NOW]);
      const j = auto(s, 11, at(40));
      assert.equal(j.level, 'ahead');
      assert.equal(j.levelBy, 'all');
      assert.equal(j.premiumHeld, true);
      assert.match(j.do, /^Fable 5\.2's own meter is at throttle: SWITCH the session to Opus 5\.5 high now/);
      assert.equal(log(s).at(-1).premiumHeld, true);
    } finally { s.cleanup(); }
  });
  test('a held flag that goes is logged within 30 min', () => {
    const s = sandbox();
    try {
      // 26 % against Friday's 20 % line is held; at midnight the line steps
      // to 33.3 % and the same carried 26 % is "ahead" of it, as all models are
      s.budget(['--all', '10', '--reset', RESET, '--premium', '26', '--now', '2026-11-13T23:50:00.000Z']);
      const j = auto(s, 10, '2026-11-14T00:05:00.000Z');
      assert.equal(j.premiumHeld, false);
      assert.equal(j.level, 'ahead');
      assert.equal(j.logged, true);
      assert.equal(auto(s, 10, '2026-11-14T00:10:00.000Z').logged, false, 'nothing moved since');
    } finally { s.cleanup(); }
  });
});

describe('a session another session started', () => {
  // the desktop app's own record of a session, as it lies on disk
  const record = (s, id, body) => s.write('../../AppData/Local/Claude-Data/app/claude-code-sessions/acct/org/' + id + '.json', JSON.stringify({ sessionId: id, ...body }));
  const spawned = (s, env) => JSON.parse(s.budget(['--all', '10', '--reset', RESET, '--now', NOW, '--source', 'hook', '--dry'], { env }).out.trim()).spawned;
  test('told from the app\'s record of the session: spawnedFrom', () => {
    const s = sandbox();
    try {
      record(s, 'local_side', { spawnedFrom: { sessionId: 'local_top', sideSession: true, name: 'a-task' } });
      record(s, 'local_top', { title: 'the top one' });
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: 'local_side' }), true);
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: 'local_top' }), false);
    } finally { s.cleanup(); }
  });
  test('a session the user detached to the top level is a session of its own; one with spawnedFrom alone is still a side session', () => {
    const s = sandbox();
    try {
      record(s, 'local_detached', { spawnedFrom: { sessionId: 'local_top', sideSession: true }, lineageDetached: true, lineageDetachedBy: 'user' });
      record(s, 'local_side', { spawnedFrom: { sessionId: 'local_top', sideSession: true } });
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: 'local_detached' }), false);
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: 'local_side' }), true);
    } finally { s.cleanup(); }
  });
  test('not known without the id, the record or a readable one; never from CLAUDE_CODE_CHILD_SESSION', () => {
    const s = sandbox();
    try {
      // the engine sets this one for every command, in every session
      assert.equal(spawned(s, { CLAUDE_CODE_CHILD_SESSION: '1' }), null);
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: 'local_none' }), null);
      s.write('../../AppData/Local/Claude-Data/app/claude-code-sessions/acct/org/local_bad.json', '{cut');
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: 'local_bad' }), null);
      assert.equal(spawned(s, { CLAUDE_CODE_HOST_SESSION_ID: '../../x' }), null);
    } finally { s.cleanup(); }
  });
});

describe('a carried per-model figure is not a current one', () => {
  // the case reported: full readings at 41/52 and 45/71 %, then 15 hours of
  // automatic ones while all models went to 49 % and Fable, unread, to 90 %
  const reported = s => {
    s.budget(['--all', '41', '--premium', '52', '--reset', RESET, '--now', '2026-11-14T12:00:00.000Z']);
    s.budget(['--all', '45', '--premium', '71', '--reset', RESET, '--now', '2026-11-15T01:00:00.000Z']);
  };
  test('15 hours old: its age, an estimate from how the two meters moved, and a full reading asked for', () => {
    const s = sandbox();
    try {
      reported(s);
      const j = auto(s, 49, '2026-11-15T16:00:00.000Z');
      assert.equal(j.premium, 71);
      assert.equal(j.premiumAt, '2026-11-15T01:00:00.000Z');
      // (71 - 52) / (45 - 41) = 4.75 points of Fable per point of all models; 4 points on: 90
      assert.equal(j.premiumEstimate, 90);
      assert.equal(j.needFull, 'the Fable 5.2 figure is 15 h old');
      // the level rests on what was read, never on the estimate
      assert.equal(j.premiumLevel, 'throttle');
    } finally { s.cleanup(); }
  });
  test('a full reading is asked for once all models moved 2 points, or the figure is an hour old', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--premium', '12', '--reset', RESET, '--now', NOW]);
      assert.equal(auto(s, 11, at(20)).needFull, null, 'a point on, 20 min: not yet');
      assert.equal(auto(s, 12, at(25)).needFull, 'all models moved 2 points since the Fable 5.2 meter was read');
      assert.equal(auto(s, 10, at(60)).needFull, 'the Fable 5.2 figure is 60 min old');
    } finally { s.cleanup(); }
  });
  test('with the model held off tier 1 the session no longer draws on it: three hours; out, or another model on tier 1: never', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--premium', '30', '--reset', RESET, '--now', NOW]);
      const held = auto(s, 14, at(60));
      assert.equal(held.premiumHeld, true);
      assert.equal(held.needFull, null);
      assert.equal(auto(s, 14, at(180)).needFull, 'the Fable 5.2 figure is 3 h old');
    } finally { s.cleanup(); }
    const t = sandbox();
    try {
      t.budget(['--all', '10', '--premium', '100', '--reset', RESET, '--now', NOW]);
      assert.equal(auto(t, 20, at(600)).needFull, null, 'out until the reset');
      t.config(['set', '1', 'opus', 'high']);
      t.budget(['--all', '10', '--premium', '12', '--reset', RESET, '--now', at(601)]);
      assert.equal(auto(t, 20, at(1200)).needFull, null, 'not tier 1');
    } finally { t.cleanup(); }
  });
  test('no figure this week yet: asked for; no estimate without two full readings to go by', () => {
    const s = sandbox();
    try {
      const j = auto(s, 10);
      assert.equal(j.needFull, 'no Fable 5.2 reading this week yet');
      assert.equal(j.premiumEstimate, null);
      s.budget(['--all', '10', '--premium', '12', '--reset', RESET, '--now', NOW]);
      assert.equal(auto(s, 15, at(90)).premiumEstimate, null, 'one full reading: no slope');
    } finally { s.cleanup(); }
  });
  test('a reading the session takes asks for nothing', () => {
    const s = sandbox();
    try {
      reported(s);
      const r = s.budget(['--all', '49', '--premium', '90', '--reset', RESET, '--now', '2026-11-15T16:00:00.000Z', '--dry']);
      assert.doesNotMatch(r.out, /needFull|full reading/);
      const j = auto(s, 49, '2026-11-15T16:05:00.000Z');
      assert.equal(j.premium, 71, 'the dry reading was not logged');
    } finally { s.cleanup(); }
  });
  test('`log` marks a carried figure with how old it was', () => {
    const s = sandbox();
    try {
      reported(s);
      auto(s, 49, '2026-11-15T16:00:00.000Z');
      const rows = s.budget(['log']).out.trim().split(/\r?\n/);
      assert.match(rows.at(-1), /Fable 5\.2 {2}71 % \(15 h old\) {2}/);
      assert.doesNotMatch(rows.at(-2), /old\)/, 'a full reading is not marked');
    } finally { s.cleanup(); }
  });
  test('the start line says how old a carried figure is, and asks for a full reading before the first big task', () => {
    const s = sandbox();
    try {
      s.write('state.json', JSON.stringify({ t: new Date().toISOString(), all: 49, line: 46.7, level: 'over', reset: RESET, source: 'hook',
        premiumModel: 'fable', premium: 71, premiumAt: new Date(Date.now() - 15 * 3600000).toISOString(), premiumHeld: true, next: { model: 'opus', label: 'Opus 5.5', effort: 'high' } }));
      const j = JSON.parse(s.hook().out);
      assert.match(j.systemMessage, /Fable 5\.2 was last read 15 h ago, at 71 %: the session will take a full reading before the first big task\.$/);
      assert.match(j.hookSpecificOutput.additionalContext, /The all-models figure is fresh, but Fable 5\.2 was last read 15 h ago, at 71 %, which an automatic reading cannot renew: run the `pacing` skill with `usage now` before the first big task\./);
      assert.doesNotMatch(j.hookSpecificOutput.additionalContext, /This reading is fresh/);
      // read 20 minutes ago: nothing to add
      const st = JSON.parse(s.read('state.json'));
      st.premiumAt = new Date(Date.now() - 20 * 60000).toISOString();
      s.write('state.json', JSON.stringify(st));
      assert.match(JSON.parse(s.hook().out).hookSpecificOutput.additionalContext, /This reading is fresh/);
    } finally { s.cleanup(); }
  });
});

describe('the tier map for the status line follows the ladder in force', () => {
  test('default: the configured ladder, the reader and the verifier after it; subagents the same', () => {
    const s = sandbox();
    try {
      const j = auto(s, 10, NOW, ['--dry', '--premium', '5']);
      assert.deepEqual(j.tierOf, { 'claude-fable-5-2': 1, 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 4 });
      assert.deepEqual(j.agentTierOf, j.tierOf);
    } finally { s.cleanup(); }
  });
  test('Fable held: the fallback, Opus 5.5 high, is tier 1 for the session; Opus subagents are tier 2', () => {
    const s = sandbox();
    try {
      const j = auto(s, 10, NOW, ['--dry', '--premium', '30']);
      assert.equal(j.premiumHeld, true);
      assert.equal(j.tierOf['claude-opus-5-5'], 1);
      assert.equal(j.agentTierOf['claude-opus-5-5'], 2);
      // Fable, off the ladder while held, keeps its configured place
      assert.equal(j.tierOf['claude-fable-5-2'], 1);
      assert.equal(j.tierOf['claude-sonnet-5-5'], 3);
      assert.equal(j.tierOf['claude-haiku-5-5'], 4);
    } finally { s.cleanup(); }
  });
  test('Fable out, fallback none: the remaining tiers move up', () => {
    const s = sandbox();
    try {
      s.config(['fallback', 'none']);
      const j = auto(s, 10, NOW, ['--dry', '--premium', '100']);
      assert.deepEqual([j.tierOf['claude-opus-5-5'], j.tierOf['claude-sonnet-5-5'], j.agentTierOf['claude-opus-5-5'], j.agentTierOf['claude-sonnet-5-5']], [1, 2, 1, 2]);
    } finally { s.cleanup(); }
  });
});

describe('what the session should run on, for the switch button', () => {
  test('the recommendation, and at "over" one step less effort on tier 1', () => {
    const s = sandbox();
    try {
      // 10 % on day 1 of 7: ahead, tier 1 for the session
      const ahead = auto(s, 10);
      assert.deepEqual(ahead.recommend, { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'high' });
      assert.equal(ahead.effortStep, null);
      assert.equal(ahead.premiumModelId, 'claude-fable-5-2');
      // just over the line: over, one step less effort on Fable
      const over = auto(s, 22, at(1));
      assert.equal(over.level, 'over');
      assert.deepEqual(over.effortStep, { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'medium' });
      // far over: throttle, tier 2 for the session, no effort step
      const throttle = auto(s, 40, at(2));
      assert.equal(throttle.level, 'throttle');
      assert.deepEqual(throttle.recommend, { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' });
      assert.equal(throttle.effortStep, null);
    } finally { s.cleanup(); }
  });
});
