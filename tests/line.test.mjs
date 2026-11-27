// line.mjs: the arithmetic of a reading, imported directly: the settings in
// force, the budget line, the levels, the trend, the per-model meter and its
// hold, the routing, the rate's rule, the week in sum. No process is started
// for these, except where the time zone is the point: the line steps at local
// midnight, so those cases run in a child started in the zone they name
// (Europe/Stockholm across the last Sunday of March and of October, and
// zones far from UTC), and budget.mjs itself is run there once.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sandbox, scripts, RESET, levelOf as printedLevel, lineOf as printedLine } from './helpers.mjs';
import { MODELS, modelOf, meterLabel, defaults, setting } from '../pacing/skills/pacing/scripts/models.mjs';
import { DAY, HOUR, r1, inForce, lineOf, paced, levelOf, below, trendOf, floorOf, sameWeek, pace, carriedPremium, premiumSince, fiveTrendOf,
  weeksOf, summarise, rateNext, rateOf, tierMaps, dateOf, badDateText } from '../pacing/skills/pacing/scripts/line.mjs';

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, (what || '') + ' ' + a + ' is not ' + b);
// a week's allowance is 7.5 units by default: six days at 1 and the last 24 h
// at 1.5. So the line after `days` of the week, up to the sixth, is this.
const after = days => 100 * days / 7.5;
const names = l => l.map(t => t.model + ' ' + t.effort);

describe('the settings in force', () => {
  test('no config: the defaults, the one place they are', () => {
    for (const cfg of [null, undefined, {}]) {
      const s = inForce(cfg);
      assert.deepEqual(names(s.tiers), ['fable high', 'opus medium', 'sonnet medium']);
      assert.deepEqual(s.fallbackTier, { model: 'opus', label: 'Opus 5.5', effort: 'high' });
      assert.deepEqual([s.readerCfg, s.verifierCfg], [{ model: 'haiku', effort: 'medium' }, { model: 'haiku', effort: 'medium' }]);
      assert.deepEqual([s.lastDayWeight, s.setNextModel, s.premium, s.premLabel], [1.5, true, 'fable', 'Fable 5.2']);
    }
    assert.deepEqual(Object.keys(defaults()), ['tiers', 'lastDayWeight', 'setNextModel', 'compactAsk', 'agentNotices', 'switchAsk', 'autoReload', 'autoCompact', 'premium', 'fallback', 'reader', 'verifier']);
    // a fresh object each time: a command changes the one it was handed
    defaults().tiers.push('x');
    assert.equal(defaults().tiers.length, 3);
  });
  test('the config\'s own values stand; null is a value, not a missing one', () => {
    const s = inForce({ tiers: [{ model: 'opus', label: 'an old label', effort: 'xhigh' }, { model: 'haiku', effort: 'low' }], premium: null, fallback: null,
      reader: 'ladder', verifier: { model: 'sonnet', effort: 'low' }, lastDayWeight: 2, setNextModel: false });
    assert.deepEqual(s.tiers, [{ model: 'opus', label: 'Opus 5.5', effort: 'xhigh' }, { model: 'haiku', label: 'Haiku 5.5', effort: 'low' }]);
    assert.deepEqual([s.premium, s.premLabel, s.fallbackTier, s.readerCfg, s.lastDayWeight, s.setNextModel], [null, null, null, 'ladder', 2, false]);
    assert.deepEqual(s.verifierCfg, { model: 'sonnet', effort: 'low' });
    assert.equal(setting({ premium: null }, 'premium'), null);
    assert.equal(setting({}, 'premium'), 'fable');
    assert.equal(setting(null, 'lastDayWeight'), 1.5);
  });
  test('a model by its id, an older id of the family or its short name; the meter\'s label', () => {
    assert.equal(modelOf('claude-opus-5-5'), 'opus');
    assert.equal(modelOf('claude-fable-5-1'), 'fable');
    assert.equal(modelOf('Sonnet'), 'sonnet');
    assert.equal(modelOf('haiku'), 'haiku');
    for (const v of ['gpt', '', null, undefined, 5]) assert.equal(modelOf(v), null);
    for (const m of Object.keys(MODELS)) assert.equal(modelOf(MODELS[m].id), m);
    assert.equal(meterLabel('opus'), 'Opus 5.5');
    // a reading from before the field named Fable's meter
    assert.equal(meterLabel(undefined), 'Fable');
  });
});

// ---- the line, in a zone: a child process started with TZ ----
const CHILD = `
const m = await import(process.argv[1]);
const out = JSON.parse(process.argv[2]).map(c => {
  const reset = new Date(c.reset), now = new Date(c.now);
  if (c.fn === 'line') { const { share, ...l } = m.lineOf({ reset, now, lastDayWeight: c.weight || 1.5 }); return l; }
  const p = m.pace({ settings: m.inForce(c.cfg || null), entries: c.entries || [], used: c.used, prem: c.prem === undefined ? null : c.prem, premAt: now.getTime(), reset, now });
  return { budget: p.budget, level: p.level, premLevel: p.premLevel, premHeld: p.premHeld, premKept: p.premKept, premHeldLine: p.premHeldLine, top: p.ladder[0] ? p.ladder[0].model : null };
});
console.log(JSON.stringify(out));`;
const inZone = (tz, calls) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, pathToFileURL(path.join(scripts, 'line.mjs')).href, JSON.stringify(calls)],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const lines = (tz, reset, nows) => inZone(tz, nows.map(now => ({ fn: 'line', reset, now })));

describe('the budget line, a step at local midnight', () => {
  test('UTC: the week of the tests, which resets on a Thursday at noon and touches 8 calendar days', () => {
    const [first, fri, lastDay, lastHour] = lines('UTC', RESET, ['2026-11-12T12:00:01.000Z', '2026-11-13T12:00:00.000Z', '2026-11-18T13:00:00.000Z', '2026-11-19T11:00:00.000Z']);
    // the first half day, counted to midnight
    near(first.budget, after(0.5));
    assert.deepEqual([first.dayNo, first.dayCount, first.toReset], [1, 8, false]);
    near(fri.budget, after(1.5));
    near(fri.todayAllowance, after(1));
    near(fri.daily, after(1));
    assert.equal(fri.dayNo, 2);
    // the last 24 h weigh 1.5: Wednesday counts to midnight, 12 of them
    near(lastDay.budget, after(6 + 0.5 * 1.5));
    near(lastHour.budget, 100);
    near(lastHour.todayAllowance, after(0.5 * 1.5));
    assert.deepEqual([lastHour.dayNo, lastHour.toReset], [8, true]);
    near(lastHour.left, 1 / 24);
    near(lastHour.elapsed, 7 - 1 / 24);
  });
  test('the last-day weight follows the settings', () => {
    const [l] = inZone('UTC', [{ fn: 'line', reset: RESET, now: '2026-11-13T12:00:00.000Z', weight: 3 }]);
    near(l.budget, 100 * 1.5 / 9);
  });
  // The week that ends Thursday 2026-04-02 12:00 UTC starts Thursday 03-26 at
  // 13:00 in Stockholm. On Sunday 03-29 the clocks go from 02:00 to 03:00:
  // that day is 23 h, from 03-28 23:00 UTC to 03-29 22:00 UTC.
  test('Europe/Stockholm, the last Sunday of March: a day of 23 h', () => {
    const R = '2026-04-02T12:00:00.000Z';
    const [sat, early, late, mon] = lines('Europe/Stockholm', R, ['2026-03-28T12:00:00.000Z', '2026-03-28T23:30:00.000Z', '2026-03-29T21:30:00.000Z', '2026-03-29T22:10:00.000Z']);
    near(sat.budget, after(2 + 11 / 24), 'Saturday, to its midnight at 23:00 UTC');
    near(sat.todayAllowance, after(1));
    assert.equal(sat.dayNo, 3);
    // Sunday 00:30, before the clocks change, and 23:30 after it: one line,
    // counted to the midnight 23 h after the last
    near(early.budget, after(3 + 10 / 24), 'Sunday 00:30');
    near(late.budget, after(3 + 10 / 24), 'Sunday 23:30');
    near(early.todayAllowance, after(23 / 24));
    assert.deepEqual([early.dayNo, late.dayNo, early.dayCount], [4, 4, 8]);
    // 24 h after Saturday's midnight is still Sunday; the step is 23 h after it
    near(mon.budget, after(4 + 10 / 24), 'Monday 00:10');
    near(mon.todayAllowance, after(1));
    assert.equal(mon.dayNo, 5);
  });
  // The week that ends Thursday 2026-10-29 12:00 UTC. On Sunday 10-25 the
  // clocks go from 03:00 back to 02:00: that day is 25 h, from 10-24 22:00
  // UTC to 10-25 23:00 UTC, and 02:30 comes twice.
  test('Europe/Stockholm, the last Sunday of October: a day of 25 h', () => {
    const R = '2026-10-29T12:00:00.000Z';
    const [sat, early, first, second, late, mon] = lines('Europe/Stockholm', R,
      ['2026-10-24T12:00:00.000Z', '2026-10-24T22:30:00.000Z', '2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z', '2026-10-25T22:30:00.000Z', '2026-10-25T23:10:00.000Z']);
    near(sat.budget, after(2 + 10 / 24));
    for (const [l, what] of [[early, 'Sunday 00:30'], [first, '02:30 the first time'], [second, '02:30 the second time'], [late, 'Sunday 23:30, 24 h and more after its midnight']]) {
      near(l.budget, after(3 + 11 / 24), what);
      near(l.todayAllowance, after(25 / 24), what);
      assert.equal(l.dayNo, 4, what);
    }
    near(mon.budget, after(4 + 11 / 24), 'Monday 00:10');
    assert.equal(mon.dayNo, 5);
  });
  // 13 h ahead of UTC in November: the tests' week starts Friday 11-13 at
  // 01:00 there and ends Friday 11-20 at 01:00, its last calendar day 1 h long
  test('Pacific/Auckland: local midnight is 11:00 UTC, and the days are other days', () => {
    const nows = ['2026-11-13T10:59:00.000Z', '2026-11-13T12:00:00.000Z', '2026-11-19T11:30:00.000Z'];
    const [fri, sat, last] = lines('Pacific/Auckland', RESET, nows);
    near(fri.budget, after(23 / 24), 'Friday 23:59, the week\'s first day there');
    assert.deepEqual([fri.dayNo, fri.dayCount], [1, 8]);
    near(sat.budget, after(1 + 23 / 24), 'Saturday 01:00');
    assert.equal(sat.dayNo, 2);
    near(last.budget, 100);
    near(last.todayAllowance, after(1.5 / 24), 'the last day there is its last hour');
    assert.deepEqual([last.dayNo, last.toReset], [8, true]);
    // the same moments in UTC are Friday, day 2, on another line
    const [utc] = lines('UTC', RESET, nows);
    near(utc.budget, after(1.5));
    assert.equal(utc.dayNo, 2);
  });
  test('Pacific/Auckland, the first Sunday of April: its day of 25 h', () => {
    // the week to Thursday 2026-04-09 00:00 UTC (noon there); Sunday 04-05
    // runs from 04-04 11:00 UTC to 04-05 12:00 UTC
    const [sat, sun, mon] = lines('Pacific/Auckland', '2026-04-09T00:00:00.000Z', ['2026-04-04T10:00:00.000Z', '2026-04-04T20:00:00.000Z', '2026-04-05T12:10:00.000Z']);
    near(sat.budget, after(2 + 11 / 24));
    near(sun.budget, after(3.5));
    near(sun.todayAllowance, after(25 / 24));
    near(mon.budget, after(4.5));
  });
  test('America/Los_Angeles, 8 h behind: the first Sunday of November is 25 h there', () => {
    // the week to Thursday 2026-11-05 12:00 UTC; Sunday 11-01 runs from 07:00
    // UTC to 11-02 08:00 UTC
    const [sat, sun, mon] = lines('America/Los_Angeles', '2026-11-05T12:00:00.000Z', ['2026-10-31T20:00:00.000Z', '2026-11-01T20:00:00.000Z', '2026-11-02T08:10:00.000Z']);
    near(sat.budget, after(2 + 19 / 24));
    near(sun.budget, after(3 + 20 / 24));
    near(sun.todayAllowance, after(25 / 24));
    assert.equal(sun.dayNo, 4);
    near(mon.budget, after(4 + 20 / 24));
  });
});

// ---- from here on in this process, whatever its zone: every figure is put
//      against the line lineOf gives for the same moment ----
const reset = new Date(RESET), now = new Date('2026-11-15T12:00:00.000Z');
const L = lineOf({ reset, now, lastDayWeight: 1.5 }).budget;
const at = h => new Date(now.getTime() + h * HOUR).toISOString();
const run = (used, more = {}, cfg = null) => pace({ settings: inForce(cfg), entries: [], used, prem: null, premAt: now.getTime(), reset, now, ...more });
// a logged reading of this week, h hours from now
const entry = (h, more = {}) => ({ t: at(h), all: 10, premium: null, premiumModel: 'fable', line: r1(L), level: 'ahead', reset: RESET, ...more });

describe('levels', () => {
  test('by the distance to the line: 5 points each way, and stop at 95 %', () => {
    assert.deepEqual([-5.1, -5, -0.1, 0, 0.1, 5, 5.1].map(paced), ['ahead', 'on pace', 'on pace', 'on pace', 'over', 'over', 'throttle']);
    assert.deepEqual([levelOf(94.9, 10), levelOf(95, 10), levelOf(95, 100), levelOf(50, 60)], ['throttle', 'stop', 'stop', 'ahead']);
    assert.ok(below('ahead', 'over') && below('over', 'throttle') && !below('over', 'over') && !below('throttle', 'on pace') && !below('stop', 'throttle'));
  });
  test('pace: the level, the delta and the line of the moment', () => {
    for (const [d, level] of [[-10, 'ahead'], [-3, 'on pace'], [3, 'over'], [10, 'throttle']]) {
      const p = run(L + d);
      assert.equal(p.level, level);
      near(p.delta, d);
      near(p.budget, L);
      assert.deepEqual([p.levelBy, p.levelBefore, p.premLevel, p.premOut, p.premHeld, p.trend], ['all', level, null, false, false, null]);
    }
    assert.equal(run(96).level, 'stop');
  });
});

describe('the trend', () => {
  test('the oldest reading within two days, at least 4 h old; under 20 h it is shown, not applied', () => {
    const t = now.getTime();
    assert.equal(trendOf(40, t, [], reset), null);
    assert.equal(trendOf(40, t, [{ t: t - 3 * HOUR, v: 30 }, { t: t - 3 * DAY, v: 1 }], reset), null);
    const tr = trendOf(40, t, [{ t: t - 3 * DAY, v: 1 }, { t: t - DAY, v: 30 }, { t: t - 5 * HOUR, v: 39 }], reset);
    // 10 points in 24 h, 4 days to the reset
    assert.deepEqual([tr.hours, tr.rate, tr.projected, tr.short], [24, 10, 80, false]);
    assert.equal(tr.reach, null);
    assert.equal(floorOf(tr), null);
    const fast = trendOf(40, t, [{ t: t - DAY, v: 20 }], reset);
    assert.deepEqual([fast.projected, floorOf(fast)], [120, 'throttle']);
    // 60 points at 20 a day: 100 % in three days
    assert.equal(fast.reach.getTime(), t + 3 * DAY);
    assert.equal(floorOf(trendOf(40, t, [{ t: t - DAY, v: 24 }], reset)), 'over');
    const short = trendOf(40, t, [{ t: t - 5 * HOUR, v: 20 }], reset);
    assert.deepEqual([short.short, floorOf(short)], [true, null]);
  });
  test('pace: a projection past the reset raises the level, from this week\'s readings only', () => {
    const fast = run(L - 10, { entries: [entry(-24, { all: L - 40 })] });
    assert.deepEqual([fast.level, fast.trend.bumped, fast.levelBefore], ['throttle', true, 'throttle']);
    const short = run(L - 10, { entries: [entry(-5, { all: L - 40 })] });
    assert.deepEqual([short.level, short.trend.short, short.trend.bumped], ['ahead', true, undefined]);
    // another week's reading is no trend; the reset time jitters within the hour
    assert.equal(run(L - 10, { entries: [entry(-24, { all: L - 40, reset: '2026-11-26T12:00:00.000Z' })] }).trend, null);
    assert.ok(run(L - 10, { entries: [entry(-24, { all: L - 40, reset: '2026-11-19T12:00:00.250Z' })] }).trend);
    assert.ok(sameWeek({ reset: '2026-11-19T12:59:00.000Z' }, reset) && !sameWeek({ reset: '2026-11-19T13:01:00.000Z' }, reset));
  });
  test('pace: at "ahead", 10 points or more the trend leaves at the reset are named as unused', () => {
    // a point a day for four more days
    const p = run(L - 20, { entries: [entry(-24, { all: L - 21 })] });
    assert.equal(p.level, 'ahead');
    assert.equal(p.unused, Math.round(100 - (L - 20 + 4)));
    assert.equal(run(L - 20).unused, null);
    assert.equal(run(L - 3, { entries: [entry(-24, { all: L - 4 })] }).unused, null, 'only at "ahead"');
  });
});

describe('the routing', () => {
  test('each class at each level, on the default ladder', () => {
    const tierOf = (p, cls) => p.ladder.indexOf(p.pick(p.route[cls])) + 1;
    const routes = d => { const p = run(d === 'stop' ? 96 : L + d); return ['judgment', 'medium', 'routine', 'trivial'].map(c => tierOf(p, c)).join(''); };
    assert.deepEqual([routes(-10), routes(-3), routes(3), routes(10), routes('stop')], ['1111', '1121', '1221', '2222', '3333']);
    assert.deepEqual(names(run(L).ladder), ['fable high', 'opus medium', 'sonnet medium']);
    // a session runs on tier 1, and on tier 2 from throttle
    assert.deepEqual([run(L - 10).sessionTier.model, run(L + 10).sessionTier.model, run(96).sessionTier.model], ['fable', 'opus', 'opus']);
    // a ladder of two: the routes are clamped to it
    const two = run(96, {}, { tiers: [{ model: 'opus', effort: 'high' }, { model: 'haiku', effort: 'low' }] });
    assert.equal(two.pick('L').model, 'haiku');
    assert.equal(two.pick(2).model, 'haiku');
  });
  test('the reader and the verifier: their own models, or the lowest tier', () => {
    const p = run(L);
    assert.deepEqual([p.readerTier, p.verifierTier].map(t => t.model + ' ' + t.effort), ['haiku medium', 'haiku medium']);
    assert.equal(p.bulkyWhat, 'checks to judge against the task');
    const q = run(L, {}, { reader: 'ladder', verifier: 'ladder' });
    assert.deepEqual([q.readerTier, q.verifierTier, q.bulkyWhat], [null, null, 'logs, test runs, many files']);
    assert.equal(run(L, {}, { reader: 'ladder' }).bulkyWhat, 'logs, many files, checks to judge');
    assert.equal(run(L, {}, { verifier: 'ladder' }).bulkyWhat, 'test runs, builds, checks');
    // on the per-model meter's model while that is out: the lowest tier
    const out = run(L, { prem: 100 }, { reader: { model: 'fable', effort: 'low' } });
    assert.deepEqual([out.readerTier, out.verifierTier.model], [null, 'haiku']);
  });
  test('the tier numbers the hooks module counts by, and their names', () => {
    const s = inForce(null);
    const plain = tierMaps({ ...s, ladder: run(L).ladder });
    assert.deepEqual(plain.tierOf, { 'claude-fable-5-2': 1, 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 4 });
    assert.deepEqual(plain.agentTierOf, { 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-fable-5-2': 1, 'claude-haiku-5-5': 4 });
    assert.deepEqual(plain.tierNames, { 1: 'Fable 5.2 high', 2: 'Opus 5.5 medium', 3: 'Sonnet 5.5 medium', 4: 'Haiku 5.5 medium' });
    // the per-model meter out: Opus holds two places, the session's turns
    // count at the first, its subagents' at the first below tier 1
    const out = tierMaps({ ...s, ladder: run(L, { prem: 100 }).ladder });
    assert.deepEqual([out.tierOf['claude-opus-5-5'], out.agentTierOf['claude-opus-5-5'], out.tierOf['claude-fable-5-2'], out.tierOf['claude-haiku-5-5']], [1, 2, 1, 4]);
    assert.deepEqual(out.tierNames, { 1: 'Opus 5.5 high', 2: 'Opus 5.5 medium', 3: 'Sonnet 5.5 medium', 4: 'Haiku 5.5 medium' });
    // a verifier on a model of its own comes after the reader's
    const own = inForce({ verifier: { model: 'sonnet', effort: 'low' }, tiers: [{ model: 'fable', effort: 'high' }, { model: 'opus', effort: 'medium' }, { model: 'opus', effort: 'low' }] });
    assert.equal(tierMaps({ ...own, ladder: own.tiers }).tierOf['claude-sonnet-5-5'], 5);
  });
});

describe('the per-model meter and its hold', () => {
  test('worse than the weekly meter while its model is tier 1: it sets the level', () => {
    const p = run(L - 10, { prem: L + 2 });
    assert.deepEqual([p.level, p.levelBy, p.levelBefore, p.premLevel, p.premHeld, p.premTop], ['over', 'premium', 'ahead', 'over', false, true]);
    near(p.premDelta, 2);
    // better than it: the weekly meter decides
    assert.deepEqual([run(L + 2, { prem: L - 10 }).level, run(L + 2, { prem: L - 10 }).levelBy], ['over', 'all']);
    // tier 1 on another model: shown only
    const other = run(L - 10, { prem: L + 8 }, { tiers: [{ model: 'opus', effort: 'high' }, { model: 'sonnet', effort: 'medium' }] });
    assert.deepEqual([other.level, other.levelBy, other.premLevel, other.premHeld, other.premTop], ['ahead', 'all', 'throttle', false, false]);
    // a plan without the meter
    assert.equal(run(L - 10, { prem: null }).premLevel, null);
  });
  test('at 100 % it is out: the fallback takes tier 1, or the rest moves up, or no model is left', () => {
    const p = run(L - 10, { prem: 100 });
    assert.deepEqual([p.premOut, p.premLevel, p.premAway, p.level], [true, null, true, 'ahead']);
    assert.deepEqual(names(p.ladder), ['opus high', 'opus medium', 'sonnet medium']);
    assert.deepEqual(names(run(L - 10, { prem: 100 }, { fallback: null }).ladder), ['opus medium', 'sonnet medium']);
    // a fallback that is a tier already is not added twice
    assert.deepEqual(names(run(L - 10, { prem: 100 }, { fallback: { model: 'opus', effort: 'medium' } }).ladder), ['opus medium', 'sonnet medium']);
    const none = run(L - 10, { prem: 100 }, { tiers: [{ model: 'fable', effort: 'high' }, { model: 'fable', effort: 'low' }], fallback: null });
    assert.deepEqual([none.ladder, none.sessionTier], [[], null]);
  });
  test('at its throttle the model is held: the session moves to the fallback, the level stays the week\'s', () => {
    const p = run(L - 10, { prem: L + 6 });
    assert.deepEqual([p.premLevel, p.premHeld, p.premKept, p.premHeldLine, p.level, p.levelBy], ['throttle', true, false, r1(L), 'ahead', 'all']);
    assert.deepEqual(names(p.ladder), ['opus high', 'opus medium', 'sonnet medium']);
    assert.equal(p.sessionTier.model, 'opus');
    // with no other model to take tier 1, its throttle routes like any other
    const alone = run(L - 10, { prem: L + 6 }, { tiers: [{ model: 'fable', effort: 'high' }, { model: 'fable', effort: 'low' }], fallback: null });
    assert.deepEqual([alone.premHeld, alone.level, alone.levelBy], [false, 'throttle', 'premium']);
    // never at stop
    assert.deepEqual([run(96, { prem: 99 }).premHeld, run(96, { prem: 99 }).level], [false, 'stop']);
  });
  test('a hold stays for the rest of the day, by the line of the day it began', () => {
    const held = (line, more = {}) => [entry(-1, { premium: L + 6, premiumHeld: true, premiumHeldLine: line, ...more })];
    // the same day: held however far under the line the figure is now
    const same = run(L - 10, { prem: L - 20, entries: held(r1(L)) });
    assert.deepEqual([same.premHeld, same.premKept, same.premHeldLine, same.premLevel], [true, true, r1(L), 'ahead']);
    // a day on: held while less than 5 points under, and the hold keeps its day
    const next = run(L - 10, { prem: L - 3, entries: held(r1(L) - 13.3) });
    assert.deepEqual([next.premHeld, next.premKept, next.premHeldLine], [true, true, r1(L) - 13.3]);
    // 5 points under or more: let back
    const back = run(L - 10, { prem: L - 6, entries: held(r1(L) - 13.3) });
    assert.deepEqual([back.premHeld, back.premKept, back.premHeldLine, names(back.ladder)[0]], [false, false, null, 'fable high']);
    // at its throttle again it is a hold of today
    const again = run(L - 10, { prem: L + 6, entries: held(r1(L) - 13.3) });
    assert.deepEqual([again.premHeld, again.premKept, again.premHeldLine], [true, false, r1(L)]);
    // an older entry carries no day of the hold: its own line stands in
    const old = run(L - 10, { prem: L - 20, entries: held(undefined) });
    assert.deepEqual([old.premHeld, old.premHeldLine], [true, r1(L)]);
    // only the last reading counts, of this week, held on this model
    assert.equal(run(L - 10, { prem: L - 20, entries: [...held(r1(L)), entry(-0.5)] }).premHeld, false);
    assert.equal(run(L - 10, { prem: L - 20, entries: held(r1(L), { reset: '2026-11-26T12:00:00.000Z' }) }).premHeld, false);
    assert.equal(run(L - 10, { prem: L - 20, entries: held(r1(L), { premiumModel: 'opus' }) }).premHeld, false);
  });
  // The day of a hold is told by its line, and the line is one figure from a
  // local midnight to the next: on the 23 h Sunday of March and the 25 h
  // Sunday of October the hold lasts to that day's own midnight.
  test('the same day in Europe/Stockholm across both clock changes', () => {
    const held = (t, line, reset) => [{ t, all: 5, premium: line + 7, premiumModel: 'fable', premiumHeld: true, premiumHeldLine: line, line, level: 'ahead', reset }];
    const march = '2026-04-02T12:00:00.000Z', m = held('2026-03-28T23:30:00.000Z', 45.6, march);
    const [late, mon, monNear] = inZone('Europe/Stockholm', [
      // held Sunday 00:30, before the clocks change; 23:30 the same day, far under its line
      { reset: march, now: '2026-03-29T21:30:00.000Z', used: 5, prem: 38, entries: m },
      // Monday 00:10: the day is over, 21 points under lets it back
      { reset: march, now: '2026-03-29T22:10:00.000Z', used: 5, prem: 38, entries: m },
      // 3 points under is not yet enough
      { reset: march, now: '2026-03-29T22:10:00.000Z', used: 5, prem: 56, entries: m },
    ]);
    assert.deepEqual([late.premHeld, late.premKept, late.premHeldLine, late.top], [true, true, 45.6, 'opus']);
    assert.deepEqual([mon.premHeld, mon.top], [false, 'fable']);
    assert.deepEqual([monNear.premHeld, monNear.premKept, monNear.premHeldLine], [true, true, 45.6]);
    const october = '2026-10-29T12:00:00.000Z', o = held('2026-10-24T22:30:00.000Z', 46.1, october);
    const [day, after25] = inZone('Europe/Stockholm', [
      // 24 h after the hold began it is still Sunday, 23:30
      { reset: october, now: '2026-10-25T22:30:00.000Z', used: 5, prem: 38, entries: o },
      { reset: october, now: '2026-10-25T23:10:00.000Z', used: 5, prem: 38, entries: o },
    ]);
    assert.deepEqual([day.premHeld, day.premKept], [true, true]);
    assert.equal(after25.premHeld, false);
  });
  test('the same day far from UTC: Saturday in Pacific/Auckland is two days in UTC', () => {
    // held Saturday 01:00 there (line 26.1 %); 23:30 the same day is past UTC's midnight
    const e = [{ t: '2026-11-13T12:00:00.000Z', all: 5, premium: 33, premiumModel: 'fable', premiumHeld: true, premiumHeldLine: 26.1, line: 26.1, level: 'ahead', reset: RESET }];
    const calls = [{ reset: RESET, now: '2026-11-14T10:30:00.000Z', used: 5, prem: 15, entries: e }, { reset: RESET, now: '2026-11-14T11:10:00.000Z', used: 5, prem: 15, entries: e }];
    const [same, sunday] = inZone('Pacific/Auckland', calls);
    assert.deepEqual([same.premHeld, same.premKept, same.premHeldLine], [true, true, 26.1]);
    assert.equal(sunday.premHeld, false);
    // in UTC the line has stepped by 10:30 already: no longer the day of the hold
    assert.equal(inZone('UTC', calls)[0].premHeld, false);
  });
  test('a last day too short to tell from the day before is no "same day"', () => {
    // the reset 2 min after midnight: Wednesday's line is 99.97 %, the last
    // day's 100 %, and the log holds both as 100.0
    const R = '2026-11-19T00:02:00.000Z';
    const e = [{ t: '2026-11-18T23:00:00.000Z', all: 50, premium: 97, premiumModel: 'fable', premiumHeld: true, premiumHeldLine: 100, line: 100, level: 'ahead', reset: R }];
    const [wed, last] = inZone('UTC', [{ reset: R, now: '2026-11-18T23:30:00.000Z', used: 50, prem: 90, entries: e }, { reset: R, now: '2026-11-19T00:01:00.000Z', used: 50, prem: 90, entries: e }]);
    assert.equal(wed.premHeld, true, 'Wednesday, the day of the hold');
    assert.equal(last.premHeld, false, 'Thursday\'s two minutes: 10 points under lets it back');
  });
  test('the figure an automatic reading carries: the last one read this week, with its time', () => {
    const r = Date.parse(RESET);
    const log = [entry(-30, { premium: 20 }), entry(-20, { premium: 30, reset: '2026-11-12T12:00:00.000Z' }), entry(-10, { premium: 25, premiumAt: at(-30) }), entry(-5, { premium: null })];
    assert.deepEqual(carriedPremium(log, 'fable', r), { premium: 25, at: at(-30) });
    assert.deepEqual(carriedPremium(log.slice(0, 2), 'fable', r), { premium: 20, at: at(-30) });
    assert.equal(carriedPremium(log, 'opus', r), null);
    assert.equal(carriedPremium([], 'fable', r), null);
  });
  test('where a carried figure probably is by now: by how the two meters moved between full readings', () => {
    // 4 points of the week were 12 on the per-model meter: 3 to 1
    const weekLog = [entry(-30, { all: 10, premium: 20 }), entry(-10, { all: 14, premium: 32 }), entry(-5, { all: 15, premium: 32, premiumAt: at(-10) })];
    const s = premiumSince({ weekLog, premium: 'fable', premFrom: { premium: 32, at: at(-10) }, prem: 32, used: 17 });
    assert.deepEqual([s.allMoved, s.ratio, s.estimate], [3, 3, 41]);
    // read now: no estimate; one full reading: no ratio; never past 100 %
    assert.deepEqual(premiumSince({ weekLog, premium: 'fable', premFrom: null, prem: 32, used: 17 }), { allMoved: null, ratio: 3, estimate: null });
    assert.equal(premiumSince({ weekLog: weekLog.slice(1), premium: 'fable', premFrom: { premium: 32, at: at(-10) }, prem: 32, used: 17 }).estimate, null);
    assert.equal(premiumSince({ weekLog, premium: 'fable', premFrom: { premium: 32, at: at(-10) }, prem: 32, used: 60 }).estimate, 100);
  });
});

describe('the 5-hour window\'s pace', () => {
  test('from the oldest reading of this window, 20 min old or more, not above the figure now', () => {
    const fiveReset = new Date(now.getTime() + 2 * HOUR);
    const log = [entry(-4, { five: 80 }), entry(-2, { five: 10 }), entry(-1, { five: 30 }), entry(-0.2, { five: 49 })];
    const t = fiveTrendOf(log, 50, fiveReset, now);
    // 40 points in 2 h, 2 h left: full before the reset
    assert.deepEqual([t.rate, t.projected], [20, 90]);
    assert.equal(t.reach, null);
    assert.equal(fiveTrendOf(log, 70, fiveReset, now).reach.getTime(), now.getTime() + HOUR);
    // the reading 4 h ago was the window before: 3 h before this one began
    assert.equal(fiveTrendOf(log.slice(0, 1), 90, fiveReset, now), null);
    assert.equal(fiveTrendOf(log.slice(3), 50, fiveReset, now), null);
  });
});

describe('the week in sum', () => {
  test('weeks by their reset, within the hour; time by level, and how the meter stood to the line', () => {
    const NEXT = '2026-11-26T12:00:00.000Z';
    const log = [
      { t: '2026-11-20T12:00:00.000Z', all: 5, line: 20, level: 'ahead', reset: NEXT },
      { t: '2026-11-13T12:00:00.000Z', all: 30, line: 20, level: 'throttle', reset: RESET },
      { t: '2026-11-12T12:00:00.000Z', all: 5, line: 6.7, level: 'on pace', reset: '2026-11-19T12:00:00.400Z' },
      { t: '2026-11-18T12:00:00.000Z', all: 80, line: 86.7, level: 'ahead', reset: RESET },
      { all: 1, reset: RESET },
    ];
    const weeks = weeksOf(log);
    assert.deepEqual(weeks.map(w => [new Date(w.reset).toISOString().slice(0, 10), w.entries.length]), [['2026-11-19', 3], ['2026-11-26', 1]]);
    assert.deepEqual(weeks[0].entries.map(e => e.all), [5, 30, 80]);
    const s = summarise(weeks[0], Date.parse(NEXT));
    // a day on pace, five at throttle, the last one ahead
    assert.deepEqual(s.shares, ['ahead 14 %', 'on pace 14 %', 'throttle 71 %']);
    assert.deepEqual([s.readings, s.last.all, s.over.length, s.peak.d], [3, 80, 1, 10]);
    // the week still running counts to now, not to its reset
    assert.deepEqual(summarise(weeks[1], Date.parse('2026-11-21T12:00:00.000Z')).shares, ['ahead 100 %']);
    assert.deepEqual(weeksOf([]), []);
  });
});

describe('dollars per point of the weekly meter: the one rule', () => {
  const week = { reset: Date.parse(RESET), resetText: RESET };
  test('rate.json after a reading: the baseline, the sum, a new week', () => {
    // the first reading of a week is its baseline, and drops what was spent before it
    const first = rateNext(null, { ...week, used: 10, spent: 0.5 });
    assert.deepEqual(first, { v: 2, reset: RESET, from: 10, to: 10, usd: 0, carried: null });
    for (const none of [undefined, 'text', [], {}, { reset: RESET, from: 10, to: 16, tokens: 6e6 }]) assert.deepEqual(rateNext(none, { ...week, used: 10, spent: 0.5 }), first);
    // the same week (the reset time jitters): the highest figure, the dollars added
    const on = rateNext({ ...first, reset: '2026-11-19T12:00:00.300Z' }, { ...week, used: 16, spent: 1.5 });
    assert.deepEqual([on.from, on.to, on.usd, on.reset], [10, 16, 1.5, '2026-11-19T12:00:00.300Z']);
    assert.equal(rateNext(on, { ...week, used: 14, spent: 0.5 }).to, 16);
    assert.equal(rateNext(on, { ...week, used: 14, spent: 0.5 }).usd, 2);
    // a new week carries the rate of a week that rose 5 points or more, and keeps the pace
    const NEXT = '2026-11-26T12:00:00.000Z', next = { reset: Date.parse(NEXT), resetText: NEXT, used: 3, spent: 9 };
    assert.deepEqual(rateNext({ ...on, pace: { usd: 12, at: 5 } }, next), { v: 2, reset: NEXT, from: 3, to: 3, usd: 0, carried: 0.25, pace: { usd: 12, at: 5 } });
    // one that rose less carries what it carried
    assert.equal(rateNext({ ...on, to: 14, carried: 0.4 }, next).carried, 0.4);
    assert.equal(rateNext({ ...on, to: 14 }, next).carried, null);
    // a late reading of the week before leaves the file's week alone
    assert.deepEqual(rateNext({ ...on, reset: NEXT, carried: null }, { ...week, used: 90, spent: 5 }), { ...on, reset: NEXT, carried: null });
  });
  test('the rate a file gives: this week\'s from 5 points, the carried one, the estimate, this week\'s from 2', () => {
    const f = more => ({ v: 2, reset: RESET, from: 10, to: 10, usd: 0, carried: null, ...more });
    const est = { usd: 10, points: 8, at: 1 };
    assert.deepEqual(rateOf(f({ to: 16, usd: 3, carried: 9, estimate: est })), { usd: 0.5, from: 'week', rise: 6 });
    assert.deepEqual(rateOf(f({ to: 14, usd: 3, carried: 9, estimate: est })), { usd: 9, from: 'carried', rise: 4 });
    assert.deepEqual(rateOf(f({ to: 14, usd: 3, estimate: est })), { usd: 1.25, from: 'estimate', rise: 4 });
    // budget.mjs under 2 points on the meter takes no estimate
    assert.deepEqual(rateOf(f({ to: 14, usd: 3, estimate: est }), { estimate: false }), { usd: 0.75, from: 'early', rise: 4 });
    assert.deepEqual(rateOf(f({ to: 12, usd: 3 })), { usd: 1.5, from: 'early', rise: 2 });
    assert.deepEqual(rateOf(f({ to: 11, usd: 3 })), { usd: null, from: null, rise: 1 });
    // a rise with nothing spent, an estimate without its figures: none
    assert.equal(rateOf(f({ to: 20 })).from, null);
    assert.equal(rateOf(f({ to: 11, estimate: { usd: 10, points: 0, at: 1 } })).from, null);
    // no file, a damaged one, 0.9.15's raw tokens per point (no v: 2)
    for (const none of [null, undefined, 'x', [], {}, { reset: RESET, from: 10, to: 20, usd: 5 }]) assert.deepEqual(rateOf(none), { usd: null, from: null, rise: 0 });
  });
});

describe('a date argument', () => {
  test('a date as Date reads it, or null; the line it is refused with', () => {
    assert.equal(dateOf('2026-11-13T12:00:00Z').getTime(), Date.parse('2026-11-13T12:00:00Z'));
    for (const v of ['garbage', '', '  ', undefined, null, '2026-13-45']) assert.equal(dateOf(v), null);
    assert.equal(badDateText('--now', 'garbage'), '--now must be a date, such as 2026-11-22T10:00:00Z, not "garbage"');
    assert.equal(badDateText('--now', undefined), '--now must be a date, such as 2026-11-22T10:00:00Z');
  });
});

test('line.mjs reads no file, no clock and no environment, and prints nothing', () => {
  const src = fs.readFileSync(path.join(scripts, 'line.mjs'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.deepEqual([...src.matchAll(/^import .* from '(.*)';$/gm)].map(m => m[1]), ['./models.mjs']);
  assert.doesNotMatch(src, /\bprocess\b|\bconsole\b|Date\.now\(|new Date\(\)|\bfs\b|require\(/);
  const models = fs.readFileSync(path.join(scripts, 'models.mjs'), 'utf8');
  assert.doesNotMatch(models, /^import /m);
});

// ---- budget.mjs itself in another zone: the report's own figures ----
describe('budget.mjs where the clocks change', () => {
  const R = '2026-04-02T12:00:00.000Z', zone = { env: { TZ: 'Europe/Stockholm' } };
  test('Europe/Stockholm: the line steps at local midnight into the 23 h Sunday, and `last` draws it for now', () => {
    const s = sandbox();
    try {
      const dry = now => s.budget(['--all', '30', '--reset', R, '--now', now, '--dry'], zone).out;
      // Saturday 23:50 and Sunday 00:10, local
      const sat = dry('2026-03-28T22:50:00.000Z'), sun = dry('2026-03-28T23:10:00.000Z');
      assert.deepEqual([printedLine(sat), printedLevel(sat)], [32.8, 'on pace']);
      assert.match(sat, /^day 3 of 8 \(calendar days\)/m);
      assert.deepEqual([printedLine(sun), printedLevel(sun)], [45.6, 'ahead']);
      assert.match(sun, /^day 4 of 8 \(calendar days\)/m);
      assert.match(sun, /^allowance today 12\.8 %, budget line now 45\.6 % \(counted to midnight\)$/m);
      // Sunday 23:30, after the clocks changed: the same line; Monday 00:10 the next
      assert.equal(printedLine(dry('2026-03-29T21:30:00.000Z')), 45.6);
      assert.equal(printedLine(dry('2026-03-29T22:10:00.000Z')), 58.9);
      // a reading Saturday 23:50, asked for again Sunday 00:10
      assert.equal(s.budget(['--all', '30', '--premium', '2', '--reset', R, '--now', '2026-03-28T22:50:00.000Z'], zone).code, 0);
      const last = s.budget(['last', '--now', '2026-03-28T23:10:00.000Z'], zone).out;
      assert.match(last, /^last reading 03-28 23:50, 20 min ago, not read now$/m);
      assert.equal(printedLevel(last), 'ahead');
    } finally { s.cleanup(); }
  });
  test('Europe/Stockholm: a hold begun before the clocks change stays to that day\'s midnight, then is let back', () => {
    const s = sandbox();
    try {
      const at = (now, prem) => s.budget(['--all', '10', '--premium', String(prem), '--reset', R, '--now', now, '--session', 'claude-opus-5-5'], zone).out;
      assert.match(at('2026-03-28T23:30:00.000Z', 52), /Fable 5.2 held$/m);
      const late = at('2026-03-29T21:30:00.000Z', 38);
      assert.match(late, /Fable 5.2 held$/m);
      assert.match(late, /^do: Fable 5\.2 stays held for now/m);
      const mon = at('2026-03-29T22:10:00.000Z', 38);
      assert.doesNotMatch(mon, /held/);
      assert.match(mon, /^next session: Fable 5.2 high$/m);
      const log = s.read('log.jsonl').trim().split('\n').map(l => JSON.parse(l));
      assert.deepEqual(log.map(e => [e.line, e.premiumHeld, e.premiumHeldLine]), [[45.6, true, 45.6], [45.6, true, 45.6], [58.9, undefined, undefined]]);
    } finally { s.cleanup(); }
  });
  test('Pacific/Auckland: the day and the line are the local ones', () => {
    const s = sandbox();
    try {
      const out = s.budget(['--all', '10', '--reset', RESET, '--now', '2026-11-13T12:00:00.000Z', '--dry'], { env: { TZ: 'Pacific/Auckland' } }).out;
      assert.equal(printedLine(out), 26.1);
      assert.match(out, /^day 2 of 8 \(calendar days\), 1 days elapsed, 6 days to reset$/m);
      // UTC, as the other tests run: Friday is day 2 as well, on 20 %
      assert.equal(printedLine(s.budget(['--all', '10', '--reset', RESET, '--now', '2026-11-13T12:00:00.000Z', '--dry']).out), 20);
    } finally { s.cleanup(); }
  });
});
