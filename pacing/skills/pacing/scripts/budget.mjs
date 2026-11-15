// Budget line for the Weekly · all models meter (the per-model meter is not
// paced), the routing of work classes onto the configured ladder, the usage log
// with its projection, and the state the SessionStart hook reads.
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
// last reading of the same week; it never changes settings.json or the app's
// preset; it is not logged when the last reading is under 30 min old and
// nothing moved; and it prints one JSON line for the module, not the report.
// The config, the log and the state live in ~/.claude/pacing, outside the
// plugin folder, which an update replaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODELS, EFFORTS, relabel } from './models.mjs';

const dataDir = path.join(os.homedir(), '.claude', 'pacing');
fs.mkdirSync(dataDir, { recursive: true });
const cfgFile = path.join(dataDir, 'config.json');
const logFile = path.join(dataDir, 'log.jsonl');
const stateFile = path.join(dataDir, 'state.json');
const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');

const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
let tiers = cfg.tiers ? cfg.tiers : cfg.primary ? [cfg.primary, cfg.fallback] : null;
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
const lastDayWeight = cfg.lastDayWeight || 1.5;
const setNextModel = cfg.setNextModel !== false;
// the per-model weekly meter: which ladder model it belongs to (fable unless
// config.premium says otherwise; null when the plan has no such meter)
const premium = cfg.premium === undefined ? 'fable' : cfg.premium;
const premLabel = premium && MODELS[premium] ? MODELS[premium].label : null;
const labelOf = m => (m && MODELS[m] ? MODELS[m].label : 'Fable');
const name = t => t.label + ' ' + t.effort;
const r1 = n => Math.round(n * 10) / 10;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// ---- arguments ----
const argv = process.argv.slice(2);
// a line that does not parse (a cut-off write, a stray edit) is skipped, not fatal
const readLog = () => fs.existsSync(logFile)
  ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })
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
    // local time, like the report
    console.log(new Date(e.t).toLocaleString('sv-SE').slice(0, 16) + '  all ' + String(e.all).padStart(5) + ' %  line ' + String(e.line).padStart(5) + ' %  '
      + ((e.premium ?? e.fable) != null ? labelOf(e.premiumModel) + ' ' + String(e.premium ?? e.fable).padStart(3) + ' %  ' : '') + (e.five != null ? '5h ' + String(e.five).padStart(3) + ' %  ' : '') + e.level + (e.premiumOut || e.fableOut ? ', ' + labelOf(e.premiumModel) + ' out' : '') + (e.source === 'hook' ? '  (auto)' : ''));
  }
  process.exit(0);
}

const KNOWN = ['all', 'reset', 'premium', 'fable', 'five', 'five-reset', 'session', 'context', 'context-tokens', 'extra-spent', 'extra-limit', 'extra-currency', 'now', 'dry', 'source'];
const opt = {};
const unknown = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (!KNOWN.includes(k)) unknown.push(a);
    else if (k === 'dry') opt.dry = true;
    else opt[k] = argv[++i];
  }
}
const usage = () => {
  console.log('usage: node budget.mjs --all <pct> --reset <ISO> [--premium <pct>] [--five <pct>] [--five-reset <ISO>] [--session <model>]');
  console.log('                      [--context <pct>] [--context-tokens <n>]');
  console.log('                      [--extra-spent <amount> --extra-limit <amount> [--extra-currency <code>]] [--now <ISO>] [--dry] [--source skill|hook]');
  console.log('       node budget.mjs log [n] | week [n]');
  console.log('       a meter the plan does not have: pass - for its percent');
  process.exit(1);
};
// a mistyped flag must not pass as "no such meter"
if (unknown.length) { console.log('unknown option ' + unknown.join(' ')); usage(); }
if (opt.all === undefined || !opt.reset) usage();
const source = opt.source || 'skill';
if (!['skill', 'hook'].includes(source)) { console.log('--source is skill or hook'); usage(); }
const auto = source === 'hook';
const num = v => (v === undefined || v === '-' ? null : Number(v));
const used = Number(opt.all);
// the per-model meter is read only when the config names one. An automatic
// reading never has it (the engine hands a plugin only the all-models and
// 5-hour windows, and a gateway's spend limit; no per-model meter and no
// extra usage), so it takes the last figure of the same week, with the
// time that figure was read; a week with none has no figure.
let premFrom = null;
const premArg = opt.premium !== undefined ? opt.premium : opt.fable;
if (auto && premium && premArg === undefined) {
  const r = Date.parse(opt.reset);
  const known = readLog().filter(e => e.premiumModel === premium && e.premium != null && Math.abs(Date.parse(e.reset) - r) <= HOUR);
  const last = known[known.length - 1];
  if (last) premFrom = { premium: last.premium, at: last.premiumAt || last.t };
}
const prem = premium ? (premFrom ? premFrom.premium : num(premArg)) : null;
const five = num(opt.five);
const context = num(opt.context);
const contextTokens = num(opt['context-tokens']);
// extra usage: past 100 % the work goes on and is charged, when the plan allows it
const extraSpent = num(opt['extra-spent']);
const extraLimit = num(opt['extra-limit']);
const extraCurrency = opt['extra-currency'] || '';
const extraOn = extraSpent !== null && extraLimit !== null && extraLimit > 0;
const reset = new Date(opt.reset);
const fiveReset = opt['five-reset'] ? new Date(opt['five-reset']) : null;
const now = opt.now ? new Date(opt.now) : new Date();
const bad = [used, prem, five, context, contextTokens].some(v => v !== null && Number.isNaN(v))
  || Number.isNaN(reset.getTime()) || Number.isNaN(now.getTime()) || (fiveReset && Number.isNaN(fiveReset.getTime()));
if (bad) { console.log('bad input: percents must be numbers, dates ISO 8601'); process.exit(1); }
// an automatic reading answers the hooks module, not a person: the report's
// lines are kept here, and one JSON line goes out at the end
const said = [];
const print = console.log;
if (auto) console.log = (...a) => { said.push(a.join(' ')); };

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
let trend = null;
const TREND_MIN_H = 20;
const sameWeek = e => Math.abs(new Date(e.reset) - reset) <= HOUR;
const prev = readLog().filter(e => sameWeek(e) && now - new Date(e.t) <= 2 * DAY && now - new Date(e.t) >= 4 * HOUR);
if (prev.length) {
  const e = prev[0];
  const hours = (now - new Date(e.t)) / HOUR;
  const rate = (used - e.all) / (hours / 24);
  const projected = used + rate * left;
  const reach = rate > 0 && projected > 100 ? new Date(now.getTime() + ((100 - used) / rate) * DAY) : null;
  trend = { hours, rate, projected, reach, short: hours < TREND_MIN_H };
  // the projection overrides the line: past 100 % at least "over", past 115 % "throttle"
  const floor = projected > 115 ? 'throttle' : projected > 100 ? 'over' : null;
  if (floor && !trend.short && LEVELS.includes(level) && LEVELS.indexOf(level) < LEVELS.indexOf(floor)) {
    level = floor;
    trend.bumped = true;
  }
}

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
const ladder = !premOut ? tiers
  : fallbackTier && fallbackTier.model !== premium && !rest.some(t => t.model === fallbackTier.model && t.effort === fallbackTier.effort)
    ? [fallbackTier, ...rest]
    : rest;
// a reader model whose meter is out follows the lowest tier like 'ladder'
const readerTier = readerCfg && readerCfg !== 'ladder' && MODELS[readerCfg.model] && !(premOut && readerCfg.model === premium)
  ? { model: readerCfg.model, label: MODELS[readerCfg.model].label, effort: readerCfg.effort } : null;
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
[
  barRow('5-hour', five, fiveReset ? 'resets ' + clock(fiveReset) : ''),
  barRow('All models', used, '/ ' + Math.round(budget) + ' % pace · resets in ' + resetsIn(reset - now), budget),
  prem !== null ? barRow(premLabel, prem, premOut ? 'out until the reset' : 'not paced') : null,
  barRow('Context', context, ctxLevel === 2 ? 'new session for the next task' : ctxLevel === 1 ? 'unrelated tasks: new session'
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
    ? (readerTier ? 'bulky output (test runs, builds, checks)' : 'bulky output (logs, test runs, many files)') : '';
  const where = i === 0 ? 'the session: ' : 'subagents: ';
  const takes = level === 'stop' ? (i === 0 ? 'the session: wrap up, the week is nearly used' : 'nothing: wrap up')
    : work.length ? where + work.join(', ') + ' work' + (bulky ? '; ' + bulky : '')
      : bulky ? where + bulky
        : i === 0 && level === 'throttle' ? where + 'only what ' + name(pick(2)) + ' would get wrong'
          : 'nothing at this level';
  sheet.push([String(i + 1), name(t), takes]);
});
if (readerTier && ladder.length && level !== 'stop') sheet.push(['r', name(readerTier), 'the reader agent: bulky reading (logs, searches, unfamiliar code)']);
if (premOut) tiers.filter(t => t.model === premium).forEach(t => sheet.push(['-', name(t), 'out until the reset: its own meter is at 100 %']));
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
// why this routing: the all-models meter against today's allowed usage
const pts = Math.abs(Math.round(delta));
const compare = delta < 0 ? pts + ' points under' : delta > 0 ? pts + ' points over' : 'exactly on';
const t1 = ladder[0] ? 'tier 1 ' + name(ladder[0]) : 'tier 1';
const t2s = ladder[1] ? 'tier 2 ' + name(ladder[1]) + ' subagents' : 'tier 2 subagents';
const because = {
  'ahead': 'more than 5 points under the line is "ahead", so every class of work stays on ' + t1 + '.',
  'on pace': 'within 5 points under the line is "on pace", so routine work goes to ' + t2s + '; judgment, medium and trivial work stay on ' + t1 + '.',
  'over': 'up to 5 points over the line is "over", so medium and routine work go to ' + t2s + '; judgment and trivial work stay on ' + t1 + '.',
  'throttle': 'more than 5 points over the line is "throttle", so every class of work goes to ' + t2s + ' and the session does only what they would get wrong.',
  'stop': 'at 95 % or more the week is nearly used: "stop", wrap up.',
};
let why = 'All models at ' + Math.round(used) + ' % is ' + compare + ' today\'s allowed ' + Math.round(budget) + ' %'
  + (trend && trend.bumped ? ', and the trend projects ' + Math.round(trend.projected) + ' % at the reset, which raises the level' : '') + ': '
  + because[level]
  + (ladder.length > 1 && level !== 'stop' ? ' Bulky output goes to the lowest tier at every level' + (readerTier ? ', bulky reading to the reader on ' + name(readerTier) : '') + ', so it stays out of the session\'s context.' : '')
  // with every tier on the premium model and no fallback, nothing takes tier 1
  + (premOut ? ' ' + premLabel + '\'s own meter is at 100 %, so it left the ladder until the reset'
    + (ladder[0] ? ' and ' + name(ladder[0]) + ' takes tier 1.' : ' and no model is left.') : '');
console.log('');
wrap(why, WIDTH).forEach(l => console.log(l));
console.log('');
console.log('day ' + dayNo + ' of ' + dayCount + ' (calendar days), ' + r1(elapsed) + ' days elapsed, ' + r1(left) + ' days to reset');
console.log('allowance today ' + r1(todayAllowance) + ' %, budget line now ' + r1(budget) + ' % (counted to ' + (endOfToday === reset.getTime() ? 'the reset' : 'midnight') + ')');
console.log('All models used ' + r1(used) + ' %, delta ' + (delta >= 0 ? '+' : '') + r1(delta)
  + (prem !== null ? ', ' + premLabel + ' ' + r1(prem) + ' %' : '') + ' -> ' + level + (trend && trend.bumped ? ' (raised by the trend)' : '') + (premOut ? ', ' + premLabel + ' out' : ''));
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
// the session's own context is re-sent on every turn: past a point, the
// transcript costs more than any model choice saves
if (context !== null || contextTokens !== null) {
  const size = contextTokens !== null
    ? Math.round(contextTokens / 1000) + 'k tokens' + (context !== null ? ' (' + r1(context) + ' % of the window)' : '')
    : r1(context) + ' % of the window';
  console.log('context ' + size
    + (ctxLevel === 2 ? ' -> this session is the expensive part now, above all after a pause: say so before the next task and offer a handover (/pacing handover); a task unrelated to this work goes to a NEW session, and only short follow-ups stay'
      : ctxLevel === 1 ? ' -> a task unrelated to this session\'s work starts in a new session; follow-ups that build on it stay here'
        : ''));
}
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
    console.log('  bulky    -> tier ' + ladder.length + ' ' + name(tL) + ' (subagent) at any level: ' + (readerTier ? 'test runs, builds, checks' : 'logs, test runs, many files') + '; the output stays out of the session\'s context');
  }
  if (level !== 'stop') {
    console.log('  reader   -> ' + (readerTier ? name(readerTier) + ' (pacing:reader) at any level: logs, searches, unfamiliar code'
      : 'tier ' + ladder.length + ' ' + name(pick('L')) + ' (pacing:reader), the lowest tier'));
  }
  const t2 = pick(2);
  const notes = {
    'ahead': 'the session model does nearly everything',
    'on pace': 'the default split',
    'over': 'medium tasks leave the session model too',
    'throttle': 'no manual change now: the session dispatches everything to ' + name(t2) + ' subagents and does itself only what they would get wrong. For the NEXT session SWITCH to ' + name(t2) + ' (model menu: ' + t2.label + ', effort ' + t2.effort + ')',
    'stop': extraOn ? 'the week is nearly used; from 100 % the work is charged to extra usage, so go on only with the user\'s word' : 'wrap up, the week is nearly used',
  };
  const switchNow = premOut ? premLabel + ' is out until the reset: SWITCH the session to ' + name(pick(1)) + ' now (model menu: ' + pick(1).label + ', effort ' + pick(1).effort + '). ' : '';
  console.log('do: ' + switchNow + notes[level]);
  // At "over" the cheapest lever comes first: one step less effort on the
  // session's own model saves on every turn and keeps the work where it is.
  // Only the user can change it (the model menu, or the app's prompt when the
  // session offers set_session_effort). A session on another tier is left
  // alone, and so is one that is told to switch model now (premium out).
  const top = ladder[0], lower = EFFORTS[EFFORTS.indexOf(top.effort) - 1];
  if (level === 'over' && lower && !premOut && (!sessionModel || sessionModel === top.model)) {
    console.log('effort: first offer to lower this session\'s effort one step, ' + name(top) + ' -> ' + lower
      + ' (model menu: ' + top.label + ', effort ' + lower + '; the user decides); medium work still goes to ' + name(pick(2)));
  }
  if (session && ladder.indexOf(session) > 0 && ladder[0].model !== session.model && !premOut) {
    console.log('upward: this session runs on ' + name(session) + '; one contained hard task with a clear deliverable may go to a ' + name(ladder[0]) + ' subagent');
  } else if (sessionModel && !session) {
    console.log('note: the session model "' + opt.session + '" is not on the ladder');
  }
  console.log('next session: ' + name(sessionTier));
}

// ---- side effects: log, state, the default model for new sessions ----
let logged = false;
if (!opt.dry) {
  // an automatic reading fires after every turn, in every session: it is
  // logged only when the last reading (of any source) is 30 min old, or the
  // meter moved a whole point, or the level or the premium flag changed, so
  // the log grows by about two readings an hour at most
  const lastEntry = readLog().at(-1);
  const age = lastEntry ? now - Date.parse(lastEntry.t) : Infinity;
  const same = auto && lastEntry && age >= 0 && age < 30 * 60000 && Math.abs(used - lastEntry.all) < 1
    && lastEntry.level === level && !!lastEntry.premiumOut === premOut;
  if (!same) {
    const entry = { t: now.toISOString(), all: r1(used), premium: prem === null ? null : r1(prem), premiumModel: premium, premiumOut: premOut, five: five === null ? null : r1(five), fiveReset: opt['five-reset'] || null, line: r1(budget), level, reset: opt.reset,
      ...(auto ? { source: 'hook' } : {}), ...(premFrom ? { premiumAt: premFrom.at } : {}) };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    fs.writeFileSync(stateFile, JSON.stringify({ ...entry, delta: r1(delta), next: sessionTier, trend: trend && !trend.short ? { rate: r1(trend.rate), projected: r1(trend.projected) } : null }, null, 2) + '\n');
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
      const s = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
      if (s.model !== sessionTier.model || s.effortLevel !== cliEffort) {
        s.model = sessionTier.model; s.effortLevel = cliEffort;
        fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
        console.log('settings.json: the terminal CLI now defaults to ' + name(sessionTier) + ' (model "' + s.model + '", effortLevel "' + cliEffort + '")');
      }
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
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        let changed = false;
        for (const acc of Object.values(j.byAccount || {})) {
          const s = acc.builtIns && acc.builtIns.local && acc.builtIns.local.settings;
          if (s && (s.modelId !== modelId || s.effort !== effort)) { s.modelId = modelId; s.effort = effort; changed = true; }
        }
        if (changed) {
          fs.writeFileSync(p, JSON.stringify(j, null, '\t') + '\n');
          console.log('desktop app preset: new local sessions now start on ' + name(sessionTier) + ' (' + p + ')');
        }
      }
    } catch (e) {
      console.log('desktop app preset not changed: ' + e.message);
    }
  }
}
if (auto) {
  const doLine = said.find(l => l.startsWith('do: '));
  // for the status line: the meter as a share of the budget line, and what the
  // module needs to split the session's own use by tier: each model's tier
  // number (its first place on the configured ladder; the reader's model
  // after the last tier when it is not on the ladder; the fallback's at tier
  // 1, the place it takes) and its prices
  const tierOf = {};
  tiers.forEach((t, i) => { if (MODELS[t.model] && !tierOf[MODELS[t.model].id]) tierOf[MODELS[t.model].id] = i + 1; });
  if (readerCfg && readerCfg !== 'ladder' && MODELS[readerCfg.model] && !tierOf[MODELS[readerCfg.model].id]) tierOf[MODELS[readerCfg.model].id] = tiers.length + 1;
  if (fallbackTier && !tierOf[MODELS[fallbackTier.model].id]) tierOf[MODELS[fallbackTier.model].id] = 1;
  const prices = Object.fromEntries(Object.values(MODELS).map(m => [m.id, m.price]));
  print(JSON.stringify({ level, all: r1(used), line: r1(budget), ofBudget: budget > 0 ? Math.round(100 * used / budget) : null, tierOf, prices,
    premium: prem === null ? null : r1(prem), premiumOut: premOut, premiumLabel: premLabel,
    premiumAt: premFrom ? premFrom.at : null, logged, do: doLine ? doLine.slice(4) : null }));
}
