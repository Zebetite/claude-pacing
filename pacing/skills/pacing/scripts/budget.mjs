// Budget line for the Weekly · all models meter (the per-model meter is not
// paced), the routing of work classes onto the configured ladder, the usage log
// with its projection, and the state the SessionStart hook reads.
//   node budget.mjs --all <pct> --reset <ISO> [--premium <pct>] [--five <pct>]
//                   [--five-reset <ISO>] [--session <model>] [--now <ISO>] [--dry]
// --premium is the per-model weekly meter of config.premium (Fable by default;
// --fable is the old name of the flag and still accepted).
//   node budget.mjs log [n]        the last n readings (20)
// The week is 7 days ending at --reset; the last 24 h weigh config.lastDayWeight
// (1.5 by default), the rest 1. The line is a step at local midnight: the whole
// of the current calendar day's allowance counts as available from its start.
// --dry: compute only (no log entry, no state.json, no settings.json change).
// The config, the log and the state live in ~/.claude/pacing, outside the
// plugin folder, which an update replaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODELS } from './models.mjs';

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
    { model: 'opus', label: MODELS.opus.label, effort: 'high' },
    { model: 'sonnet', label: MODELS.sonnet.label, effort: 'medium' },
  ];
}
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

if (argv[0] === 'log') {
  const rows = readLog().slice(-(Number(argv[1]) || 20));
  if (!rows.length) { console.log('no readings yet'); process.exit(0); }
  for (const e of rows) {
    // local time, like the report
    console.log(new Date(e.t).toLocaleString('sv-SE').slice(0, 16) + '  all ' + String(e.all).padStart(5) + ' %  line ' + String(e.line).padStart(5) + ' %  '
      + ((e.premium ?? e.fable) != null ? labelOf(e.premiumModel) + ' ' + String(e.premium ?? e.fable).padStart(3) + ' %  ' : '') + (e.five != null ? '5h ' + String(e.five).padStart(3) + ' %  ' : '') + e.level + (e.premiumOut || e.fableOut ? ', ' + labelOf(e.premiumModel) + ' out' : ''));
  }
  process.exit(0);
}

const KNOWN = ['all', 'reset', 'premium', 'fable', 'five', 'five-reset', 'session', 'context', 'now', 'dry'];
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
  console.log('usage: node budget.mjs --all <pct> --reset <ISO> [--premium <pct>] [--five <pct>] [--five-reset <ISO>] [--session <model>] [--context <pct>] [--now <ISO>] [--dry]');
  console.log('       node budget.mjs log [n]');
  console.log('       a meter the plan does not have: pass - for its percent');
  process.exit(1);
};
// a mistyped flag must not pass as "no such meter"
if (unknown.length) { console.log('unknown option ' + unknown.join(' ')); usage(); }
if (opt.all === undefined || !opt.reset) usage();
const num = v => (v === undefined || v === '-' ? null : Number(v));
const used = Number(opt.all);
// the per-model meter is read only when the config names one
const prem = premium ? num(opt.premium !== undefined ? opt.premium : opt.fable) : null;
const five = num(opt.five);
const context = num(opt.context);
const reset = new Date(opt.reset);
const fiveReset = opt['five-reset'] ? new Date(opt['five-reset']) : null;
const now = opt.now ? new Date(opt.now) : new Date();
const bad = [used, prem, five, context].some(v => v !== null && Number.isNaN(v))
  || Number.isNaN(reset.getTime()) || Number.isNaN(now.getTime()) || (fiveReset && Number.isNaN(fiveReset.getTime()));
if (bad) { console.log('bad input: percents must be numbers, dates ISO 8601'); process.exit(1); }

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
const ladder = premOut ? tiers.filter(t => t.model !== premium) : tiers;
const route = ROUTES[level];
const pick = r => { const i = r === 'L' ? ladder.length : Math.min(r, ladder.length); return ladder[i - 1]; };
// the model a session should run on at this level
const sessionTier = !ladder.length ? null : level === 'throttle' || level === 'stop' ? pick(2) : pick(1);
// --session takes a short name (opus) or a full model id (claude-opus-5-5)
const sessionModel = opt.session ? (Object.keys(MODELS).find(m => opt.session.toLowerCase().includes(m)) || opt.session) : null;
const session = sessionModel ? tiers.find(t => t.model === sessionModel) : null;

// ---- report ----
const when = d => d.toLocaleString('sv-SE').slice(0, 16);
console.log('day ' + dayNo + ' of ' + dayCount + ' (calendar days), ' + r1(elapsed) + ' days elapsed, ' + r1(left) + ' days to reset');
console.log('allowance today ' + r1(todayAllowance) + ' %, budget line now ' + r1(budget) + ' % (counted to ' + (endOfToday === reset.getTime() ? 'the reset' : 'midnight') + ')');
console.log('All models used ' + r1(used) + ' %, delta ' + (delta >= 0 ? '+' : '') + r1(delta)
  + (prem !== null ? ', ' + premLabel + ' ' + r1(prem) + ' %' : '') + ' -> ' + level + (trend && trend.bumped ? ' (raised by the trend)' : '') + (premOut ? ', ' + premLabel + ' out' : ''));
if (trend) {
  console.log('trend: ' + (trend.rate >= 0 ? '+' : '') + r1(trend.rate) + ' %/day over the last ' + r1(trend.hours) + ' h, projected ' + r1(trend.projected) + ' % at reset'
    + (trend.reach ? ', reaches 100 % ' + when(trend.reach) : '')
    + (trend.short ? ' (sample under ' + TREND_MIN_H + ' h, not applied to the level)' : ''));
}
if (five !== null) {
  const resetsIn = fiveReset ? Math.max(0, Math.round((fiveReset - now) / 60000)) : null;
  console.log('5-hour window ' + r1(five) + ' %' + (resetsIn !== null ? ', resets in ' + resetsIn + ' min (' + when(fiveReset) + ')' : '')
    + (five >= 85 ? ' -> HOLD heavy work until it resets; delegation does not help this meter' : ''));
}
// the session's own context is re-sent on every turn: past a point, the
// transcript costs more than any model choice saves
if (context !== null) {
  console.log('context ' + r1(context) + ' % of the window'
    + (context >= 50 ? ' -> this session is the expensive part now: move the next task to a NEW session, and keep this one for follow-ups only'
      : context >= 30 ? ' -> start new tasks in a new session; finish the current one here'
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
    console.log('  bulky    -> tier ' + ladder.length + ' ' + name(tL) + ' (subagent) at any level: logs, test runs, many files; the output stays out of the session\'s context');
  }
  const t2 = pick(2);
  const notes = {
    'ahead': 'the session model does nearly everything',
    'on pace': 'the default split',
    'over': 'medium tasks leave the session model too',
    'throttle': 'no manual change now: the session dispatches everything to ' + name(t2) + ' subagents and does itself only what they would get wrong. For the NEXT session SWITCH to ' + name(t2) + ' (model menu: ' + t2.label + ', effort ' + t2.effort + ')',
    'stop': 'wrap up, the week is nearly used',
  };
  const switchNow = premOut ? premLabel + ' is out until the reset: SWITCH the session to ' + name(pick(1)) + ' now (model menu: ' + pick(1).label + ', effort ' + pick(1).effort + '). ' : '';
  console.log('do: ' + switchNow + notes[level]);
  if (session && ladder.indexOf(session) > 0 && ladder[0].model !== session.model && !premOut) {
    console.log('upward: this session runs on ' + name(session) + '; one contained hard task with a clear deliverable may go to a ' + name(ladder[0]) + ' subagent');
  } else if (sessionModel && !session) {
    console.log('note: the session model "' + opt.session + '" is not on the ladder');
  }
  console.log('next session: ' + name(sessionTier));
}

// ---- side effects: log, state, the default model for new sessions ----
if (!opt.dry) {
  const entry = { t: now.toISOString(), all: r1(used), premium: prem === null ? null : r1(prem), premiumModel: premium, premiumOut: premOut, five: five === null ? null : r1(five), line: r1(budget), level, reset: opt.reset };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  fs.writeFileSync(stateFile, JSON.stringify({ ...entry, delta: r1(delta), next: sessionTier, trend: trend && !trend.short ? { rate: r1(trend.rate), projected: r1(trend.projected) } : null }, null, 2) + '\n');
  if (setNextModel && sessionTier) {
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
