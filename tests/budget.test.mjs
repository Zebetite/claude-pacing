// budget.mjs: the budget line, the levels, the routing, the bars and the
// tier sheet, the premium meter, the context line and the trend.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RESET, levelOf, lineOf, block, sheetRows, routeOf } from './helpers.mjs';

const sb = sandbox();
after(() => sb.cleanup());
// a dry reading in the fixed week; extra flags after
const dry = (now, all, ...more) => sb.budget(['--all', String(all), '--reset', RESET, '--now', now, '--dry', ...more]);

describe('the budget line', () => {
  test('the first half day of a week that resets at noon is 6.7 %', () => {
    const r = dry('2026-11-12T13:00:00Z', 0);
    assert.equal(r.code, 0, r.out);
    assert.equal(lineOf(r.out), 6.7);
    assert.match(r.out, /^day 1 of 8 \(calendar days\)/m);
  });
  test('the line steps up at local midnight, not at the hour of the reset', () => {
    assert.equal(lineOf(dry('2026-11-13T23:59:00Z', 0).out), 20);
    assert.equal(lineOf(dry('2026-11-14T00:01:00Z', 0).out), 33.3);
    assert.match(dry('2026-11-13T23:59:00Z', 0).out, /counted to midnight/);
  });
  test('the last 24 h weigh 1.5 by default', () => {
    // midnight before the last day: 6.5 days of 7.5 units, of which 0.5 weigh 1.5
    assert.equal(lineOf(dry('2026-11-18T13:00:00Z', 0).out), 90);
    const r = dry('2026-11-19T01:00:00Z', 0);
    assert.equal(lineOf(r.out), 100);
    assert.match(r.out, /counted to the reset/);
    assert.match(r.out, /^day 8 of 8/m);
  });
  test('the last-day weight follows the config', () => {
    sb.config(['weight', '1']);
    try {
      assert.equal(lineOf(dry('2026-11-18T13:00:00Z', 0).out), 92.9);
    } finally { sb.config(['reset']); }
  });
});

describe('levels against a line of 20 %', () => {
  const at = all => levelOf(dry('2026-11-13T12:00:00Z', all).out);
  const cases = [[14.9, 'ahead'], [15, 'on pace'], [20, 'on pace'], [20.5, 'over'], [25, 'over'], [25.1, 'throttle'], [94.9, 'throttle'], [95, 'stop']];
  for (const [all, level] of cases) test(all + ' % is ' + level, () => assert.equal(at(all), level));
});

describe('routing on the default ladder', () => {
  const now = '2026-11-13T12:00:00Z';
  const fable = 'tier 1 Fable 5.2 high (the session)', opus = 'tier 2 Opus 5.5 medium (subagent)', sonnet = 'tier 3 Sonnet 5.5 medium (subagent)';
  const table = {
    10: ['ahead', [fable, fable, fable, fable]],
    18: ['on pace', [fable, fable, opus, fable]],
    22: ['over', [fable, opus, opus, fable]],
    30: ['throttle', [opus + ', the session itself only for what Opus 5.5 medium would get wrong', opus, opus, opus]],
    96: ['stop', [sonnet, sonnet, sonnet, sonnet]],
  };
  for (const [all, [level, want]] of Object.entries(table)) {
    test(level, () => {
      const out = dry(now, all).out;
      assert.equal(levelOf(out), level);
      ['judgment', 'medium', 'routine', 'trivial'].forEach((cls, i) => assert.equal(routeOf(out, cls), want[i], cls));
      assert.match(out, /^ {2}bulky {4}-> tier 3 Sonnet 5.5 medium \(subagent\) at any level/m);
      assert.match(out, new RegExp('^next session: ' + (level === 'throttle' || level === 'stop' ? 'Opus 5.5 medium' : 'Fable 5.2 high') + '$', 'm'));
    });
  }
});

describe('the bars and the tier sheet', () => {
  const full = ['--premium', '40', '--five', '55', '--five-reset', '2026-11-13T15:00:00Z', '--context', '12', '--context-tokens', '120000',
    '--extra-spent', '3', '--extra-limit', '50', '--extra-currency', 'EUR', '--session', 'claude-fable-5-2'];
  test('every line of the block stays within 68 columns, at every level', () => {
    for (const all of [10, 18, 22, 30, 96]) {
      const lines = block(dry('2026-11-13T12:00:00Z', all, ...full).out);
      assert.ok(lines.length > 6);
      for (const l of lines) assert.ok(l.length <= 68, all + ' %: ' + l.length + ' columns: ' + l);
    }
  });
  test('also with six tiers and the premium meter out', () => {
    sb.config(['add', 'haiku', 'low']); sb.config(['add', 'haiku', 'medium']); sb.config(['add', 'sonnet', 'low']);
    try {
      for (const all of [10, 30]) {
        const lines = block(dry('2026-11-13T12:00:00Z', all, ...full.map(v => (v === '40' ? '100' : v))).out);
        for (const l of lines) assert.ok(l.length <= 68, l.length + ' columns: ' + l);
      }
    } finally { sb.config(['reset']); }
  });
  test('the bars: 20 cells, the line marked on the weekly bar', () => {
    const lines = block(dry('2026-11-13T12:00:00Z', 10, ...full).out);
    const all = lines.find(l => l.startsWith('All models'));
    assert.match(all, /^All models [█░│]{20} {2}10 % \/ 20 % pace · resets in 6d 0h$/);
    // 10 % fills 2 cells; the line at 20 % marks the 4th
    assert.equal(all.slice(11, 31), '██░│' + '░'.repeat(16));
    assert.ok(lines.some(l => /^5-hour {5}[█░]{20} {2}55 %  resets 15:00$/.test(l)));
    // the per-model bar carries the same line: 40 % against 20 % marks the 4th cell
    assert.ok(lines.some(l => /^Fable 5.2 {2}[█░│]{20} {2}40 % \/ 20 % pace$/.test(l)), lines.join('\n'));
    assert.equal(lines.find(l => l.startsWith('Fable')).slice(11, 31), '███│████' + '░'.repeat(12));
    assert.ok(lines.some(l => /^Context {4}[█░]{20} {2}12 %  120k tokens$/.test(l)));
  });
  test('the sheet says what each tier takes at each level', () => {
    const sheet = all => sheetRows(dry('2026-11-13T12:00:00Z', all).out).join('\n');
    assert.match(sheet(10), /^1 +Fable 5.2 high +the session: judgment, medium, routine, trivial work$/m);
    assert.match(sheet(10), /^2 +Opus 5.5 medium +nothing at this level$/m);
    assert.match(sheet(10), /^3 +Sonnet 5.5 medium +subagents: bulky output/m);
    assert.match(sheet(18), /^2 +Opus 5.5 medium +subagents: routine work$/m);
    assert.match(sheet(22), /^2 +Opus 5.5 medium +subagents: medium, routine work$/m);
    assert.match(sheet(22), /^1 +Fable 5.2 high +the session: judgment, trivial work$/m);
    assert.match(sheet(30), /^1 +Fable 5.2 high +the session: only what Opus 5.5 medium would get wrong$/m);
    assert.match(sheet(30), /^2 +Opus 5.5 medium +subagents: judgment, medium, routine, trivial work$/m);
    assert.match(sheet(96), /^1 +Fable 5.2 high +the session: wrap up/m);
    assert.match(sheet(96), /^2 +Opus 5.5 medium +nothing: wrap up$/m);
  });
});

describe('the premium meter', () => {
  const now = '2026-11-13T12:00:00Z';
  test('below 100 % it is paced on the same line; under it, all models decide', () => {
    const out = dry(now, 10, '--premium', '12').out;
    assert.equal(levelOf(out), 'ahead');
    assert.match(out, /Fable 5.2 12 % -> ahead$/m);
    assert.match(out, /^Fable 5.2 used 12 %, delta -8 -> ahead$/m);
    assert.doesNotMatch(out, /out until the reset/);
  });
  test('at 100 % Fable leaves the ladder and the fallback takes tier 1', () => {
    const out = dry(now, 10, '--premium', '100').out;
    assert.match(out, /-> ahead, Fable 5.2 out$/m);
    assert.equal(routeOf(out, 'judgment'), 'tier 1 Opus 5.5 high (the session)');
    assert.equal(routeOf(out, 'medium'), 'tier 1 Opus 5.5 high (the session)');
    assert.match(sheetRows(out).join('\n'), /^- +Fable 5.2 high +out until the reset: its own meter is at 100 %$/m);
    assert.match(out, /^do: Fable 5.2 is out until the reset: SWITCH the session to Opus 5.5 high now \(model menu: Opus 5.5, effort high\)/m);
    assert.match(out, /^next session: Opus 5.5 high$/m);
  });
  test('the old --fable flag still reads the meter', () => {
    assert.match(dry(now, 10, '--fable', '100').out, /Fable 5.2 out$/m);
  });
  test('fallback none: the remaining tiers move up', () => {
    sb.config(['fallback', 'none']);
    try {
      const out = dry(now, 10, '--premium', '100').out;
      assert.equal(routeOf(out, 'judgment'), 'tier 1 Opus 5.5 medium (the session)');
      assert.match(out, /^ {2}bulky {4}-> tier 2 Sonnet 5.5 medium/m);
    } finally { sb.config(['reset']); }
  });
  test('premium none: the flag is ignored and no meter row is drawn', () => {
    sb.config(['premium', 'none']);
    try {
      const out = dry(now, 10, '--premium', '100').out;
      assert.equal(routeOf(out, 'judgment'), 'tier 1 Fable 5.2 high (the session)');
      assert.doesNotMatch(out, /out until|^Fable 5.2 used/m);
      assert.equal(block(out).filter(l => l.startsWith('Fable')).length, 0);
    } finally { sb.config(['premium', 'fable']); }
  });
  test('every tier on the premium model, no fallback, meter full: wrap up, no crash', () => {
    sb.config(['set', '2', 'fable', 'medium']); sb.config(['remove', '3']); sb.config(['fallback', 'none']);
    try {
      const r = dry(now, 10, '--premium', '100');
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /^do: no model left on the ladder/m);
    } finally { sb.config(['reset']); }
  });
});

describe('the context line', () => {
  const now = '2026-11-13T12:00:00Z';
  const ctx = (...f) => dry(now, 10, ...f).out.split(/\r?\n/).find(l => l.startsWith('context ')) || '';
  test('by tokens: nothing under 300 000', () => assert.equal(ctx('--context-tokens', '299999'), 'context 300k tokens'));
  test('by tokens: from 300 000 compact at a natural break, unrelated tasks go to a new session', () => {
    const l = ctx('--context-tokens', '300000');
    assert.match(l, /-> for work that continues, suggest compacting the conversation at a natural break \(\/compact\), the cheaper step/);
    assert.match(l, /a task unrelated to this session's work starts in a new session$/);
  });
  test('by tokens: from 500 000 a handover, not compacting', () => assert.doesNotMatch(ctx('--context-tokens', '500000'), /\/compact/));
  test('by tokens: from 500 000 the next task goes whole to one agent; a new session only for steering, many questions or unrelated work', () => {
    const l = ctx('--context-tokens', '500000');
    assert.match(l, /-> this session is the expensive part now: a next task with a clear outcome goes WHOLE to one fresh agent, without asking/);
    assert.match(l, /read only its report\. Offer a new session, with a handover \(\/pacing handover\), only for a task that needs the user's steering, many rounds of questions, or has nothing to do with this session's work$/);
  });
  test('the whole-task agent: never below tier 2, judgment on the fallback', () => {
    const whole = all => (dry(now, all, '--context-tokens', '520000').out.match(/without asking \((.*?)\)/) || [])[1];
    // ahead: every class routes to tier 1, but a whole task goes no lower than tier 2 and judgment to the fallback
    assert.equal(whole(10), 'judgment on Opus 5.5 high, medium on Opus 5.5 medium, routine on Opus 5.5 medium');
    assert.equal(whole(30), 'judgment on Opus 5.5 high, medium on Opus 5.5 medium, routine on Opus 5.5 medium');
    // with no fallback, judgment goes to tier 1
    sb.config(['fallback', 'none']);
    try { assert.match(whole(10), /^judgment on Fable 5\.2 high,/); } finally { sb.config(['reset']); }
    // at stop nothing is handed out, only wrapped up
    assert.equal(whole(96), undefined);
  });
  test('tokens win over the percentage', () => {
    assert.equal(ctx('--context', '60', '--context-tokens', '100000'), 'context 100k tokens (60 % of the window)');
  });
  test('by percentage alone: 30 % and 50 %', () => {
    assert.equal(ctx('--context', '29'), 'context 29 % of the window');
    assert.match(ctx('--context', '30'), /unrelated to this session's work/);
    assert.match(ctx('--context', '50'), /expensive part now/);
  });
  test('the context bar names the advice', () => {
    const bars = c => block(dry(now, 10, '--context', '40', '--context-tokens', c).out).find(l => l.startsWith('Context'));
    assert.match(bars('320000'), / {2}compact \(\/compact\) at a break$/);
    assert.match(bars('520000'), / {2}next task whole to an agent$/);
    for (const c of ['320000', '520000']) assert.ok(bars(c).length <= 68, bars(c));
  });
  test('a token count that is not a number is refused', () => {
    const r = dry(now, 10, '--context-tokens', 'lots');
    assert.equal(r.code, 1);
    assert.match(r.out, /bad input/);
  });
});

describe('the trend', () => {
  // the line at Sunday 12:00 is 46.7 %; 40 % used is "ahead" on the line alone
  const now = '2026-11-15T12:00:00Z';
  const seed = (hoursBefore, all) => sb.write('log.jsonl', JSON.stringify({
    t: new Date(Date.parse(now) - hoursBefore * 3600000).toISOString(), all, line: 30, level: 'ahead', reset: RESET,
  }) + '\n');
  test('a projection past 115 % raises the level to throttle', () => {
    seed(24, 20);
    const out = dry(now, 40).out;
    assert.equal(levelOf(out), 'throttle');
    assert.match(out, /raised by the trend/);
    assert.match(out, /^trend: \+20 %\/day over the last 24 h, projected 120 % at reset, reaches 100 % 2026-11-18 12:00$/m);
  });
  test('a projection between 100 and 115 % raises it to over', () => {
    seed(24, 24);
    assert.equal(levelOf(dry(now, 40).out), 'over');
  });
  test('a sample under 20 h is shown but does not move the level', () => {
    seed(10, 30);
    const out = dry(now, 40).out;
    assert.equal(levelOf(out), 'ahead');
    assert.match(out, /sample under 20 h, not applied to the level/);
  });
  test('a reading of another week is not a trend', () => {
    sb.write('log.jsonl', JSON.stringify({ t: '2026-11-14T12:00:00Z', all: 5, reset: '2026-11-26T12:00:00Z' }) + '\n');
    assert.doesNotMatch(dry(now, 40).out, /^trend:/m);
  });
  test('a line that does not parse is skipped', () => {
    seed(24, 20);
    sb.write('log.jsonl', '{cut off\n' + sb.read('log.jsonl'));
    assert.equal(levelOf(dry(now, 40).out), 'throttle');
  });
});

describe('a reading that is not dry', () => {
  test('logs it, writes state.json and the next-session defaults', () => {
    const s = sandbox();
    try {
      // a desktop app preset to be updated
      const preset = { byAccount: { a: { builtIns: { local: { settings: { modelId: 'claude-sonnet-5-5', effort: 'low' } } } } } };
      s.write('../../AppData/Local/Claude-Data/acct/ccd-session-presets.json', JSON.stringify(preset));
      const r = s.budget(['--all', '30', '--reset', RESET, '--now', '2026-11-13T12:00:00Z']);
      assert.equal(r.code, 0, r.out);
      const log = s.read('log.jsonl').trim().split('\n').map(l => JSON.parse(l));
      assert.equal(log.length, 1);
      assert.equal(log[0].level, 'throttle');
      const state = JSON.parse(s.read('state.json'));
      assert.equal(state.next.label, 'Opus 5.5');
      assert.equal(state.delta, 10);
      const settings = JSON.parse(s.read('../settings.json'));
      assert.deepEqual([settings.model, settings.effortLevel], ['opus', 'medium']);
      const p = JSON.parse(s.read('../../AppData/Local/Claude-Data/acct/ccd-session-presets.json'));
      assert.deepEqual(p.byAccount.a.builtIns.local.settings, { modelId: 'claude-opus-5-5', effort: 'medium' });
      // `log` lists it
      assert.match(s.budget(['log']).out, /all {4}30 % {2}line {4}20 % {2}throttle/);
    } finally { s.cleanup(); }
  });
  test('next off leaves settings.json alone', () => {
    const s = sandbox();
    try {
      s.config(['next', 'off']);
      s.budget(['--all', '30', '--reset', RESET, '--now', '2026-11-13T12:00:00Z']);
      assert.ok(s.exists('state.json'));
      assert.ok(!s.exists('../settings.json'));
    } finally { s.cleanup(); }
  });
  test('--dry writes nothing', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '30', '--reset', RESET, '--dry']);
      assert.ok(!s.exists('log.jsonl') && !s.exists('state.json') && !s.exists('../settings.json'));
    } finally { s.cleanup(); }
  });
});

describe('arguments', () => {
  test('a mistyped flag is refused, not taken for a missing meter', () => {
    const r = dry('2026-11-13T12:00:00Z', 10, '--premum', '100');
    assert.equal(r.code, 1);
    assert.match(r.out, /unknown option --premum/);
  });
  test('without --all and --reset it prints the usage', () => {
    const r = sb.budget(['--all', '10']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^usage: node budget.mjs/);
  });
  test('a meter the plan lacks is -', () => {
    const r = dry('2026-11-13T12:00:00Z', 10, '--premium', '-', '--five', '-');
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /5-hour/);
  });
  test('the session model by id: upward line on a lower tier', () => {
    const out = dry('2026-11-13T12:00:00Z', 10, '--session', 'claude-opus-5-5').out;
    assert.match(out, /^upward: this session runs on Opus 5.5 medium/m);
    assert.match(dry('2026-11-13T12:00:00Z', 10, '--session', 'claude-haiku-5-5').out, /^note: the session model "claude-haiku-5-5" is not on the ladder$/m);
  });
});

describe('the reader agent', () => {
  const now = '2026-11-13T12:00:00Z';
  const readerLine = out => routeOf(out, 'reader');
  test('reads on Haiku 5.5 medium by default, at every level but stop', () => {
    for (const all of [10, 18, 22, 30]) {
      const out = dry(now, all).out;
      assert.equal(readerLine(out), 'Haiku 5.5 medium (pacing:reader) at any level: logs, searches, unfamiliar code');
      assert.match(sheetRows(out).join('\n'), /^r +Haiku 5.5 medium +the reader agent: bulky reading/m);
      assert.match(out, /^ {2}bulky {4}-> tier 3 Sonnet 5.5 medium \(subagent\) at any level: checks to judge against the task;/m);
    }
    assert.equal(readerLine(dry(now, 96).out), undefined);
  });
  test('reader ladder follows the lowest tier', () => {
    sb.config(['reader', 'ladder']); sb.config(['verifier', 'ladder']);
    try {
      const out = dry(now, 10).out;
      assert.equal(readerLine(out), 'tier 3 Sonnet 5.5 medium (pacing:reader), the lowest tier');
      assert.doesNotMatch(sheetRows(out).join('\n'), /^r /m);
      assert.match(out, /at any level: logs, test runs, many files;/);
    } finally { sb.config(['reset']); }
  });
  test('another model for the reader', () => {
    sb.config(['reader', 'sonnet', 'low']);
    try { assert.match(readerLine(dry(now, 10).out), /^Sonnet 5.5 low \(pacing:reader\)/); } finally { sb.config(['reset']); }
  });
  test('a reader on the premium model follows the lowest tier while that meter is out', () => {
    sb.config(['reader', 'fable', 'low']);
    try {
      assert.match(readerLine(dry(now, 10).out), /^Fable 5.2 low/);
      assert.equal(readerLine(dry(now, 10, '--premium', '100').out), 'tier 3 Sonnet 5.5 medium (pacing:reader), the lowest tier');
    } finally { sb.config(['reset']); }
  });
});

describe('the effort step at "over"', () => {
  const now = '2026-11-13T12:00:00Z';
  const effort = out => (out.split(/\r?\n/).find(l => l.startsWith('effort: ')) || null);
  test('at over: lower the session\'s effort one step first', () => {
    assert.equal(effort(dry(now, 22).out), 'effort: first offer to lower this session\'s effort one step, Fable 5.2 high -> medium (model menu: Fable 5.2, effort medium; the user decides); medium work still goes to Opus 5.5 medium');
    assert.match(effort(dry(now, 22, '--session', 'claude-fable-5-2').out), /Fable 5.2 high -> medium/);
  });
  test('not at the other levels', () => {
    for (const all of [10, 18, 30, 96]) assert.equal(effort(dry(now, all).out), null, String(all));
  });
  test('not for a session on another tier, nor below low', () => {
    assert.equal(effort(dry(now, 22, '--session', 'claude-opus-5-5').out), null);
    sb.config(['set', '1', 'fable', 'low']);
    try { assert.equal(effort(dry(now, 22).out), null); } finally { sb.config(['reset']); }
  });
  test('not while the session is told to switch model (Fable out)', () => {
    assert.equal(effort(dry(now, 22, '--premium', '100').out), null);
  });
});

describe('the week in sum', () => {
  const LAST = '2026-11-12T12:00:00.000Z';
  const e = (t, all, line, level, reset = LAST) => JSON.stringify({ t, all, line, level, reset });
  const lastWeek = [e('2026-11-10T12:00:00Z', 50, 60, 'ahead'), e('2026-11-11T12:00:00Z', 75, 73.3, 'over'), e('2026-11-12T00:00:00Z', 90, 86.7, 'on pace')];
  const want = 'last week: ended at 90 %, time by level ahead 50 %, on pace 25 %, over 25 %; line crossed on 2 of 3 readings (peak 3.3 points over, 2026-11-12 00:00)';
  const lastLine = out => out.split(/\r?\n/).find(l => l.startsWith('last week:')) || null;
  test('the first reading of a new week sums up the week before', () => {
    sb.write('log.jsonl', lastWeek.join('\n') + '\n');
    assert.equal(lastLine(dry('2026-11-12T13:00:00Z', 1).out), want);
  });
  test('only once: not when this week already has a reading', () => {
    sb.write('log.jsonl', [...lastWeek, e('2026-11-12T13:00:00Z', 1, 6.7, 'ahead', RESET)].join('\n') + '\n');
    assert.equal(lastLine(dry('2026-11-12T15:00:00Z', 2).out), null);
  });
  test('a week that never crossed the line says how close it came', () => {
    sb.write('log.jsonl', [e('2026-11-11T12:00:00Z', 60, 73.3, 'ahead'), e('2026-11-12T06:00:00Z', 80, 86.7, 'on pace')].join('\n') + '\n');
    assert.match(lastLine(dry('2026-11-12T13:00:00Z', 1).out), /; line never crossed \(closest 6.7 points under\)$/);
  });
  test('no line on the very first reading', () => {
    sb.write('log.jsonl', '');
    assert.equal(lastLine(dry('2026-11-12T13:00:00Z', 1).out), null);
  });
  test('week lists the weeks, newest first', () => {
    sb.write('log.jsonl', [...lastWeek, e('2026-11-12T13:00:00Z', 1, 6.7, 'ahead', RESET)].join('\n') + '\n');
    const out = sb.budget(['week']).out;
    const weeks = out.split(/\r?\n/).filter(l => l.startsWith('week to '));
    assert.equal(weeks.length, 2);
    assert.match(weeks[0], /^week to 2026-11-19 12:00/);
    assert.match(out, /^week to 2026-11-12 12:00: 3 readings, last 90 % at 2026-11-12 00:00\n {2}time by level: ahead 50 %, on pace 25 %, over 25 %\n {2}line crossed on 2 of 3 readings/m);
    assert.equal(sb.budget(['week', '1']).out.split(/\r?\n/).filter(l => l.startsWith('week to ')).length, 1);
  });
  test('week with no readings', () => {
    sb.write('log.jsonl', '');
    assert.equal(sb.budget(['week']).out.trim(), 'no readings yet');
  });
});

describe('the per-model meter, paced on the same line', () => {
  // the line is 20 % at Friday noon
  const now = '2026-11-13T12:00:00Z';
  const effort = out => (out.split(/\r?\n/).find(l => l.startsWith('effort: ')) || null);
  const premLine = out => out.split(/\r?\n/).find(l => l.startsWith('Fable 5.2 used ')) || null;
  test('worse than all models while Fable is tier 1: its level decides, and the report says so', () => {
    const out = dry(now, 10, '--premium', '22').out;
    assert.equal(levelOf(out), 'over');
    assert.match(out, /-> over \(set by the Fable 5.2 meter\)$/m);
    assert.equal(premLine(out), 'Fable 5.2 used 22 %, delta +2 -> over: sets the level');
    assert.match(out.replace(/\s+/g, ' '), /Fable 5\.2's own meter at 22 % is 2 points over the same line: "over", worse than all models alone \("ahead", 10 points under\), and Fable 5\.2 runs tier 1, so that meter sets the level/);
    assert.equal(routeOf(out, 'medium'), 'tier 2 Opus 5.5 medium (subagent)');
    assert.equal(routeOf(out, 'judgment'), 'tier 1 Fable 5.2 high (the session)');
    // at its "over", one step less effort first, as at the all-models one
    assert.match(effort(out), /Fable 5.2 high -> medium/);
    assert.equal(levelOf(dry(now, 10, '--premium', '17').out), 'on pace');
  });
  test('better than all models: all models decide', () => {
    const out = dry(now, 22, '--premium', '10').out;
    assert.equal(levelOf(out), 'over');
    assert.doesNotMatch(out, /set by the/);
    assert.equal(premLine(out), 'Fable 5.2 used 10 %, delta -10 -> ahead');
  });
  test('at its throttle the session moves to the fallback and keeps Fable for judgment work', () => {
    const out = dry(now, 10, '--premium', '30', '--session', 'claude-fable-5-2').out;
    assert.equal(levelOf(out), 'ahead');
    assert.match(out, /-> ahead, Fable 5.2 held$/m);
    assert.equal(premLine(out), 'Fable 5.2 used 30 %, delta +10 -> throttle: the session moves off it');
    assert.equal(routeOf(out, 'judgment'), 'tier 1 Opus 5.5 high (the session)');
    assert.match(sheetRows(out).join('\n'), /^- +Fable 5.2 high +kept for judgment: one contained hard task at a time, as a subagent$/m);
    assert.match(out, /^do: Fable 5\.2's own meter is at throttle: SWITCH the session to Opus 5\.5 high now \(model menu: Opus 5\.5, effort high\) and keep Fable 5\.2 for judgment work\./m);
    assert.match(out, /^upward: Fable 5\.2 is kept for judgment work: one contained hard task with a clear deliverable may go to a Fable 5\.2 high subagent/m);
    assert.match(out, /^next session: Opus 5.5 high$/m);
    assert.equal(effort(out), null);
    // the all-models level still routes on the new ladder
    const over = dry(now, 22, '--premium', '30').out;
    assert.equal(levelOf(over), 'over');
    assert.equal(routeOf(over, 'medium'), 'tier 2 Opus 5.5 medium (subagent)');
    assert.equal(effort(over), null);
  });
  test('a reader on that model follows the lowest tier while it is held', () => {
    sb.config(['reader', 'fable', 'low']);
    try { assert.equal(routeOf(dry(now, 10, '--premium', '30').out, 'reader'), 'tier 3 Sonnet 5.5 medium (pacing:reader), the lowest tier'); } finally { sb.config(['reset']); }
  });
  test('with no other model to take tier 1, its throttle routes like any other', () => {
    sb.config(['set', '2', 'fable', 'medium']); sb.config(['remove', '3']); sb.config(['fallback', 'none']);
    try {
      const out = dry(now, 10, '--premium', '30').out;
      assert.equal(levelOf(out), 'throttle');
      assert.match(out, /set by the Fable 5.2 meter/);
      assert.doesNotMatch(out, /held/);
    } finally { sb.config(['reset']); }
  });
  test('shown only when tier 1 is another model', () => {
    sb.config(['set', '1', 'opus', 'high']);
    try {
      const out = dry(now, 10, '--premium', '30').out;
      assert.equal(levelOf(out), 'ahead');
      assert.equal(premLine(out), 'Fable 5.2 used 30 %, delta +10 -> throttle: not tier 1, shown only');
      assert.equal(routeOf(out, 'judgment'), 'tier 1 Opus 5.5 high (the session)');
    } finally { sb.config(['reset']); }
  });
  test('its own trend, from the readings that read it in full', () => {
    // Sunday noon, line 46.7 %: 40 % is under it, but 10 % a day earlier projects 160 %
    const sun = '2026-11-15T12:00:00Z';
    const entry = (hoursBefore, all, premium, extra = {}) => JSON.stringify({ t: new Date(Date.parse(sun) - hoursBefore * 3600000).toISOString(),
      all, premium, premiumModel: 'fable', line: 33.3, level: 'ahead', reset: RESET, ...extra });
    sb.write('log.jsonl', entry(24, 30, 10) + '\n');
    const out = dry(sun, 35, '--premium', '40').out;
    assert.match(out, /^Fable 5\.2 trend: \+30 %\/day over 24 h, projected 160 % at reset, reaches 100 % 2026-11-17 12:00$/m);
    assert.match(premLine(out), /-> throttle \(raised by its trend\): the session moves off it$/);
    assert.match(out, /Fable 5.2 held$/m);
    // a carried figure is not a reading of the meter: no trend from it
    sb.write('log.jsonl', entry(24, 30, 10, { premiumAt: '2026-11-13T12:00:00.000Z', source: 'hook' }) + '\n');
    assert.doesNotMatch(dry(sun, 35, '--premium', '40').out, /^Fable 5\.2 trend/m);
    sb.write('log.jsonl', '');
  });
  test('the log marks the meter that set the level, and a held model', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--premium', '22', '--now', now]);
      s.budget(['--all', '10', '--reset', RESET, '--premium', '30', '--now', '2026-11-13T12:05:00Z']);
      const log = s.read('log.jsonl').trim().split('\n').map(l => JSON.parse(l));
      assert.deepEqual([log[0].levelBy, log[0].premiumLevel, log[0].premiumHeld], ['premium', 'over', undefined]);
      assert.deepEqual([log[1].levelBy, log[1].premiumLevel, log[1].premiumHeld], [undefined, 'throttle', true]);
      const rows = s.budget(['log']).out.trim().split(/\r?\n/);
      assert.match(rows[0], /over \(Fable 5\.2\)$/);
      assert.match(rows[1], /ahead, Fable 5\.2 held$/);
      // the next session starts on the fallback
      assert.equal(JSON.parse(s.read('state.json')).next.label, 'Opus 5.5');
    } finally { s.cleanup(); }
  });
});

describe('the fixed overhead', () => {
  const now = '2026-11-15T13:40:00Z';
  // the categories a real session reported
  const REAL = 'Messages=303307,System tools=25759,MCP tools=13768,System prompt=11164,Skills=5760,Custom agents=410';
  const fixedLine = out => out.split(/\r?\n/).find(l => l.startsWith('fixed overhead ')) || null;
  test('everything but the messages, in tokens and as a share of the session', () => {
    const out = dry(now, 43, '--context', '36', '--context-tokens', '360672', '--categories', REAL).out;
    assert.equal(fixedLine(out), 'fixed overhead 57k tokens on every turn (15.8 % of the session): System tools 26k, MCP tools 14k, System prompt 11k, Skills 6k');
    const b = block(out);
    assert.ok(b.includes('Fixed      ███░░░░░░░░░░░░░░░░░  16 %  57k every turn'), b.join('\n'));
  });
  test('large MCP tools: what switching off unneeded connectors saves, no connector named', () => {
    const out = dry(now, 43, '--context-tokens', '160000', '--categories', 'Messages=90000,System tools=25000,MCP tools=40000,System prompt=5000').out;
    assert.match(fixedLine(out), / -> MCP tools are 40k of it: switching off connectors the user does not need saves up to that many tokens on every turn$/);
    assert.match(block(out).find(l => l.startsWith('Fixed')), /70k every turn, MCP 40k$/);
    // a quarter of the fixed part, but under 10 000 tokens: not worth a word
    assert.doesNotMatch(fixedLine(dry(now, 43, '--categories', 'Messages=9000,System tools=6000,MCP tools=4000').out), /connectors/);
  });
  test('without the context tokens, the share is of the categories\' sum', () => {
    assert.match(fixedLine(dry(now, 43, '--categories', 'Messages=60000,System tools=40000').out), /\(40 % of the session\)/);
  });
  test('missing: no row and no line; malformed: refused', () => {
    const out = dry(now, 43, '--context-tokens', '160000').out;
    assert.equal(fixedLine(out), null);
    assert.ok(!block(out).some(l => l.startsWith('Fixed')));
    const r = dry(now, 43, '--categories', 'Messages=lots');
    assert.equal(r.code, 1);
    assert.match(r.out, /--categories is/);
  });
  test('the bar block stays within 68 columns with every row', () => {
    for (const t of ['160000', '520000']) {
      const out = dry(now, 43, '--premium', '79', '--five', '14', '--five-reset', '2026-11-15T16:40:00Z', '--context', '52', '--context-tokens', t,
        '--categories', 'Messages=90000,System tools=25000,MCP tools=400000,System prompt=5000').out;
      for (const l of block(out)) assert.ok(l.length <= 68, l.length + ': ' + l);
    }
  });
});

describe('the verifier agent', () => {
  const now = '2026-11-13T12:00:00Z';
  const line = out => routeOf(out, 'verifier');
  test('plain runs on Haiku 5.5 medium by default; checks to judge on the lowest tier', () => {
    for (const all of [10, 22, 30]) {
      const out = dry(now, all).out;
      assert.equal(line(out), 'Haiku 5.5 medium (pacing:verifier) for a plain run: run it, quote what failed; a check with points to judge: tier 3 Sonnet 5.5 medium');
      assert.match(sheetRows(out).join('\n'), /^v +Haiku 5\.5 medium +the verifier: plain runs of tests, builds, checks$/m);
    }
    assert.equal(line(dry(now, 96).out), undefined);
  });
  test('verifier ladder: every run on the lowest tier; another model', () => {
    sb.config(['verifier', 'ladder']);
    try {
      const out = dry(now, 10).out;
      assert.equal(line(out), 'tier 3 Sonnet 5.5 medium (pacing:verifier), the lowest tier');
      assert.doesNotMatch(sheetRows(out).join('\n'), /^v /m);
      assert.match(out, /at any level: test runs, builds, checks;/);
    } finally { sb.config(['reset']); }
    sb.config(['verifier', 'sonnet', 'low']);
    try { assert.match(line(dry(now, 10).out), /^Sonnet 5\.5 low \(pacing:verifier\)/); } finally { sb.config(['reset']); }
  });
  test('a verifier on the premium model follows the lowest tier while that meter is out', () => {
    sb.config(['verifier', 'fable', 'low']);
    try { assert.equal(line(dry(now, 10, '--premium', '100').out), 'tier 3 Sonnet 5.5 medium (pacing:verifier), the lowest tier'); } finally { sb.config(['reset']); }
  });
  test('its own model counts as a tier of its own in the status line', () => {
    const s = sandbox();
    try {
      s.config(['verifier', 'sonnet', 'low']);
      s.config(['set', '3', 'opus', 'low']);
      const j = JSON.parse(s.budget(['--all', '10', '--reset', RESET, '--now', now, '--source', 'hook', '--dry']).out.trim());
      assert.equal(j.tierOf['claude-sonnet-5-5'], 5);
    } finally { s.cleanup(); }
  });
});
