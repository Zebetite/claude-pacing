// The arithmetic of a reading, apart from what budget.mjs does around it:
// given the settings, the log's readings, the meters and the time, it gives
// the budget line, the level, the per-model meter's level and its hold, and
// the routing; beside that the trends, the week in sum, the dollars per point
// of the weekly meter (rate.json's rule) and the tier numbers the hooks
// module counts by. Nothing here reads a file, the clock or the environment,
// and nothing prints: budget.mjs does those and calls this, doctor.mjs and
// saved.mjs take the rate from it, and the tests import it
// (tests/line.test.mjs). One thing comes from outside all the same: the line
// steps at local midnight, in the time zone the process runs in.
import { MODELS, relabel, defaults, setting } from './models.mjs';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const r1 = n => Math.round(n * 10) / 10;
const fin = v => typeof v === 'number' && Number.isFinite(v);

// ---- the settings in force ----
// A config as loaded (models.mjs checkConfig; null or {} on a first run or
// with a damaged file), each key it lacks filled from the defaults.
export const inForce = cfg => {
  const c = cfg || {};
  // a tier as stored carries the label of the day it was written
  const tiers = (c.tiers || defaults().tiers).map(relabel);
  // when the premium model's meter is full, this tier takes its place at the
  // top (Opus 5.5 high by default): the session keeps a strong model for
  // judgment while routine work stays on the cheaper tier 2
  const fallback = setting(c, 'fallback');
  // the per-model weekly meter: which ladder model it belongs to (fable unless
  // config.premium says otherwise; null when the plan has no such meter)
  const premium = setting(c, 'premium');
  return {
    tiers,
    fallbackTier: fallback && MODELS[fallback.model] ? { model: fallback.model, label: MODELS[fallback.model].label, effort: fallback.effort } : null,
    // the reader agent (pacing:reader) reads at a model of its own, Haiku 5.5
    // medium by default: finding and summing up asks less than the work the
    // lowest tier is chosen for. 'ladder' makes it follow the lowest tier.
    readerCfg: setting(c, 'reader'),
    // the verifier (pacing:verifier) runs plain test runs at a model of its own,
    // Haiku 5.5 medium by default: running a suite and quoting what failed asks
    // little judgment. A check with acceptance points to judge stays on the
    // lowest tier. 'ladder' makes every run follow the lowest tier.
    verifierCfg: setting(c, 'verifier'),
    lastDayWeight: c.lastDayWeight || defaults().lastDayWeight,
    setNextModel: c.setNextModel !== false,
    premium,
    premLabel: premium && MODELS[premium] ? MODELS[premium].label : null,
  };
};

// ---- the budget line (a step per local day) ----
// share(t): the part of the week's allowance that belongs to the time from the
// week's start to t; the last 24 h before the reset weigh lastDayWeight, the
// rest 1. The line is share() at the next local midnight (or the reset, if
// that comes first), so the whole of the current calendar day counts as
// available from its start, and the step falls at midnight, not at the hour
// of the reset. `reset` and `now` are Dates; the week is the 7 days (168 h)
// that end at the reset.
export const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const lineOf = ({ reset, now, lastDayWeight }) => {
  const left = Math.max(0, (reset - now) / DAY);
  const elapsed = Math.min(7, Math.max(0, 7 - left));
  const weekStart = reset.getTime() - 7 * DAY;
  const units = 6 + lastDayWeight;
  // a full day's allowance, the last one aside
  const daily = 100 / units;
  const share = t => {
    const d = Math.min(7, Math.max(0, (t - weekStart) / DAY));
    return 100 * (Math.min(d, 6) + Math.max(0, d - 6) * lastDayWeight) / units;
  };
  const startOfToday = midnight(now);
  // the next midnight by the calendar, not +24 h: the day the clocks change is 23 or 25 h long
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const endOfToday = Math.min(reset.getTime(), nextMidnight);
  // the day label counts calendar days, like the line: a week that resets at
  // noon touches 8 of them, the first and the last ones half
  const calDays = (a, b) => Math.round((midnight(new Date(b)) - midnight(new Date(a))) / DAY);
  const dayNo = Math.min(calDays(weekStart, now) + 1, calDays(weekStart, reset.getTime() - 1) + 1);
  const dayCount = calDays(weekStart, reset.getTime() - 1) + 1;
  const todayAllowance = share(endOfToday) - share(Math.max(weekStart, startOfToday));
  const budget = share(endOfToday);
  return { left, elapsed, weekStart, daily, share, startOfToday, endOfToday, toReset: endOfToday === reset.getTime(), dayNo, dayCount, todayAllowance, budget };
};

// ---- levels ----
export const LEVELS = ['ahead', 'on pace', 'over', 'throttle'];
// a meter's level by its distance to the line alone
export const paced = delta => (delta > 5 ? 'throttle' : delta > 0 ? 'over' : delta >= -5 ? 'on pace' : 'ahead');
// the weekly meter's: at 95 % the week is nearly used, wherever the line is
export const levelOf = (used, budget) => (used >= 95 ? 'stop' : paced(used - budget));
export const below = (a, b) => LEVELS.includes(a) && LEVELS.indexOf(a) < LEVELS.indexOf(b);

// ---- trend from the log: the oldest reading of this week within the last two
//      days, at least 4 h old, gives the burn rate. The same week means a reset
//      within an hour of this one (the API's reset time jitters by milliseconds).
//      The projection only moves the level once the sample spans 20 h or more,
//      so that it covers a night: a busy morning alone is not a trend. ----
export const TREND_MIN_H = 20;
export const sameWeek = (e, reset) => Math.abs(new Date(e.reset) - reset) <= HOUR;
// one meter's trend: its value at `at` (ms) against the oldest of its readings
// ({ t, v }) within the two days before, at least 4 h older
export const trendOf = (value, at, readings, reset) => {
  const prev = readings.filter(p => at - p.t <= 2 * DAY && at - p.t >= 4 * HOUR);
  if (!prev.length) return null;
  const p = prev[0];
  const hours = (at - p.t) / HOUR;
  const rate = (value - p.v) / (hours / 24);
  const projected = value + rate * Math.max(0, (reset - at) / DAY);
  const reach = rate > 0 && projected > 100 ? new Date(at + ((100 - value) / rate) * DAY) : null;
  return { hours, rate, projected, reach, short: hours < TREND_MIN_H };
};
// the projection overrides the line: past 100 % at least "over", past 115 % "throttle"
export const floorOf = tr => (!tr || tr.short ? null : tr.projected > 115 ? 'throttle' : tr.projected > 100 ? 'over' : null);

// ---- routing ----
// Which tier takes each class of work at each level. 1 = the top tier (the
// session model), L = the lowest tier. Clamped to the ladder.
// Trivial work stays in the session until throttle: a subagent costs tens of
// thousands of tokens before it reads a file, so a grep delegated to a cheap
// model costs more on the meter than the same grep done by the session.
// Bulky output is the exception at every level (the "bulky" line in the
// report): what a subagent reads stays out of the session's context, which is
// re-sent on every later turn.
export const ROUTES = {
  'ahead': { judgment: 1, medium: 1, routine: 1, trivial: 1 },
  'on pace': { judgment: 1, medium: 1, routine: 2, trivial: 1 },
  'over': { judgment: 1, medium: 2, routine: 2, trivial: 1 },
  'throttle': { judgment: 2, medium: 2, routine: 2, trivial: 2 },
  'stop': { judgment: 'L', medium: 'L', routine: 'L', trivial: 'L' },
};
export const CLASSES = ['judgment', 'medium', 'routine', 'trivial'];
// A hold stays. The per-model meter's level moves with its trend, which swings
// from one reading to the next, and a session that has left the model lets the
// trend fall again: the hold came and went within the hour and the session
// was sent off the model and back (live: seven times in a day). So a model
// held at the last logged reading stays held for the rest of that day (the
// budget line steps once a day), and after the step until its meter is
// HOLD_RELEASE points or more under the line by its figure alone. That is
// two switches a day at most.
export const HOLD_RELEASE = 5;
// What goes unused: the allowance does not carry over the reset. At
// "ahead", where the trend (20 h or more of it) projects UNUSED_MIN points
// or more under 100 % at the reset, the report, the status report and one
// toast (readings.mjs) say so: there is room for harder work and more
// effort, which the level alone does not show.
export const UNUSED_MIN = 10;

// The per-model figure an automatic reading carries over: the last one read
// in the week of `reset` (ms), with the time it was read; null when the week
// has none. A lower bound: a meter only rises.
export const carriedPremium = (entries, premium, reset) => {
  const known = entries.filter(e => e.premiumModel === premium && e.premium != null && Math.abs(Date.parse(e.reset) - reset) <= HOUR);
  const last = known[known.length - 1];
  return last ? { premium: last.premium, at: last.premiumAt || last.t } : null;
};

// ---- a reading: the line, the level, the hold, the routing ----
//   settings  inForce(config)
//   entries   the log's readings, oldest first (every week's: this week's are
//             picked here)
//   used      the weekly meter, in percent
//   prem      the per-model meter, or null (the plan has none, or no figure)
//   premAt    when that figure was read (ms): now, or earlier for a carried one
//   reset, now  Dates
// Returns the line (lineOf), delta, the level with what set it (levelBy:
// 'all' or 'premium'; levelBefore: the weekly meter's own), the trends, the
// per-model meter's level and flags (premOut: at 100 %; premHeld: over its
// line, the session moves off the model; premKept: held by the rule above,
// not by the level now; premHeldLine: the line of the day the hold began),
// this week's readings (weekLog), and the routing: the ladder in force, the
// reader's and the verifier's tiers, the route of each class, pick(route)
// and the tier a session should run on.
export const pace = ({ settings, entries, used, prem, premAt, reset, now }) => {
  const { tiers, fallbackTier, readerCfg, verifierCfg, lastDayWeight, premium } = settings;
  const line = lineOf({ reset, now, lastDayWeight });
  const budget = line.budget;
  const delta = used - budget;

  // "<premium> out" is a flag beside the level, not a level: it takes every tier
  // of that model off the ladder, while the level still comes from the all-models
  // meter (at 96 % the week is still nearly used, premium meter or not)
  const premOut = prem !== null && prem >= 100;
  let level = levelOf(used, budget);

  const weekLog = entries.filter(e => sameWeek(e, reset));
  const trend = trendOf(used, now.getTime(), weekLog.map(e => ({ t: Date.parse(e.t), v: e.all })), reset);
  if (trend && floorOf(trend) && below(level, floorOf(trend))) {
    level = floorOf(trend);
    trend.bumped = true;
  }

  // ---- the per-model meter, paced on the same line. A session on that model
  //      draws on both meters at once, and a long one can drain the per-model
  //      meter while the all-models one still reads "ahead" (11 points in 46
  //      min were seen). Its level comes by the same thresholds and its own
  //      trend, from the readings that read it in full (a carried figure would
  //      flatten the slope). It counts only while tier 1 is that model: then
  //      the worse of the two levels decides, and at its "throttle" the session
  //      moves to the fallback tier as when the meter is out, so what is left
  //      of the meter goes to judgment work. A carried figure is a lower bound
  //      (the meter only rises): its level can be too mild, never too strict. ----
  const premDelta = prem === null ? null : prem - budget;
  let premLevel = null, premTrend = null;
  if (prem !== null && !premOut) {
    premLevel = paced(premDelta);
    premTrend = trendOf(prem, premAt, weekLog.filter(e => e.premiumModel === premium && e.premium != null && !e.premiumAt)
      .map(e => ({ t: Date.parse(e.t), v: e.premium })), reset);
    if (premTrend && floorOf(premTrend) && below(premLevel, floorOf(premTrend))) {
      premLevel = floorOf(premTrend);
      premTrend.bumped = true;
    }
  }
  const premTop = !!tiers[0] && tiers[0].model === premium;
  const levelBefore = level;
  // 'premium' when the per-model meter set the level
  let levelBy = 'all';
  let premHeld = false;
  // the hold (HOLD_RELEASE, above)
  let premKept = false, premHeldLine = null;
  if (premLevel && premTop && level !== 'stop') {
    // held only when another model can take tier 1; with none, its throttle
    // routes like any other
    const others = tiers.some(t => t.model !== premium) || (fallbackTier && fallbackTier.model !== premium);
    const before = weekLog.at(-1);
    const wasHeld = !!before && before.premiumHeld === true && before.premiumModel === premium;
    // the day the hold began, by its budget line (carried in the log): the
    // line is one figure from a local midnight to the next, whatever the
    // zone and however long the day (23 or 25 h where the clocks change).
    // The log holds it to a tenth, so a day whose own allowance is under
    // 0.11 points (the week's last, where the reset falls within four
    // minutes after midnight) cannot be told from the day before: then no
    // day counts as the same, and the figure alone decides.
    const since = wasHeld ? (typeof before.premiumHeldLine === 'number' ? before.premiumHeldLine : before.line) : null;
    const sameDay = typeof since === 'number' && Math.abs(since - budget) < 0.06 && line.todayAllowance >= 0.11;
    const keep = wasHeld && premLevel !== 'throttle' && (sameDay || premDelta > -HOLD_RELEASE);
    if ((premLevel === 'throttle' || keep) && others) { premHeld = true; premKept = keep; premHeldLine = keep && typeof since === 'number' ? since : Math.round(budget * 10) / 10; }
    else if (below(level, premLevel)) { level = premLevel; levelBy = 'premium'; }
  }
  // the model is off tier 1 either way: out (its meter full) or held (over its line)
  const premAway = premOut || premHeld;

  const rest = tiers.filter(t => t.model !== premium);
  const ladder = !premAway ? tiers
    : fallbackTier && fallbackTier.model !== premium && !rest.some(t => t.model === fallbackTier.model && t.effort === fallbackTier.effort)
      ? [fallbackTier, ...rest]
      : rest;
  // a reader model whose meter is out, or held off tier 1, follows the lowest tier like 'ladder'
  const readerTier = readerCfg && readerCfg !== 'ladder' && MODELS[readerCfg.model] && !(premAway && readerCfg.model === premium)
    ? { model: readerCfg.model, label: MODELS[readerCfg.model].label, effort: readerCfg.effort } : null;
  const verifierTier = verifierCfg && verifierCfg !== 'ladder' && MODELS[verifierCfg.model] && !(premAway && verifierCfg.model === premium)
    ? { model: verifierCfg.model, label: MODELS[verifierCfg.model].label, effort: verifierCfg.effort } : null;
  // what bulky work the lowest tier still takes, once the reader and the
  // verifier took theirs
  const bulkyWhat = !readerTier && !verifierTier ? 'logs, test runs, many files' : !readerTier ? 'logs, many files, checks to judge'
    : !verifierTier ? 'test runs, builds, checks' : 'checks to judge against the task';
  const route = ROUTES[level];
  const pick = r => { const i = r === 'L' ? ladder.length : Math.min(r, ladder.length); return ladder[i - 1]; };
  // the model a session should run on at this level
  const sessionTier = !ladder.length ? null : level === 'throttle' || level === 'stop' ? pick(2) : pick(1);
  const unused = trend && !trend.short && level === 'ahead' && 100 - trend.projected >= UNUSED_MIN ? Math.round(100 - trend.projected) : null;

  return { line, budget, delta, level, levelBefore, levelBy, trend, unused, weekLog,
    premOut, premDelta, premLevel, premTrend, premTop, premHeld, premKept, premHeldLine, premAway,
    ladder, readerTier, verifierTier, bulkyWhat, route, pick, sessionTier };
};

// ---- the 5-hour window's pace: the oldest reading of this window, at least
//      20 min old, whose value is not above the current one (a drop means the
//      window reset in between). null without one. ----
export const fiveTrendOf = (entries, five, fiveReset, now) => {
  const windowStart = fiveReset.getTime() - 5 * HOUR;
  const prevFive = entries.filter(e => e.five != null && new Date(e.t) >= windowStart && now - new Date(e.t) >= 20 * 60000 && e.five <= five);
  if (!prevFive.length) return null;
  const e = prevFive[0];
  const h = (now - new Date(e.t)) / HOUR;
  const rate = (five - e.five) / h;
  const hoursLeft = Math.max(0, (fiveReset - now) / HOUR);
  const projected = five + rate * hoursLeft;
  const reach = rate > 0 && projected > 100 ? new Date(now.getTime() + ((100 - five) / rate) * HOUR) : null;
  return { rate, projected, reach };
};

// ---- a carried per-model figure is not a current one: where the meter
//      probably is by now. The figure plus what all models moved since it was
//      read, times how the two meters moved against each other between this
//      week's full readings (the per-model allowance is the smaller one, so
//      its meter moves faster). An estimate, never used for a level: a level
//      rests on figures that were read. `premFrom`: the carried figure
//      (carriedPremium), or null for one read now. ----
export const premiumSince = ({ weekLog, premium, premFrom, prem, used }) => {
  const fulls = weekLog.filter(e => e.premiumModel === premium && typeof e.premium === 'number' && !e.premiumAt);
  const readAt = premFrom ? fulls.filter(e => e.t === premFrom.at).at(-1) || fulls.at(-1) : null;
  // what the weekly meter moved since the figure was read
  const allMoved = readAt ? Math.max(0, used - readAt.all) : null;
  const ratio = fulls.length >= 2 && fulls.at(-1).all - fulls[0].all >= 2 && fulls.at(-1).premium >= fulls[0].premium
    ? Math.min(10, (fulls.at(-1).premium - fulls[0].premium) / (fulls.at(-1).all - fulls[0].all)) : null;
  const estimate = premFrom && prem !== null && ratio !== null && allMoved > 0 && ratio * allMoved >= 1 ? Math.min(100, r1(prem + ratio * allMoved)) : null;
  return { allMoved, ratio, estimate };
};

// ---- the week in sum: the readings of one week (the same reset, within an
//      hour: the API's reset time jitters) give the last use, the share of
//      the time spent at each level, and whether the meter crossed the line.
//      A reading's level holds until the next reading, the last one's until
//      the reset (or now, for the week still running). ----
export const weeksOf = entries => {
  const weeks = [];
  for (const e of entries) {
    if (!e.reset || !e.t) continue;
    const r = Date.parse(e.reset);
    let w = weeks.find(x => Math.abs(x.reset - r) <= HOUR);
    if (!w) { w = { reset: r, entries: [] }; weeks.push(w); }
    w.entries.push(e);
  }
  for (const w of weeks) w.entries.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return weeks.sort((a, b) => a.reset - b.reset);
};
export const SUM_LEVELS = ['ahead', 'on pace', 'over', 'throttle', 'stop'];
export const summarise = (w, until) => {
  const es = w.entries, last = es[es.length - 1];
  const time = {};
  es.forEach((e, i) => {
    const end = i + 1 < es.length ? Date.parse(es[i + 1].t) : Math.min(w.reset, until);
    time[e.level] = (time[e.level] || 0) + Math.max(0, end - Date.parse(e.t));
  });
  const total = Object.values(time).reduce((a, b) => a + b, 0);
  const shares = SUM_LEVELS.filter(l => time[l] > 0).map(l => l + ' ' + Math.round(100 * time[l] / total) + ' %');
  const gaps = es.filter(e => e.line != null).map(e => ({ e, d: e.all - e.line }));
  const over = gaps.filter(g => g.d > 0);
  const peak = gaps.reduce((m, g) => (!m || g.d > m.d ? g : m), null);
  return { last, readings: es.length, shares, over, peak };
};

// ---- dollars per point of the weekly meter (rate.json) ----
// The meter weighs what the work cost, not how many tokens it moved: a cache
// read costs a tenth of an input token, and a long session re-reads its whole
// context each turn, so a raw token count tracks the meter poorly. The rate
// is learned in dollars. rate.json holds this week's baseline (from: the
// meter at the week's first reading, to: the highest since) and the dollars
// the sessions reported since then (usd); a new week keeps the week before's
// rate (carried) when its meter rose RISE_MIN points or more. Use by sessions
// without the hooks module (another device, the web) raises the meter with
// nothing counted, so the rate errs low and shows less left than there is.
// A file without v: RATE_V holds the raw tokens per point of 0.9.15 and
// before: an empty one.
export const RATE_V = 2, RISE_MIN = 5, RISE_EARLY = 2;
const rateFile = cur => (cur && typeof cur === 'object' && !Array.isArray(cur) && cur.v === RATE_V ? cur : null);
// the pace kept beside the rate ({ usd, at }: the dollars an hour of work costs)
export const paceOk = p => !!p && typeof p === 'object' && fin(p.usd) && p.usd > 0 && fin(p.at);
// an estimate of the rate from this week's transcripts ({ usd, points, at })
export const estimateOk = e => !!e && typeof e === 'object' && fin(e.usd) && e.usd > 0 && fin(e.points) && e.points > 0 && fin(e.at);

// rate.json after a reading: `cur` is the file as parsed (anything else than
// a v: RATE_V object counts as empty), `reset` this reading's reset (ms, and
// resetText as it was given), `used` the weekly meter, `spent` the dollars
// the session reports since its reading before. The first reading of a week
// is its baseline and drops its `spent`: that was spent before the baseline.
export const rateNext = (cur, { reset, resetText, used, spent }) => {
  cur = rateFile(cur) || {};
  const carried = fin(cur.carried) && cur.carried > 0 ? cur.carried : null;
  const at = Date.parse(cur.reset);
  const whole = fin(cur.from) && fin(cur.to) && fin(cur.usd);
  // a late reading of a week before the file's leaves it alone
  if (whole && at > reset + HOUR) return { ...cur, carried };
  if (whole && Math.abs(at - reset) <= HOUR) return { ...cur, to: Math.max(cur.to, used), usd: cur.usd + spent, carried };
  const rise = whole ? cur.to - cur.from : 0;
  return { v: RATE_V, reset: resetText, from: used, to: used, usd: 0, carried: rise >= RISE_MIN && cur.usd > 0 ? cur.usd / rise : carried,
    ...(paceOk(cur.pace) ? { pace: cur.pace } : {}) };
};

// The rate a rate.json gives, and where it is from. The one rule, for
// budget.mjs, doctor.mjs and saved.mjs alike:
//   week      this week's, from a rise of RISE_MIN points
//   carried   else the one carried from the week before
//   estimate  else what this week's local transcripts cost over the points
//             the meter showed (budget.mjs keeps it in the file's `estimate`,
//             priced afresh at most once an hour); { estimate: false } leaves
//             it out (budget.mjs under 2 points on the meter)
//   early     else this week's from RISE_EARLY points: only where no estimate
//             can be had (live it swung while the sessions' spending caught
//             up after a reload)
// { usd: dollars per point or null, from: one of the four or null, rise: the
// points the meter rose this week }. A file that is not a v: RATE_V object
// gives none.
export const rateOf = (state, { estimate = true } = {}) => {
  const s = rateFile(state);
  if (!s) return { usd: null, from: null, rise: 0 };
  const rise = fin(s.from) && fin(s.to) ? s.to - s.from : 0;
  const usd = fin(s.usd) ? s.usd : 0;
  const carried = fin(s.carried) && s.carried > 0 ? s.carried : null;
  if (rise >= RISE_MIN && usd > 0) return { usd: usd / rise, from: 'week', rise };
  if (carried) return { usd: carried, from: 'carried', rise };
  if (estimate && estimateOk(s.estimate)) return { usd: s.estimate.usd / s.estimate.points, from: 'estimate', rise };
  if (rise >= RISE_EARLY && usd > 0) return { usd: usd / rise, from: 'early', rise };
  return { usd: null, from: null, rise };
};

// ---- the tier numbers for the hooks module's split of a session's use ----
// Each model's tier number on the ladder in force now (with the fallback on
// top while the per-model meter is out or held). A usage record names a
// model, not an effort, and one model can hold two places (Opus 5.5 high as
// the fallback on top, Opus 5.5 medium at tier 2). So the session's own turns
// count at a model's first place (tierOf), and its subagents' at its first
// place below tier 1 (agentTierOf): subagents take the lower tiers. A model
// off the ladder now (the premium one while out or held, a configured tier
// the ladder dropped) keeps its configured place; the reader's and the
// verifier's models, off the ladder, come after its last tier.
// tierNames: each of those numbers as the user reads it, the model with its
// effort (/pacing-status names models, not tier numbers): the ladder's at
// that place, else the configured tier's, the reader's or the verifier's.
export const tierMaps = ({ ladder, tiers, fallbackTier, readerCfg, verifierCfg }) => {
  const tierOf = {}, agentTierOf = {};
  const idOf = t => (t && MODELS[t.model] ? MODELS[t.model].id : null);
  ladder.forEach((t, i) => {
    const id = idOf(t);
    if (!id) return;
    if (!tierOf[id]) tierOf[id] = i + 1;
    if (i > 0 && !agentTierOf[id]) agentTierOf[id] = i + 1;
  });
  tiers.forEach((t, i) => { const id = idOf(t); if (id && !tierOf[id]) tierOf[id] = i + 1; });
  if (fallbackTier && !tierOf[idOf(fallbackTier)]) tierOf[idOf(fallbackTier)] = 1;
  const last = Math.max(ladder.length, tiers.length);
  if (readerCfg && readerCfg !== 'ladder' && idOf(readerCfg) && !tierOf[idOf(readerCfg)]) tierOf[idOf(readerCfg)] = last + 1;
  if (verifierCfg && verifierCfg !== 'ladder' && idOf(verifierCfg) && !tierOf[idOf(verifierCfg)]) tierOf[idOf(verifierCfg)] = Math.max(last, ...Object.values(tierOf)) + 1;
  for (const id of Object.keys(tierOf)) if (!agentTierOf[id]) agentTierOf[id] = tierOf[id];
  const tierNames = {};
  const nameAt = (n, t) => { if (n && t && MODELS[t.model] && !tierNames[n]) tierNames[n] = MODELS[t.model].label + ' ' + t.effort; };
  ladder.forEach((t, i) => nameAt(i + 1, t));
  tiers.forEach((t, i) => nameAt(i + 1, t));
  if (readerCfg && readerCfg !== 'ladder') nameAt(tierOf[idOf(readerCfg)], readerCfg);
  if (verifierCfg && verifierCfg !== 'ladder') nameAt(tierOf[idOf(verifierCfg)], verifierCfg);
  return { tierOf, agentTierOf, tierNames };
};

// ---- a date argument (--now, --reset): the Date, or null for one that is
//      missing or no date. As lenient as Date itself: the usage tool's
//      resetsAt is passed on as written. ----
export const dateOf = v => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
// the one line a script refuses such an argument with (and exits 1)
export const badDateText = (flag, v) => flag + ' must be a date, such as 2026-11-22T10:00:00Z' + (v === undefined ? '' : ', not "' + v + '"');
