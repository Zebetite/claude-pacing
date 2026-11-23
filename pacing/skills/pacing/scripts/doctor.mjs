// A self-check: is pacing working here, and if not, what to do. Nine checks,
// a line each: ok, warn or fail, a short name, what was found, and for a warn
// or a fail one plain step after "->". Never a step to change this session's
// model or effort: the hooks module's Switch row offers that. A summary line
// ends it.
//   node doctor.mjs [--json] [--now <ISO>]
// --json: the same as one JSON line, for the hooks module. --now: the time to
// check against (the tests). Exit code 1 when a check failed, else 0.
// It reads the files the other scripts write and changes none of them; the
// one write is a temp file in each folder, removed at once. A missing or
// damaged file is a finding, never a crash.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, EFFORTS, SETTINGS, RETIRED, checkConfig } from './models.mjs';
import { dataDir, projectRoot, projectSlug, notesDir, agentsLog, loadConfig, recentHookReading } from './paths.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const nowArg = argv.indexOf('--now') >= 0 ? Date.parse(argv[argv.indexOf('--now') + 1]) : NaN;
const now = Number.isNaN(nowArg) ? Date.now() : nowArg;
const HOUR = 3600000, DAY = 24 * HOUR;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// ---- reading the files: a missing one and a damaged one told apart ----
const readJson = f => {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { missing: true } : { damaged: true }; }
  try { return { value: JSON.parse(text) }; } catch { return { damaged: true }; }
};
// the lines of a .jsonl file, and how many of them do not parse
const readLines = f => {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return { missing: e.code === 'ENOENT', damaged: e.code !== 'ENOENT', rows: [], bad: 0 }; }
  const rows = [];
  let bad = 0;
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const v = JSON.parse(l); if (v && typeof v === 'object' && !Array.isArray(v)) rows.push(v); else bad++; } catch { bad++; }
  }
  return { missing: false, damaged: false, rows, bad };
};
// a reading as budget.mjs logs it: a time and the all-models figure
const isReading = e => !!e && typeof e === 'object' && !Array.isArray(e) && !Number.isNaN(Date.parse(e.t)) && typeof e.all === 'number';

// ---- texts ----
const ago = ms => (ms < 60000 ? 'under a minute' : ms < 90 * 60000 ? Math.round(ms / 60000) + ' min' : ms < 2 * DAY ? Math.round(ms / HOUR) + ' h' : Math.round(ms / DAY) + ' days');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Thu 26 Nov 11:00", in local time
const stamp = ms => { const d = new Date(ms); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const kindOf = e => (e.source === 'hook' ? (e.full ? 'automatic and full' : 'automatic') : 'full');
const labelOf = m => (m && MODELS[m] ? MODELS[m].label : 'the per-model meter');
const USAGE = 'type /pacing usage now';

// ---- what the checks share: the readings, the last one, the settings ----
const log = readLines(path.join(dataDir, 'log.jsonl'));
const readings = log.rows.filter(isReading);
const logLast = readings.at(-1) || null;
const stateRead = readJson(path.join(dataDir, 'state.json'));
const state = isReading(stateRead.value) ? stateRead.value : null;
// the newest of the two: state.json holds the last reading, the log every one
const last = state && (!logLast || Date.parse(state.t) >= Date.parse(logLast.t)) ? state : logLast;
let loaded;
try { loaded = loadConfig(checkConfig); } catch { loaded = { cfg: {}, problems: ['it does not read'], missing: false, damaged: true }; }
const cfg = loaded.cfg || {};

// ---- the plugin's version against the copies the desktop app installed ----
// The app keeps them under %LOCALAPPDATA%\Claude-Data\<app>\rpm\<a>\<b>\, a
// manifest.json beside a plugin_<id> folder per plugin. Not found: skipped.
const versionParts = v => String(v).split(/[.+-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
const newer = (a, b) => {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined) return false;
    if (y[i] === undefined) return true;
    return typeof x[i] === typeof y[i] ? x[i] > y[i] : typeof x[i] === 'number';
  }
  return false;
};
const subdirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)); } catch { return []; } };
const installedCopies = () => {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Data');
  const found = [];
  for (const app of subdirs(base)) {
    for (const b of subdirs(path.join(app, 'rpm')).flatMap(subdirs)) {
      if (!fs.existsSync(path.join(b, 'manifest.json'))) continue;
      for (const p of subdirs(b).filter(d => path.basename(d).startsWith('plugin_'))) {
        const m = readJson(path.join(p, '.claude-plugin', 'plugin.json')).value;
        if (m && m.name === 'pacing' && typeof m.version === 'string') found.push({ version: m.version, folder: p });
      }
    }
  }
  return found;
};
const checkVersion = () => {
  // scripts/ -> skills/pacing -> skills -> the plugin root
  const own = readJson(path.join(here, '..', '..', '..', '.claude-plugin', 'plugin.json')).value;
  const running = own && typeof own.version === 'string' ? own.version : null;
  if (!running) return { status: 'fail', found: 'the plugin\'s own plugin.json does not read', fix: 'reinstall pacing from the app\'s plugin list' };
  const copies = installedCopies();
  if (!copies.length) return { status: 'ok', found: 'running ' + running + '; no installed copy found to compare', running };
  const newest = copies.reduce((a, b) => (newer(b.version, a.version) ? b : a)).version;
  if (newer(newest, running)) return { status: 'warn', found: 'running ' + running + ', but ' + newest + ' is installed', fix: 'type /reload-plugins or open a new session', running, installed: newest };
  return { status: 'ok', found: 'running ' + running + ', the app holds ' + newest, running, installed: newest };
};

// ---- the hooks module: a reading it took (source 'hook') in the last 24 h ----
const checkHooks = () => {
  const t = recentHookReading(now);
  if (t !== null) return { status: 'ok', found: 'it took a reading ' + ago(Math.max(0, now - t)) + ' ago' };
  const any = readings.filter(e => e.source === 'hook').at(-1);
  return { status: 'warn', found: any ? 'its last reading was ' + ago(now - Date.parse(any.t)) + ' ago' : 'no automatic reading in the log',
    fix: 'turn pacing on in the plugin list' };
};

// ---- the last reading: its age and its kind ----
const checkReading = () => {
  if (!last) return { status: 'warn', found: stateRead.damaged ? 'state.json does not parse, and the log has no reading' : 'no reading yet', fix: USAGE };
  const age = now - Date.parse(last.t), kind = kindOf(last);
  const facts = { at: last.t, kind };
  if (stateRead.damaged) return { status: 'warn', found: 'state.json does not parse; the log\'s last is ' + ago(Math.abs(age)) + ' old', fix: USAGE + ' to rewrite it', ...facts };
  if (age < -5 * 60000) return { status: 'warn', found: 'the last is dated ' + ago(-age) + ' ahead of now', fix: 'check the computer\'s clock', ...facts };
  if (age > 2 * HOUR) return { status: 'warn', found: 'the last is ' + ago(age) + ' old, ' + kind, fix: USAGE + ' for a fresh one', ...facts };
  return { status: 'ok', found: 'the last is ' + ago(Math.max(0, age)) + ' old, ' + kind, ...facts };
};

// ---- the per-model meter: when it was last read. An automatic reading that
//      did not read it carries the last figure over (premiumAt says from when) ----
const checkPremium = () => {
  const premium = cfg.premium === undefined ? 'fable' : cfg.premium;
  if (premium === null) return { status: 'ok', found: 'none: the settings say the plan has no per-model meter' };
  if (!last) return { status: 'ok', found: 'no reading yet: nothing to check' };
  const label = labelOf(last.premiumModel || premium);
  if (last.premiumOut || last.fableOut) return { status: 'ok', found: label + ' is out until the reset' };
  const figure = last.premium ?? last.fable;
  if (typeof figure !== 'number') return { status: 'warn', found: label + ' not read this week yet', fix: USAGE + ' to read it' };
  if (!last.premiumAt) return { status: 'ok', found: label + ' read ' + ago(Math.max(0, now - Date.parse(last.t))) + ' ago, at ' + figure + ' %', readAt: last.t };
  const carried = now - Date.parse(last.premiumAt);
  if (carried > 6 * HOUR) return { status: 'warn', found: label + ' carried over for ' + ago(carried) + ', at ' + figure + ' %', fix: USAGE + ' to read it', readAt: last.premiumAt };
  return { status: 'ok', found: label + ' read ' + ago(Math.max(0, carried)) + ' ago, carried over since', readAt: last.premiumAt };
};

// ---- the week: the reset ahead, and the log in the same week as state.json
//      (within an hour: the API's reset time jitters) ----
const checkWeek = () => {
  if (!last) return { status: 'ok', found: 'no reading yet: nothing to check' };
  const reset = Date.parse(last.reset);
  if (Number.isNaN(reset)) return { status: 'warn', found: 'the last reading has no reset time', fix: USAGE };
  if (reset <= now) return { status: 'warn', found: 'the week reset ' + stamp(reset) + ', no reading since', fix: USAGE + ' to start the new one', reset: last.reset };
  if (state && logLast && Math.abs(Date.parse(logLast.reset) - Date.parse(state.reset)) > HOUR) {
    return { status: 'warn', found: 'the log\'s week ends ' + stamp(Date.parse(logLast.reset)) + ', state.json\'s ' + stamp(Date.parse(state.reset)), fix: USAGE, reset: last.reset };
  }
  return { status: 'ok', found: 'resets ' + stamp(reset) + ', in ' + ago(reset - now) + (state && logLast ? '; the log agrees' : ''), reset: last.reset };
};

// ---- the settings: config.json parses, each value is one the commands
//      write (models.mjs checkConfig), and no key is unknown ----
const checkSettings = () => {
  if (loaded.missing) return { status: 'ok', found: 'no config.json yet: the defaults stand' };
  if (loaded.damaged) return { status: 'fail', found: 'config.json does not parse; the defaults stand in', fix: 'type /pacing reset: it rewrites it and keeps a copy' };
  const unknown = Object.keys(cfg).filter(k => !SETTINGS.includes(k) && !RETIRED.includes(k));
  const problems = loaded.problems.map(p => p.replace(/: the default(s are| is) used$/, ''));
  if (problems.length || unknown.length) {
    const found = [problems.length ? problems[0] + (problems.length > 1 ? ', and ' + (problems.length - 1) + ' more' : '') : '',
      unknown.length ? 'unknown setting' + (unknown.length > 1 ? 's: ' : ': ') + unknown.join(', ') : ''].filter(Boolean).join('; ');
    return { status: 'warn', found, fix: problems.length ? 'type /pacing setup to set it again' : 'remove it from config.json: nothing reads it', problems: loaded.problems, unknown };
  }
  const onOff = v => (v === false ? 'off' : 'on');
  return { status: 'ok', found: 'compact ' + onOff(cfg.compactAsk) + ', notify ' + onOff(cfg.agentNotices) + ', switch ' + onOff(cfg.switchAsk)
    + ', reload ' + onOff(cfg.autoReload) + ', ' + (cfg.tiers ? cfg.tiers.length : 3) + ' tiers' };
};

// ---- the token rate (rate.json): dollars per point of the weekly meter, by
//      budget.mjs's rule: this week's from a rise of 5 points, else the one
//      carried from last week, else this week's from 2 points. A file
//      without v: 2 holds 0.9.15's raw tokens per point, which budget.mjs
//      drops at its next reading. ----
const usdText = n => '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
const checkRate = () => {
  const r = readJson(path.join(dataDir, 'rate.json'));
  if (r.missing) return { status: 'ok', found: 'not learned yet', learned: false };
  const v = r.value, fin = x => typeof x === 'number' && Number.isFinite(x);
  if (!r.damaged && v && typeof v === 'object' && !Array.isArray(v) && v.v !== 2) return { status: 'ok', found: 'not learned yet (an older rate was dropped)', learned: false };
  if (r.damaged || !v || typeof v !== 'object' || !fin(v.from) || !fin(v.to) || !fin(v.usd)) {
    return { status: 'warn', found: 'rate.json does not parse', fix: USAGE + ' to start it afresh', learned: false };
  }
  const rise = Math.round((v.to - v.from) * 10) / 10, carried = fin(v.carried) && v.carried > 0 ? v.carried : null;
  const points = rise + (rise === 1 ? ' point' : ' points');
  const learned = (usd, how, pts) => ({ status: 'ok', found: 'learned, ' + usdText(usd) + ' per point, ' + how, learned: true, usdPerPoint: Math.round(usd * 1e4) / 1e4, points: pts });
  if (rise >= 5 && v.usd > 0) return learned(v.usd / rise, 'from ' + points + ' this week', rise);
  if (carried) return learned(carried, 'carried from last week', null);
  if (rise >= 2 && v.usd > 0) return learned(v.usd / rise, 'from only ' + points + ' so far', rise);
  // before that, budget.mjs's estimate from this week's transcripts
  const e = v.estimate;
  if (e && fin(e.usd) && e.usd > 0 && fin(e.points) && e.points > 0) {
    return { status: 'ok', found: 'estimated, ' + usdText(e.usd / e.points) + ' per point, from this week\'s transcripts; learning it: ' + points + ' so far', learned: false, estimated: true, usdPerPoint: Math.round(e.usd / e.points * 1e4) / 1e4, points: rise };
  }
  return { status: 'ok', found: 'not learned yet: ' + points + ' this week so far', learned: false, points: rise };
};

// ---- the agent records of this project: each finished task of a role agent ----
const checkAgents = () => {
  const f = agentsLog(root), name = 'agents/' + projectSlug(root) + '.jsonl';
  const a = readLines(f);
  if (a.missing) return { status: 'ok', found: 'no agent recorded for this project yet', file: f };
  if (a.damaged) return { status: 'warn', found: name + ' does not read', fix: 'check that the file is not locked or damaged', file: f };
  const partial = a.rows.filter(x => !(typeof x.tokens === 'number' && Number.isFinite(x.tokens)) || !EFFORTS.includes(x.effort)).length;
  if (a.bad || partial) {
    const found = [a.bad ? a.bad + (a.bad === 1 ? ' line does' : ' lines do') + ' not parse' : '',
      partial ? partial + ' of ' + a.rows.length + ' records lack a token count or effort' : ''].filter(Boolean).join('; ');
    return { status: 'warn', found, fix: 'remove those lines from ' + name, file: f, records: a.rows.length, bad: a.bad, partial };
  }
  const latest = a.rows.map(x => Date.parse(x.t)).filter(t => !Number.isNaN(t)).sort((x, y) => x - y).at(-1);
  return { status: 'ok', found: a.rows.length + (a.rows.length === 1 ? ' record' : ' records') + (latest ? ', the last ' + ago(Math.max(0, now - latest)) + ' ago' : ''), file: f, records: a.rows.length };
};

// ---- the folders: the data folder (config, log, state) and this project's
//      notes folder take a write. One not made yet is tried at the nearest
//      folder above it that exists: making it would need that write. ----
const writable = dir => {
  let at = dir;
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const tmp = path.join(at, '.pacing-doctor-' + process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.tmp');
  try { fs.writeFileSync(tmp, ''); fs.unlinkSync(tmp); return null; } catch (e) { try { fs.unlinkSync(tmp); } catch { /* never made */ } return e.code || 'error'; }
};
const checkFolders = () => {
  const folders = [['the data folder', dataDir], ['the notes folder', notesDir(root)]];
  for (const [what, dir] of folders) {
    const err = writable(dir);
    if (err) return { status: 'fail', found: 'cannot write in ' + what + ' (' + err + ')', fix: 'give your user write access to ' + dir, folder: dir };
  }
  return { status: 'ok', found: 'the data folder and the notes folder take writes' };
};

// ---- run them all: a check that throws is a finding too ----
const CHECKS = [['version', checkVersion], ['hooks', checkHooks], ['reading', checkReading], ['per-model', checkPremium], ['week', checkWeek],
  ['settings', checkSettings], ['token rate', checkRate], ['agents', checkAgents], ['folders', checkFolders]];
const checks = CHECKS.map(([name, fn]) => {
  try { const r = fn(); return { name, status: r.status, found: r.found, fix: r.fix || null, ...Object.fromEntries(Object.entries(r).filter(([k]) => !['status', 'found', 'fix'].includes(k))) }; } catch (e) {
    return { name, status: 'warn', found: 'could not check: ' + (e && e.message ? e.message : String(e)), fix: 'run it again; if it stays, report it' };
  }
});
const counts = { ok: 0, warn: 0, fail: 0 };
for (const c of checks) counts[c.status]++;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const summary = !counts.warn && !counts.fail ? 'All ' + checks.length + ' checks pass.'
  : [counts.warn ? plural(counts.warn, 'warning') : '', counts.fail ? plural(counts.fail, 'failure') : ''].filter(Boolean).join(', ') + ': see above.';

if (asJson) console.log(JSON.stringify({ checks, counts, summary }));
else {
  for (const c of checks) console.log(c.status.padEnd(4) + '  ' + c.name.padEnd(10) + '  ' + c.found + (c.fix ? ' -> ' + c.fix : ''));
  console.log(summary);
}
process.exitCode = counts.fail ? 1 : 0;
