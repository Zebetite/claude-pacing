// Budget line for the Weekly · all models meter and the plan's per-model meter
// (the same line for both), the routing of work classes onto the configured
// ladder, the usage log with its projection, and the state the SessionStart
// hook reads.
//   node budget.mjs --all <pct> --reset <ISO> [--premium <pct>] [--five <pct>]
//                   [--five-reset <ISO>] [--session <model>] [--now <ISO>] [--dry]
// --premium is the per-model weekly meter of config.premium (Fable by default;
// --fable is the old name of the flag and still accepted).
//   node budget.mjs log [n]        the last n readings (20)
//   node budget.mjs week [n]       the last n weeks in sum (2): last use, time by level, the line
// The week is 7 days ending at --reset; the last 24 h weigh config.lastDayWeight
// (1.5 by default), the rest 1. The line is a step at local midnight: the whole
// of the current calendar day's allowance counts as available from its start.
// --dry: compute only (no log entry, no state.json, no settings.json change).
// --source hook: an automatic reading from the plugin's hooks module (after a
// turn). It has no per-model meter, so it carries that figure over from the
// last full reading of the same week (a lower bound: a meter only rises), and
// says from when; it never changes settings.json or the app's
// preset; it is not logged when the last reading is under 30 min old and
// nothing moved; and it prints one JSON line for the module, not the report.
// The config, the log and the state live in ~/.claude/pacing, outside the
// plugin folder, which an update replaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODELS, EFFORTS, relabel, checkConfig } from './models.mjs';
import { loadConfig, projectRoot, markSession } from './paths.mjs';
import { updateFile, updateJson } from './safe.mjs';

const dataDir = path.join(os.homedir(), '.claude', 'pacing');
fs.mkdirSync(dataDir, { recursive: true });
const cfgFile = path.join(dataDir, 'config.json');
const logFile = path.join(dataDir, 'log.jsonl');
const stateFile = path.join(dataDir, 'state.json');
const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');

// a missing file is a first run (the defaults); a damaged one or a value no
// command writes gives a note in the report, never a crash
const loaded = loadConfig(checkConfig);
const cfg = loaded.cfg || {};
let tiers = cfg.tiers || null;
if (!tiers) {
  tiers = [
    { model: 'fable', label: MODELS.fable.label, effort: 'high' },
    { model: 'opus', label: MODELS.opus.label, effort: 'medium' },
    { model: 'sonnet', label: MODELS.sonnet.label, effort: 'medium' },
  ];
}
tiers = tiers.map(relabel);
// when the premium model's meter is full, this tier takes its place at the
// top (Opus 5.5 high by default): the session keeps a strong model for
// judgment while routine work stays on the cheaper tier 2
const fallback = cfg.fallback === undefined ? { model: 'opus', effort: 'high' } : cfg.fallback;
const fallbackTier = fallback && MODELS[fallback.model] ? { model: fallback.model, label: MODELS[fallback.model].label, effort: fallback.effort } : null;
// the reader agent (pacing:reader) reads at a model of its own, Haiku 5.5
// medium by default: finding and summing up asks less than the work the
// lowest tier is chosen for. 'ladder' makes it follow the lowest tier.
const readerCfg = cfg.reader === undefined ? { model: 'haiku', effort: 'medium' } : cfg.reader;
// the verifier (pacing:verifier) runs plain test runs at a model of its own,
// Haiku 5.5 medium by default: running a suite and quoting what failed asks
// little judgment. A check with acceptance points to judge stays on the
// lowest tier. 'ladder' makes every run follow the lowest tier.
const verifierCfg = cfg.verifier === undefined ? { model: 'haiku', effort: 'medium' } : cfg.verifier;
const lastDayWeight = cfg.lastDayWeight || 1.5;
const setNextModel = cfg.setNextModel !== false;
// the per-model weekly meter: which ladder model it belongs to (fable unless
// config.premium says otherwise; null when the plan has no such meter)
const premium = cfg.premium === undefined ? 'fable' : cfg.premium;
const premLabel = premium && MODELS[premium] ? MODELS[premium].label : null;
const labelOf = m => (m && MODELS[m] ? MODELS[m].label : 'Fable');
const name = t => t.label + ' ' + t.effort;
// "a Fable 5.2 high", "an Opus 5.5 high"
const aName = t => (/^[AEIOU]/.test(t.label) ? 'an ' : 'a ') + name(t);
const r1 = n => Math.round(n * 10) / 10;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// "40 min", "15 h": an age
const mins = ms => (ms >= 2 * HOUR ? Math.round(ms / HOUR) + ' h' : Math.round(ms / 60000) + ' min');

// ---- arguments ----
const argv = process.argv.slice(2);
// a line that does not parse (a cut-off write, a stray edit) or is no reading
// (no time, no figure) is skipped, not fatal
const isReading = e => !!e && typeof e === 'object' && !Array.isArray(e) && !Number.isNaN(Date.parse(e.t)) && typeof e.all === 'number';
const readLog = () => fs.existsSync(logFile)
  ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { const e = JSON.parse(l); return isReading(e) ? [e] : []; } catch { return []; } })
  : [];

// ---- the week in sum: the readings of one week (the same reset, within an
//      hour: the API's reset time jitters) give the last use, the share of
//      the time spent at each level, and whether the meter crossed the line.
//      A reading's level holds until the next reading, the last one's until
//      the reset (or now, for the week still running). ----
const weeksOf = entries => {
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
const SUM_LEVELS = ['ahead', 'on pace', 'over', 'throttle', 'stop'];
const summarise = (w, until) => {
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
const stamp = t => new Date(t).toLocaleString('sv-SE').slice(0, 16);
const crossedText = s => (!s.peak ? 'no line logged'
  : s.over.length ? 'line crossed on ' + s.over.length + ' of ' + s.readings + ' readings (peak ' + r1(s.peak.d) + ' points over, ' + stamp(s.peak.e.t) + ')'
    : r1(-s.peak.d) === 0 ? 'line never crossed (touched it)' : 'line never crossed (closest ' + r1(-s.peak.d) + ' points under)');

if (argv[0] === 'week') {
  const n = Number(argv[1]) || 2;
  const weeks = weeksOf(readLog()).slice(-n).reverse();
  if (!weeks.length) { console.log('no readings yet'); process.exit(0); }
  const nowMs = Date.now();
  for (const w of weeks) {
    const s = summarise(w, nowMs);
    console.log('week to ' + stamp(w.reset) + (w.reset > nowMs ? ' (running)' : '') + ': ' + s.readings + ' readings, last ' + s.last.all + ' % at ' + stamp(s.last.t));
    if (s.shares.length) console.log('  time by level: ' + s.shares.join(', '));
    console.log('  ' + crossedText(s));
  }
  process.exit(0);
}

if (argv[0] === 'log') {
  const rows = readLog().slice(-(Number(argv[1]) || 20));
  if (!rows.length) { console.log('no readings yet'); process.exit(0); }
  for (const e of rows) {
    // a per-model figure an automatic reading carried over is marked with how
    // old it was then: "Fable 5.2 71 % (15 h old)", never shown as read
    const carried = e.premiumAt ? Date.parse(e.t) - Date.parse(e.premiumAt) : 0;
    // local time, like the report
    console.log(new Date(e.t).toLocaleString('sv-SE').slice(0, 16) + '  all ' + String(e.all).padStart(5) + ' %  line ' + String(e.line).padStart(5) + ' %  '
      + ((e.premium ?? e.fable) != null ? labelOf(e.premiumModel) + ' ' + String(e.premium ?? e.fable).padStart(3) + ' %' + (carried >= 30 * 60000 ? ' (' + mins(carried) + ' old)' : '') + '  ' : '') + (e.five != null ? '5h ' + String(e.five).padStart(3) + ' %  ' : '') + e.level + (e.levelBy === 'premium' ? ' (' + labelOf(e.premiumModel) + ')' : '') + (e.premiumOut || e.fableOut ? ', ' + labelOf(e.premiumModel) + ' out' : e.premiumHeld ? ', ' + labelOf(e.premiumModel) + ' held' : '') + (e.source === 'hook' ? '  (auto)' : ''));
  }
  process.exit(0);
}

// ---- `last [--now <ISO>]`: the report from the last reading, with no new
//      measurement, when that reading is fresh enough; else one line that
//      starts "measure:" and says why. Fresh enough: at most 30 min old (the
//      hooks module logs a reading every 30 min of work, and sooner on every
//      whole point the meter moves, so within that the all-models figure is
//      at most a point behind), in the same week, and not at "stop" (where
//      extra usage, never in a reading, decides what to say). The per-model
//      figure has a test of its own further down, once the line is known.
//      The line itself is drawn for now, not for the reading's time. ----
const FRESH = 30 * 60000;
let fromState = null;
if (argv[0] === 'last') {
  const i = argv.indexOf('--now');
  const at = i > 0 && argv[i + 1] ? new Date(argv[i + 1]) : new Date();
  let s = null;
  try { s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { s = null; }
  const age = s ? at - Date.parse(s.t) : NaN;
  const why = !s || !s.reset || s.all == null || Number.isNaN(age) ? 'no reading yet'
    : age < 0 ? 'the last reading is dated after now'
      : age > FRESH ? 'the last reading is ' + mins(age) + ' old'
      : Date.parse(s.reset) <= at.getTime() ? 'the week has reset since the last reading'
        : s.level === 'stop' ? 'the week is nearly used, and extra usage is only in a full reading'
          : null;
  if (why) { console.log('measure: ' + why); process.exit(0); }
  fromState = { ...s, age };
  const brief = argv.includes('--brief');
  argv.splice(0, argv.length, '--all', String(s.all), '--reset', s.reset, '--now', at.toISOString(), '--dry', ...(brief ? ['--brief'] : []),
    ...(s.five != null && s.fiveReset && Date.parse(s.fiveReset) > at.getTime() ? ['--five', String(s.five), '--five-reset', s.fiveReset] : []));
}

const KNOWN = ['all', 'reset', 'premium', 'fable', 'five', 'five-reset', 'session', 'context', 'context-tokens', 'extra-spent', 'extra-limit', 'extra-currency', 'now', 'dry', 'source', 'categories', 'brief'];
const opt = {};
const unknown = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (!KNOWN.includes(k)) unknown.push(a);
    else if (k === 'dry' || k === 'brief') opt[k] = true;
    else opt[k] = argv[++i];
  }
}
const usage = () => {
  console.log('usage: node budget.mjs --all <pct> --reset <ISO> [--premium <pct>] [--five <pct>] [--five-reset <ISO>] [--session <model>]');
  console.log('                      [--context <pct>] [--context-tokens <n>] [--categories "<name>=<tokens>,..."] [--brief]');
  console.log('                      [--extra-spent <amount> --extra-limit <amount> [--extra-currency <code>]] [--now <ISO>] [--dry] [--source skill|hook]');
  console.log('       node budget.mjs last [--brief] [--now <ISO>] | log [n] | week [n]');
  console.log('       a meter the plan does not have: pass - for its percent');
  process.exit(1);
};
// a mistyped flag must not pass as "no such meter"
if (unknown.length) { console.log('unknown option ' + unknown.join(' ')); usage(); }
if (opt.all === undefined || !opt.reset) usage();
const source = opt.source || 'skill';
if (!['skill', 'hook'].includes(source)) { console.log('--source is skill or hook'); usage(); }
const auto = source === 'hook';
// an empty value is a mistake, not 0 %
const num = v => (v === undefined || v === '-' ? null : String(v).trim() === '' ? NaN : Number(v));
const used = String(opt.all).trim() === '' ? NaN : Number(opt.all);
// the per-model meter is read only when the config names one. An automatic
// reading never has it (the engine hands a plugin only the all-models and
// 5-hour windows, and a gateway's spend limit; no per-model meter and no
// extra usage), so it takes the last figure of the same week, with the
// time that figure was read; a week with none has no figure. A report from
// the last reading (`last`) takes it the same way.
let premFrom = null;
const premArg = opt.premium !== undefined ? opt.premium : opt.fable;
if ((auto || fromState) && premium && premArg === undefined) {
  const r = Date.parse(opt.reset);
  const known = readLog().filter(e => e.premiumModel === premium && e.premium != null && Math.abs(Date.parse(e.reset) - r) <= HOUR);
  const last = known[known.length - 1];
  if (last) premFrom = { premium: last.premium, at: last.premiumAt || last.t };
}
const prem = premium ? (premFrom ? premFrom.premium : num(premArg)) : null;
const five = num(opt.five);
const context = num(opt.context);
const contextTokens = num(opt['context-tokens']);
// the context window by category, as the usage tool lists it: everything but
// the messages is sent again on every turn whatever the work (tool
// definitions, the system prompt, skills), so it is the session's fixed
// overhead. "Messages=303307,System tools=25759,MCP tools=13768,..."
let categories = null;
if (opt.categories) {
  categories = opt.categories.split(',').map(p => p.trim()).filter(Boolean).map(p => {
    const i = p.lastIndexOf('=');
    return { name: p.slice(0, i).trim(), tokens: Number(p.slice(i + 1)) };
  });
  if (categories.some(c => !c.name || !Number.isFinite(c.tokens) || c.tokens < 0)) { console.log('bad input: --categories is "<name>=<tokens>,..."'); process.exit(1); }
}
const fixedParts = categories ? categories.filter(c => !/^messages$/i.test(c.name)) : null;
const fixed = fixedParts ? fixedParts.reduce((a, c) => a + c.tokens, 0) : null;
const sessionSize = categories ? (contextTokens !== null ? contextTokens : categories.reduce((a, c) => a + c.tokens, 0)) : null;
const mcp = fixedParts ? fixedParts.filter(c => /mcp/i.test(c.name)).reduce((a, c) => a + c.tokens, 0) : 0;
// the MCP tools are worth a word when they are a quarter of the fixed part
// and 10 000 tokens or more: below that, switching connectors off saves
// little next to the rest
const mcpLarge = fixed !== null && mcp >= 10000 && mcp >= fixed / 4;
const kTok = n => Math.round(n / 1000) + 'k';
// extra usage: past 100 % the work goes on and is charged, when the plan allows it
const extraSpent = num(opt['extra-spent']);
const extraLimit = num(opt['extra-limit']);
const extraCurrency = opt['extra-currency'] || '';
const extraOn = extraSpent !== null && extraLimit !== null && extraLimit > 0;
const reset = new Date(opt.reset);
const fiveReset = opt['five-reset'] ? new Date(opt['five-reset']) : null;
const now = opt.now ? new Date(opt.now) : new Date();
const bad = [used, prem, five, context, contextTokens].some(v => v !== null && (Number.isNaN(v) || v < 0))
  || Number.isNaN(reset.getTime()) || Number.isNaN(now.getTime()) || (fiveReset && Number.isNaN(fiveReset.getTime()));
if (bad) { console.log('bad input: percents must be numbers from 0, dates ISO 8601'); process.exit(1); }
// an automatic reading answers the hooks module, not a person: the report's
// lines are kept here, and one JSON line goes out at the end
const said = [];
const print = console.log;
// --brief (a reading after a task, or for the routing): the same lines are
// kept, and only the ones that carry a decision go out at the end
if (auto || opt.brief) console.log = (...a) => { said.push(a.join(' ')); };

// ---- the budget line (a step per local day) ----
// share(t): the part of the week's allowance that belongs to the time from the
// week's start to t; the last 24 h before the reset weigh lastDayWeight, the
// rest 1. The line is share() at the next local midnight (or the reset, if
// that comes first), so the whole of the current calendar day counts as
// available from its start, and the step falls at midnight, not at the hour
// of the reset.
const left = Math.max(0, (reset - now) / DAY);
const elapsed = Math.min(7, Math.max(0, 7 - left));
const weekStart = reset.getTime() - 7 * DAY;
const units = 6 + lastDayWeight;
const daily = 100 / units;
const share = t => {
  const d = Math.min(7, Math.max(0, (t - weekStart) / DAY));
  return 100 * (Math.min(d, 6) + Math.max(0, d - 6) * lastDayWeight) / units;
};
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
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
const delta = used - budget;

// "<premium> out" is a flag beside the level, not a level: it takes every tier
// of that model off the ladder, while the level still comes from the all-models
// meter (at 96 % the week is still nearly used, premium meter or not)
const premOut = prem !== null && prem >= 100;
const LEVELS = ['ahead', 'on pace', 'over', 'throttle'];
let level;
if (used >= 95) level = 'stop';
else if (delta > 5) level = 'throttle';
else if (delta > 0) level = 'over';
else if (delta >= -5) level = 'on pace';
else level = 'ahead';

// ---- trend from the log: the oldest reading of this week within the last two
//      days, at least 4 h old, gives the burn rate. The same week means a reset
//      within an hour of this one (the API's reset time jitters by milliseconds).
//      The projection only moves the level once the sample spans 20 h or more,
//      so that it covers a night: a busy morning alone is not a trend. ----
const TREND_MIN_H = 20;
const sameWeek = e => Math.abs(new Date(e.reset) - reset) <= HOUR;
const weekLog = readLog().filter(sameWeek);
// one meter's trend: its value at `at` (ms) against the oldest of its readings
// ({ t, v }) within the two days before, at least 4 h older
const trendOf = (value, at, readings) => {
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
const floorOf = tr => (!tr || tr.short ? null : tr.projected > 115 ? 'throttle' : tr.projected > 100 ? 'over' : null);
const below = (a, b) => LEVELS.includes(a) && LEVELS.indexOf(a) < LEVELS.indexOf(b);
const trend = trendOf(used, now.getTime(), weekLog.map(e => ({ t: Date.parse(e.t), v: e.all })));
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
const premAt = premFrom ? Date.parse(premFrom.at) : now.getTime();
const premDelta = prem === null ? null : prem - budget;
let premLevel = null, premTrend = null;
if (prem !== null && !premOut) {
  premLevel = premDelta > 5 ? 'throttle' : premDelta > 0 ? 'over' : premDelta >= -5 ? 'on pace' : 'ahead';
  premTrend = trendOf(prem, premAt, weekLog.filter(e => e.premiumModel === premium && e.premium != null && !e.premiumAt)
    .map(e => ({ t: Date.parse(e.t), v: e.premium })));
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
if (premLevel && premTop && level !== 'stop') {
  // held only when another model can take tier 1; with none, its throttle
  // routes like any other
  const others = tiers.some(t => t.model !== premium) || (fallbackTier && fallbackTier.model !== premium);
  if (premLevel === 'throttle' && others) premHeld = true;
  else if (below(level, premLevel)) { level = premLevel; levelBy = 'premium'; }
}
// the model is off tier 1 either way: out (its meter full) or held (over its line)
const premAway = premOut || premHeld;

// ---- routing ----
// Which tier takes each class of work at each level. 1 = the top tier (the
// session model), L = the lowest tier. Clamped to the ladder.
// Trivial work stays in the session until throttle: a subagent costs tens of
// thousands of tokens before it reads a file, so a grep delegated to a cheap
// model costs more on the meter than the same grep done by the session.
// Bulky output is the exception at every level (the "bulky" line below):
// what a subagent reads stays out of the session's context, which is re-sent
// on every later turn.
const ROUTES = {
  'ahead': { judgment: 1, medium: 1, routine: 1, trivial: 1 },
  'on pace': { judgment: 1, medium: 1, routine: 2, trivial: 1 },
  'over': { judgment: 1, medium: 2, routine: 2, trivial: 1 },
  'throttle': { judgment: 2, medium: 2, routine: 2, trivial: 2 },
  'stop': { judgment: 'L', medium: 'L', routine: 'L', trivial: 'L' },
};
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
// --session takes a short name (opus) or a full model id (claude-opus-5-5)
const sessionModel = opt.session ? (Object.keys(MODELS).find(m => opt.session.toLowerCase().includes(m)) || opt.session) : null;
const session = sessionModel ? tiers.find(t => t.model === sessionModel) : null;

// ---- report ----
const when = d => d.toLocaleString('sv-SE').slice(0, 16);
const clock = d => when(d).slice(11);
// the meters as bars, first: 20 cells, the budget line marked on the weekly
// bar with │; the skill shows this block verbatim when the user asks for usage.
// Every line of the block is kept within WIDTH columns, so a narrow chat
// column does not wrap the bars.
const WIDTH = 68;
const BAR_W = 20;
// words wrapped to `width` columns
const wrap = (text, width) => {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; }
    else line += (line ? ' ' : '') + word;
  }
  lines.push(line);
  return lines;
};
const bar = (pct, marker) => {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 100 * BAR_W);
  const cells = Array.from({ length: BAR_W }, (_, i) => (i < filled ? '█' : '░'));
  if (marker !== undefined && marker < 100) cells[Math.min(BAR_W - 1, Math.max(0, Math.round(marker / 100 * BAR_W) - 1))] = '│';
  return cells.join('');
};
// What a long session costs follows its size in tokens, not its share of the
// window: the whole history is sent again on every turn, and stored again
// after a pause. From CTX_ADVISE a task unrelated to the session's work is
// better started fresh; from CTX_URGE the session says so before the next
// task. A reading with the percentage alone falls back to 30 % and 50 %, the
// same sizes in a window of a million tokens.
const CTX_ADVISE = 300000, CTX_URGE = 500000;
const ctxLevel = contextTokens !== null ? (contextTokens >= CTX_URGE ? 2 : contextTokens >= CTX_ADVISE ? 1 : 0)
  : context !== null ? (context >= 50 ? 2 : context >= 30 ? 1 : 0) : 0;
const barRow = (label, pct, note, marker) => pct === null ? null
  : label.padEnd(11) + bar(pct, marker) + String(Math.round(pct) + ' %').padStart(6) + (note ? (note.startsWith('/') ? ' ' : '  ') + note : '');
// "2d 16h" until the weekly reset
const resetsIn = ms => { const h = Math.max(0, Math.round(ms / HOUR)); const d = Math.floor(h / 24); return (d ? d + 'd ' : '') + (h % 24) + 'h'; };
if (fromState) {
  // While tier 1 is the per-model meter's model, that meter routes the work,
  // and it has drained 11 points in 46 min: a carried figure serves when it
  // was read within 30 min, or within an hour while 15 points or more under
  // the line. Shown only (another model on tier 1, or the meter out), any
  // carried figure serves.
  const premAge = premFrom ? now - Date.parse(premFrom.at) : Infinity;
  const premWhy = !premium || !premTop || premOut ? null
    : prem === null ? premLabel + '\'s meter is not in the last reading'
      : premAge <= FRESH || (premAge <= HOUR && premDelta <= -15) ? null
        : premLabel + '\'s meter was read ' + mins(premAge) + ' ago';
  if (premWhy) { print('measure: ' + premWhy); process.exit(0); }
  // the block says what it rests on, within WIDTH like every line of it
  console.log('last reading ' + when(new Date(fromState.t)).slice(5) + ', ' + mins(fromState.age) + ' ago'
    + (fromState.source === 'hook' ? ' (automatic)' : '') + ', not measured now');
  console.log('not in it: context, extra usage · /pacing usage now measures');
}
[
  barRow('5-hour', five, fiveReset ? 'resets ' + clock(fiveReset) : ''),
  barRow('All models', used, '/ ' + Math.round(budget) + ' % pace · resets in ' + resetsIn(reset - now), budget),
  // the per-model bar carries the same line; a carried figure says when it was read
  prem !== null ? barRow(premLabel, prem, premOut ? 'out until the reset'
    : '/ ' + Math.round(budget) + ' % pace' + (premFrom ? ' · read ' + when(new Date(premFrom.at)).slice(5) : ''), premOut ? undefined : budget) : null,
  // the fixed overhead as a share of the session; its tokens, and the MCP
  // tools' when they are a large part
  fixed !== null && sessionSize > 0 ? barRow('Fixed', 100 * fixed / sessionSize, kTok(fixed) + ' every turn' + (mcpLarge ? ', MCP ' + kTok(mcp) : '')) : null,
  barRow('Context', context, ctxLevel === 2 ? 'next task whole to an agent' : ctxLevel === 1 ? 'compact (/compact) at a break'
    : contextTokens !== null ? Math.round(contextTokens / 1000) + 'k tokens' : ''),
].filter(Boolean).forEach(l => console.log(l));
console.log('');
// the sheet under the bars, as GUIDE.md's ladder table: each tier and the
// work it takes right now, at this level
const sheet = [['tier', 'model', 'takes now · level ' + level]];
const CLASSES = ['judgment', 'medium', 'routine', 'trivial'];
ladder.forEach((t, i) => {
  const work = CLASSES.filter(cls => pick(route[cls]) === t);
  const bulky = ladder.length > 1 && i === ladder.length - 1
    ? 'bulky output (' + bulkyWhat + ')' : '';
  const where = i === 0 ? 'the session: ' : 'subagents: ';
  const takes = level === 'stop' ? (i === 0 ? 'the session: wrap up, the week is nearly used' : 'nothing: wrap up')
    : work.length ? where + work.join(', ') + ' work' + (bulky ? '; ' + bulky : '')
      : bulky ? where + bulky
        : i === 0 && level === 'throttle' ? where + 'only what ' + name(pick(2)) + ' would get wrong'
          : 'nothing at this level';
  sheet.push([String(i + 1), name(t), takes]);
});
if (readerTier && ladder.length && level !== 'stop') sheet.push(['r', name(readerTier), 'the reader agent: bulky reading (logs, searches, unfamiliar code)']);
if (verifierTier && ladder.length && level !== 'stop') sheet.push(['v', name(verifierTier), 'the verifier: plain runs of tests, builds, checks']);
if (premOut) tiers.filter(t => t.model === premium).forEach(t => sheet.push(['-', name(t), 'out until the reset: its own meter is at 100 %']));
if (premHeld) tiers.filter(t => t.model === premium).forEach(t => sheet.push(['-', name(t), 'kept for judgment: one contained hard task at a time, as a subagent']));
// the last column wraps within WIDTH, its continuation lines under its start
const widths = sheet[0].map((_, c) => Math.max(...sheet.map(r => r[c].length)));
const lastAt = widths.slice(0, -1).reduce((a, w) => a + w + 2, 0);
widths[widths.length - 1] = Math.min(widths[widths.length - 1], WIDTH - lastAt);
const sheetRow = r => {
  const head = r.slice(0, -1).map((v, c) => v.padEnd(widths[c])).join('  ') + '  ';
  return wrap(r[r.length - 1], WIDTH - lastAt).map((l, i) => (i === 0 ? head : ' '.repeat(lastAt)) + l);
};
sheetRow(sheet[0]).forEach(l => console.log(l));
console.log(widths.map(w => '─'.repeat(w)).join('  '));
sheet.slice(1).forEach(r => sheetRow(r).forEach(l => console.log(l)));
// why this routing: the meter that set the level against today's allowed usage
const cmp = d => { const p = Math.abs(Math.round(d)); return d < 0 ? p + ' points under' : d > 0 ? p + ' points over' : 'exactly on'; };
const compare = cmp(delta);
const premRead = premFrom ? ' (read ' + when(new Date(premFrom.at)) + ')' : '';
const premWhy = premLevel ? premLabel + '\'s own meter at ' + Math.round(prem) + ' %' + premRead + ' is ' + cmp(premDelta) + ' the same line'
  + (premTrend && premTrend.bumped ? ', and its trend projects ' + Math.round(premTrend.projected) + ' % at the reset' : '') : '';
const t1 = ladder[0] ? 'tier 1 ' + name(ladder[0]) : 'tier 1';
const t2s = ladder[1] ? 'tier 2 ' + name(ladder[1]) + ' subagents' : 'tier 2 subagents';
const because = {
  'ahead': 'more than 5 points under the line is "ahead", so every class of work stays on ' + t1 + '.',
  'on pace': 'within 5 points under the line is "on pace", so routine work goes to ' + t2s + '; judgment, medium and trivial work stay on ' + t1 + '.',
  'over': 'up to 5 points over the line is "over", so medium and routine work go to ' + t2s + '; judgment and trivial work stay on ' + t1 + '.',
  'throttle': 'more than 5 points over the line is "throttle", so every class of work goes to ' + t2s + ' and the session does only what they would get wrong.',
  'stop': 'at 95 % or more the week is nearly used: "stop", wrap up.',
};
const allWhy = 'All models at ' + Math.round(used) + ' % is ' + compare + ' today\'s allowed ' + Math.round(budget) + ' %'
  + (trend && trend.bumped ? ', and the trend projects ' + Math.round(trend.projected) + ' % at the reset, which raises the level' : '');
let why = (levelBy === 'premium'
  ? premWhy + ': "' + level + '", worse than all models alone ("' + levelBefore + '", ' + compare + '), and ' + premLabel + ' runs tier 1, so that meter sets the level: '
  : allWhy + ': ')
  + because[level]
  + (ladder.length > 1 && level !== 'stop' ? ' Bulky output goes to the lowest tier at every level' + (readerTier ? ', bulky reading to the reader on ' + name(readerTier) : '') + (verifierTier ? ', plain test runs to the verifier on ' + name(verifierTier) : '') + ', so it stays out of the session\'s context.' : '')
  // with every tier on the premium model and no fallback, nothing takes tier 1
  + (premOut ? ' ' + premLabel + '\'s own meter is at 100 %, so it left the ladder until the reset'
    + (ladder[0] ? ' and ' + name(ladder[0]) + ' takes tier 1.' : ' and no model is left.') : '')
  + (premHeld ? ' ' + premWhy + ': "throttle" for that meter, so the session moves to ' + name(ladder[0]) + ' at tier 1 and keeps '
    + premLabel + ' for judgment work, one contained hard task at a time.' : '');
console.log('');
wrap(why, WIDTH).forEach(l => console.log(l));
console.log('');
console.log('day ' + dayNo + ' of ' + dayCount + ' (calendar days), ' + r1(elapsed) + ' days elapsed, ' + r1(left) + ' days to reset');
console.log('allowance today ' + r1(todayAllowance) + ' %, budget line now ' + r1(budget) + ' % (counted to ' + (endOfToday === reset.getTime() ? 'the reset' : 'midnight') + ')');
console.log('All models used ' + r1(used) + ' %, delta ' + (delta >= 0 ? '+' : '') + r1(delta)
  + (prem !== null ? ', ' + premLabel + ' ' + r1(prem) + ' %' : '') + ' -> ' + level + (trend && trend.bumped ? ' (raised by the trend)' : '')
  + (levelBy === 'premium' ? ' (set by the ' + premLabel + ' meter)' : '') + (premOut ? ', ' + premLabel + ' out' : premHeld ? ', ' + premLabel + ' held' : ''));
if (premLevel) {
  console.log(premLabel + ' used ' + r1(prem) + ' %' + (premFrom ? ' (read ' + when(new Date(premFrom.at)) + ', carried over)' : '')
    + ', delta ' + (premDelta >= 0 ? '+' : '') + r1(premDelta) + ' -> ' + premLevel + (premTrend && premTrend.bumped ? ' (raised by its trend)' : '')
    + (levelBy === 'premium' ? ': sets the level' : premHeld ? ': the session moves off it' : !premTop ? ': not tier 1, shown only' : ''));
}
// the first reading of a new week sums up the week before it, once
{
  const weeks = weeksOf(readLog());
  const thisWeek = weeks.some(w => Math.abs(w.reset - reset) <= HOUR);
  const before = weeks.filter(w => w.reset < reset.getTime() - HOUR).pop();
  if (!thisWeek && before) {
    const s = summarise(before, now.getTime());
    console.log('last week: ended at ' + s.last.all + ' %' + (s.shares.length ? ', time by level ' + s.shares.join(', ') : '') + '; ' + crossedText(s));
  }
}
if (trend) {
  console.log('trend: ' + (trend.rate >= 0 ? '+' : '') + r1(trend.rate) + ' %/day over the last ' + r1(trend.hours) + ' h, projected ' + r1(trend.projected) + ' % at reset'
    + (trend.reach ? ', reaches 100 % ' + when(trend.reach) : '')
    + (trend.short ? ' (sample under ' + TREND_MIN_H + ' h, not applied to the level)' : ''));
}
if (premTrend) {
  console.log(premLabel + ' trend: ' + (premTrend.rate >= 0 ? '+' : '') + r1(premTrend.rate) + ' %/day over ' + r1(premTrend.hours) + ' h, projected ' + r1(premTrend.projected) + ' % at reset'
    + (premTrend.reach ? ', reaches 100 % ' + when(premTrend.reach) : '')
    + (premTrend.short ? ' (sample under ' + TREND_MIN_H + ' h, not applied to the level)' : ''));
}
if (five !== null) {
  const resetsIn = fiveReset ? Math.max(0, Math.round((fiveReset - now) / 60000)) : null;
  // the pace inside the window: the oldest reading of this window, at least
  // 20 min old, whose value is not above the current one (a drop means the
  // window reset in between)
  let fiveTrend = null;
  if (fiveReset) {
    const windowStart = fiveReset.getTime() - 5 * HOUR;
    const prevFive = readLog().filter(e => e.five != null && new Date(e.t) >= windowStart && now - new Date(e.t) >= 20 * 60000 && e.five <= five);
    if (prevFive.length) {
      const e = prevFive[0];
      const h = (now - new Date(e.t)) / HOUR;
      const rate = (five - e.five) / h;
      const hoursLeft = Math.max(0, (fiveReset - now) / HOUR);
      const projected = five + rate * hoursLeft;
      const reach = rate > 0 && projected > 100 ? new Date(now.getTime() + ((100 - five) / rate) * HOUR) : null;
      fiveTrend = { rate, projected, reach };
    }
  }
  console.log('5-hour window ' + r1(five) + ' %' + (resetsIn !== null ? ', resets in ' + resetsIn + ' min (' + when(fiveReset) + ')' : '')
    + (fiveTrend ? ', pace ' + (fiveTrend.rate >= 0 ? '+' : '') + r1(fiveTrend.rate) + ' %/h'
      + (fiveTrend.reach ? ', full at ' + when(fiveTrend.reach).slice(11) + ' at this pace, before the reset -> delegate bulky work or pause heavy runs' : ', about ' + r1(fiveTrend.projected) + ' % at the reset at this pace') : '')
    + (five >= 85 ? ' -> HOLD heavy work until it resets; delegation does not help this meter' : ''));
}
// what the headroom buys: the spend per hour that lands at 100 % exactly at
// the reset, and how much of today's line is still free
const hoursToReset = Math.max(0, (reset - now) / HOUR);
if (hoursToReset > 0 && used < 100) {
  const todayLeft = budget - used;
  console.log('spend rate: up to ' + r1((100 - used) / hoursToReset) + ' %/h until the reset lands at 100 %'
    + (todayLeft > 0 ? '; today\'s line leaves ' + r1(todayLeft) + ' % headroom' : '; today\'s line is ' + r1(-todayLeft) + ' % behind'));
}
if (extraSpent !== null && extraLimit !== null) {
  console.log(extraOn
    ? 'extra usage: on, ' + extraSpent.toFixed(2) + ' of ' + extraLimit.toFixed(2) + ' ' + extraCurrency + ' spent this month; past 100 % the work goes on and is charged'
      + (extraSpent / extraLimit >= 0.8 ? ' -> the monthly cap is nearly reached' : '')
    : 'extra usage: monthly limit 0, nothing can be charged; 100 % is a hard stop');
}
if (fixed !== null) {
  console.log('fixed overhead ' + kTok(fixed) + ' tokens on every turn' + (sessionSize > 0 ? ' (' + r1(100 * fixed / sessionSize) + ' % of the session)' : '') + ': '
    + fixedParts.filter(c => c.tokens >= 500).sort((a, b) => b.tokens - a.tokens).map(c => c.name + ' ' + kTok(c.tokens)).join(', ')
    // which connectors are not needed is the user's to say: the plugin cannot know
    + (mcpLarge ? ' -> MCP tools are ' + kTok(mcp) + ' of it: switching off connectors the user does not need saves up to that many tokens on every turn' : ''));
}
// the session's own context is re-sent on every turn: past a point, the
// transcript costs more than any model choice saves
if (context !== null || contextTokens !== null) {
  const size = contextTokens !== null
    ? Math.round(contextTokens / 1000) + 'k tokens' + (context !== null ? ' (' + r1(context) + ' % of the window)' : '')
    : r1(context) + ' % of the window';
  // From CTX_URGE every step the session takes itself costs a turn of its
  // full size; a whole task handed to one fresh agent costs it two (the
  // start and the report). Such an agent gets the tier its class routes
  // to, never below tier 2 (a whole task is more than a routine step), and
  // judgment work the fallback tier: a strong model that is not the
  // premium one, whose meter the session itself draws on. A fallback on
  // the model that is out or held is no fallback: tier 1 of what is left.
  const tierNo = r => (r === 'L' ? ladder.length : Math.min(r, ladder.length));
  const strong = fallbackTier && !(premAway && fallbackTier.model === premium) ? fallbackTier : ladder[0];
  const wholeOf = cls => (cls === 'judgment' ? strong : ladder[Math.max(2, tierNo(route[cls])) - 1] || ladder[ladder.length - 1]);
  const whole = ladder.length && level !== 'stop'
    ? ['judgment', 'medium', 'routine'].map(cls => cls + ' on ' + name(wholeOf(cls))).join(', ') : null;
  // All work stays in this session: the user should never have to open
  // another one. Compacting keeps the work and shrinks what every later
  // turn re-sends, for the price of one summary; a new session would have to
  // learn the work again, and is the last resort only.
  console.log('context ' + size
    + (ctxLevel === 2 ? ' -> this session is the expensive part now: compact first if not yet done (/compact). '
      + (whole ? 'A next task with a clear outcome goes WHOLE to one fresh agent, without asking (' + whole + '), with a handover-style brief; read only its report and give the user the outcome here. ' : '')
      + 'Never offer a new session: name one only when the session cannot be compacted or the user asks, with a handover (/pacing handover)'
      : ctxLevel === 1 ? ' -> suggest compacting the conversation at the next natural break (/compact), then go on here, whatever the next task is: every later turn re-sends less, and an unrelated task is a reason to compact first, not to leave'
        : ''));
}
if (loaded.missing) console.log('first run: no settings yet, the defaults are used; run config.mjs init once');
if (loaded.problems.length) console.log('config.json: ' + loaded.problems.join('; '));
if (!ladder.length) {
  console.log('do: no model left on the ladder (every tier is ' + premLabel + ' and its meter is full); wrap up');
} else {
  for (const cls of ['judgment', 'medium', 'routine', 'trivial']) {
    const t = pick(route[cls]);
    const no = ladder.indexOf(t) + 1;
    const only = level === 'throttle' && cls === 'judgment' ? ', the session itself only for what ' + name(t) + ' would get wrong' : '';
    console.log('  ' + cls.padEnd(9) + '-> tier ' + no + ' ' + name(t) + (no === 1 ? ' (the session)' : ' (subagent)') + only);
  }
  if (ladder.length > 1) {
    const tL = pick('L');
    console.log('  bulky    -> tier ' + ladder.length + ' ' + name(tL) + ' (subagent) at any level: ' + bulkyWhat + '; the output stays out of the session\'s context');
  }
  if (level !== 'stop') {
    console.log('  reader   -> ' + (readerTier ? name(readerTier) + ' (pacing:reader) at any level: logs, searches, unfamiliar code'
      : 'tier ' + ladder.length + ' ' + name(pick('L')) + ' (pacing:reader), the lowest tier'));
    // a plain run asks one thing, did it pass, and quotes what failed; a
    // check judges a result against points the task names
    console.log('  verifier -> ' + (verifierTier ? name(verifierTier) + ' (pacing:verifier) for a plain run: run it, quote what failed; a check with points to judge: tier ' + ladder.length + ' ' + name(pick('L'))
      : 'tier ' + ladder.length + ' ' + name(pick('L')) + ' (pacing:verifier), the lowest tier'));
  }
  const t2 = pick(2);
  const notes = {
    'ahead': 'the session model does nearly everything',
    'on pace': 'the default split',
    'over': 'medium tasks leave the session model too',
    'throttle': 'no manual change now: the session dispatches everything to ' + name(t2) + ' subagents and does itself only what they would get wrong. For the NEXT session SWITCH to ' + name(t2) + ' (model menu: ' + t2.label + ', effort ' + t2.effort + ')',
    'stop': extraOn ? 'the week is nearly used; from 100 % the work is charged to extra usage, so go on only with the user\'s word' : 'wrap up, the week is nearly used',
  };
  const menuOf = t => '(model menu: ' + t.label + ', effort ' + t.effort + ')';
  const switchNow = premOut ? premLabel + ' is out until the reset: SWITCH the session to ' + name(pick(1)) + ' now ' + menuOf(pick(1)) + '. '
    : premHeld ? premLabel + '\'s own meter is at throttle: SWITCH the session to ' + name(pick(1)) + ' now ' + menuOf(pick(1)) + ' and keep ' + premLabel + ' for judgment work. ' : '';
  console.log('do: ' + switchNow + notes[level]);
  // At "over" the cheapest lever comes first: one step less effort on the
  // session's own model saves on every turn and keeps the work where it is.
  // Only the user can change it (the model menu, or the app's prompt when the
  // session offers set_session_effort). A session on another tier is left
  // alone, and so is one that is told to switch model now (premium out or held).
  const top = ladder[0], lower = EFFORTS[EFFORTS.indexOf(top.effort) - 1];
  if (level === 'over' && lower && !premAway && (!sessionModel || sessionModel === top.model)) {
    console.log('effort: first offer to lower this session\'s effort one step, ' + name(top) + ' -> ' + lower
      + ' (model menu: ' + top.label + ', effort ' + lower + '; the user decides); medium work still goes to ' + name(pick(2)));
  }
  if (premHeld && level !== 'throttle') {
    // what is left of the held meter goes to work that needs it most
    const held = tiers.find(t => t.model === premium);
    console.log('upward: ' + premLabel + ' is kept for judgment work: one contained hard task with a clear deliverable may go to ' + aName(held) + ' subagent; an open debugging hunt may not');
  } else if (session && ladder.indexOf(session) > 0 && ladder[0].model !== session.model && !premAway) {
    console.log('upward: this session runs on ' + name(session) + '; one contained hard task with a clear deliverable may go to ' + aName(ladder[0]) + ' subagent');
  } else if (sessionModel && !session) {
    console.log('note: the session model "' + opt.session + '" is not on the ladder');
  }
  console.log('next session: ' + name(sessionTier));
}

// ---- side effects: log, state, the default model for new sessions ----
let logged = false;
if (!opt.dry) {
  // this session is at work in this project (paths.mjs, the marks): a reading
  // the hooks module took after a turn says it is live
  if (process.env.CLAUDE_CODE_SESSION_ID) markSession(updateJson, projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd()), process.env.CLAUDE_CODE_SESSION_ID, { live: auto, now: now.getTime() });
  // an automatic reading fires after every turn, in every session: it is
  // logged only when the last reading (of any source) is 30 min old, or the
  // meter moved a whole point, or the level or the premium flag changed, so
  // the log grows by about two readings an hour at most
  const lastEntry = readLog().at(-1);
  const age = lastEntry ? now - Date.parse(lastEntry.t) : Infinity;
  const same = auto && lastEntry && age >= 0 && age < 30 * 60000 && Math.abs(used - lastEntry.all) < 1
    && lastEntry.level === level && !!lastEntry.premiumOut === premOut && !!lastEntry.premiumHeld === premHeld;
  if (!same) {
    const entry = { t: now.toISOString(), all: r1(used), premium: prem === null ? null : r1(prem), premiumModel: premium, premiumOut: premOut, five: five === null ? null : r1(five), fiveReset: opt['five-reset'] || null, line: r1(budget), level, reset: opt.reset,
      ...(premLevel ? { premiumLevel: premLevel } : {}), ...(premHeld ? { premiumHeld: true } : {}), ...(levelBy === 'premium' ? { levelBy } : {}),
      ...(auto ? { source: 'hook' } : {}), ...(premFrom ? { premiumAt: premFrom.at } : {}) };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    // swapped in whole (safe.mjs), and never over a newer reading that
    // another session wrote meanwhile
    const state = { ...entry, delta: r1(delta), next: sessionTier, trend: trend && !trend.short ? { rate: r1(trend.rate), projected: r1(trend.projected) } : null };
    updateJson(stateFile, cur => (cur && Date.parse(cur.t) > now.getTime() ? null : state));
    logged = true;
  }
  // only a reading the session takes on purpose changes what new sessions
  // start on: a background run never rewrites a setting
  if (setNextModel && sessionTier && !auto) {
    // the app's picker and preset know "max"; settings.json's effortLevel is
    // written as xhigh for max, as it was before (not verified either way)
    const effort = sessionTier.effort;
    const cliEffort = effort === 'max' ? 'xhigh' : effort;
    // the terminal CLI's default: ~/.claude/settings.json
    try {
      // the user's own settings file, which Claude Code and other sessions
      // write too: only these two keys change, on the file as it is at that
      // moment (safe.mjs); a file that does not parse is left alone
      let changed = false;
      updateFile(settingsFile, text => {
        const s = text === null ? {} : JSON.parse(text);
        changed = s.model !== sessionTier.model || s.effortLevel !== cliEffort;
        if (!changed) return null;
        s.model = sessionTier.model; s.effortLevel = cliEffort;
        return JSON.stringify(s, null, 2) + '\n';
      });
      if (changed) console.log('settings.json: the terminal CLI now defaults to ' + name(sessionTier) + ' (model "' + sessionTier.model + '", effortLevel "' + cliEffort + '")');
    } catch (e) {
      console.log('settings.json not changed: ' + e.message);
    }
    // the desktop app's preset for new local sessions: the "builtIns.local"
    // entry of ccd-session-presets.json under %LOCALAPPDATA%\Claude-Data\<id>\
    try {
      const modelId = MODELS[sessionTier.model].id;
      const dataDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Data');
      const presetFiles = fs.existsSync(dataDir)
        ? fs.readdirSync(dataDir).map(d => path.join(dataDir, d, 'ccd-session-presets.json')).filter(p => fs.existsSync(p))
        : [];
      for (const p of presetFiles) {
        // the app's own file, which the app writes too: changed on the file
        // as it is at that moment, and swapped in whole (safe.mjs)
        let changed = false;
        updateFile(p, text => {
          if (text === null) return null;
          const j = JSON.parse(text);
          changed = false;
          for (const acc of Object.values(j.byAccount || {})) {
            const s = acc.builtIns && acc.builtIns.local && acc.builtIns.local.settings;
            if (s && (s.modelId !== modelId || s.effort !== effort)) { s.modelId = modelId; s.effort = effort; changed = true; }
          }
          return changed ? JSON.stringify(j, null, '\t') + '\n' : null;
        });
        if (changed) console.log('desktop app preset: new local sessions now start on ' + name(sessionTier) + ' (' + p + ')');
      }
    } catch (e) {
      console.log('desktop app preset not changed: ' + e.message);
    }
  }
}
if (opt.brief && !auto) {
  // The full report says the routing three times (the sheet, the paragraph
  // under it, the routing lines) for a person to read. After a task the
  // session needs the level, what to do and what advises: one line each,
  // the routing in one line.
  const byTier = new Map();
  if (ladder.length) for (const cls of CLASSES) { const t = pick(route[cls]); byTier.set(t, [...(byTier.get(t) || []), cls]); }
  const parts = [...byTier].map(([t, cls]) => cls.join(', ') + ' -> ' + name(t) + (ladder.indexOf(t) === 0 ? ' (the session)' : ''));
  if (ladder.length > 1) parts.push('bulky -> ' + name(pick('L')));
  if (ladder.length && level !== 'stop') {
    parts.push('reader -> ' + name(readerTier || pick('L')));
    parts.push('verifier -> ' + name(verifierTier || pick('L')) + (verifierTier ? ' (plain runs; checks to judge -> ' + name(pick('L')) + ')' : ''));
  }
  const keep = l => /^(All models used |last reading |last week:|first run:|config.json: |do: |effort: |upward: |note: |next session: |settings.json|desktop app preset)/.test(l)
    || (premLabel && l.startsWith(premLabel + ' used '))
    || (/^(5-hour window|fixed overhead|context) /.test(l) && l.includes(' -> '))
    || (level === 'stop' && l.startsWith('extra usage: '));
  for (const l of said.filter(keep)) {
    if (l.startsWith('do: ') && parts.length) print('route: ' + parts.join('; '));
    print(l);
  }
}
// Whether another session started this one (a side session in the desktop
// app). The app keeps a record per session, in the folder
// <LOCALAPPDATA>/Claude-Data/<app>/claude-code-sessions/<a>/<b>/ as
// <session id>.json, with `spawnedFrom` on a
// session another one started, and names the id in the engine's environment
// (CLAUDE_CODE_HOST_SESSION_ID). The app's own file, not a documented
// interface, and seen on Windows only: anything missing or unreadable is
// "not known" (null), never an error. CLAUDE_CODE_CHILD_SESSION is no such
// mark: the engine sets it for every command it runs, in every session.
// A session the user detached to the top level keeps its `spawnedFrom` and
// gains `lineageDetached: true`: it is a session of its own from then on.
const spawnedSession = () => {
  try {
    const id = process.env.CLAUDE_CODE_HOST_SESSION_ID;
    if (!id || !/^[\w-]+$/.test(id)) return null;
    const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Data');
    const dirs = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)) : []);
    for (const app of dirs(base)) for (const a of dirs(path.join(app, 'claude-code-sessions'))) for (const b of dirs(a)) {
      const f = path.join(b, id + '.json');
      if (fs.existsSync(f)) {
        const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
        const s = rec.spawnedFrom;
        return !!(s && typeof s === 'object' && s.sessionId) && rec.lineageDetached !== true;
      }
    }
  } catch { /* not known */ }
  return null;
};
// ---- a carried per-model figure is not a current one ----
// An automatic reading has no per-model meter and carries the last figure a
// full reading took. That figure went unread for 15 hours once, at 71 % while
// the meter reached 90 %. So the reading says how old the figure is, where the
// meter probably is by now, and when a full reading is due:
//   age       from the time the figure was read
//   estimate  the figure plus what all models moved since, times how the two
//             meters moved against each other between this week's full
//             readings (the per-model allowance is the smaller one, so its
//             meter moves faster). Shown as an estimate, never used for a
//             level: a level rests on figures that were read.
//   needFull  while tier 1 is that model: no figure this week, the figure an
//             hour old, or all models 2 points on since it was read (two
//             points were ten on the per-model meter in the case above).
//             With the model held off tier 1 this session no longer draws
//             on it, and three hours is soon enough.
const fulls = weekLog.filter(e => e.premiumModel === premium && typeof e.premium === 'number' && !e.premiumAt);
const premAgeMs = premFrom ? Math.max(0, now - Date.parse(premFrom.at)) : null;
const readAt = premFrom ? fulls.filter(e => e.t === premFrom.at).at(-1) || fulls.at(-1) : null;
const allMoved = readAt ? Math.max(0, used - readAt.all) : null;
const ratio = fulls.length >= 2 && fulls.at(-1).all - fulls[0].all >= 2 && fulls.at(-1).premium >= fulls[0].premium
  ? Math.min(10, (fulls.at(-1).premium - fulls[0].premium) / (fulls.at(-1).all - fulls[0].all)) : null;
const premEstimate = premFrom && prem !== null && ratio !== null && allMoved > 0 && ratio * allMoved >= 1 ? Math.min(100, r1(prem + ratio * allMoved)) : null;
const FULL_AGE = HOUR, FULL_AGE_HELD = 3 * HOUR, FULL_MOVED = 2;
const needFull = !(auto && premium && premTop) || premOut ? null
  : prem === null ? 'no ' + premLabel + ' reading this week yet'
    : premAgeMs !== null && premAgeMs >= (premHeld ? FULL_AGE_HELD : FULL_AGE) ? 'the ' + premLabel + ' figure is ' + mins(premAgeMs) + ' old'
      : !premHeld && allMoved !== null && allMoved >= FULL_MOVED ? 'all models moved ' + r1(allMoved) + ' points since the ' + premLabel + ' meter was read'
        : null;
if (auto) {
  const doLine = said.find(l => l.startsWith('do: '));
  // For the status line: the meter as a share of the budget line, and what the
  // module needs to split the session's use by tier: each model's prices, and
  // its tier number on the ladder in force now (with the fallback on top
  // while the per-model meter is out or held). A usage record names a model,
  // not an effort, and one model can hold two places (Opus 5.5 high as the
  // fallback on top, Opus 5.5 medium at tier 2). So the session's own turns
  // count at a model's first place (tierOf), and its subagents' at its first
  // place below tier 1 (agentTierOf): subagents take the lower tiers. A model
  // off the ladder now (the premium one while out or held, a configured tier
  // the ladder dropped) keeps its configured place; the reader's and the
  // verifier's models, off the ladder, come after its last tier.
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
  const prices = Object.fromEntries(Object.values(MODELS).map(m => [m.id, m.price]));
  print(JSON.stringify({ level, all: r1(used), line: r1(budget), ofBudget: budget > 0 ? Math.round(100 * used / budget) : null, tierOf, agentTierOf, prices,
    premium: prem === null ? null : r1(prem), premiumOut: premOut, premiumLabel: premLabel,
    premiumAt: premFrom ? premFrom.at : null, premiumLevel: premLevel, premiumHeld: premHeld, levelBy,
    premiumOfBudget: premLevel && budget > 0 ? Math.round(100 * prem / budget) : null,
    premiumEstimate: premEstimate, needFull,
    // what the session should run on, and at "over" the effort one step
    // lower on tier 1: the hooks module offers them as a Switch button
    recommend: sessionTier ? { model: MODELS[sessionTier.model].id, label: sessionTier.label, effort: sessionTier.effort } : null,
    effortStep: ladder.length && level === 'over' && !premAway && EFFORTS.indexOf(ladder[0].effort) > 0
      ? { model: MODELS[ladder[0].model].id, label: ladder[0].label, effort: EFFORTS[EFFORTS.indexOf(ladder[0].effort) - 1] } : null,
    premiumModelId: premium && MODELS[premium] ? MODELS[premium].id : null,
    // this session's id, for the hooks module to find the side sessions it started
    hostSessionId: /^[\w-]+$/.test(process.env.CLAUDE_CODE_HOST_SESSION_ID || '') ? process.env.CLAUDE_CODE_HOST_SESSION_ID : null,
    spawned: spawnedSession(), logged, do: doLine ? doLine.slice(4) : null }));
}
