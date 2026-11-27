import { paneView, TASK_MARKS } from './pane.mjs';

// Automatic readings: after a turn, the engine hands this module the session's
// rate-limit windows (session.measure). When the weekly all-models window
// moved a whole point, or 10 min passed, it runs budget.mjs --source hook,
// which logs the reading, keeps state.json fresh for the next session's start
// line, and answers in one JSON line. The status line shows the result, each
// tier marked by a coloured circle, and a change of level one toast:
//
//   Budget tokens: 850K, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (36% Weekly, 40% Fable)
//
// The tier shares are this session's own use: every turn's tokens, the
// subagents' included (turn.complete), priced per model and summed by the
// tier each model holds on the ladder. An estimate: the weekly meter weighs
// models as the prices do, but is not counted in dollars.
//
// Declared in readings.json, a hooks file of its own beside hooks.json, so an
// engine that does not know modules can lose this file and still run the
// SessionStart hook. Nothing goes into the system prompt: a section that
// changed every turn would break the prompt cache. The per-model meter
// (Weekly · Fable) and extra usage are not in what the engine hands a plugin:
// the module reads them itself through the desktop app's usage tool (see
// "every meter, read by the module itself"), and where that tool does not
// answer budget.mjs carries the per-model figure over from the last reading.
//
// A warning after a pause: a long session costs most right after a break.
// Once the prompt cache has expired, the next turn stores the whole history
// again at the write price. When the user submits a prompt after such a pause
// and the session holds 300 000 tokens or more, one toast says so, once per
// pause. It shows as the prompt is submitted, before the request goes out.
// Where the engine has the question dialog and the offers are on, the dialog
// takes its place and offers to compact first (see "an offer to compact"):
// the prompt waits for the answer and then goes on exactly as typed.

// a reading at least this often while turns run: each takes off what every
// local session spent since the meter last moved (budget.mjs), so "Budget
// tokens" in every session follows the spending within minutes
const MIN_GAP = 10 * 60 * 1000;

// ---- a toast by its kind ----
// A toast takes a text and how long it stays, nothing else: no colour, no
// icon, no style (ToastOptions). So each toast leads with one emoji for its
// kind, the same everywhere, and its colour carries the urgency. It stands
// where "Pacing: " stood: the toast's box is drawn under the plugin's name
// already. The widths (MSG_MAX) count it. The row above the prompt for the
// same matter leads with the same icon.
export const ICON = {
  started: '▶️', // an agent or a side session started
  done: '✅', // one finished
  still: '⏳', // still running: the 5-minute toast, the background row
  worse: '⚠️', // over the budget line, far over, or the per-model meter over its line
  stop: '🔴', // the week nearly used, or the per-model meter's model out
  better: '🟢', // on or under the budget line again
  switched: '🔁', // the session's model or effort switched, or a switch on offer
  failed: '❌', // what did not happen: a switch that did not take, a compaction that did not run
  waiting: '📦', // a new version waiting for /reload-plugins
  compacted: '🗜️', // compacted, or a compaction on offer
  pause: '💤', // the cache lapsed, or is about to, in a pause
  room: '💡', // allowance that goes unused at the reset
};
// Routine toasts (started, still running, a switch or a compaction the
// person just pressed for) stay the engine's 4 seconds; what should not be
// missed stays TOAST_LONG: finished, a change of level, anything that did
// not happen or needs a key, a new version, the notice after a pause.
export const TOAST_LONG = 15000;
// the icon of a reading's state: stop or the model out, over the line, within it
export const levelIcon = j => (j.level === 'stop' || j.premiumOut ? ICON.stop
  : j.level === 'over' || j.level === 'throttle' || j.premiumHeld ? ICON.worse : ICON.better);
// The engine tells a module nothing of the cache's lifetime (only a model
// switch and a resumed session's start hear of it): an hour is assumed.
const CACHE_TTL = 60 * 60 * 1000;
const PAUSE_SIZE = 300000;
// prompts nobody typed: a pause before one is not the user's to act on, and a
// warning there would use up the one the user should see
// (a plugin's prompt counts as typed only when it carries the user's own words)
const UNATTENDED = ['task-notification', 'scheduled-trigger', 'auto-continuation', 'peer', 'peer-send-message', 'coordinator', 'observer', 'observer-activity', 'plugin'];
export const unattended = o => !!o && UNATTENDED.includes(o.kind) && !(o.kind === 'plugin' && o.asUser);

// "1 h 25 min"
const span = ms => {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return (h ? h + ' h' : '') + (h && m % 60 ? ' ' : '') + (m % 60 || !h ? (m % 60) + ' min' : '');
};
// the line after a pause, or null when the session is small or the cache warm
export const pauseNote = (tokens, idleMs) => (tokens >= PAUSE_SIZE && idleMs >= CACHE_TTL
  ? ICON.pause + ' this session is ' + Math.round(tokens / 1000) + 'k tokens and sat idle ' + span(idleMs)
    + ', so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.'
  : null);

// ---- an offer to compact ----
// A large session pays for its size on every turn: each turn sends the whole
// history again (at the cache's read price while it is warm, at the write
// price once it has lapsed). So the module offers to compact, at three levels:
//   suggest  from 400 000 tokens, once a turn has ended: one calm line in the
//            band above the prompt, with Compact now and Not now. It never
//            interrupts and stays until answered or the next prompt.
//   urge     from 650 000 tokens: the same band, plainer words, the cost, and
//            the warning colour.
//   now      a session of 300 000 tokens or more left idle: the same band in
//            the warning colour, 10 minutes before the cache lapses and again
//            once it has, so the person can compact before the next turn pays
//            to store it all again. Timers set when a turn ends; any prompt
//            ends them.
// Why not ask when the prompt is sent: the engine refuses a compaction from a
// prompt.submit hook ("it would compact under the turn this hook is
// holding"), so the prompt cannot be held for one, and resending it would
// lose what came with it. The notice after a pause still shows then, as
// before, unless the row already said it for that pause. No dialog: the
// question dialog interrupts, and one raised while nobody is there resolves
// itself when the person is away.
// Once per level; again only after the session grew by a further 250 000
// tokens (it was 100 000 until 0.9.29: a row every 100 000 tokens and at
// every pause came too often). So between two compactions the size is
// offered at 400 000, 650 000 and 900 000. A pause is told once per such
// step too, as the row or as the notice at the next prompt, whichever comes:
// a second pause at about the same size is not told again (pauseDue).
// Never while a turn runs, never in a
// subagent, and only once a person has typed in the session (a side session
// another session drives has nobody to ask). `/pacing compact off` turns the
// offers off; the pause notice then shows as it did before them. An engine
// without the band, the timers or $.session.compact keeps the notice too.
export const SUGGEST_AT = 400000;
export const URGE_AT = 650000;
export const OFFER_STEP = 250000;
export const COMPACT_INSTRUCTIONS = 'Keep what this session must not lose: the goal; the decisions made and why; '
  + 'the open items, in order; the files and commands that matter; what was tried and ruled out.';
const kTok = n => Math.round(n / 1000) + 'k';
// the band's level for a session of this size, or null
export const offerLevel = tokens => (tokens >= URGE_AT ? 'urge' : tokens >= SUGGEST_AT ? 'suggest' : null);
// whether a level may be offered now, given the size at its last offer
// A compaction pacing did not hear: the session's context fell by half or
// more, and by 50 000 tokens or more, between two measures. Live, another
// plugin's hook on session.compact runs first and skips pacing's, so a
// /compact the person types is not seen; a /clear is the same to the offers.
export const COMPACT_DROP = 50000;
export const compactedBetween = (before, after) => typeof before === 'number' && typeof after === 'number'
  && before - after >= COMPACT_DROP && after <= before / 2;
export const offerDue = (level, tokens, offered) => !!level && (offered[level] == null || tokens >= offered[level] + OFFER_STEP);
// whether a pause may be told (row or notice): the first at this size, the
// same pause again (before the lapse, then after it), or 250 000 tokens on
export const pauseDue = (tokens, pause, offered) => offered.now == null || (pause != null && offered.nowPause === pause)
  || (typeof tokens === 'number' && tokens >= offered.now + OFFER_STEP);
export const offerText = (level, tokens) => (level === 'urge'
  ? 'This session is ' + kTok(tokens) + ' tokens, and every turn sends all ' + kTok(tokens) + ' again. Compact now to cut that.'
  : 'This session is ' + kTok(tokens) + ' tokens. Compacting now makes every later turn cheaper.');
// now: the cache lapses LAPSE_LEAD before it does, and once it has
export const LAPSE_LEAD = 10 * 60 * 1000;
export const nowText = (tokens, lapsed) => (lapsed
  ? 'This session is ' + kTok(tokens) + ' tokens and its cache has lapsed, so the next turn stores all of it again. Compacting first is cheaper.'
  : 'This session is ' + kTok(tokens) + ' tokens, and its cache lapses in about ' + Math.round(LAPSE_LEAD / 60000) + ' minutes. Then the next turn stores all of it again. Compacting now is cheaper.');
export const compactedText = (before, after) => (before && after
  ? ICON.compacted + ' compacted from ' + kTok(before) + ' to ' + kTok(after) + ' tokens.'
  : ICON.compacted + ' compacted.');
// Compact now that the engine refused: its reason (one line, 120 characters
// at most), and /compact in the box to send, where the box took it
export const compactFailedText = (reason, filled) => {
  // the engine's words may carry the plugin's name already ("pacing: $.session…")
  const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().replace(/^pacing:\s*/i, '') : '';
  const short = why.length > 120 ? why.slice(0, 119) + '…' : why;
  return ICON.failed + ' the compaction did not start' + (short ? ': ' + short.replace(/[.\s]+$/, '') : '') + '. '
    + (filled ? '/compact is in the box: press Enter to send it.' : 'Type /compact to run it.');
};
// the setting in config.json: on unless it says false
export const compactAskOf = text => { try { return JSON.parse(text).compactAsk !== false; } catch { return true; } };

// ---- pacing's own files ----
// config.json, state.json and line.json lie in ~/.claude/pacing. Seven
// functions each asked the engine for the home folder and read a file
// there, and a main thread's turn end read config.json two or three times,
// once per toggle that asked. Now the home folder is asked for once per load
// of the module (`pf.home`; one not found is asked for again), every file
// is read through pacingFile, and config.json through configOf alone, which
// keeps what it read for CONFIG_FRESH by the engine's clock. A main
// thread's turn end starts it over first (configStale): the turn may have
// changed a setting (`/pacing compact off`), which then holds at that
// turn's end already, read once for all its toggles. Elsewhere a change (in
// another session, or by hand) holds within CONFIG_FRESH. No file reads as
// {} and is kept as long: most people have none. An engine without a clock
// reads the file each time, as before.
export const CONFIG_FRESH = 3000;
const pf = { home: null, config: null, at: 0 };
// Claude Code's folder: CLAUDE_CONFIG_DIR where it is set (the scripts
// follow it too, paths.mjs), else ~/.claude
async function homeOf($) {
  if (pf.home) return pf.home;
  let dir = null;
  try { dir = await $.env.get('CLAUDE_CONFIG_DIR'); } catch { /* not set */ }
  if (!dir) {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (home) dir = home + '/.claude';
  }
  if (dir) pf.home = dir;
  return dir || null;
}
// one of pacing's files as text; throws without a home folder or the file
async function pacingFile($, name) {
  const dir = await homeOf($);
  if (!dir) throw new Error('no home folder');
  return $.fs.read(dir + '/pacing/' + name);
}
function configStale() { pf.config = null; }
// config.json as it stands, or {}
async function configOf($) {
  let now = null;
  try { now = await $.clock.now(); } catch { /* no clock: read each time */ }
  if (pf.config && now !== null && now >= pf.at && now - pf.at < CONFIG_FRESH) return pf.config;
  let c = {};
  try {
    const v = JSON.parse(await pacingFile($, 'config.json'));
    if (v && typeof v === 'object' && !Array.isArray(v)) c = v;
  } catch { /* none, or not to be read: every setting at its default */ }
  if (now !== null) { pf.config = c; pf.at = now; }
  return c;
}
// a toggle of config.json: on unless it says false; any failure: on
async function settingOn($, key) { try { return (await configOf($))[key] !== false; } catch { return true; } }
// the offers to compact (compactAsk)
async function compactAskOn($) { return settingOn($, 'compactAsk'); }

// what budget.mjs is run with for a reading from the hooks module; `dry`
// computes from given figures and logs nothing. `m` is every meter the
// module read itself (usageOf): the per-model figure (- where the plan has
// no such window), the context and its categories, extra usage, and the
// session's model, as the skill's own reading hands them over. `spent`: the
// dollars this session spent since its last reading that ran (spentUsd;
// budget.mjs learns the dollars per point of the weekly meter from them).
export const readingArgv = (root, all, reset, five, fiveReset, dry, m = null, session = null, spent = 0) => ["node", root + "/skills/pacing/scripts/budget.mjs",
  "--all", String(all), "--reset", reset, "--source", "hook",
  ...(typeof five === "number" ? ["--five", String(five), ...(fiveReset ? ["--five-reset", fiveReset] : [])] : []),
  ...(m ? ["--premium", m.premium === null ? "-" : String(m.premium),
    ...(m.context !== null ? ["--context", String(m.context)] : []),
    ...(m.contextTokens !== null ? ["--context-tokens", String(m.contextTokens)] : []),
    ...(m.categories ? ["--categories", m.categories] : []),
    ...(m.extra ? ["--extra-spent", String(m.extra.spent), "--extra-limit", String(m.extra.limit), ...(m.extra.currency ? ["--extra-currency", m.extra.currency] : [])] : []),
    ...(session ? ["--session", session] : [])] : []),
  ...(!dry && Math.round(spent * 1e6) > 0 ? ["--spent-usd", String(Math.round(spent * 1e6) / 1e6)] : []),
  ...(dry ? ["--dry"] : [])];
// the last reading budget.mjs stored for the start line (state.json), or null
async function storedReading($) {
  try { return JSON.parse(await pacingFile($, 'state.json')); } catch { return null; }
}

// ---- every meter, read by the module itself ----
// The engine hands a plugin the all-models and 5-hour windows only. The
// desktop app's own usage tool has the rest: the per-model window, extra
// usage, the context and its categories. The module calls it like a tool
// ($.tool.call: no dialog, no model tokens) whenever a reading is due, and
// hands budget.mjs what the skill's own reading hands it. That is an
// automatic reading that is a full one: "(auto, full)" in `/pacing log`,
// `full: true` in the log. Then the per-model figure is never a carried one,
// and nothing asks the session for a reading (fullReadingAsk is not sent).
// Not a documented interface, the desktop app's alone: where the tool is
// absent, fails or reads as nothing (a terminal session without the app),
// the reading is the plain one from the two windows the engine gave, the
// figure carried and the note included, as before.
// No more often than before: when the weekly window moved a whole point, 30
// minutes passed, or the module loaded; and once when a subagent's run ends,
// if the last reading is AGENT_GAP old (its work moved the meters, and no
// response of the main thread has said so yet).
export const USAGE_TOOL = 'mcp__ccd_session_mgmt__get_usage';
export const AGENT_GAP = 5 * 60 * 1000;
const amount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// The texts of a tool's answer as a module gets it, in the order they are
// tried: `text`, then each text of `result`, the tool's content (an array of
// { type, text }, or an object holding one as `content`). The usage tool's
// and the sessions list's answers are both read through it.
export const textsOf = res => {
  const texts = [];
  if (res && typeof res.text === 'string') texts.push(res.text);
  const r = res && res.result;
  const content = Array.isArray(r) ? r : r && Array.isArray(r.content) ? r.content : [];
  for (const c of content) if (c && typeof c.text === 'string') texts.push(c.text);
  return texts;
};
// a reset time as budget.mjs takes it (ISO 8601): a date as written, or
// from seconds or milliseconds since the epoch
const isoOf = v => {
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : typeof v === 'string' && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? (typeof v === 'string' ? v : d.toISOString()) : null;
};
// Every meter of a get_usage answer, or null when it reads as nothing or has
// no weekly window. A live answer: `text`, JSON, and `result`, the tool's
// content as an array of { type, text }. In it `plan.windows[]` (`label`:
// "5-hour limit", "Weekly · all models", "Weekly · Fable"; `percentUsed`,
// `resetsAt`), `plan.extraUsage` (`enabled`, `spent`, `monthlyLimit`,
// `currency`) and `context` (`tokensUsed`, `percentUsed`, `categories[]` of
// `name`, `tokens`). `premium` is config.json's per-model meter (a model's
// short name; null: the plan has none).
export const usageOf = (res, premium = 'fable') => {
  for (const t of textsOf(res)) {
    let v;
    try { v = JSON.parse(t); } catch { continue; }
    const windows = v && v.plan && Array.isArray(v.plan.windows) ? v.plan.windows.filter(w => w && typeof w.label === 'string') : [];
    const by = test => windows.find(w => test(w.label.toLowerCase()));
    const week = by(l => l.startsWith('weekly') && l.includes('all models'));
    if (!week || !amount(week.percentUsed) || !isoOf(week.resetsAt)) continue;
    const five = by(l => l.startsWith('5-hour'));
    const prem = premium ? by(l => l.startsWith('weekly') && !l.includes('all models') && l.includes(String(premium).toLowerCase())) : null;
    const ctx = v.context && typeof v.context === 'object' ? v.context : {};
    // a name with a comma would split in two on budget.mjs's side
    const cats = (Array.isArray(ctx.categories) ? ctx.categories : []).filter(c => c && typeof c.name === 'string' && c.name.trim() && amount(c.tokens))
      .map(c => c.name.replace(/[,=\s]+/g, ' ').trim() + '=' + Math.round(c.tokens));
    const x = v.plan.extraUsage;
    return {
      all: week.percentUsed, reset: isoOf(week.resetsAt),
      premium: prem && amount(prem.percentUsed) ? prem.percentUsed : null,
      five: five && amount(five.percentUsed) ? five.percentUsed : null, fiveReset: five ? isoOf(five.resetsAt) : null,
      context: amount(ctx.percentUsed) ? ctx.percentUsed : null, contextTokens: amount(ctx.tokensUsed) ? ctx.tokensUsed : null,
      categories: cats.length ? cats.join(',') : null,
      extra: x && x.enabled === true && amount(x.spent) && amount(x.monthlyLimit) ? { spent: x.spent, limit: x.monthlyLimit, currency: typeof x.currency === 'string' ? x.currency : '' } : null,
    };
  }
  return null;
};
// every meter as the app's usage tool has them now, or null (see above)
async function metersNow($) {
  try {
    const c = await configOf($);
    return usageOf(await $.tool.call({ tool: USAGE_TOOL }), c.premium === undefined ? 'fable' : c.premium);
  } catch { return null; }
}
// the two windows the engine holds from the last response, where it has any
async function limitsNow($) {
  try {
    const limits = (await $.session.usage()).rateLimits || [];
    return { week: limits.find(r => r.kind === 'seven_day'), five: limits.find(r => r.kind === 'five_hour') };
  } catch { return {}; }
}
// One logged reading by budget.mjs, answered as its JSON line, or null. With
// every meter where the usage tool answers; else, or should budget.mjs
// refuse those figures, from the two windows the engine gave (`week`,
// `five`), where it gave any. `spend` ({ total, sent }: the session's dollars
// so far and as far as a reading took them) hands budget.mjs the dollars
// since, and counts them sent once a reading ran.
async function runReading($, week, five, session, spend = null, health = null) {
  const total = spend ? spend.total : 0;
  const spent = spend ? total - spend.sent : 0;
  const run = async argv => {
    let r, j = null;
    try { r = await $.process.run(argv, { timeoutMs: 20000 }); } catch (err) { readingFailed(health, err && err.message); throw err; }
    if (r.exitCode !== 0) {
      // budget.mjs refuses a reset that has passed. The engine holds the last
      // response's windows, so between the weekly reset and the next response
      // the one it names has: there is nothing to read then, and nothing failed
      const why = lastLineOf(r.stderr) || lastLineOf(r.stdout);
      if (!RESET_PASSED.test(why)) readingFailed(health, why);
    } else { try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (err) { readingFailed(health, 'its answer could not be read'); throw err; } }
    if (j) { readingCame(health); if (spend) spend.sent = total; }
    return j;
  };
  const plain = () => (week && week.resetsAt
    ? run(readingArgv($.plugin.root, week.percentUsed, week.resetsAt, five && five.percentUsed, five && five.resetsAt, false, null, null, spent)) : null);
  const m = await metersNow($);
  if (!m) return plain();
  const own = m.five !== null;
  let j = null;
  try {
    j = await run(readingArgv($.plugin.root, m.all, m.reset, own ? m.five : five && five.percentUsed, own ? m.fiveReset : five && five.resetsAt, false, m, session, spent));
  } catch { /* the plain one */ }
  return j || plain();
}
// How the readings go, in `health` ({ fails, why, told }): a run of budget.mjs
// that failed (an exit code, a timeout, an answer that does not parse) is
// counted, and one that answers starts the count over. A reading that fails
// leaves the status line as it was, and it gave no sign of that: a broken
// budget.mjs or state file froze the line on figures days old. After
// FAIL_SAY failures in a row the line leads with a mark (staleLine), the
// pane says so, and one toast names /pacing-doctor.
export const FAIL_SAY = 3;
const RESET_PASSED = /^no reading was taken: --reset \S+ has passed/;
const lastLineOf = text => (typeof text === 'string' ? (text.trim().split('\n').pop() || '').trim() : '');
function readingFailed(health, why) {
  if (!health) return;
  health.fails++;
  const w = typeof why === 'string' ? why.replace(/\s+/g, ' ').trim() : '';
  health.why = w.length > 80 ? w.slice(0, 79) + '…' : w;
}
function readingCame(health) { if (health) { health.fails = 0; health.why = ''; health.told = false; } }
export const readingsFail = health => !!health && health.fails >= FAIL_SAY;
export const failedText = (n, why) => ICON.failed + ' pacing could not take a reading, ' + n + ' tries in a row' + (why ? ' (' + why.replace(/[.\s]+$/, '') + ')' : '')
  + ': the status line shows older figures. /pacing-doctor says what is wrong.';
export const FAILED_NOTE = 'The readings fail: these figures are older. /pacing-doctor says what is wrong.';
// the line with a mark in front while the readings fail, where it has room
export const staleLine = (text, max = LINE_MAX) => {
  for (const lead of ['⚠️ old figures · ', '⚠️ ']) if ((lead + text).length <= max) return lead + text;
  return text;
};
function sayFailing($, health) {
  if (!readingsFail(health) || health.told) return;
  health.told = true;
  try { $.ui.toast(failedText(health.fails, health.why), { timeoutMs: TOAST_LONG }); } catch { /* an engine without toasts */ }
}
// One reading at a time, taken in one place. `rd` is the session's own
// ({ running, health, spend, un, session(), held(), hold(j), setLast(v) }).
// The flag is set and cleared here alone: this was written out five times,
// the copies had drifted, and one cleared a flag another had set, so two
// readings ran at once and handed budget.mjs the same dollars twice. Answers
// the reading taken in (the level and what goes unused said, `last` set), or
// null: one runs already, or none came. Never throws. `lastFirst` counts the
// try as the last reading before it runs (a measure's: a failed one is not
// tried again until the meter moves or MIN_GAP passes).
async function takeReading($, rd, { at, week, five, lastFirst = false } = {}) {
  if (rd.running) return null;
  rd.running = true;
  try {
    if (week === undefined) ({ week, five } = await limitsNow($));
    const pct = week && week.resetsAt ? week.percentUsed : null;
    if (lastFirst) rd.setLast({ pct, at });
    const j = await runReading($, week, five, rd.session(), rd.spend, rd.health);
    if (j) {
      rd.setLast({ pct: pct !== null ? pct : j.all, at });
      sayLevel($, rd.held(), j, rd.session());
      rd.hold(j);
    }
    return j;
  } catch { return null; } finally { rd.running = false; sayFailing($, rd.health); }
}
const kText = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));

// ---- what fills the session's context ----
// The engine breaks the window down by category as /context does
// ($.session.usage({ breakdown: 'summary' }): estimated locally, no request
// sent). /pacing-status shows it in lines: the total against the window and
// where it compacts by itself, the Messages row's total, and the fixed parts
// (system prompt, tools, memory, skills) largest first. Categories are told
// apart by `kind`; the Messages row is the one the engine names so (its name
// is the only mark it has). No split of the large results: compacting is
// what the module offers when the session is large (the user's word).
export const contextLines = bd => {
  const lines = [];
  if (bd && typeof bd.totalTokens === 'number') {
    const max = bd.rawMaxTokens || bd.maxTokens;
    lines.push('Context: ' + kText(bd.totalTokens) + (max ? ' of ' + kText(max) + ' (' + Math.round(bd.percentage) + '%)' : '')
      + (bd.isAutoCompactEnabled && bd.autoCompactThreshold ? '; it compacts by itself at ' + kText(bd.autoCompactThreshold) : ''));
    const used = (bd.categories || []).filter(c => c.kind === 'used' && c.tokens > 0);
    const msgs = used.find(c => /^messages$/i.test(String(c.name)));
    if (msgs) lines.push('  Messages ' + kText(msgs.tokens));
    const rest = used.filter(c => c !== msgs).sort((a, b) => b.tokens - a.tokens);
    if (rest.length) lines.push('  ' + rest.map(c => c.name + ' ' + kText(c.tokens)).join(' · '));
  }
  return lines;
};
// the breakdown now, or null where the engine gives none
async function breakdownNow($) {
  try {
    const u = await $.session.usage({ breakdown: 'summary' });
    return (u && u.context && u.context.breakdown) || null;
  } catch { return null; }
}

// ---- Claude Code's auto-compact window ----
// Claude Code compacts a session by itself as it nears its auto-compact
// window, which /autocompact sets and the settings keep per model. The user
// wants it at 750 000 tokens. config.json's autoCompact says what pacing
// sets (config.mjs autocompact): a token count, 'auto' (Claude Code's own
// window) or 'off' (pacing leaves /autocompact alone). At a session's start,
// when its model changes and when the setting changes, the context breakdown
// says what Claude Code has, and where it differs /autocompact runs, once.
// A success says nothing (the user's word: few toasts; the pane's row shows
// the value); a failure is one toast per load of the module at most.
export const AUTO_COMPACT_DEFAULT = 750000;
// what /autocompact takes (models.mjs has the same bounds for config.mjs)
export const AUTO_COMPACT_MIN = 100000;
export const AUTO_COMPACT_MAX = 1000000;
// one press of the pane's − or +
export const AUTO_COMPACT_STEP = 50000;
// the setting as config.json holds it; a value config.mjs would refuse is the default
export const autoCompactOf = c => {
  const v = c && c.autoCompact;
  return v === 'auto' || v === 'off' ? v : Number.isInteger(v) && v >= AUTO_COMPACT_MIN && v <= AUTO_COMPACT_MAX ? v : AUTO_COMPACT_DEFAULT;
};
// Whether Claude Code has `want` already, by the breakdown `bd`. A window the
// settings set is the window measured against (rawMaxTokens), with the
// source 'settings'; 'auto' is any window the settings did not set. One from
// CLAUDE_CODE_AUTO_COMPACT_WINDOW (source 'env') outranks the settings, so
// /autocompact could not change it: that counts as had. Claude Code keeps the
// value set but measures against no more than the model's context window
// (`window`, where known): a 200k model set to 750 000 shows 200 000.
// The figure is where the session compacts: Claude Code compacts a buffer
// short of its window (about 32k: a 400k window compacts near 368k), so
// pacing sets the window that much higher (the user's word: the pane's
// numbers stay the point it compacts at). The buffer is the breakdown's own
// (its 'Autocompact buffer' row, kind 'buffer'), else AUTO_COMPACT_BUFFER.
export const AUTO_COMPACT_BUFFER = 33000;
export const autoCompactBuffer = bd => {
  const row = bd && Array.isArray(bd.categories) && bd.categories.find(c => c && c.kind === 'buffer');
  const b = row ? row.tokens : 0;
  return Number.isFinite(b) && b > 0 && b < 200000 ? Math.round(b) : AUTO_COMPACT_BUFFER;
};
// the window /autocompact gets for `want`, no more than it takes
export const autoCompactWindow = (want, buffer = AUTO_COMPACT_BUFFER) => Math.min(want + buffer, AUTO_COMPACT_MAX);
export const autoCompactHas = (bd, want, window = null) => {
  const source = bd && bd.autocompactSource;
  if (source === 'env') return true;
  if (want === 'auto') return source !== 'settings';
  const set = autoCompactWindow(want, autoCompactBuffer(bd));
  return source === 'settings' && bd.rawMaxTokens === (window > 0 ? Math.min(set, window) : set);
};
// The last token count the setting held ($.store, across sessions), so the
// pane's toggle back from Claude Code's own auto-compact returns to it;
// none kept is the default.
export const AUTO_COMPACT_LAST = 'autoCompactLast';
export const autoCompactLastOf = v => (Number.isInteger(v) && v >= AUTO_COMPACT_MIN && v <= AUTO_COMPACT_MAX ? v : AUTO_COMPACT_DEFAULT);
async function autoCompactLast($) {
  try { return autoCompactLastOf(await $.store.get(AUTO_COMPACT_LAST)); } catch { return AUTO_COMPACT_DEFAULT; }
}
async function autoCompactKeep($, v) {
  if (!Number.isInteger(v)) return;
  try { await $.store.set(AUTO_COMPACT_LAST, v); } catch { /* the default then */ }
}
// the pane's words for the setting
export const autoCompactText = v => (v === 'auto' ? 'Auto-compact: Claude Code\'s default' : 'Compact at ' + kText(v));
// `arg`: what /autocompact was given (the window, a buffer above `want`)
export const autoCompactFailedText = (want, why, arg = want) => {
  const w = String(why || '').replace(/\s+/g, ' ').trim();
  const short = w.length > 80 ? w.slice(0, 79) + '…' : w;
  return ICON.failed + ' Claude Code\'s auto-compact was not set to ' + (want === 'auto' ? 'its default' : kText(want))
    + (short ? ': ' + short.replace(/[.\s]+$/, '') : '') + '. /autocompact ' + arg + ' sets it.';
};
// config.mjs stores a press's value (it owns config.json)
export const autoCompactArgv = (root, v) => ['node', root + '/skills/pacing/scripts/config.mjs', 'autocompact', String(v)];
// /autocompact with `want`; whether it took. A failure is told once per
// load where `quiet` (the run at a start or a change), at every press else.
async function autoCompactRun($, ac, want, quiet, bd = null) {
  let why = '', arg = String(want);
  try {
    if (want !== 'auto' && !bd) bd = await breakdownNow($);
    if (want !== 'auto') arg = String(autoCompactWindow(want, autoCompactBuffer(bd)));
    const r = await $.command.run({ command: 'autocompact', args: arg });
    if (!commandFailed(r)) return true;
    why = (r && r.text) || '';
  } catch (err) { why = (err && err.message) || ''; }
  if (quiet && ac.told) return false;
  if (quiet) ac.told = true;
  try { $.ui.toast(autoCompactFailedText(want, why, arg), { timeoutMs: TOAST_LONG }); } catch { /* no toast */ }
  return false;
}
// The check. `ac` is what it reads and writes of the copy's memory (see
// register): `on` once a session started, `due` while the start's check
// waits for a breakdown, the model and the setting last checked (`model`,
// `want`), `told`, and `busy` while a check runs. `model`: the session's
// model as the caller knows it, or null (not known is no change).
async function autoCompactCheck($, ac, model) {
  if (!ac.on || ac.busy) return;
  ac.busy = true;
  try {
    const want = autoCompactOf(await configOf($));
    const same = !model || !ac.model || sameModel(ac.model, model) || sameModel(model, ac.model);
    if (!ac.due && want === ac.want && same) return;
    if (want !== ac.want) await autoCompactKeep($, want);
    if (want === 'off') { ac.want = want; ac.due = false; return; }
    let u = null;
    try { u = await $.session.usage({ breakdown: 'summary' }); } catch { /* none */ }
    const bd = (u && u.context && u.context.breakdown) || null;
    // none yet: the next turn's end asks again
    if (!bd) { ac.due = true; return; }
    ac.due = false;
    ac.want = want;
    if (model || !ac.model) ac.model = model || (typeof bd.model === 'string' ? bd.model : null);
    if (!autoCompactHas(bd, want, u.context.window)) await autoCompactRun($, ac, want, true, bd);
  } catch { /* the next start or change */ } finally { ac.busy = false; }
}
// A press on the pane's −, + or its toggle for Claude Code's own: config.json
// first, through config.mjs, then /autocompact with the new value. The token
// count it leaves for 'auto' is kept (autoCompactKeep). One press at a time.
async function autoCompactPress($, ac, v) {
  if (ac.pressing) return;
  ac.pressing = true;
  try {
    if (v === 'auto') { try { await autoCompactKeep($, autoCompactOf(await configOf($))); } catch { /* the last kept */ } }
    let r = null;
    try { r = await $.process.run(autoCompactArgv($.plugin.root, v), { timeoutMs: 20000 }); } catch { /* said below */ }
    if (!r || r.exitCode !== 0) {
      const why = String((r && r.stdout) || '').trim().split('\n')[0];
      $.ui.toast(ICON.failed + ' the auto-compact setting was not saved' + (why ? ': ' + why.replace(/[.\s]+$/, '') : '') + '.', { timeoutMs: TOAST_LONG });
      return;
    }
    configStale();
    await autoCompactKeep($, v);
    // the check at the next turn's end has nothing more to do
    ac.want = v;
    redraw($);
    await autoCompactRun($, ac, v, false);
  } catch { /* the toast said it */ } finally { ac.pressing = false; redraw($); }
}

// ---- the pane ----
// `/pacing-pane` opens a pane beside the chat with what /pacing-status says
// (the budget in time, the usage, what to do, the agents running) and what
// fills the context, redrawn with the band (redraw) and after each turn.
export const PANE_ID = 'pacing';
// at the pane's first draw, a reading younger than this is not taken again
export const PANE_FRESH = 60 * 1000;
export const PANE_TITLE = 'Pacing';
// The pane opens by itself at a session's start, so it is there once the
// plugin is installed. A person who closes it (ui.close, origin `person`)
// has it stay closed, in later sessions too ($.store), until they type
// /pacing-pane again.
export const PANE_CLOSED = 'paneClosed';
// whether a ui.close is the person closing the pacing pane
export const closedByPerson = e => !!e && e.id === PANE_ID && !!e.origin && e.origin.kind === 'person';
// What the pane draws, as plain data (pane.mjs draws it): the time left
// today in plain words with the level, the meters with the budget line, the
// session's models, the agents running (`running`: a text each, or
// { text, id } where a press on the row opens that agent's transcript), how
// full the context is, and the background tasks (`tasks`, taskRows).
// `compact`: whether the Context section offers to compact, 'offer' from
// PANE_COMPACT_AT tokens (`tokens`: the session's size at its last measure,
// else the breakdown's total), 'running' while one runs (`compacting`).
// The figure is the user's, and lower than the row's SUGGEST_AT on purpose:
// the pane's button is there for whoever looks, the row is what interrupts.
// `autoCompact`: the setting (autoCompactOf), drawn in the Context section
// as its words, the values a press on − and + gives (a step of
// AUTO_COMPACT_STEP on the step's grid, none past the bounds) and `own`,
// whether Claude Code's own auto-compact is on ('auto'): then no − and +,
// a short `note` instead, and `back`, the token count the switch returns
// to (`autoCompactLast`, the last one kept, else the default). For 'off'
// (pacing leaves /autocompact alone) one dim line, `off` and its `text`,
// with no buttons; nothing when none is given.
export const PANE_COMPACT_AT = 300000;
// the pane's note under the switch while Claude Code's own auto-compact is on
export const AUTO_COMPACT_OWN_NOTE = 'It compacts near the end of the window.';
// the pane's one line while pacing leaves /autocompact alone ('off')
export const AUTO_COMPACT_OFF_TEXT = 'Auto-compact: pacing leaves it alone (/pacing autocompact 750k or auto turns it back on)';
// the 5-hour window's figure from which heavy work waits (budget.mjs says HOLD there too)
export const FIVE_HOLD = 85;
// ---- the agents' rows in the pane: model tags, output, step bars ----
// A model as the reading's prices name it: an id the session or an agent
// reports ("claude-opus-5-5", with a suffix or not), or an alias the Agent
// call gave ("haiku"); null where the prices know none.
export const modelIdOf = (m, prices) => {
  if (typeof m !== 'string' || !m || !prices) return null;
  const ids = Object.keys(prices);
  return ids.find(id => m.startsWith(id)) || ids.find(id => id.startsWith('claude-' + m.toLowerCase() + '-')) || null;
};
// ↑ or ↓ for a model stronger or weaker than the session's, by its price;
// '' when the same, or either is not known
export const modelArrow = (m, session, prices) => {
  const a = modelIdOf(m, prices), b = modelIdOf(session, prices);
  if (!a || !b || a === b) return '';
  const pa = prices[a] && prices[a][0], pb = prices[b] && prices[b][0];
  return typeof pa !== 'number' || typeof pb !== 'number' || pa === pb ? '' : pa > pb ? '↑' : '↓';
};
// What an agent is doing or has just produced, in a small box under its row
// (the user's word: show a subagent's output where the pane has room): its
// main tasks alone (meaningOf, below; OUT_MAIN lines). The engine hands the
// module, for a subagent's loop, each tool call with its result (tool.call,
// `agentId`), and at its end the report it handed back (turn.complete's
// `answer`); nothing is read from a transcript. outLine, actionLine and
// noteOut (each call as a line, the last OUT_LINES) are no longer drawn.
// The pane cuts a line at its width too. OUT_SHOWN agents show the box at
// once: the ones with the newest output.
export const OUT_LINES = 3;
export const OUT_CHARS = 90;
export const OUT_SHOWN = 2;
// a text's first line with words in it, its spaces made one; '' for none
export const outLine = text => {
  const line = String(text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(l => /\w/.test(l)) || '';
  return cut(line, OUT_CHARS);
};
// the first OUT_LINES lines of an agent's report, its markdown marks left out
export const reportLines = text => String(text || '').split('\n')
  .map(l => l.replace(/^\s*(#+|[-*>]|\d+\.)\s+/, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim())
  .filter(l => /\w/.test(l)).slice(0, OUT_LINES).map(l => cut(l, OUT_CHARS));
// a finished run's row: "reviewer: the release notes ✓ done · 6m" (`state`: done, failed, stopped)
export const finishedText = (a, state, ms) => {
  const task = taskOf(a);
  return nameOf(a) + (task ? ': ' + task : '') + ' ' + (TASK_MARKS[state] || TASK_MARKS.done) + ' · ' + dur(ms);
};
// a command without what leads up to it: each leading "cd <dir> &&" or
// "cd <dir>;" and "VAR=...;" left out ("cd /x/app; F=a.txt; grep b $F" is "grep b $F")
const LEAD = /^\s*(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)|[A-Za-z_]\w*=("[^"]*"|'[^']*'|[^\s;]*)\s*;)\s*/;
export const commandWhat = command => {
  let s = String(command || '');
  for (let left = s.replace(LEAD, ''); left !== s; left = s.replace(LEAD, '')) s = left;
  return s;
};
// what a call read or ran, in a few words: a file's name; for a shell
// command the short description its call carries ("Run all checks"), else
// its first line (commandWhat)
const callWhat = e => {
  const file = e.file_path || e.notebook_path || e.path;
  if (file) return String(file).split(/[\\/]/).pop();
  if ((e.tool === 'Bash' || e.tool === 'PowerShell') && e.command) return outLine(e.description || commandWhat(e.command));
  return outLine(e.command || e.pattern || e.url || e.query || e.description || '');
};
// One tool call and how it came out: "Bash Run the tests → 448 pass" (a
// command's description, its last line of output), "Read pane.mjs → 737 lines", "Edit
// pane.mjs → saved", "Grep stepBarOf → 3 lines"; refused or failed says so.
// '' for the call that says a step (config.mjs part): the bar shows it.
// a command's outcome: of its last lines, the last that says how it went
// (a test runner ends on "# duration_ms …" after "# pass 448"), else its
// last line
const SAYS_RESULT = /\b(pass(ed)?|fail(ed|ures?)?|errors?|ok|tests?|done|warnings?)\b|✓|✗/i;
const resultLine = lines => [...lines.slice(-12)].reverse().find(l => SAYS_RESULT.test(l) && !/duration/i.test(l)) || lines[lines.length - 1] || '';
export const actionLine = (e, r) => {
  if (!e || !e.tool || (e.tool === 'Bash' && PART_CALL.test(String(e.command || '')))) return '';
  const tool = String(e.tool).startsWith('mcp__') ? String(e.tool).split('__').pop() : String(e.tool);
  const what = callWhat(e);
  const text = r && !r.deny ? textsOf(r).join('\n') : '';
  const lines = text.split('\n').filter(l => l.trim());
  const outcome = !r ? '' : r.deny ? 'refused' : r.isError ? 'failed' + (outLine(text) ? ': ' + outLine(text) : '')
    : e.tool === 'Bash' || e.tool === 'PowerShell' ? outLine(resultLine(lines))
    : e.tool === 'Read' || e.tool === 'Grep' || e.tool === 'Glob' ? (lines.length ? lines.length + (lines.length === 1 ? ' line' : ' lines') : 'nothing')
    : e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit' ? 'saved' : '';
  return cut(tool + (what ? ' ' + what : '') + (outcome ? ' → ' + outcome : ''), OUT_CHARS);
};
// the agent's box after a new line: the last OUT_LINES, one the same as the last not twice
export const noteOut = (out, line) => {
  const list = Array.isArray(out) ? out : [];
  if (!line || list[list.length - 1] === line) return list;
  return [...list, line].slice(-OUT_LINES);
};
// The box says only the agent's main tasks (the user's words: the main
// point, not all detailed calls; not much text under agents, just main
// tasks): the files it is changing ("Changing readings.mjs and pane.mjs")
// and its latest test, check, build or lint run with how it came out
// ("Tests: 455 pass", "Checks failed: 2 fail"); once it ended, its report's
// first clause ("Done: the band row waits for the turn"). No narration, no
// reads, searches, listings or other commands. A line each, the newest
// first, at most OUT_MAIN, each cut at OUT_MAIN_CHARS; none yet, no box.
export const OUT_MAIN = 2;
export const OUT_MAIN_CHARS = 60;
// the files an agent changed, as one line, the newest two by name: "Changing
// pane.mjs", "Changing a.mjs and b.mjs", "Changing a.mjs, b.mjs and 3 more"; '' for none
export const changedLine = (files, verb = 'Changing') => {
  if (!files || !files.length) return '';
  const last = files.slice(-2), more = files.length - last.length;
  return cut(verb + ' ' + (more ? last.join(', ') + ' and ' + more + ' more' : last.join(' and ')), OUT_MAIN_CHARS);
};
// a finished run's line: "Done: " and its report's first clause (a leading
// "Done." left out); "Failed: ", "Stopped: " likewise; '' for no report
const ENDED = { done: 'Done', failed: 'Failed', stopped: 'Stopped' };
export const doneLine = (state, answer) => {
  const first = (reportLines(answer)[0] || '').replace(/…$/, '').replace(/^done\b[.,:;!\s—-]*/i, '');
  const clause = first.split(/[.;:!?](?=\s|$)|\s[—–-]\s/)[0].trim();
  return clause ? cut((ENDED[state] || ENDED.done) + ': ' + clause, OUT_MAIN_CHARS) : '';
};
// the file a call changed (Edit, Write, NotebookEdit that was not refused or failed); null for any other
export const changedFile = (e, r) => {
  if (!e || !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.tool) || (r && (r.deny || r.isError))) return null;
  const file = e.file_path || e.notebook_path || e.path;
  return file ? String(file).split(/[\\/]/).pop() : null;
};
// a shell command that only reads or lists is no run, whatever its words say
const PLAIN_COMMAND = /^(grep|rg|cat|head|tail|less|ls|dir|find|sed|awk|wc|echo|pwd|which|type|git\s+(diff|status|log|show|ls-files|blame)|Get-Content|Get-ChildItem|Select-String)\b/i;
const RUN_KINDS = [['Tests', /\btests?\b|\bspecs?\b|\b(vitest|jest|pytest|mocha)\b/i], ['Checks', /\bchecks?\b|\bvalidat\w*|\btsc\b|\btypecheck\b/i],
  ['Build', /\bbuild\b/i], ['Lint', /\b(es)?lint\b/i]];
// what kind of run a shell call is (Tests, Checks, Build, Lint), by its description or its command; null for none
export const runKind = e => {
  if (!e || (e.tool !== 'Bash' && e.tool !== 'PowerShell') || !e.command) return null;
  const what = commandWhat(String(e.command)).trim();
  if (PLAIN_COMMAND.test(what) || PART_CALL.test(String(e.command))) return null;
  // (its description first: "Run all checks" over the "test" in its command)
  const kind = RUN_KINDS.find(([, re]) => re.test(e.description || '')) || RUN_KINDS.find(([, re]) => re.test(what));
  return kind ? kind[0] : null;
};
// the largest count a run's output gives before or after a word ("455 pass", "# pass 448")
const countOf = (text, word) => {
  let n = null;
  for (const m of text.matchAll(new RegExp('(\\d+)\\s+' + word + '|\\b' + word + '\\s+(\\d+)', 'gi'))) n = Math.max(n ?? 0, +(m[1] ?? m[2]));
  return n;
};
// a run and how it came out: "Tests: 455 pass", "Build: ok", "Checks failed:
// 2 fail" (or the line that says how it went); '' for a call that is no run
export const runLine = (e, r) => {
  const kind = runKind(e);
  if (!kind || !r || r.deny) return '';
  const text = textsOf(r).join('\n');
  const pass = countOf(text, 'pass(?:ed|es|ing)?'), fail = countOf(text, 'fail(?:ed|ing|ures?|s)?');
  if (r.isError || fail > 0) {
    const detail = fail ? fail + ' fail' : outLine(resultLine(text.split('\n').filter(l => l.trim())));
    return cut(kind + ' failed' + (detail ? ': ' + detail : ''), OUT_CHARS);
  }
  return cut(kind + ': ' + (pass !== null ? pass + ' pass' : 'ok'), OUT_CHARS);
};
// the box after a new main task of `kind` ('files', 'run'): it first, the
// other after it, none the same twice, at most OUT_MAIN
export const noteMeaning = (list, kind, text) => {
  const was = Array.isArray(list) ? list : [];
  if (!text) return was;
  return [{ kind, text }, ...was.filter(x => x.kind !== kind && x.text !== text)].slice(0, OUT_MAIN);
};
// an agent's box after the call `e` with its result `r`; true when it changed
export const meaningOf = (a, e, r) => {
  const before = JSON.stringify(a.mean || []);
  const file = changedFile(e, r);
  if (file) {
    a.files = [...(a.files || []).filter(f => f !== file), file];
    a.mean = noteMeaning(a.mean, 'files', changedLine(a.files));
  }
  a.mean = noteMeaning(a.mean, 'run', runLine(e, r));
  a.out = (a.mean || []).map(x => x.text);
  return JSON.stringify(a.mean || []) !== before;
};
// a finished run's box: how it ended with its report's first clause, then
// its newest main task ("Changed …" now), at most OUT_MAIN
export const finishedOut = (a, state, answer) => {
  const lines = [doneLine(state, answer), ...(a.mean || []).map(x => (x.kind === 'files' ? changedLine(a.files, 'Changed') : x.text))].filter(Boolean);
  return lines.filter((l, i) => lines.indexOf(l) === i).slice(0, OUT_MAIN);
};
// An agent's progress as a bar under its row: the steps it said ("step 2 of
// 4": a segment each), else the time it has run against the time it is
// estimated to take (leftOf: `frac`, 0 to 1), else none.
export const stepBarOf = (a, now) => {
  if (a && a.part && a.part.total >= 1) return { done: Math.min(a.part.done, a.part.total), total: a.part.total };
  const left = a ? leftOf(a, now) : null;
  if (left == null) return null;
  const run = Math.max(0, now - a.startedAt);
  return { frac: run + left > 0 ? Math.min(1, run / (run + left)) : 1 };
};
// The budget is said as time alone, never in tokens or dollars: "9h 30m" and
// "left to use today to stay on budget"; past the line, "40m" and "over
// today's budget". Without a pace there is no time: the points of the week.
// `session`: the session's { model, effort }, for the agents' model tags.
// An agent given as { text, model, effort, on, bar, out, outAt } (paneNow)
// is drawn with its model as a tag (`tag`: `on`, ↑ or ↓ before it against
// the session's model), its step bar (`bar`, stepBarOf) and its output box
// (`out`, for the OUT_SHOWN agents with the newest output).
export const paneModel = ({ j = null, mix = [], running = [], bd = null, now = Date.now(), busy = false, failing = false, tasks = [], tokens = null, compacting = false, autoCompact = null, autoCompactLast = null, session = null } = {}) => {
  const m = { level: 'ok', levelText: '', budget: null, meters: [], notes: [], mix, running, context: null, contextNote: '', empty: '', tasks, compact: null, autoCompact: null };
  if (autoCompact === 'off') m.autoCompact = { text: AUTO_COMPACT_OFF_TEXT, off: true };
  else if (autoCompact === 'auto') m.autoCompact = { text: autoCompactText(autoCompact), own: true, note: AUTO_COMPACT_OWN_NOTE, back: autoCompactLastOf(autoCompactLast) };
  else if (typeof autoCompact === 'number') {
    const n = autoCompact;
    const less = Math.max(AUTO_COMPACT_MIN, Math.ceil(n / AUTO_COMPACT_STEP) * AUTO_COMPACT_STEP - AUTO_COMPACT_STEP);
    const more = Math.min(AUTO_COMPACT_MAX, Math.floor(n / AUTO_COMPACT_STEP) * AUTO_COMPACT_STEP + AUTO_COMPACT_STEP);
    m.autoCompact = { text: autoCompactText(n), own: false, less: less < n ? less : null, more: more > n ? more : null };
  }
  const size = typeof tokens === 'number' ? tokens : bd && typeof bd.totalTokens === 'number' ? bd.totalTokens : null;
  if (compacting) m.compact = 'running';
  else if (size !== null && size >= PANE_COMPACT_AT) m.compact = 'offer';
  if (j) {
    // The top area is the week alone (the user's word: do not mix the weekly
    // meter and Fable's there): its level before the per-model meter's
    // (weekLevel; from an older budget.mjs, the level where the week set it,
    // else the week's figure against the line). The per-model meter says
    // its own state under its bar.
    const wl = j.weekLevel || (j.levelBy !== 'premium' ? j.level
      : typeof j.all === 'number' && typeof j.line === 'number' ? (j.all >= 95 ? 'stop' : j.all - j.line > 5 ? 'throttle' : j.all > j.line ? 'over' : 'ahead') : 'ahead');
    m.level = wl === 'stop' ? 'stop' : wl === 'throttle' ? 'throttle' : wl === 'over' ? 'over' : 'ok';
    // The words say the weekly meter's own points over its line, not the
    // level: a trend or the per-model meter can raise the level to throttle
    // while the week is 3 over (the user's word: "far over" then reads
    // wrong): on or under it within budget, over by up to 5, far over past
    // that, with the points; the week nearly used says so.
    const over = typeof j.all === 'number' && typeof j.line === 'number' ? j.all - j.line : null;
    const by = over !== null && over > 0 ? Math.max(1, Math.round(over)) : 0;
    m.levelText = m.level === 'stop' ? 'The week is nearly used'
      : over === null ? { ok: 'Within budget', over: 'Over the budget line', throttle: 'Far over the budget line' }[m.level]
      : !by ? 'Within budget' : (by > 5 ? 'Far over the budget line' : 'Over the budget line') + ' · +' + by;
    const h = hoursLeft(j);
    const points = j.left && typeof j.left.points === 'number' ? j.left.points : typeof j.line === 'number' && typeof j.all === 'number' ? j.line - j.all : null;
    if (h !== null) {
      const over = h < 0 && timeText(h) !== '0m';
      m.budget = { big: (j.rateFrom === 'estimate' ? '~' : '') + timeText(h), sub: over ? 'over today\'s budget' : 'left to use today to stay on budget' };
    } else if (points !== null) {
      m.budget = { big: Math.abs(Math.round(points)) + '%', sub: points < 0 ? 'of the week over today\'s budget' : 'of the week left to use today to stay on budget' };
    } else m.budget = { big: '–', sub: 'No budget figure yet' };
    if (typeof j.all === 'number') {
      m.meters.push({ label: 'Weekly', pct: j.all, line: typeof j.line === 'number' ? j.line : null,
        note: typeof j.line === 'number' ? 'budget line ' + Math.round(j.line) + '%' : '' });
    }
    if (j.premium != null && j.premiumLabel) {
      const age = j.premiumAt ? now - Date.parse(j.premiumAt) : 0;
      // its budget line drawn loud (the user's word: very visible, and more
      // so when over), and its state in words under the bar
      const line = typeof j.line === 'number' ? j.line : null;
      const by = line !== null ? Math.round(j.premium - line) : null;
      const state = j.premiumOut ? 'used up until the reset'
        : line === null ? ''
        : by > 0 ? by + ' points over its budget line ' + Math.round(line) + '%' + (j.premiumHeld ? ': held, kept for hard tasks' : '')
        : 'budget line ' + Math.round(line) + '%' + (j.premiumHeld ? ', held for today' : '');
      const read = age > CARRIED_CURRENT ? 'read ' + ageText(age) + ' ago'
        + (j.premiumEstimate != null && Math.round(j.premiumEstimate) > Math.round(j.premium) ? ', estimated ' + Math.round(j.premiumEstimate) + '% now' : '') : '';
      m.meters.push({ label: j.premiumLabel, pct: j.premium, line, loud: true, over: by !== null && by > 0,
        note: [state, read].filter(Boolean).join(' · ') });
    }
    // the 5-hour window under the per-model meter (the user's word): no
    // budget line; under it when it resets, and when it fills first at its
    // pace. Once the reset has passed the window starts over: 0 until the
    // next reading.
    if (typeof j.five === 'number') {
      const resetAt = j.fiveReset ? Date.parse(j.fiveReset) : NaN;
      const passed = resetAt <= now;
      const fullAt = j.fiveFull ? Date.parse(j.fiveFull) : NaN;
      const note = passed ? 'started over; the figure comes with the next reading'
        : [resetAt > now ? 'resets in ' + timeText((resetAt - now) / 3600000) : '',
          fullAt > now && !(fullAt >= resetAt) ? 'full in ' + timeText((fullAt - now) / 3600000) + ' at this pace' : '',
          j.five >= FIVE_HOLD ? 'heavy work waits for the reset' : ''].filter(Boolean).join(' · ');
      m.meters.push({ label: '5-hour', pct: passed ? 0 : j.five, line: null, five: true, note });
    }
    if (typeof j.unused === 'number') m.notes.push('At this pace about ' + j.unused + '% of the week goes unused at the reset; it does not carry over.');
  // a reading on its way (at load, or Refresh): said so, not "none"
  } else m.empty = busy ? 'Reading the meters…' : 'No reading yet in this session: /pacing usage takes one.';
  // the readings fail: the figures above are older than they look
  if (failing) m.notes.unshift(FAILED_NOTE);
  if (bd && typeof bd.totalTokens === 'number') {
    // Against the point it compacts at where a window was set (pacing sets it
    // a buffer above the figure, so "of 400k" matches "Compact at 400k"), the
    // window else.
    const at = bd.autocompactSource === 'settings' && bd.isAutoCompactEnabled && bd.autoCompactThreshold > 0 ? bd.autoCompactThreshold : 0;
    const max = at || bd.rawMaxTokens || bd.maxTokens;
    m.context = { used: kText(bd.totalTokens), of: max ? kText(max) : '', pct: max ? (at ? Math.round(bd.totalTokens / at * 100) : bd.percentage) : null };
  } else m.contextNote = 'Not measured yet; it shows after the next turn.';
  // the agents' rows: the model as a tag, the step bar, the rung
  // the output box (`out`, `outAt` its newest line's time) for the
  // OUT_SHOWN agents with the newest output alone
  const prices = j && j.prices;
  const hasOut = a => a && typeof a === 'object' && Array.isArray(a.out) && a.out.length;
  const shown = new Set(running.filter(hasOut).sort((x, y) => (y.outAt || 0) - (x.outAt || 0)).slice(0, OUT_SHOWN));
  m.running = running.map(a => {
    if (!a || typeof a !== 'object' || !('on' in a || 'bar' in a || 'model' in a || 'out' in a)) return a;
    const arrow = session && session.model ? modelArrow(a.model, session.model, prices) : '';
    return { id: a.id ?? null, text: a.text, tag: a.on ? (arrow ? arrow + ' ' : '') + a.on : '', bar: a.bar || null,
      out: shown.has(a) ? a.out : null, ...(a.done ? { done: true } : {}) };
  });
  return m;
};
// A change of level is one toast, and so is the session moved off the
// per-model meter's model, or let back. A reading the module took at load is
// no level the user was told of.
// The toast says the change and one short step; the whole advice (budget.mjs's
// do: line, 250 characters and more) was cut off in the desktop app's toast
// (the user's word: can't see the full text). The pane and /pacing-status
// have the rest.
export const levelStepText = j => {
  const rec = j.recommend ? j.recommend.label + ' ' + j.recommend.effort : null;
  const prem = j.premiumLabel || 'The per-model meter\'s model';
  if (j.premiumOut) return prem + ' is out until the reset' + (rec ? '; the Switch row offers ' + rec : '') + '.';
  if (j.premiumHeld) return prem + ' is kept for hard tasks' + (rec ? '; the Switch row offers ' + rec : '') + '.';
  if (j.level === 'throttle') { const t2 = j.tierNames && j.tierNames[2]; return 'Most work goes to ' + (t2 ? t2 + ' ' : '') + 'subagents.'; }
  if (j.level === 'stop') return /extra usage/.test(j.do || '') ? 'The week is nearly used; past 100% it is charged to extra usage.' : 'Wrap up: the week is nearly used.';
  return '';
};
export const levelToastText = (was, j) => levelIcon(j) + ' ' + levelPhrase(was.level) + ' -> ' + levelPhrase(j.level)
  + (j.levelBy === 'premium' && j.premiumLabel ? ' (' + j.premiumLabel.split(' ')[0] + '\'s meter)' : '') + '. ' + levelStepText(j);
// Only a level that got worse and calls for something is a toast (the user's
// word: fewer messages): far over the line, or the week nearly used. A little
// over, a level that got better, and Fable held or let back show in the pane
// alone; where the session runs on the held model, the Switch row says it.
export const LEVEL_RANK = { 'ahead': 0, 'on pace': 1, 'over': 2, 'throttle': 3, 'stop': 4 };
export const levelToastDue = (was, j, session = null) => {
  if (!was || was.fromLoad || !j) return false;
  if (!(LEVEL_RANK[j.level] >= LEVEL_RANK.throttle) || !(LEVEL_RANK[j.level] > (LEVEL_RANK[was.level] ?? -1))) return false;
  // the Switch row is there for it
  return !((j.premiumOut || (j.premiumHeld && heldFar(j))) && j.premiumModelId && typeof session === 'string' && session.startsWith(j.premiumModelId));
};
function sayLevel($, was, j, session = null) {
  if (levelToastDue(was, j, session)) $.ui.toast(levelToastText(was, j), { timeoutMs: TOAST_LONG });
}

// a redraw of the band; an engine without it has nothing to redraw
function redraw($) { try { $.ui.invalidate('ui.render'); } catch { /* no band */ } }

// shares that add up to 100: whole percents by the largest remainder
const percents = values => {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map(v => (100 * v) / total);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]);
  // the points still missing, counted once: counted inside the loop, the
  // bound would shrink as the loop adds them and leave the sum short of 100
  const short = 100 - out.reduce((a, b) => a + b, 0);
  for (let k = 0; k < short; k++) out[order[k][1]]++;
  return out;
};

// the model id a usage record names, as the prices know it
const idOf = (model, prices) => Object.keys(prices).find(p => model.startsWith(p));

// the session's spend by tier, from the tokens seen per model id: its own
// turns' at each model's tier for the session (tierOf), its subagents' at the
// model's tier for a subagent (agentTierOf; one model can hold two places,
// the session's above, a subagent's below). An older budget.mjs sends no
// agentTierOf: then both count by tierOf.
export const tierMix = (tokens, tierOf, prices, agentTokens = {}, agentTierOf = tierOf) => {
  const byTier = new Map();
  for (const [seen, map] of [[tokens, tierOf], [agentTokens, agentTierOf || tierOf]]) {
    for (const [model, t] of Object.entries(seen)) {
      const id = idOf(model, prices);
      if (!id) continue;
      const [pin, pout, pread, pwrite] = prices[id];
      const usd = (t.in * pin + t.out * pout + t.read * pread + t.write * pwrite) / 1e6;
      const key = map[id] ?? tierOf[id] ?? 'Other';
      byTier.set(key, (byTier.get(key) || 0) + usd);
    }
  }
  const keys = [...byTier.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a - b));
  const shares = percents(keys.map(k => byTier.get(k)));
  return keys.map((k, i) => ({ tier: k, share: shares[i] })).filter(x => x.share > 0);
};

// What the session and its subagents have spent so far, in US dollars: each
// model's input, output, cache read and cache write at its own prices. The
// weekly meter weighs cost, not tokens (a cache read costs a tenth of an
// input token), so budget.mjs learns its rate in dollars (--spent-usd). A
// model the prices do not know counts at the session model's prices: most
// likely a newer name of a model like it. With neither priced it is left out.
export const spentUsd = (tokens, agentTokens, prices, session) => {
  const own = session ? idOf(session, prices || {}) : null;
  let usd = 0;
  for (const seen of [tokens, agentTokens]) {
    for (const [model, t] of Object.entries(seen || {})) {
      const id = idOf(model, prices || {}) || own;
      if (!id) continue;
      const [pin, pout, pread, pwrite] = prices[id];
      usd += (t.in * pin + t.out * pout + t.read * pread + t.write * pwrite) / 1e6;
    }
  }
  return usd;
};

// the status line is plain text, so each tier is marked by a coloured circle:
// gold, silver, bronze and brown for tiers 1 to 4 (the nearest emoji: yellow,
// white, orange, brown), then purple, red, blue and green for a longer
// ladder; black for a model the ladder does not hold
const CIRCLES = ['🟡', '⚪', '🟠', '🟤', '🟣', '🔴', '🔵', '🟢'];
const square = tier => (tier === 'Other' ? '⚫' : CIRCLES[tier - 1] || '⚫');

// "45m", "15h", "3d": how old a carried figure is
const ageText = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + 'm' : m < 48 * 60 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
// A carried per-model figure counts as current for half an hour (within that
// an automatic reading is at most a point behind on all models too). Past
// it, the status line says how old the figure is, and where the meter
// probably is when budget.mjs could estimate it.
const CARRIED_CURRENT = 30 * 60 * 1000;
// The line the session reads beside the user's next prompt when a full
// reading is due. Only where the app's usage tool did not answer (a terminal
// session): there the module cannot read the per-model meter, the session
// can. A reading the module took in full never asks (budget.mjs sends no
// needFull). One line, once per stale figure, and again after an hour if
// nothing came of it; never a tool call on every turn.
const ASK_AGAIN = 60 * 60 * 1000;
export const fullReadingAsk = j => (j && j.needFull
  ? 'Pacing (automatic note, not from the user): ' + j.needFull
    + (j.premium != null ? '; it read ' + Math.round(j.premium) + ' % then' + (j.premiumEstimate != null ? ' and is about ' + Math.round(j.premiumEstimate) + ' % by estimate' : '') : '')
    + '. The automatic readings cannot read that meter. Before the next piece of work, take a full reading: run the `pacing` skill with `usage now`, and follow its do: line.'
  : null);

// A session another session started (a side session in the desktop app)
// says so up front, with the tier of the model it runs on:
//   ⚪Tier 2 Sub Agent - Budget tokens: 850K, ⚪Tier 2[90%] 🟤Tier 4[10%], (36% Weekly, 40% Fable)
// `self` is that tier ('Other' off the ladder), or null for any other session.
// `now` (ms) dates a carried per-model figure: "71% Fable 15h ago, est. 90%".
// The status line, compact. The desktop app gives it what is left of the
// composer's footer beside the model and mode pickers, and cuts the rest with
// an ellipsis: about 33 characters while a turn runs. So what matters comes
// first and a cut takes only the tail:
//   a side session's own tier   🟡T1 sub
//   what is left of the budget  Budget tokens: 850K
//   the session's tier split    🟡T1 45% ⚪T2 55%
//   the meters                  week 48% Fable 71% (2h old est 80%)
// `/pacing-status` shows the whole line in the long form (fullText).
// The case reported drew 33 characters before the ellipsis
// ("🟡Tier 1 Sub Agent - 158% of Fable"), the circle counted as one.
export const HEAD_MAX = 33;
// The levels in words that say which side of the budget line the week is:
// "ahead" read as spending ahead of the budget, the opposite of its meaning.
const PHRASE = { 'ahead': 'under budget', 'on pace': 'on budget', 'over': 'over budget', 'throttle': 'far over budget', 'stop': 'stop' };
export const levelPhrase = level => PHRASE[level] || level || '';
// What is left under today's budget line, wherever it shows: in tokens, by
// the tokens per point of the weekly meter budget.mjs learned from what the
// sessions spent ("Budget tokens: 850K", "1.2M" from a million, "-120K"
// past the line, "0K" under a thousand either way). The rate errs low (use
// on another device raises the meter with no tokens counted), so the figure
// shows less than there is. Before a rate is learned, an estimate from this
// week's transcripts (rateFrom 'estimate'), marked "~": "Budget tokens: ~36M".
// With neither, the points of the week, without the word tokens
// ("Budget: 5%"); "Budget: -" only with no figure at all.
export const tokensText = n => {
  const a = Math.abs(n);
  if (a < 1000) return '0K';
  const k = Math.round(a / 1000);
  return (n < 0 ? '-' : '') + (k < 1000 ? k + 'K' : (a / 1e6).toFixed(1) + 'M');
};
// With a pace as well (paceUsd, the dollars an hour of work costs, from the
// last hour's spending: budget.mjs), the figure is time, which says more
// than a token count priced at tier 1's rate: "Budget: 2h 10m left", past
// the line "Budget: 40m over", "~" before an estimate. Rounded to 5 minutes
// under an hour and to 10 from there, whole hours from 10, "24h+" past a day.
export const timeText = hours => {
  const m = Math.abs(hours) * 60;
  if (m > 24 * 60) return '24h+';
  if (m < 60) { const r = Math.round(m / 5) * 5; return r < 60 ? r + 'm' : '1h'; }
  if (m >= 600) return Math.round(m / 60) + 'h';
  const r = Math.round(m / 10) * 10;
  return Math.floor(r / 60) + 'h' + (r % 60 ? ' ' + (r % 60) + 'm' : '');
};
// the hours the tokens left last at the pace, or null without a pace
const hoursLeft = j => (j && j.left && typeof j.left.tokens === 'number' && j.tokenUsd > 0 && j.paceUsd > 0 ? j.left.tokens * j.tokenUsd / j.paceUsd : null);
export const budgetText = j => {
  const left = j && j.left && typeof j.left === 'object' ? j.left : {};
  const mark = j && j.rateFrom === 'estimate' ? '~' : '';
  const h = hoursLeft(j);
  if (h !== null) return 'Budget: ' + mark + timeText(h) + (h < 0 && timeText(h) !== '0m' ? ' over' : ' left');
  if (typeof left.tokens === 'number') return 'Budget tokens: ' + mark + tokensText(left.tokens);
  const points = typeof left.points === 'number' ? left.points : j && typeof j.line === 'number' && typeof j.all === 'number' ? j.line - j.all : null;
  return 'Budget: ' + (points !== null ? Math.round(points) + '%' : '-');
};
// for /pacing-status: with the time, the tokens it stands for and the pace
export const budgetWords = j => budgetText(j) + (hoursLeft(j) !== null
  ? ' (' + tokensText(j.left.tokens) + ' tokens, at $' + j.paceUsd.toFixed(2) + ' an hour)' : '');
// what a cost in dollars is of the budget, in the status line's unit: "20m"
// with a pace, else "250K tokens", else nothing
export const costText = (j, usd) => (!(usd > 0) || !j ? ''
  : j.paceUsd > 0 ? timeText(usd / j.paceUsd)
    : j.tokenUsd > 0 ? tokensText(usd / j.tokenUsd) + ' tokens' : '');

// ---- subagents at work ----
// The session's own subagents, from the engine's events: agent.spawn starts
// one (type, model; its effort from the Agent call), its loop's turn.complete
// ends it. $.agent.list() settles the count: an agent it lists as neither
// pending nor running is gone. The main thread's turn ending ends every
// foreground agent (the turn waited for them); a new or resumed session
// starts with none. While any run:
//   the status line leads with their count, "⏳ 2 Subagents running" (side
//   sessions counted in), and nothing more of them: who they are, what they
//   do, their time and progress are the toasts', the row's and
//   /pacing-status's;
//   a toast when one starts and when one ends, and every 5 minutes while
//   any runs (`/pacing notify off` quiets the toasts);
//   a background agent still running after the turn ended gets a row in the
//   band above the prompt, under the offer to compact, never over it.
// Toasts and the row are one line each, within MSG_MAX.
// The status line's agents part keeps within the room the surface gives it.
// Where the desktop app or the mobile app draws the session, LINE_MAX_NARROW
// (70: the footer of a normal window has room for about 65 to 70 characters;
// the cut seen at about 35 was a narrow window, and at 34 the usage was
// dropped, which the user wants always shown); in a terminal alone (or
// where the engine does not say), LINE_MAX: a line of 75 was seen whole. The
// surfaces come from $.session.surfaces(), asked again when one attaches or
// detaches. The order is the agents, the budget, the usage; the budget and
// the usage always show whole, and only the agents part gives way.
export const LINE_MAX = 75;
export const LINE_MAX_NARROW = 70;
export const NARROW = ['desktop', 'mobile'];
// the room for the line on these surfaces (the narrowest of them counts)
export const lineMaxOf = surfaces => (Array.isArray(surfaces) && surfaces.some(x => NARROW.includes(x)) ? LINE_MAX_NARROW : LINE_MAX);
export const MSG_MAX = 120;
// While anything runs the line is redrawn every REFRESH_EVERY from what the
// module knows (no cost); the agents are settled from the engine's list every
// SETTLE_EVERY, and side sessions polled every POLL_EVERY while one runs or for
// WATCH_FOR after one was started or messaged.
export const REFRESH_EVERY = 5 * 1000;
export const SETTLE_EVERY = 30 * 1000;
export const POLL_EVERY = 15 * 1000;
export const WATCH_FOR = 60 * 1000;
export const PROGRESS_EVERY = 5 * 60 * 1000;
// a background agent the engine cannot vouch for is let go after this long
const STALE_AGENT = 2 * 60 * 60 * 1000;
export const chars = s => [...String(s)].length;
// "reader", "implementer", "general" (general-purpose); a plugin's prefix off; 12 at most
export const roleOf = type => {
  let t = String(type || 'agent').replace(/^[\w.-]+:/, '').toLowerCase();
  if (t === 'general-purpose') t = 'general';
  return chars(t) > 12 ? [...t].slice(0, 11).join('') + '…' : t;
};
// "claude-haiku-5-5" -> "Haiku 5.5"
export const modelLabel = id => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(id || ''));
  if (m) return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + '.' + m[3];
  // an alias the Agent call gave ("haiku"), before the spawn resolves it
  const t = String(id || '');
  return /^[a-z]+$/.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
};
// "40s", "3m", "2h"
export const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : s < 6000 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'; };
const runOn = a => (a.model ? modelLabel(a.model) + (a.effort ? ' ' + a.effort : '') : '');
const firstFit = (steps, room) => steps.find(s => chars(s) <= room) || steps[steps.length - 1];
// ---- an estimate of a running agent's progress ----
// By time only: the engine gives an agent's tokens when its run ends, not
// while it runs. How long it has run against the median of that agent
// type's recent finished runs (kept in $.store, the last RUNS_KEPT per
// type): shown from RUNS_NEEDED runs on, as "~60%", and never above EST_CAP
// while it runs, so it never claims to be done. A rough guess from how long
// that kind of agent usually takes, not a measure of the work done.
export const RUNS_KEPT = 20;
export const RUNS_NEEDED = 3;
export const EST_CAP = 95;
export const median = xs => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
export const estimateOf = (runs, elapsed) => (!Array.isArray(runs) || runs.length < RUNS_NEEDED ? null
  : Math.min(EST_CAP, Math.max(0, Math.round((100 * elapsed) / Math.max(1000, median(runs))))));
export const keepRuns = (runs, ms) => [...(Array.isArray(runs) ? runs : []), ms].slice(-RUNS_KEPT);
// what a running agent is doing, from its latest tool call: a word or two
const STEPS = { Read: 'reading', Grep: 'searching', Glob: 'searching', Bash: 'running', Edit: 'editing', Write: 'editing',
  NotebookEdit: 'editing', WebFetch: 'on the web', WebSearch: 'on the web', Agent: 'delegating', TodoWrite: 'planning' };
export const stepOf = tool => STEPS[tool] || (String(tool || '').startsWith('mcp__') ? 'a tool' : String(tool || '').toLowerCase().slice(0, 12));
const est = (a, now) => estimateOf(a.runs, now - a.startedAt);
const estText = (a, now) => (est(a, now) == null ? '' : '~' + est(a, now) + '%');
// ---- real progress: the parts an agent says it has finished ----
// A task in several parts: the agent says so itself, by running
// `node <...>/scripts/config.mjs part <done> <total>` in a Bash call as each
// part is finished (its role text asks for it; the command prints one line).
// The module sees every tool call of an agent with the agent's id, which is
// where the step comes from, and reads the two numbers off the command.
// Then "step 2 of 4" (the user's word for a part) shows wherever the
// estimate "~60%" would: the row, the 5-minute toast, /pacing-status; and in
// the same place in what gives way without room (first). An agent that never says a part
// keeps the estimate by time. Where an agent keeps the build's own to-do
// list (TodoWrite, the whole list in each call) and said no part itself, the
// finished entries of that list are its parts. TaskCreate and TaskUpdate are
// not read: they change one entry of a list the session shares, and the id
// of a new entry is in the call's result, not in what the module sees.
const PART_CALL = /config\.mjs["']?\s+part\s+(\d{1,3})\s+(\d{1,3})(?!\d)/;
// the parts after this tool call of the agent: `was`, unless the call says them
export const partOf = (e, was = null) => {
  if (e && e.tool === 'Bash' && typeof e.command === 'string') {
    const m = PART_CALL.exec(e.command);
    if (m && +m[2] >= 1 && +m[1] <= +m[2]) return { done: +m[1], total: +m[2], said: true };
  }
  if (e && e.tool === 'TodoWrite' && Array.isArray(e.todos) && e.todos.length && !(was && was.said)) {
    return { done: e.todos.filter(t => t && t.status === 'completed').length, total: e.todos.length };
  }
  return was;
};
export const partText = a => (a && a.part ? 'step ' + a.part.done + ' of ' + a.part.total : '');
// what shows of an agent's progress: its parts, else the estimate
const progText = (a, now) => partText(a) || estText(a, now);
// ---- an estimate of the time left ----
// For the 5-minute toast, from what the module has already:
//   with parts said and one or more done: the time run so far, per part
//   done, times the parts left;
//   else, from RUNS_NEEDED finished runs of that agent type on: the median
//   of those runs less the time run, the history "~60%" rests on.
// Rough, and said so: "about 8m left", in whole minutes, "under 1m left"
// below one. Nothing without a basis, and nothing once the run has passed
// the estimate: a figure that is wrong already says less than none. The
// start toast gives the usual length of that kind of run the same way,
// "about 20m". Where a toast has no room, this goes first.
const about = ms => { const m = Math.round(ms / 60000); return m < 100 ? m + 'm' : Math.round(m / 60) + 'h'; };
export const leftOf = (a, now) => {
  const run = Math.max(0, now - a.startedAt), p = a.part;
  if (p && p.done > 0) return p.done >= p.total ? 0 : (run / p.done) * (p.total - p.done);
  if (!Array.isArray(a.runs) || a.runs.length < RUNS_NEEDED) return null;
  const left = median(a.runs) - run;
  return left > 0 ? left : null;
};
export const leftText = (a, now) => { const ms = leftOf(a, now); return ms == null ? '' : ms < 60000 ? 'under 1m left' : 'about ' + about(ms) + ' left'; };
// how long that kind of run usually takes, for the start toast; '' without three runs to go by
export const usualText = a => (!Array.isArray(a.runs) || a.runs.length < RUNS_NEEDED ? '' : median(a.runs) < 60000 ? 'under 1m' : 'about ' + about(median(a.runs)));
// One agent as the user reads it: its name, its assignment (the short
// description it was started with), what it is doing now, its progress (the
// parts it said, else the estimate: `parts.est`), how long it has run, in
// that order; as much as `parts` asks for. `parts.left` adds the estimate
// of the time left after it: reader "read the logs", searching ~60%, 3m, about 2m left.
//   with a step      reader: read the logs, searching step 2 of 4, 3m
//   without one      reader is running: read the logs 3m
//   no assignment    reader searching ~60%, 3m, reader is running 3m
// Without the progress the time follows the words with a space: searching 3m.
// `parts.task` is how many characters of the assignment show (cut with an
// ellipsis past it; 0 or absent: none). `parts.quote` is the toasts' form,
// which says "running" itself: reader "read the logs", searching ~60%, 3m.
// A side session's name is its short title, and it has no assignment beside it.
const nameOf = a => (a.kind === 'session' ? a.label || 'side session' : roleOf(a.type));
// an assignment longer than this is cut wherever it shows; one cut shorter
// than TASK_MIN says nothing and is left out instead
export const TASK_MAX = 60;
export const TASK_MIN = 8;
const cut = (s, n) => (chars(s) > n ? [...s].slice(0, Math.max(1, n - 1)).join('') + '…' : s);
export const taskOf = a => (!a || a.kind === 'session' ? '' : cut(String(a.description || '').replace(/\s+/g, ' ').trim(), TASK_MAX));
const detail = (a, now, parts) => {
  const task = parts.task ? cut(taskOf(a), parts.task) : '';
  const step = parts.step && a.step ? a.step : '';
  const head = parts.quote ? nameOf(a) + (task ? ' "' + task + '"' : '') + (step ? (task ? ', ' : ' ') + step : '')
    : step ? nameOf(a) + (task ? ': ' + task + ', ' : ' ') + step
    : nameOf(a) + (parts.time ? ' is running' : '') + (task ? ': ' + task : '');
  const left = parts.left ? leftText(a, now) : '';
  const prog = parts.est ? progText(a, now) : '';
  const time = parts.time ? dur(now - a.startedAt) : '';
  return head + (prog ? ' ' + prog : '') + (time ? (prog ? ', ' : ' ') + time : '') + (left ? ', ' + left : '');
};
// What shows of every agent where its assignment shows too (the toasts and
// the row above the prompt), from all of it to the names alone: for all of
// them at each step and from the right, the progress goes, then the step,
// then the assignment (cut shorter and shorter, then gone), then the time
// and "is running" with it.
const shrinks = (agents, more = {}) => {
  const longest = Math.max(0, ...agents.map(a => chars(taskOf(a))));
  const out = [{ task: TASK_MAX, step: 1, time: 1, est: 1 }, { task: TASK_MAX, step: 1, time: 1 }, { task: TASK_MAX, time: 1 }];
  for (let n = longest - 1; n >= TASK_MIN; n--) out.push({ task: n, time: 1 });
  out.push({ time: 1 }, {});
  return out.map(parts => ({ ...parts, ...more }));
};
// "2 Subagents", "2 Subagents are running": the count, as the status line
// words it (subagentsText), only for more than one;
// `word` goes before "running" ("still", "also")
export const countText = list => subagentsText(list.length);
export const runningText = (list, word = '') => countText(list) + (list.length === 1 ? ' is ' : ' are ') + (word ? word + ' ' : '') + 'running';
// The status line's agent part: the count alone, "⏳ 1 Subagent running",
// "⏳ 2 Subagents running", side sessions counted in; where that does not
// fit, without "running": "⏳ 2 Subagents"; with no room even for that, "⏳2",
// which shows even where it does not fit (the line then runs past the room).
export const subagentsText = n => n + (n === 1 ? ' Subagent' : ' Subagents');
export const agentPart = (agents, now, room) => {
  const n = agents.length;
  if (!n) return '';
  return firstFit(['⏳ ' + subagentsText(n) + ' running', '⏳ ' + subagentsText(n), '⏳' + n], room);
};
// who else runs, for a toast: by name for one or two, a count for more
const others = (list, word) => (list.length === 0 ? 'nothing else is running'
  : list.length <= 2 ? list.map(nameOf).join(' and ') + (list.length === 1 ? ' is ' : ' are ') + word + ' running'
  : runningText(list, word));
// the assignment in a toast, quoted, whole and then cut shorter and shorter
const quoted = (task, n) => (task ? ' "' + cut(task, n) + '"' : '');
const cuts = task => { const out = []; for (let n = chars(task) - 1; n >= TASK_MIN; n--) out.push(n); return out; };
// "▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2
// high; reader is also running." What gives way past MSG_MAX, in order: who
// else runs, the assignment's end, the assignment, the model. Where that
// kind of run has a usual length it says so, ", about 20m", and that goes
// before anything else does.
export const startedText = (a, list) => {
  const rest = list.filter(x => x !== a && x.id !== a.id);
  const head = ICON.started + ' ' + nameOf(a) + ' is running', task = taskOf(a), on = runOn(a) ? ' on ' + runOn(a) : '';
  const usual = usualText(a) ? ', ' + usualText(a) : '';
  return firstFit([
    ...(usual ? [head + quoted(task, TASK_MAX) + on + usual + (rest.length ? '; ' + others(rest, 'also') : '') + '.'] : []),
    head + quoted(task, TASK_MAX) + on + (rest.length ? '; ' + others(rest, 'also') : '') + '.',
    head + quoted(task, TASK_MAX) + on + '.',
    ...cuts(task).map(n => head + quoted(task, n) + on + '.'),
    head + on + '.',
    head + '.',
  ], MSG_MAX);
};
// "✅ implementer is done with "Auto-reload on plugin update" after 3m,
// 41k tokens; nothing else is running." What gives way: the tokens, who else
// runs, the assignment's end, the assignment.
export const doneText = (a, ms, tokens, list) => {
  const head = ICON.done + ' ' + nameOf(a) + ' is done', task = taskOf(a), after = ' after ' + dur(ms);
  const withTask = n => (task ? ' with' + quoted(task, n) : '');
  return firstFit([
    head + withTask(TASK_MAX) + after + (tokens ? ', ' + Math.round(tokens / 1000) + 'k tokens' : '') + '; ' + others(list, 'still') + '.',
    head + withTask(TASK_MAX) + after + '; ' + others(list, 'still') + '.',
    head + withTask(TASK_MAX) + after + '.',
    ...cuts(task).map(n => head + withTask(n) + after + '.'),
    head + after + '.',
  ], MSG_MAX);
};
// the 5-minute toast and the row: one line each, the same order of what goes.
// The toast: "⏳ still running: implementer "Auto-reload on plugin
// update", editing ~60%, 12m.", several joined by "; " while an assignment
// shows and by ", " once none does.
export const progressText = (agents, now) => {
  const longest = dur(now - Math.min(...agents.map(a => a.startedAt)));
  const each = parts => { const items = agents.map(a => detail(a, now, parts)); return items.join(items.some(i => i.includes('"') || i.includes(', ')) ? '; ' : ', '); };
  return firstFit([
    // with the time left where there is a basis for it: the first thing to go
    ...(agents.some(a => leftText(a, now)) ? [ICON.still + ' still running: ' + each({ task: TASK_MAX, step: 1, time: 1, est: 1, left: 1, quote: 1 }) + '.'] : []),
    ...shrinks(agents, { quote: 1 }).map(parts => ICON.still + ' still running: ' + each(parts) + '.'),
    ICON.still + ' ' + runningText(agents, 'still') + ', the longest for ' + longest + '.',
    ICON.still + ' ' + runningText(agents, 'still') + '.',
  ], MSG_MAX);
};
export const backgroundText = (agents, now, room = MSG_MAX) => {
  const names = agents.map(a => '⏳ ' + nameOf(a)).join(', ');
  return firstFit([
    ...shrinks(agents).map(parts => 'In the background: ' + agents.map(a => '⏳ ' + detail(a, now, parts)).join(', ')),
    ...(agents.length > 1 ? ['⏳ ' + runningText(agents) + ' in the background', '⏳ ' + runningText(agents), '⏳ ' + countText(agents)] : [names]),
  ], Math.min(room, MSG_MAX));
};
// the session's own agents still running, by the engine's list; null where
// the engine has no list
async function liveAgents($) {
  try {
    const list = await $.agent.list();
    return new Map(list.filter(a => a.status === 'pending' || a.status === 'running').map(a => [a.id, a]));
  } catch { return null; }
}
// drop the agents the engine no longer runs; without its list, those of the
// background that have run implausibly long. Of those that run, what the
// list says of them where it does: the tokens used so far (for the record
// at its end, should the list have let it go by then) and its effort.
async function settleAgents($, st, now) {
  const agents = st.agents;
  const live = await liveAgents($);
  let dropped = false;
  for (const [id, a] of agents) {
    if (a.kind === 'session' || a.provisional) continue;
    if (live ? !live.has(id) : now - a.startedAt > STALE_AGENT) { agents.delete(id); dropped = true; continue; }
    const row = live && live.get(id);
    if (row && row.tokenCount > 0) a.tokens = row.tokenCount;
    if (row && !a.effort && EFFORT_ORDER.includes(row.effort)) a.effort = row.effort;
  }
  if (dropped) await keepAgents($, st);
}

// ---- running agents across a reload ----
// A reload starts this module's memory over, and a subagent already at work
// was then known by nothing: the line and the toasts lost its role, its
// assignment, its time and its step. So what they need of each running
// subagent is kept in $.store under the session's id ('agents:<id>'):
// written when one starts, says a new part, or ends, the key deleted when
// none runs. A new step alone is not written at once: Read, Grep and Bash
// take turns with every tool call of an agent, and each was a $.session.id()
// and a $.store.set of every agent. It is noted (`st.stepMoved`) and the
// next refresh writes it, once per REFRESH_EVERY at most, and only where a
// step moved. At the load it is read back,
// only the agents $.agent.list() still runs; without the list, none. The
// time it started is the first one, so the time and the estimate go on.
// Side sessions are not kept: the poll at load finds them again.
// One write at a time: the writes were started and not waited for, so two
// could be under way at once and the older list land last. `kp` is one
// kept list ({ prefix, list(), busy, due }; the agents' is st.kept): a call
// while a write is under way (`busy`) asks for one more after it (`due`),
// which takes the list as it stands then, so the last write always holds
// the latest list. Every caller gets the promise of the whole run, and it
// never rejects. The session's id is asked at each write: a /clear changes it.
const KEPT = ['id', 'type', 'description', 'model', 'effort', 'background', 'startedAt', 'step', 'part', 'tokens'];
async function agentsKey($) { try { const id = await $.session.id(); return id ? 'agents:' + id : null; } catch { return null; } }
function keepUnder($, kp) {
  kp.due = true;
  if (!kp.busy) kp.busy = writeKept($, kp);
  return kp.busy;
}
async function writeKept($, kp) {
  try {
    while (kp.due) {
      kp.due = false;
      try {
        const id = await $.session.id();
        if (!id) continue;
        const list = kp.list();
        if (list.length) await $.store.set(kp.prefix + id, list); else await $.store.delete(kp.prefix + id);
      } catch { /* no store or no id: this copy's own memory */ }
    }
  } finally { kp.busy = null; }
}
// the agents as they are kept (the list as it stands, steps and all: no
// step waits for the refresh after it)
function keptAgents(st) {
  st.stepMoved = false;
  return [...st.agents.values()].filter(a => !a.provisional && a.kind !== 'session')
    .map(a => Object.fromEntries(KEPT.filter(k => a[k] !== undefined && a[k] !== null).map(k => [k, a[k]])));
}
function keepAgents($, st) { return keepUnder($, st.kept); }
// the kept agents the engine still runs, into `agents`; how many came back
async function restoreAgents($, agents) {
  try {
    const key = await agentsKey($);
    const got = key ? await $.store.get(key) : null;
    if (!Array.isArray(got) || !got.length) return 0;
    const live = await liveAgents($);
    if (!live) return 0;
    let history = null;
    try { history = await $.store.get('agentRuns'); } catch { /* no history */ }
    let n = 0;
    for (const k of got) {
      if (!k || typeof k !== 'object' || typeof k.id !== 'string' || typeof k.type !== 'string' || typeof k.startedAt !== 'number' || !live.has(k.id) || agents.has(k.id)) continue;
      const runs = history && typeof history === 'object' && Array.isArray(history[k.type]) ? history[k.type] : [];
      agents.set(k.id, { ...k, background: !!k.background, step: k.step || null, runs });
      n++;
    }
    return n;
  } catch { return 0; }
}

// ---- side sessions this session started ----
// The engine lists no other sessions. The desktop app's own list_sessions
// tool does, with `isRunning` and `startedBy`: the module calls it like a
// tool ($.tool.call, no dialog), only while a side session of this one runs,
// for a minute after one was started or messaged, once at load and once at a
// turn's end; never in a session that started none. Not a documented
// interface, the desktop app's alone: anything missing or unreadable is none.
export const SESSIONS_TOOL = 'mcp__ccd_session_mgmt__list_sessions';
// the rows of a list_sessions answer, or [] when it reads as nothing
// (a live answer: `text`, the rows as JSON, and `result`, the tool's content
// as an array of { type, text })
export const sessionRows = res => {
  for (const t of textsOf(res)) { try { const v = JSON.parse(t); if (Array.isArray(v)) return v; } catch { /* not this one */ } }
  return [];
};
// the side sessions of `host` that are working now, as running entries
export const workingSessions = (rows, host) => (host ? rows.filter(r => r && r.startedBy === host && r.isRunning === true && !r.isArchived) : []);
export const startedBy = (rows, host) => (host ? rows.filter(r => r && r.startedBy === host && !r.isArchived).length : 0);
// a side session's short title: its title cut to 24 characters
export const shortTitle = row => { const t = String((row && (row.title || row.name)) || 'side session'); return chars(t) > 24 ? [...t].slice(0, 23).join('') + '…' : t; };
export const sessionStartedText = (row, list) => {
  const rest = list.filter(x => x.id !== row.sessionId);
  const also = rest.length ? '; ' + others(rest, 'also') : '';
  return firstFit([
    ICON.started + ' side session ' + shortTitle(row) + ' is running' + also + '.',
    ICON.started + ' a side session is running' + also + '.',
  ], MSG_MAX);
};
export const sessionDoneText = (a, ms, list) => firstFit([
  ICON.done + ' side session ' + (a.label || 'side session') + ' ended its turn after ' + dur(ms) + '; ' + others(list, 'still') + '.',
  ICON.done + ' a side session ended its turn after ' + dur(ms) + '.',
], MSG_MAX);
// the refresh while anything runs: every REFRESH_EVERY, the line and the
// band redrawn from what the module knows; the agents settled every
// SETTLE_EVERY; side sessions polled every POLL_EVERY while one runs or is
// watched; the progress toast every PROGRESS_EVERY. Stops when nothing runs
// and nothing is watched.
function startTick($, st) {
  if (st.timer) return;
  st.timer = $.clock.every(REFRESH_EVERY, () => { tick($, st).catch(() => { /* a refresh never disturbs the session */ }); });
}
function stopTickOf(st) { if (st.timer) { try { st.timer.cancel(); } catch { /* gone */ } st.timer = null; } }
async function tick($, st) {
  const t = await $.clock.now();
  if (t - st.settledAt >= SETTLE_EVERY) { st.settledAt = t; await settleAgents($, st, t); }
  // a step that moved since the last write: kept now, once per refresh
  if (st.stepMoved) await keepAgents($, st);
  const watching = t < st.watchUntil || [...st.agents.values()].some(a => a.kind === 'session');
  if (watching && t - st.polledAt >= POLL_EVERY) await pollSessions($, st, t);
  if (!st.agents.size && t >= st.watchUntil) stopTickOf(st);
  $.ui.status(st.lineNow(t));
  redraw($);
  if (st.agents.size && t - st.progressAt >= PROGRESS_EVERY) {
    st.progressAt = t;
    if ((await noticesOn($)) && !(await paneShown($, st))) $.ui.toast(progressText(st.list(), t));
  }
}
// the room for the status line, from the surfaces that draw the session
// (lineMaxOf), into st.max: asked once and kept (st.surfaces) until one
// attaches or detaches; an answer of none is asked again next time, an
// engine without the call keeps LINE_MAX. Whether it changed.
async function learnSurfaces($, st) {
  if (st.surfaces) return false;
  let list;
  try { list = await $.session.surfaces(); } catch { st.surfaces = []; return false; }
  if (!Array.isArray(list) || !list.length) return false;
  st.surfaces = list;
  const was = st.max;
  st.max = lineMaxOf(list);
  return st.max !== was;
}
// the line drawn again as it stands, by the engine's clock
async function redrawLine($, st) {
  const line = st.lineNow(await $.clock.now());
  if (line !== undefined) $.ui.status(line);
}
// this session's id, as the app's records and list_sessions name it
async function hostOf($, st) {
  if (st.host) return st.host;
  try { const h = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID'); if (h) st.host = h; } catch { /* not in this environment */ }
  if (!st.host) { const r = st.reading(); if (r && typeof r.hostSessionId === 'string') st.host = r.hostSessionId; }
  return st.host;
}
// the side sessions this one started that are working now, into st.agents;
// a toast as one starts and as one ends its turn, but none at a quiet poll
// (the one at load: what already ran is no news)
async function pollSessions($, st, t) {
  st.polledAt = t;
  let rows;
  try { rows = sessionRows(await $.tool.call({ tool: SESSIONS_TOOL, linked: true })); } catch { return; }
  const host = await hostOf($, st);
  if (!host) return;
  const live = workingSessions(rows, host);
  st.children = startedBy(rows, host);
  const ids = new Set(live.map(r => r.sessionId));
  const quiet = st.quiet;
  const notify = !quiet && (await noticesOn($));
  let changed = false;
  for (const [id, a] of st.agents) {
    if (a.kind === 'session' && !ids.has(id)) {
      st.agents.delete(id);
      changed = true;
      if (notify && !(await paneShown($, st))) $.ui.toast(sessionDoneText(a, t - a.startedAt, st.list()), { timeoutMs: TOAST_LONG });
    }
  }
  for (const r of live) {
    if (st.agents.has(r.sessionId)) continue;
    if (!st.agents.size) st.progressAt = t;
    // one the main thread just started or messaged: its time from then
    const since = st.watchSince && t - st.watchSince <= WATCH_FOR ? st.watchSince : t;
    st.agents.set(r.sessionId, { id: r.sessionId, kind: 'session', type: r.name || r.title || 'session', label: shortTitle(r), description: r.title, startedAt: since, background: true, runs: [], step: null });
    changed = true;
    if (notify && !(await paneShown($, st))) $.ui.toast(sessionStartedText(r, st.list()));
  }
  st.quiet = false;
  if (st.agents.size) startTick($, st);
  if (changed) { $.ui.status(st.lineNow(t)); redraw($); }
}
// Whether the pacing pane is on show in full: it lists the agents at work,
// so a toast that one started, still runs or is done says nothing new there
// (the user's word: too many boxes; a finished agent leaves the list, and
// its answer comes in the chat). A pane behind another tab, waiting undrawn or minimized (`st.paneGlance`,
// set as it is drawn) shows no agents, and the toasts go on.
async function paneShown($, st) {
  try {
    if (st && st.paneGlance) return false;
    const panes = await $.ui.panes();
    return !!panes && panes.some(p => p.id === PANE_ID && p.isShown !== false && p.isPlaced !== false);
  } catch { return false; }
}
// whether the toasts about agents are on (config.json's agentNotices; on unless false)
async function noticesOn($) { return settingOn($, 'agentNotices'); }
// whether the offer to switch the session's model or effort is on (switchAsk)
async function switchOn($) { return settingOn($, 'switchAsk'); }
// the effort the session runs at: as last set in it (`ss`, see "the
// session's model and effort as last set"), else where the engine says
// (CLAUDE_EFFORT, fixed at the session's start)
async function effortNow($, ss = null) {
  if (ss && ss.effort) return ss.effort;
  try { const v = await $.env.get('CLAUDE_EFFORT'); return typeof v === 'string' && v ? v : null; } catch { return null; }
}

// ---- the session's model and effort as last set ----
// /model and /effort switch the session at once, but what the module reads
// lags: CLAUDE_EFFORT is fixed at the session's start, and the app's model
// menu and the turn's usage name the old model until the next turn. A live
// press of Switch ran both and the session did switch, yet it read as a
// switch that had failed, and the row would have offered it again. So the
// module notes what each of the two commands set when it ran without an
// error, pressed or typed (command.run), in `ss` ({ model, effort }), kept in
// $.store under the session's id ('switch:<id>') so a reload keeps it. The
// effort stands for the session; the model until the next turn's usage names
// one. A model given by an alias ("opus") is noted as the id the session
// reports, where that agrees.
async function switchKey($) { try { const id = await $.session.id(); return id ? 'switch:' + id : null; } catch { return null; } }
async function keepSwitch($, ss) {
  try {
    const key = await switchKey($);
    if (!key) return;
    if (ss.model || ss.effort) await $.store.set(key, { model: ss.model, effort: ss.effort }); else await $.store.delete(key);
  } catch { /* no store or no id: this copy's own memory */ }
}
async function restoreSwitch($, ss) {
  try {
    const key = await switchKey($);
    const got = key ? await $.store.get(key) : null;
    if (!got || typeof got !== 'object') return;
    if (!ss.model && typeof got.model === 'string' && got.model) ss.model = got.model;
    if (!ss.effort && EFFORT_ORDER.includes(got.effort)) ss.effort = got.effort;
  } catch { /* none kept */ }
}
// a /model or /effort that ran: what it set, into `ss`; whether it noted anything
export const commandFailed = r => !!r && ((typeof r.exitCode === 'number' && r.exitCode !== 0) || r.isError === true);
async function noteSet($, ss, command, args) {
  const v = String(args || '').trim().toLowerCase();
  if (command === 'effort') {
    if (!EFFORT_ORDER.includes(v)) return false;
    ss.effort = v;
  } else if (/^claude-[a-z]+-\d+-\d+/.test(v)) ss.model = v;
  else if (/^[a-z]+$/.test(v)) {
    let id = null;
    try { id = await $.session.model(); } catch { /* not known */ }
    if (typeof id !== 'string' || !id.startsWith('claude-' + v + '-')) return false;
    ss.model = id;
  } else return false;
  await keepSwitch($, ss);
  return true;
}

// ---- each finished task of a role agent, on record ----
// The session used to be told to run `config.mjs agent <role> <agent id>
// <model> <effort> <tokens>` after every task of a role agent: a tool call,
// and so a turn of its whole history, for bookkeeping. The module runs the
// same command when a run of pacing:reader, implementer, verifier or
// researcher ends by itself, with what the engine gives:
//   role    the agent's type
//   id      the id its spawn answered, the one SendMessage resumes it by
//   model   the model that answered its last request (the run's usage), else
//           the one its spawn resolved, as the short name config.mjs takes
//   effort  the Agent call's `effort`; else what the engine's list says the
//           agent runs at; else the session's own (an agent that names none
//           takes the session's). A kept agent's later tasks come by
//           SendMessage, with no Agent call: its effort is remembered by id.
//   tokens  the engine's list has them (`tokenCount`: the latest request's
//           input and all its output, the figure the agent's notification
//           gives), asked once as the run ends; else the last figure the
//           refresh saw while it ran. The run's own usage is not it: that is
//           every request summed, many times the agent's size.
//   spent   that usage, the run's requests summed, as input, output, cache
//           read and cache write (--spent): what the task cost, which
//           saved.mjs prices. Left out where the run reported no usage.
// Without a model config.mjs knows, an effort or a token count there is no
// record: a guessed one would say "start a fresh agent" at the wrong time.
// The command says when the role's next task goes to a fresh agent (five
// tasks, or 150 000 tokens). That, and nothing else, reaches the session:
// one hidden line beside the next prompt, as the request for a full reading
// is added; dropped if a fresh agent of that role started meanwhile.
const ROLES = ['reader', 'implementer', 'verifier', 'researcher'];
export const roleFor = type => { const m = /^(?:pacing:)?([a-z]+)$/.exec(String(type || '')); return m && ROLES.includes(m[1]) ? m[1] : null; };
// "claude-haiku-5-5", "haiku" -> "haiku"
export const shortModel = id => { const m = /^(?:claude-)?([a-z]+)/.exec(String(id || '').toLowerCase()); return m ? m[1] : null; };
// what a run's usage spent, { in, out, read, write }, or null without usage
export const spentOf = u => (u ? { in: u.input_tokens || 0, out: u.output_tokens || 0, read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0 } : null);
export const recordArgv = (root, role, id, model, effort, tokens, spent = null) => ['node', root + '/skills/pacing/scripts/config.mjs', 'agent', role, id, model, effort, String(Math.round(tokens)),
  ...(spent && ['in', 'out', 'read', 'write'].every(k => amount(spent[k])) ? ['--spent', ['in', 'out', 'read', 'write'].map(k => Math.round(spent[k])).join(',')] : [])];
// "the next implementer task goes to a fresh agent (5 tasks or 150k tokens reached)", from the command's answer; or null
export const freshOf = out => { const m = /the next \w+ task goes to a fresh agent(?: \([^)\n]*\))?/.exec(String(out || '')); return m ? m[0] : null; };
export const freshNote = lines => (lines.length
  ? 'Pacing (automatic note, not from the user): ' + lines.join('; ') + '. Start a new agent of that role for it, not the kept one.'
  : null);
// what the engine's list says of one agent, whatever its status; null without it
async function agentRow($, id) { try { return (await $.agent.list()).find(a => a.id === id) || null; } catch { return null; } }
// the record of one finished task; answers the line about a fresh agent, or null
async function recordAgent($, a, usage, ss = null) {
  try {
    const role = roleFor(a.type);
    if (!role) return null;
    const row = await agentRow($, a.id);
    const model = shortModel((usage && usage.model) || (row && row.model) || a.model);
    const effort = [a.effort, row && row.effort, await effortNow($, ss)].find(v => EFFORT_ORDER.includes(v));
    const tokens = row && row.tokenCount > 0 ? row.tokenCount : a.tokens;
    if (!model || !effort || !(tokens > 0)) return null;
    const r = await $.process.run(recordArgv($.plugin.root, role, a.id, model, effort, tokens, spentOf(usage)), { timeoutMs: 20000 });
    return r.exitCode === 0 ? freshOf(r.stdout) : null;
  } catch { return null; }
}

// ---- reports the module answers itself ----
// /pacing-usage, /pacing-help, /pacing-guide, /pacing-doctor and
// /pacing-saved run the same scripts the skill runs and show their output as
// the command's own, as /pacing-status does: no model call. A command's
// text is drawn as markdown, so the usage report (bars and a table in
// fixed-width columns), the self-check and the savings table go in a fenced
// code block, as the skill shows them, and the help and the guide, markdown
// themselves, as they are. Each is marked for the person alone
// (isTextDisplayOnly): the session never reads it, so the guide's 30 000
// characters cost nothing on later turns. None is `immediate`: a command
// answered while a turn runs keeps its text in the requests, so these wait
// for the turn to end.
async function scriptOut($, script, args) {
  const r = await $.process.run(['node', $.plugin.root + '/skills/pacing/scripts/' + script, ...args], { timeoutMs: 20000 });
  return r.exitCode === 0 ? String(r.stdout || '').replace(/\r/g, '') : null;
}
// "measure: <why>" from `budget.mjs last`: the why, or null for a report
export const measureWhy = out => { const m = /^measure: (.*)$/m.exec(String(out || '')); return m ? m[1].trim() : null; };
// the bars and the tier sheet (every line before "day N of M") in a code
// block, and under it what to do now where that is the point: over the
// budget line or worse, or a model the session should leave. The module
// shows this, so its Switch row is there: the steps for a session without
// the module are left out.
export const usageText = out => {
  const lines = String(out || '').replace(/\r/g, '').split('\n');
  const end = lines.findIndex(l => /^day \d+ of \d+/.test(l));
  const block = (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();
  const level = (lines.find(l => /^(Weekly|All models) used /.test(l)) || '').split(' -> ')[1] || '';
  const now = (lines.find(l => l.startsWith('do: ')) || '').slice(4).replace(/ \(without the hooks module: [^)]*\)/g, '');
  return '```\n' + block + '\n```' + (now && (/^(over|throttle|stop)/.test(level) || now.includes('Switch row')) ? '\nNow: ' + now : '');
};

// ---- an offer to switch the session's model or effort ----
// The reading recommends what the session should run on. Where the session
// runs on something else, a row above the prompt offers it with Switch and
// Not now, by urgency:
//   out     the per-model meter's model is out until the reset: warning colour
//   held    that meter is over its line: warning colour
// Nothing else: a session on another model or effort than recommended gets
// no row, since the plugin moves the work to subagents on the right models
// by itself (the user's word: switch only sometimes, never less effort for
// being over).
// Switch runs /model and /effort as if typed (a live test: $.command.run
// with /model answered "Set model to ... for this session only", and
// $.session.model() agreed); where a run fails, the box is filled with the
// command for the user to send. Once per suggestion; Not now holds until the
// recommendation changes. Never switches without the press.
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const sameModel = (cur, id) => typeof cur === 'string' && typeof id === 'string' && cur.startsWith(id);
// A switch in a large session is dear: each model has its own cache, so the
// next turn stores the whole session again at the new model's cache-write
// price (400K tokens to Opus 5.5: $2, a third of a point of the week), where
// staying reads it at a small fraction of that. So from SWITCH_LARGE tokens
// (`ctx`, the session's size at the last measure) an offer that changes the
// model says so, with what it costs in the status line's unit, and the row
// gains "Compact, then switch": the compaction first, so the switch stores
// the summary. Not where the model is out (compacting runs on it).
export const SWITCH_LARGE = 200000;
// A held per-model meter is a row only when it is far over its line, by
// HELD_SWITCH_AT points or more (the user's word: a button to switch from
// Fable when much over, 20+); short of that the subagents take the work.
export const HELD_SWITCH_AT = 20;
export const heldFar = j => typeof j.premium === 'number' && typeof j.line === 'number' && j.premium - j.line >= HELD_SWITCH_AT;
export const switchOffer = (j, curModel, curEffort, ctx = null) => {
  if (!j || typeof curModel !== 'string' || !curModel) return null;
  const rec = j.recommend, prem = j.premiumModelId, name = j.premiumLabel || 'The per-model model';
  const onPrem = sameModel(curModel, prem);
  // from: the model the offer saw the session on, which the press goes by
  const make = (kind, t, text) => {
    const large = kind !== 'out' && !sameModel(curModel, t.model) && typeof ctx === 'number' && ctx >= SWITCH_LARGE;
    const price = j.prices && Array.isArray(j.prices[t.model]) ? j.prices[t.model][3] : 0;
    const cost = large ? costText(j, ctx * price / 1e6) : '';
    return { kind, from: curModel, model: t.model, label: t.label, effort: t.effort, urgent: kind === 'out' || kind === 'held', compactFirst: large,
      text: text + (large ? ' A switch stores this session\'s ' + kTok(ctx) + ' tokens again' + (cost ? ' (about ' + cost + ' of the budget)' : '') + ': compact first.' : ''),
      icon: kind === 'out' ? ICON.stop : kind === 'held' ? ICON.worse : ICON.switched, key: kind + ':' + t.model + ':' + t.effort };
  };
  if (rec && onPrem && !sameModel(rec.model, prem) && j.premiumOut)
    return make('out', rec, name + ' is out until the reset. Switch this session to ' + rec.label + ' ' + rec.effort + '.');
  if (rec && onPrem && !sameModel(rec.model, prem) && j.premiumHeld && heldFar(j))
    return make('held', rec, name + '\'s meter is over its budget line. Switch to ' + rec.label + ' ' + rec.effort + '; ' + name.split(' ')[0] + ' stays for hard tasks.');
  // Nothing else: the plugin changes models and effort by itself, through
  // the subagents it starts (the user's word: the user switches only
  // sometimes). A session on another model or effort than recommended is
  // left alone; only a model it cannot go on with is a row.
  return null;
};
// After a press. `was`: the model before it; where the model changed, the
// app's model menu may go on naming that one for a while, and the toast says
// so. A read-back that disagrees right after the press is read again after
// READ_BACK_LAG; a command that ran without an error is trusted over it.
export const READ_BACK_LAG = 2000;
// Work a press starts and must not wait for. A press hook that has waited
// 10 s is dropped, and the command it queued with it (live: "ui.press hook
// skipped: ran past its 10s budget", and no switch). A queued command waits
// for the session to be free: /compact itself takes a minute, and a /model
// queued behind one waits as long. So a press returns at once and its work
// runs from a timer, which no dispatch waits on.
function later($, work) {
  const run = () => { Promise.resolve().then(work).catch(() => { /* its own toasts say what failed */ }); };
  try { $.clock.after(0, run); } catch { run(); }
}
// a queued command that has not run after this long gets a toast saying it waits
export const RUN_WAIT = 1500;
// /compact answers only once the compaction is over, a minute on: its toast
// waits longer, and is called off as the compaction starts (the user's word:
// no "runs as soon as" when it starts right away)
export const COMPACT_RUN_WAIT = 4000;
export const switchWaitText = target => ICON.switched + ' the switch to ' + target.label + (target.effort ? ' ' + target.effort : '') + ' runs as soon as the session is free.';
export const COMPACT_WAIT_TEXT = ICON.compacted + ' compacting: /compact runs as soon as the session is free.';
export const switchedText = (target, nowModel, nowEffort, was = null) => (sameModel(nowModel, target.model)
  ? ICON.switched + ' this session now runs on ' + modelLabel(nowModel) + (nowEffort ? ' ' + nowEffort : target.effort ? ' ' + target.effort : '')
    + (typeof was === 'string' && was && !sameModel(was, target.model) ? '; the model menu may still show ' + modelLabel(was) : '') + '.'
  : ICON.failed + ' the switch did not take; the session still runs on ' + modelLabel(nowModel) + '. The model menu does it: ' + target.label + ', effort ' + target.effort + '.');
// The head is what is left under the weekly meter's line, without the
// level's word. The per-model meter shows as its week's usage among the
// meters and nowhere else: a share of its line ("Fable held 158%") read as
// usage over 100 %.
// A side session (one another session started, `spawned`) shows no per-model
// meter at all: the figure is the account's, its session on the per-model
// model is the one that started it, and in a side session's narrow line it
// read as the side session's own use.
const sideOf = (j, self) => self !== null || j.spawned === true;
// The compact line: what is left of the budget (budgetText), then the usage
// meters, with no tiers (the tier split is /pacing-status's, in the long form):
//   Budget tokens: 850K · usage: Weekly 36% Fable 40%
// A side session leads with a plain "sub" and shows no per-model meter.
// The budget part and the usage always show, whole, at any width. While
// subagents run (`agents`, see "subagents at work"), the line leads with
// their count in what is left of `max` (LINE_MAX, or LINE_MAX_NARROW where
// the desktop app draws it): "sub" if it costs the agents nothing, the
// agents' count, without "running" where that does not fit, "⏳2" where even
// that does not (shown all the same, past `max`):
//   ⏳ 2 Subagents · Budget tokens: 850K · usage: Weekly 36% Fable 40%   (desktop)
//   ⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 36% Fable 40%
// `mix` is no longer drawn here; it stays in the signature for fullText's sake.
export const statusText = (j, mix, self = null, now = Date.now(), agents = [], max = LINE_MAX) => {
  const side = sideOf(j, self);
  const name = j.premiumLabel && !side ? j.premiumLabel.split(' ')[0] : null;
  // what is left under today's budget line, without a word on the level:
  // under zero is over. The toast on a change of level says the rest.
  const level = budgetText(j);
  const sub = side ? 'sub' : null;
  let usage = 'usage: Weekly ' + Math.round(j.all) + '%';
  // the per-model figure as last read, plainly: its age and the estimate are
  // /pacing-status's, and a stale one still brings the note asking for a
  // full reading
  if (j.premium != null && name) usage += ' ' + name + ' ' + Math.round(j.premium) + '%';
  const tail = level + ' · ' + usage;
  if (!agents.length) return [sub, tail].filter(Boolean).join(' · ');
  // the agents' share: what the budget and the usage leave. "sub" goes first
  // only where it costs the agents no word.
  const room = max - chars(tail) - 3;
  const lead = agentPart(agents, now, room);
  const withSub = sub && agentPart(agents, now, room - chars(sub) - 3) === lead;
  return [withSub ? sub : null, lead, tail].filter(Boolean).join(' · ');
};

// a tier number as the user reads it: the model with its effort, as
// budget.mjs names it (tierNames); from an older budget.mjs, the model alone
// by tierOf; "Other" off the ladder
export const tierName = (j, tier) => {
  if (tier === 'Other') return 'Other';
  const names = j && j.tierNames && typeof j.tierNames === 'object' ? j.tierNames : {};
  if (typeof names[tier] === 'string' && names[tier]) return names[tier];
  const ids = Object.entries((j && j.tierOf) || {}).filter(([, n]) => n === tier).map(([id]) => modelLabel(id));
  return ids.length ? [...new Set(ids)].join(' / ') : 'Tier ' + tier;
};
// the long form, as the line read before 0.9.5: for /pacing-status. Models
// by name and effort, never a tier number: "🟡Fable 5.2 high 80%"; a side
// session leads with the model it runs on (`model`, its id, names one off
// the ladder): "⚪side session on Opus 5.5 medium".
export const fullText = (j, mix, self = null, now = Date.now(), model = null) => {
  const side = sideOf(j, self);
  const meters = [Math.round(j.all) + '% Weekly'];
  // the engine never hands a plugin the per-model meter: its figure is carried
  // over from the last full reading, and is never shown as current once old.
  // A side session shows none (sideOf).
  if (j.premium != null && j.premiumLabel && !side) {
    const age = j.premiumAt ? now - Date.parse(j.premiumAt) : 0;
    const old = age > CARRIED_CURRENT;
    meters.push(Math.round(j.premium) + '% ' + j.premiumLabel.split(' ')[0]
      + (old ? ' ' + ageText(age) + ' ago' + (j.premiumEstimate != null && Math.round(j.premiumEstimate) > Math.round(j.premium) ? ', est. ' + Math.round(j.premiumEstimate) + '%' : '') : ''));
  }
  const parts = [];
  // what is left under the weekly meter's line; the per-model meter shows as
  // its usage among the meters only (see statusText)
  // (the "Now:" line /pacing-status adds says what to do about it)
  const share = budgetWords(j);
  if (self !== null) parts.push(square(self) + 'side session on ' + (self === 'Other' && model ? modelLabel(model) : tierName(j, self)) + (share ? ' - ' + share : ''));
  else if (share) parts.push(share);
  if (mix.length) parts.push(mix.map(x => square(x.tier) + tierName(j, x.tier) + ' ' + x.share + '%').join(' '));
  parts.push('(' + meters.join(', ') + ')');
  return parts.join(', ');
};

// the status line from a reading. A side session leads with its own tier, by
// the model its main thread runs on; a model off the ladder is Other.
export const lineOf = (j, model, tokens, agentTokens, now, full = false, agents = [], max = LINE_MAX) => {
  const prices = j.prices || {}, tierOf = j.tierOf || {};
  const child = j.spawned === true && typeof model === 'string' && model !== '';
  const id = child ? idOf(model, prices) : null;
  const self = child ? (id && tierOf[id]) || 'Other' : null;
  if (full) return fullText(j, tierMix(tokens, tierOf, prices, agentTokens, j.agentTierOf), self, now, child ? model : null)
    + (agents.length ? '\nRunning: ' + agents.map(a => (a.kind === 'session' ? 'side session ' : '') + detail(a, now, { task: TASK_MAX, time: 1, est: 1, step: 1 }) + (runOn(a) ? ' (' + runOn(a) + ')' : '') + (a.kind === 'session' && a.description ? ', ' + a.description : '')).join('; ')
      + (agents.some(a => !partText(a) && estText(a, now)) ? '\n~ is a rough estimate from how long that kind of agent usually takes, not a measure of the work done.' : '') : '');
  return statusText(j, tierMix(tokens, tierOf, prices, agentTokens, j.agentTierOf), self, now, agents, max);
};

// ---- a new version: the new-version row ----
// The desktop app syncs installed plugins about every 20 minutes and
// replaces this plugin's files in place; an open session runs the old code
// until /reload-plugins. The module says so:
//   it knows the version it was loaded as (plugin.json, read at load) and
//   reads the file again RELOAD_AFTER_TURN after a turn ends and every
//   RELOAD_CHECK_EVERY: one $.fs.read, no process, no model call;
//   another version there, in a session a person has typed in: a row above
//   the prompt at once, "📦 Pacing 0.9.16 is installed: type /reload-plugins
//   to load it, or open a new session." with Not now, once per version (the
//   band hides it during a turn and under a survey).
// Nothing runs /reload-plugins from here, and nothing fills the prompt: run
// from a timer the command never answered live (0.9.11 to 0.9.13), and a
// Reload button (0.9.14, 0.9.15) met "/reload-plugins isn't available over
// a remote connection in this session." on every press there. The person
// types it, or opens a new session, which loads the new version.
// The row stays until this copy is replaced or Not now is pressed (that
// version only; the next one shows it again).
// A manifest that does not read or names no version (half-written during a
// sync) is no change, and is read again at the next look. A side session
// nobody types in is left alone: it loads the new version at its next start.
// `/pacing reload off`: no row, one toast per version with the same text.
export const RELOAD_CHECK_EVERY = 5 * 60 * 1000;
export const RELOAD_AFTER_TURN = 2 * 1000;
// the version a manifest's text names, or null
export const versionOf = text => { try { const v = JSON.parse(text).version; return typeof v === 'string' && v ? v : null; } catch { return null; } };
export const reloadText = version => ICON.waiting + ' Pacing ' + version + ' is installed: type /reload-plugins to load it, or open a new session.';
// whether the new-version row is on (config.json's autoReload; on unless false)
async function reloadOn($) { return settingOn($, 'autoReload'); }
// ---- the newest shared reading ----
// Each session took its own readings and kept its own figure, so two
// sessions side by side showed different budgets (live: 28.9M and 10.4M). A
// reading's account-wide part (the meters, the budget line, what is left and
// the rate) is the same for every session, and budget.mjs writes it to
// line.json as well; every SHARED_EVERY each session takes it in where it
// is newer than the reading it holds, and redraws its status line. The
// level and its toasts stay the session's own readings'.
export const SHARED_EVERY = 60 * 1000;
const SHARED_KEYS = ['t', 'all', 'line', 'ofBudget', 'usdPerPoint', 'rateFrom', 'left', 'tokenUsd', 'paceUsd', 'premium', 'premiumAt', 'premiumOut'];
// Between readings: budget.mjs takes off what every local session spent
// since the meter last moved, at each reading; until the next one, the
// status line takes off what this session spent since its reading came in
// (`usd`), at the reading's full-price token (`tokenUsd`).
export const liveLeft = (j, usd) => {
  if (!j || !j.left || typeof j.left.tokens !== 'number' || !(j.tokenUsd > 0) || !(usd > 0)) return j;
  return { ...j, left: { ...j.left, tokens: j.left.tokens - Math.round(usd / j.tokenUsd) } };
};
export const sharedOf = text => {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || Number.isNaN(Date.parse(j.t)) || typeof j.all !== 'number' || typeof j.line !== 'number') return null;
  const out = {};
  for (const k of SHARED_KEYS) if (k in j) out[k] = j[k];
  // a reading without the per-model figure leaves the one held
  if (out.premium === null) { delete out.premium; delete out.premiumAt; delete out.premiumOut; }
  return out;
};
async function readShared($) {
  try { return await pacingFile($, 'line.json'); } catch { return null; }
}
// `sh`: the reading held (held), taking the shared part in (take), the line
async function takeShared($, sh) {
  const held = sh.held();
  if (!held) return;
  const j = sharedOf(await readShared($));
  if (!j || !(Date.parse(j.t) > (Date.parse(held.t) || 0))) return;
  sh.take(j);
  let now;
  try { now = await $.clock.now(); } catch { now = Date.now(); }
  $.ui.status(sh.lineNow(now));
  redraw($);
}
// the version plugin.json names now; null when unreadable
async function versionOnDisk($) { try { return versionOf(await $.fs.read($.plugin.root + '/.claude-plugin/plugin.json')); } catch { return null; } }
function say($, text) { try { $.ui.toast(text, { timeoutMs: TOAST_LONG }); } catch { /* an engine without toasts */ } }
// Reloaded in one session, the row stayed in the others (the user's word:
// it leaves the message open there). /reload-plugins loads the new version
// in the session it is typed in alone, and a reload tells a module nothing
// of itself, so each copy notes the version it loaded as under its session
// (`version:<id>`, in the store, which outlives the copy); a copy that finds
// an older one there is a reload into a new version, and says so to every
// session (RELOADED). Then the others drop the row at their next look: the
// person has seen it and acted once. They run the older code until their
// own reload or a new session, as before.
export const RELOADED = 'reloadedTo';
async function noteLoaded($, version) {
  try {
    const id = await $.session.id();
    if (!id) return;
    const key = 'version:' + id;
    const was = await $.store.get(key);
    if (typeof was === 'string' && was !== version) await $.store.set(RELOADED, version);
    if (was !== version) await $.store.set(key, version);
  } catch { /* the row stays in the others, as before */ }
}
// The store's keys under a session's id (the version it loaded as, the model
// and effort last set, its running agents, its background tasks): nothing deleted them, so the
// store gained one or more per session for good. An ending session's go
// (session.end). Those left by sessions before that, once a day at a load:
// a `version:` key naming another version than this copy's is a session
// that ended or runs older code (should it reload after all, the other
// sessions keep their row for that one time).
export const PRUNED = 'prunedAt';
export const PRUNE_EVERY = 24 * 3600000;
const SESSION_KEYS = ['version:', 'switch:', 'agents:', 'tasks:'];
async function dropKeys($, id) {
  if (!id) return;
  for (const k of SESSION_KEYS) { try { await $.store.delete(k + id); } catch { /* no store */ } }
}
async function pruneKeys($, version) {
  try {
    const now = await $.clock.now();
    const at = await $.store.get(PRUNED);
    if (typeof at === 'number' && now - at < PRUNE_EVERY) return;
    const keys = await $.store.keys();
    const own = 'version:' + (await $.session.id());
    for (const key of keys) {
      if (!key.startsWith('version:') || key === own) continue;
      const v = await $.store.get(key);
      if (typeof v === 'string' && v !== version) await $.store.delete(key);
    }
    await $.store.set(PRUNED, now);
  } catch { /* an engine without keys(): they stay */ }
}
async function reloadedElsewhere($, version) { try { return (await $.store.get(RELOADED)) === version; } catch { return false; } }
// one look at the version on disk; `rl` is the copy's memory (see register).
// Never throws: a look is a convenience, and the next one tries again.
async function look($, rl) {
  if (rl.looking) return;
  rl.looking = true;
  try {
    const disk = await versionOnDisk($);
    if (!disk) return;
    // this copy's first look: what it was loaded as
    if (rl.loaded === null) { rl.loaded = disk; await noteLoaded($, disk); await pruneKeys($, disk); return; }
    // the row up, and the person reloaded into that version in another session
    if (rl.row && rl.row === disk && await reloadedElsewhere($, disk)) { rl.row = null; redraw($); return; }
    if (disk === rl.loaded || disk === rl.acted || !rl.typed()) return;
    rl.acted = disk;
    // reloaded in another session already: no row here
    if (await reloadedElsewhere($, disk)) return;
    // off: one toast for this version, no row
    if (!(await reloadOn($))) { say($, reloadText(disk)); return; }
    // the row for this version, unless Not now was pressed for it
    if (rl.dismissed.has(disk)) return;
    rl.row = disk;
    redraw($);
  } catch { /* the next look */ } finally { rl.looking = false; }
}

// ---- background tasks ----
// A shell the session runs in the background (Bash or PowerShell with
// run_in_background, or one the person moved there with Ctrl+B), a monitor
// and a workflow each answer their call with a task id and go on after it.
// The pane lists them at its foot, as the app's own tasks list does: the
// kind, the description (else the command, shortened), how long it has run.
// Subagents are not among them: they are the pane's "Agents at work".
// The engine hands a plugin no list of such tasks, so the module keeps one:
//   a start is the call's own result in the main thread (taskStarted): Bash's and
//   PowerShell's `backgroundTaskId`, Monitor's and Workflow's `taskId`;
//   an end is the task's notification, a prompt of origin
//   `task-notification` whose text names the task and how it ended (taskEnded:
//   <task-id> and <status>), or a TaskStop call that names it.
// A finished one stays TASK_DONE_FOR with its status (✓ done, ✗ failed,
// ■ stopped), then goes; a monitor whose own deadline passed that long ago
// with no word goes too. A subagent's background tasks are left out: their
// notifications go to the subagent, and nothing here would end the row. No
// toasts. Kept in $.store under the session's id ('tasks:<id>') as the
// agents are, so a reload keeps the list; a /clear keeps it too (the tasks
// are the process's, not the conversation's); the session's end deletes it.
// `tk` is the copy's memory of them ({ tasks, kept, timer }).
export const TASK_DONE_FOR = 60 * 1000;
// while any is listed the pane is drawn again this often, for the times
export const TASK_EVERY = 60 * 1000;
const TASK_TOOLS = { Bash: 'shell', PowerShell: 'shell', Monitor: 'monitor', Workflow: 'workflow' };
// the background task a tool call started, { id, kind, what, lasts } (lasts:
// a monitor's own time limit in ms, else null), or null: no such tool, a
// call refused, or one that ran in the foreground
export const taskStarted = (e, r) => {
  const kind = e ? TASK_TOOLS[e.tool] : null;
  const res = r && !r.deny && r.result && typeof r.result === 'object' ? r.result : null;
  if (!kind || !res) return null;
  const id = kind === 'shell' ? res.backgroundTaskId : res.taskId;
  if (typeof id !== 'string' || !id) return null;
  const what = kind === 'workflow' ? res.workflowName || e.name || '' : e.description || e.command || '';
  return { id, kind, what: cut(String(what).replace(/\s+/g, ' ').trim(), TASK_MAX),
    lasts: kind === 'monitor' && res.timeoutMs > 0 && !res.persistent ? res.timeoutMs : null };
};
// how a task ended, by the word its notification gives; a word not known
// here (a monitor's event in passing) is no end
const TASK_STATES = { completed: 'done', done: 'done', success: 'done', failed: 'failed', error: 'failed',
  killed: 'stopped', stopped: 'stopped', cancelled: 'stopped', canceled: 'stopped', timeout: 'stopped', expired: 'stopped' };
// the task a notification's text says has ended, { id, state }, or null
export const taskEnded = text => {
  const s = typeof text === 'string' ? text : '';
  const id = /<task[-_]id>\s*([^<\s][^<]*?)\s*<\/task[-_]id>/i.exec(s), status = /<status>\s*([^<]*?)\s*<\/status>/i.exec(s);
  const state = status ? TASK_STATES[status[1].toLowerCase()] : null;
  return id && state ? { id: id[1], state } : null;
};
// the pane's rows, oldest first: { kind, what, state, time }; `state` is
// 'running' or how it ended, `time` how long it has run or ran
export const taskRows = (tasks, now) => [...tasks].filter(t => !t.endedAt || now - t.endedAt < TASK_DONE_FOR).sort((a, b) => a.startedAt - b.startedAt)
  .map(t => ({ kind: t.kind, what: t.what, state: t.endedAt ? t.state : 'running', time: dur((t.endedAt || now) - t.startedAt) }));
function watchTasks($, tk) {
  if (tk.timer || !tk.tasks.size) return;
  try { tk.timer = $.clock.every(TASK_EVERY, () => { tasksTick($, tk).catch(() => { /* the next one */ }); }); } catch { /* no timers: drawn with the pane's other draws */ }
}
// what has stayed its minute goes, and the pane is drawn again; the timer
// stops with the last task
async function tasksTick($, tk) {
  let now;
  try { now = await $.clock.now(); } catch { now = Date.now(); }
  let gone = false;
  for (const [id, t] of tk.tasks) {
    if (t.endedAt ? now - t.endedAt >= TASK_DONE_FOR : t.until && now - t.until >= TASK_DONE_FOR) { tk.tasks.delete(id); gone = true; }
  }
  if (gone) keepUnder($, tk.kept);
  if (!tk.tasks.size && tk.timer) { try { tk.timer.cancel(); } catch { /* gone */ } tk.timer = null; }
  redraw($);
}
function noteTask($, tk, task, now) {
  tk.tasks.set(task.id, { id: task.id, kind: task.kind, what: task.what, startedAt: now, ...(task.lasts ? { until: now + task.lasts } : {}) });
  keepUnder($, tk.kept);
  watchTasks($, tk);
  redraw($);
}
function endTask($, tk, id, state, now) {
  const t = tk.tasks.get(id);
  if (!t || t.endedAt) return;
  t.state = state;
  t.endedAt = now;
  keepUnder($, tk.kept);
  redraw($);
  // its minute, then gone (the slow timer alone could leave it up to two)
  try { $.clock.after(TASK_DONE_FOR, () => { tasksTick($, tk).catch(() => { /* the next draw leaves it out */ }); }); } catch { /* no timers */ }
}
// the tasks kept under this session, into tk.tasks, after a reload
async function restoreTasks($, tk) {
  try {
    const id = await $.session.id();
    const got = id ? await $.store.get('tasks:' + id) : null;
    if (!Array.isArray(got)) return;
    for (const t of got) {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.startedAt !== 'number' || !Object.values(TASK_TOOLS).includes(t.kind) || tk.tasks.has(t.id)) continue;
      tk.tasks.set(t.id, { id: t.id, kind: t.kind, what: typeof t.what === 'string' ? t.what : '', startedAt: t.startedAt,
        ...(typeof t.until === 'number' ? { until: t.until } : {}),
        ...(typeof t.endedAt === 'number' && TASK_MARKS[t.state] ? { state: t.state, endedAt: t.endedAt } : {}) });
    }
    watchTasks($, tk);
    await tasksTick($, tk);
    // a finished one's minute goes on from its end: gone when it is over
    const now = await $.clock.now();
    for (const t of tk.tasks.values()) {
      if (t.endedAt) $.clock.after(Math.max(0, TASK_DONE_FOR - (now - t.endedAt)), () => { tasksTick($, tk).catch(() => { /* the next draw leaves it out */ }); });
    }
  } catch { /* none kept */ }
}

// ---- an agent's transcript, from its row in the pane ----
// A press on an agent's row in "Agents at work" puts that agent's transcript
// in the main view, as the app's own tasks list does ($.ui.view, which the
// engine allows only while a press, a pick or a prompt of the person's is
// being answered: so it runs within the press, not after it). Where the
// view does not move, a toast gives the engine's reason. A side session has
// no transcript the engine can show here, and an agent not yet spawned no
// id: their rows are text.
export const viewDeniedText = why => {
  const w = typeof why === 'string' ? why.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '') : '';
  return ICON.failed + ' the agent\'s transcript did not open' + (w ? ': ' + (w.length > 80 ? w.slice(0, 79) + '…' : w) : '') + '.';
};
// set once the engine says this session draws no main view: rows stop
// offering the press (a module variable: a reload tries again)
let viewNone = false;
async function openAgent($, id) {
  let why = null;
  try { const r = await $.ui.view({ agentId: id }); if (r && r.deny) why = r.deny; else return; } catch (err) { why = (err && err.message) || ''; }
  if (/no main view|draws none/i.test(String(why || ''))) { viewNone = true; redraw($); }
  try { $.ui.toast(viewDeniedText(why)); } catch { /* no toast */ }
}

// ---- what the band's buttons do ----
// The band's drawing (ui.render, AbovePrompt) only draws. What a press does
// stood inside it, written anew at every draw; it stands here, once. A
// Button's onPress is handed the press and no `$`, so the drawing gives
// each button a one-line closure over its own `$` that calls one of these.
// `pr` is what a press reads and writes of the copy's memory (see
// register): the model and effort last set and run on (ss, here), what
// calls off the toast of a queued /compact (waited), forget() and
// setContext(tokens) after a compaction.

// A toast when a queued command has not run after `wait`: the session is
// busy, and the command runs when it is free. Answers what calls it off.
function whileWaiting($, text, wait = RUN_WAIT) {
  let timer = null;
  try { timer = $.clock.after(wait, () => { try { $.ui.toast(text); } catch { /* no toast */ } }); } catch { /* no timers: no toast */ }
  return () => { try { if (timer) timer.cancel(); } catch { /* fired already */ } };
}
// /compact as if typed (command.run, queued until the session is free); it
// resolves once the compaction has run, and throws where none started. The
// toast that it waits is called off as the compaction starts (the
// session.compact hook, through pr.waited), so it shows only while the
// session is busy.
async function typedCompact($, pr) {
  const waited = whileWaiting($, COMPACT_WAIT_TEXT, COMPACT_RUN_WAIT);
  pr.waited = waited;
  try {
    const ran = await $.command.run({ command: 'compact', args: COMPACT_INSTRUCTIONS });
    if (commandFailed(ran)) throw new Error((ran && ran.text) || 'the /compact command failed');
  } finally { waited(); if (pr.waited === waited) pr.waited = null; }
}
// The direct call did not compact (`err`). The engine rejects it while a
// turn runs, and in the desktop app always: "$.session.compact: not
// available in a headless (-p / SDK) session yet: compaction here runs
// inside a turn" (seen live), while a typed /compact works there. So
// /compact runs as if typed; only where that fails too does a toast give the
// engine's reason and /compact go in the box. Whether a compaction ran. The
// one place for it: Compact now and Compact, then switch both come here.
async function compactTyped($, pr, err) {
  try { await typedCompact($, pr); return true; } catch (err2) {
    let filled = false;
    try { const f = await $.prompt.fill({ text: '/compact', mode: 'replace' }); filled = !f || f.isFilled !== false; } catch { /* the toast alone */ }
    $.ui.toast(compactFailedText((err2 && err2.message) || (err && err.message), filled), { timeoutMs: TOAST_LONG });
    return false;
  }
}
// Compact now, for the offer `shown` ({ tokens }: the band's row, or the
// pane's Compact button): the compaction, and a toast with the sizes.
// `pr.compacting` is set by the press that asked (see register: one at a
// time) and cleared here, however it ends; the pane's button reads it.
async function compactNow($, pr, shown) {
  try {
    let r;
    try { r = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS }); } catch (err) {
      if (await compactTyped($, pr, err)) { $.ui.toast(ICON.compacted + ' compacted.'); pr.forget(); }
      return;
    }
    if (r && r.skip) { $.ui.toast(ICON.failed + ' the compaction did not run: ' + r.skip, { timeoutMs: TOAST_LONG }); return; }
    $.ui.toast(compactedText((r && r.tokensBefore) || shown.tokens, r && r.tokensAfter));
    pr.forget();
    pr.setContext((r && r.tokensAfter) || null);
  } finally { pr.compacting = false; redraw($); }
}
// Switch, to the offer `target`: /model, then /effort, and the toast
async function runSwitch($, pr, target) {
  const { ss, here } = pr;
  let ran = true, was = null, modelRan = null;
  const waited = whileWaiting($, switchWaitText(target));
  try {
    // /model runs on every press, then /effort. What the module takes
    // for the session's model can be wrong: live, a read named the
    // target while the turns ran on another, and later the offer's own
    // model did, and each time a press ran /effort alone. /model to
    // the model the session runs on already does no harm.
    was = target.from || ss.model || (await $.session.model());
    // only the part that differs from what the session runs on (here);
    // with neither known to differ, /model all the same
    const modelSame = sameModel(here.model, target.model);
    // here is empty after a reload; the stored effort (ss) stands then
    const effortSame = !target.effort || (here.effort || ss.effort) === target.effort;
    if (!modelSame || effortSame) {
      modelRan = await $.command.run({ command: 'model', args: target.model });
      if (commandFailed(modelRan)) throw new Error('refused');
    }
    ss.model = target.model;
    here.model = target.model;
    if (target.effort && !effortSame) {
      if (commandFailed(await $.command.run({ command: 'effort', args: target.effort }))) throw new Error('refused');
    }
    if (target.effort) { ss.effort = target.effort; here.effort = target.effort; }
    await keepSwitch($, ss);
  } catch { ran = false; }
  waited();
  if (!ran) {
    // the command as text in the box, for the user to send
    try { await $.prompt.fill({ text: '/model ' + target.model, mode: 'replace' }); } catch { /* the menu alone */ }
    $.ui.toast(ICON.switched + ' press Enter to switch to ' + target.label + (target.effort ? '; then set effort ' + target.effort + ' in the model menu' : '') + '.', { timeoutMs: TOAST_LONG });
    return;
  }
  // the read-back: one that disagrees is read again after a moment;
  // a /model that answered without an error is trusted over it
  const effort = await effortNow($, ss);
  const tell = nowModel => {
    const model = sameModel(nowModel, target.model) || !modelRan || !commandFailed(modelRan) ? target.model : nowModel;
    $.ui.toast(switchedText(target, model, effort, was), sameModel(model, target.model) ? undefined : { timeoutMs: TOAST_LONG });
  };
  let nowModel = null;
  try { nowModel = await $.session.model(); } catch { /* no read-back */ }
  if (sameModel(nowModel, target.model)) { tell(target.model); return; }
  try {
    $.clock.after(READ_BACK_LAG, async () => {
      let again = nowModel;
      try { again = await $.session.model(); } catch { /* the first read stands */ }
      try { tell(again); } catch { /* no toast */ }
    });
  } catch { tell(nowModel); }
}
// "Compact, then switch", in a large session (switchOffer): the compaction
// as the Compact now button runs it, then the switch; a compaction that did
// not start leaves the session as it is
async function compactThenSwitch($, pr, target) {
  try {
    const r = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS });
    if (r && r.skip) throw new Error(r.skip);
    pr.setContext((r && r.tokensAfter) || null);
  } catch (err) {
    if (!(await compactTyped($, pr, err))) return;
  }
  pr.forget();
  await runSwitch($, pr, target);
}

/** @type {import('claude-code').Register} */
export const register = on => {
  // this module's memory, for this session; a reload starts it over, and
  // budget.mjs keeps the log thin across sessions and reloads by itself
  // tokens per model id: the session's own turns, and its subagents'
  const tokens = {};
  const agentTokens = {};
  // all of them in one sum, in dollars (spentUsd), and how much of it a
  // reading has handed budget.mjs
  const spend = { total: 0, sent: 0 };
  let last = null;
  let reading = null;
  // what this session had spent when the reading came in: what it spent
  // since comes off the reading's "Budget tokens" (liveLeft)
  let liveFrom = 0;
  // what was said of the allowance going unused (sayUnused)
  const un = { said: null };
  // the context lines for /pacing-status and the pane: a fresh breakdown
  // where the engine gave one, else the last
  const ctxText = bd => {
    if (bd) ctxNow = bd;
    const l = contextLines(bd || ctxNow);
    return l.length ? '\n' + l.join('\n') : '';
  };
  // (the session's dollars priced again at the reading's prices first: turns
  // before any reading were priced at none)
  const hold = j => {
    reading = j;
    try { spend.total = spentUsd(tokens, agentTokens, reading.prices, sessionModel); } catch { /* as it stood */ }
    liveFrom = spend.total;
  };
  // the newest shared reading (see "the newest shared reading"): its timer,
  // and what takeShared reads and writes
  let sharedTimer = null;
  // (a newer reading another session wrote is fresh figures: the mark goes)
  const sh = { held: () => reading, take: j => { hold({ ...reading, ...j }); rd.health.fails = 0; }, lineNow: now => lineNow(now) };
  // what takeReading reads and writes: whether a reading runs now, and how
  // the readings go (see FAIL_SAY)
  const rd = { running: false, loadFlight: null, health: { fails: 0, why: '', told: false }, spend, un,
    session: () => sessionModel, held: () => reading, hold: j => hold(j), setLast: v => { last = v; } };
  // the status line with the mark in front while the readings fail
  const marked = text => (text && readingsFail(rd.health) ? staleLine(text, st.max) : text);
  // the reading at load on its way (the pane says so)
  let loading = false;
  // for the warning after a pause: when the main thread's last turn ended (a
  // subagent's turn keeps only its own cache warm), the session's size at the
  // last measure, and the pause already warned of
  let lastTurnAt = null;
  let contextTokens = null;
  let warnedFor = null;
  // the request for a full reading: which figure it was made for, and when
  let askedFor = null;
  let askedAt = 0;
  // a session another session started is told by budget.mjs (`spawned`, from
  // the desktop app's own record of the session). The model it runs on: its
  // main thread's last turn.
  let sessionModel = null;
  // the session's model and effort as last set by /model and /effort (see
  // "the session's model and effort as last set"): the model until the next
  // turn's usage names one
  const ss = { model: null, effort: null };
  // What the session runs on now, by the latest of two facts: the model and
  // effort the main thread's last request carried (turn.step), and a /model
  // or /effort that ran since, pressed or typed. Switch runs only the
  // command whose part differs, so a switch of effort alone is one command
  // (a typed /model keeps the session's effort: the engine sets the model
  // alone). Unknown before the first request: both run, as before.
  const here = { model: null, effort: null };
  const modelNow = () => ss.model || sessionModel;
  // the offer to compact: the one in the band ({ level, tokens }) or null, the
  // size at each level's last offer, and whether a person has typed here
  let offer = null;
  // the pane drawn since it last opened: its first draw takes fresh figures
  let paneDrawn = false;
  let offered = {};
  let attended = false;
  // a /clear or a resume gave the process a new session id: what is kept in
  // the store under the id is written again at the next prompt
  let rekey = false;
  // the pause's timers, and the pause (its last turn's end) a drawn now row spoke for
  let timers = [];
  let nowFor = null;
  const clearTimers = () => { for (const t of timers) { try { t.cancel(); } catch { /* gone */ } } timers = []; };
  // the last breakdown of the context (see "what fills the session's context")
  let ctxNow = null;
  const forget = () => { offer = null; offered = {}; ctxNow = null; };
  // what a press's work reads and writes (see "what the band's buttons do");
  // `waited` calls off the toast that a queued /compact waits, set while one
  // is queued; `compacting`: a compaction the band's or the pane's button
  // asked for is under way (claimCompact; compactNow clears it)
  const pr = { ss, here, waited: null, compacting: false, forget, setContext: v => { contextTokens = v; } };
  // Claude Code's auto-compact window (see "Claude Code's auto-compact
  // window"): what its check and the pane's presses read and write
  const ac = { on: false, due: false, model: null, want: null, told: false, busy: false, pressing: false };
  // one compaction at a time: whether this press may start one
  const claimCompact = () => (pr.compacting ? false : (pr.compacting = true));
  // the background tasks (see "background tasks"): by id, their write to the
  // store, and the slow timer that draws their times again
  const tasks = new Map();
  const tk = { tasks, timer: null, kept: { prefix: 'tasks:', busy: null, due: false, list: () => [...tasks.values()] } };
  // the switch the band offers now, and every suggestion offered already
  let sw = null;
  const switchSeen = new Set();
  // the session's own subagents and side sessions now running, by id; the
  // effort each Agent call asked for, by its tool call. `st` holds what the
  // refresh (top-level tick) reads and writes: the timer, when the agents were
  // last settled and the side sessions polled, how long side sessions are
  // watched for after one was started or messaged, the last progress toast.
  const agents = new Map();
  const efforts = new Map();
  // the effort each agent runs at, by its id: a kept agent's later tasks come
  // by SendMessage, with no Agent call to say it
  const keptEffort = new Map();
  // A kept agent's next task comes by SendMessage from the main thread: its
  // `summary` is the task the row shows, in place of the first Agent call's
  // description. `to` names the agent by its id or by the name its Agent
  // call gave (names: by id and by name, the id); a recipient the module does not
  // know is left alone. nextTask: the summary by id, until the resumed run's
  // spawn takes it.
  const names = new Map();
  const nextTask = new Map();
  // a role whose next task goes to a fresh agent: the line for the session,
  // by role, until the next prompt carries it
  const fresh = new Map();
  const runningAgents = () => [...agents.values()].sort((x, y) => x.startedAt - y.startedAt);
  // subagents whose run ended, by id: their row stays in the pane
  // TASK_DONE_FOR with how it ended and the first lines of the report
  // ({ a, endedAt, state, out }); the module's memory alone
  const finished = new Map();
  // the status line as it stands, with the agents when any run
  const lineNow = now => {
    const list = runningAgents();
    if (reading) return marked(lineOf(liveLeft(reading, spend.total - liveFrom), sessionModel, tokens, agentTokens, now, false, list, st.max));
    return list.length ? agentPart(list, now, st.max) : undefined;
  };
  // (kept, stepMoved: the write of the agents to the store, see keepAgents)
  const st = { agents, timer: null, settledAt: 0, polledAt: 0, watchUntil: 0, progressAt: 0, host: null, children: 0, quiet: false, watchSince: 0, max: LINE_MAX, surfaces: null,
    kept: { prefix: 'agents:', busy: null, due: false, list: () => keptAgents(st) }, stepMoved: false,
    list: runningAgents, lineNow, reading: () => reading };
  const stopTick = () => stopTickOf(st);

  // the new-version row (see "a new version"): what the looks read and
  // write. The version this copy was loaded as, the version last offered
  // (row or toast), the timers, the version the row offers (null: none),
  // the versions Not now dismissed and whether a person has typed in this
  // session.
  const rl = { loaded: null, acted: null, looking: false, timer: null, afterTurn: null, row: null, dismissed: new Set(),
    typed: () => attended };

  // An Agent call: its effort, which agent.spawn does not carry, and the
  // agent in the line at once, before the engine resolves and spawns it (a
  // few seconds), as a provisional entry the spawn takes over; dropped when
  // the call ends with no spawn.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const key = 'call:' + (e.tool_use_id || '');
    try {
      if (e.effort && e.tool_use_id) efforts.set(e.tool_use_id, e.effort);
      if (!e.agentId && e.tool_use_id) {
        const now = await $.clock.now();
        if (!agents.size) st.progressAt = now;
        agents.set(key, { id: key, provisional: true, type: e.subagent_type || 'general-purpose', description: e.description,
          model: e.model, effort: e.effort, background: !!e.run_in_background, startedAt: now, runs: [], step: null });
        startTick($, st);
        $.ui.status(lineNow(now));
        redraw($);
      }
    } catch { /* the spawn shows it */ }
    try { return await next(e); } finally {
      if (agents.has(key)) {
        agents.delete(key);
        try { $.ui.status(lineNow(await $.clock.now())); } catch { /* the next refresh */ }
      }
    }
  });

  // what a running agent is doing: its latest tool call, and the parts it
  // says it has finished (see "real progress"). A side session started or
  // messaged from the main thread: watch the side sessions for a minute,
  // from the next refresh on.
  on('tool.call', async ($, e, next) => {
    try {
      if (e.agentId && agents.has(e.agentId)) {
        const a = agents.get(e.agentId), step = stepOf(e.tool), part = partOf(e, a.part || null);
        const stepped = step !== a.step, parted = part !== (a.part || null);
        a.step = step;
        a.part = part;
        if (stepped || parted) redraw($);
        // a part said is kept at once; a step alone at the next refresh (keepAgents)
        if (parted) keepAgents($, st); else if (stepped) st.stepMoved = true;
      }
    } catch { /* no step known */ }
    if (e.agentId) {
      // a subagent's call: a file it changed or a run's outcome is a line
      // of its output box (meaningOf); other calls are not shown
      const r = await next(e);
      try {
        const a = agents.get(e.agentId);
        if (a && meaningOf(a, e, r)) { a.outAt = await $.clock.now(); redraw($); }
      } catch { /* not shown */ }
      return r;
    }
    // a task sent to a kept agent: its summary is the row's task from now on
    if (e.tool === 'SendMessage' && typeof e.summary === 'string' && e.summary.trim()) {
      try {
        const to = String(e.to || ''), id = agents.has(to) ? to : names.get(to);
        if (id) {
          nextTask.set(id, e.summary.trim());
          const a = agents.get(id);
          if (a) { a.description = e.summary.trim(); keepAgents($, st); redraw($); }
        }
      } catch { /* the first task's words stay */ }
    }
    const r = await next(e);
    // a background task this call started, or one a TaskStop ended
    try {
      const task = taskStarted(e, r);
      if (task) noteTask($, tk, task, await $.clock.now());
      else if (e.tool === 'TaskStop' && r && !r.deny && !r.isError) {
        const id = (r.result && r.result.task_id) || e.task_id || e.shell_id;
        if (tasks.has(id)) endTask($, tk, id, 'stopped', await $.clock.now());
      }
    } catch { /* not listed */ }
    const toSession = e.tool === 'mcp__ccd_session__start_session' || e.tool === 'mcp__ccd_session_mgmt__send_message'
      || (e.tool === 'SendMessage' && /^local_/.test(String(e.to || '')));
    if (toSession) {
      try {
        st.watchSince = await $.clock.now();
        st.watchUntil = st.watchSince + WATCH_FOR;
        st.polledAt = 0;
        startTick($, st);
      } catch { /* no watch */ }
    }
    return r;
  });

  // a subagent of the main thread starts (or a kept one is sent its next task)
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e);
    try {
      if (r && r.agentId && !e.parentAgentId && !e.isTeammate) {
        const now = await $.clock.now();
        const type = e.subagentType || 'general-purpose';
        // the provisional entry of its Agent call, if any: the time it was first shown
        const early = agents.get('call:' + (e.tool_use_id || ''));
        if (early) agents.delete(early.id);
        const a = { id: r.agentId, type, description: nextTask.get(r.agentId) || e.description, model: r.model || e.model || e.parentModel,
          effort: efforts.get(e.tool_use_id) || keptEffort.get(r.agentId), background: !!e.background, startedAt: early ? early.startedAt : now, runs: [], step: null };
        efforts.delete(e.tool_use_id);
        nextTask.delete(r.agentId);
        names.set(r.agentId, r.agentId);
        if (e.name) names.set(e.name, r.agentId);
        if (a.effort) keptEffort.set(a.id, a.effort);
        // a fresh agent of a role is what a waiting line about one asked for
        if (!e.resume && roleFor(type)) fresh.delete(roleFor(type));
        if (!agents.size) st.progressAt = now;
        agents.set(a.id, a);
        keepAgents($, st);
        startTick($, st);
        // in the line at once; its history for the estimate after
        $.ui.status(lineNow(now));
        redraw($);
        try { const all = await $.store.get('agentRuns'); if (all && typeof all === 'object' && Array.isArray(all[type])) a.runs = all[type]; } catch { /* no history */ }
        if ((await noticesOn($)) && !(await paneShown($, st))) $.ui.toast(startedText(a, runningAgents()));
      }
    } catch { /* an engine without timers or toasts: the count alone */ }
    return r;
  });

  // What a press changes in the band's own memory, at once; its work runs
  // after the press (later; see "what the band's buttons do"). The switch
  // row answered, by any of its buttons. An offer to compact answered, by
  // Compact now or Not now: gone, and offered at its size; the pause's timers
  // with it (`timersToo`: Compact now at any level, Not now on a now row).
  // The new-version row put off for that version.
  const switchAnswered = () => { sw = null; };
  const offerAnswered = (shown, timersToo) => { if (timersToo) clearTimers(); offer = null; offered[shown.level] = shown.tokens; };
  const reloadPutOff = version => { rl.dismissed.add(version); rl.row = null; };
  // A now row drawn: the notice after this pause need not say it again, and
  // the pause counts as told at this size (pauseDue). Noted as it is drawn,
  // not as the timer raises it: a row raised is not a row shown (an engine
  // without the band, a survey over it, a subagent's transcript in view, an
  // urgent switch in its place), nothing but its drawing tells the module
  // which, and a row never shown leaves the notice to say it at the next
  // prompt. It sets the same three values at every draw of the same row.
  const nowDrawn = shown => { nowFor = shown.pause; offered.now = shown.tokens; offered.nowPause = shown.pause; };

  // the band above the prompt: the suggest, urge and now offers, and under
  // them a row for background agents still at work. Hidden while a turn
  // runs, under a survey, and over a subagent's transcript.
  // One action row at a time, by urgency: a switch away from a model that is
  // out or held, then the offer to compact, then a calm switch (another
  // model, or one step less effort), then the new-version row (see "a new
  // version"). The background agents' row goes under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = e.props || {};
    const background = runningAgents().filter(a => a.background);
    if ((!offer && !sw && !rl.row && !background.length) || p.hasSurvey || p.isWorking || (p.view && p.view.agentId) || (e.plugin && e.plugin !== 'pacing')) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    let now = Date.now();
    if (background.length) { try { now = await $.clock.now(); } catch { /* the system's clock */ } }
    const agentRow = background.length
      ? Text({ dimColor: true, children: backgroundText(background, now, typeof p.bodyColumns === 'number' ? p.bodyColumns : MSG_MAX) })
      : null;
    const stack = row => (agentRow ? Box({ flexDirection: 'column', children: [row, agentRow] }) : row);
    if (sw && (sw.urgent || !offer)) {
      const target = sw;
      const switchRow = Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, children: [
        Text(target.urgent ? { color: 'warning', children: target.icon + ' ' + target.text } : { dimColor: true, children: target.icon + ' ' + target.text }),
        ...(target.compactFirst ? [Button({ key: 'pacing-compact-switch', label: 'Compact, then switch', variant: target.urgent ? 'primary' : 'secondary',
          onPress: () => { switchAnswered(); redraw($); later($, () => compactThenSwitch($, pr, target)); } })] : []),
        Button({ key: 'pacing-switch', label: 'Switch', variant: target.urgent && !target.compactFirst ? 'primary' : 'secondary',
          onPress: () => { switchAnswered(); redraw($); later($, () => runSwitch($, pr, target)); } }),
        Button({ key: 'pacing-switch-not-now', label: 'Not now', role: 'dismiss', dimColor: true, onPress: () => { switchAnswered(); redraw($); } }),
      ] });
      return stack(switchRow);
    }
    if (!offer && rl.row) {
      const version = rl.row;
      const reloadRow = Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, children: [
        Text({ dimColor: true, children: reloadText(version) }),
        Button({ key: 'pacing-reload-not-now', label: 'Not now', role: 'dismiss', dimColor: true, onPress: () => { reloadPutOff(version); redraw($); } }),
      ] });
      return stack(reloadRow);
    }
    if (!offer) return Box({ flexDirection: 'column', children: [agentRow] });
    const shown = offer;
    const urge = shown.level !== 'suggest';
    const words = shown.level === 'now' ? ICON.pause + ' ' + nowText(shown.tokens, shown.lapsed) : ICON.compacted + ' ' + offerText(shown.level, shown.tokens);
    // the one thing a drawing notes (nowDrawn says why it cannot be noted sooner)
    if (shown.level === 'now') nowDrawn(shown);
    const offerRow = Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, children: [
      Text(urge ? { color: 'warning', children: words } : { dimColor: true, children: words }),
      // the compaction takes a minute: it runs after the press (later)
      Button({ key: 'pacing-compact', label: 'Compact now', variant: urge ? 'primary' : 'secondary',
        onPress: () => { offerAnswered(shown, true); redraw($); if (claimCompact()) later($, () => compactNow($, pr, shown)); } }),
      Button({ key: 'pacing-not-now', label: 'Not now', role: 'dismiss', dimColor: true,
        onPress: () => { offerAnswered(shown, shown.level === 'now'); redraw($); } }),
    ] });
    return agentRow ? Box({ flexDirection: 'column', children: [offerRow, agentRow] }) : offerRow;
  });

  // a compaction the person or the engine ran: the offers start over, and
  // the agents are counted again from the engine's list (none without it)
  on('session.compact', async ($, e, next) => {
    // the session's compaction starts: a queued /compact waits no more
    if (!e.agentId && pr.waited) { pr.waited(); pr.waited = null; }
    const r = await next(e);
    if (!e.agentId && r && r.messages) {
      forget();
      contextTokens = r.tokensAfter || null;
      try {
        const live = await liveAgents($);
        // (side sessions are not in the engine's list: they stay, or the
        // next poll took each for a new one and said it started again)
        for (const [id, a] of [...agents]) if (a.kind !== 'session' && (!live || !live.has(id))) agents.delete(id);
        keepAgents($, st);
        if (!agents.size) stopTick();
        $.ui.status(lineNow(await $.clock.now()));
      } catch { /* the line is redrawn at the next measure */ }
      redraw($);
    }
    return r;
  });

  // The session ends. A /clear or a resume goes on in this process under a
  // new session id, and no session.start fires for it: what the module held
  // of the old conversation (its size, its pause, the offers, each model's
  // share) carried into the new one, so an empty conversation was told it
  // held 400k tokens and had sat idle. That memory starts over here; the
  // reading, the agents at work and the model set stay, they are the
  // account's and the process's. The dollars not yet handed to budget.mjs
  // go with it: a reading's worth at most. And the store's keys under the
  // ending session's id are deleted (dropKeys).
  on('session.end', async ($, e, next) => {
    try {
      if (e.reason === 'clear' || e.reason === 'resume') {
        lastTurnAt = null; contextTokens = null; warnedFor = null; nowFor = null; askedFor = null; askedAt = 0;
        forget();
        clearTimers();
        sw = null;
        switchSeen.clear();
        finished.clear();
        for (const k of Object.keys(tokens)) delete tokens[k];
        for (const k of Object.keys(agentTokens)) delete agentTokens[k];
        spend.total = 0; spend.sent = 0; liveFrom = 0;
        rekey = true;
        redraw($);
      }
      await dropKeys($, e.sessionId);
    } catch { /* an ending session is never held */ }
    return next(e);
  });

  // a surface attached or detached: the room for the line asked again
  on('session.attach', async ($, e, next) => {
    const r = await next(e);
    try { st.surfaces = null; if (await learnSurfaces($, st)) await redrawLine($, st); } catch { /* the next measure */ }
    return r;
  });
  on('session.detach', async ($, e, next) => {
    const r = await next(e);
    try { st.surfaces = null; if (await learnSurfaces($, st)) await redrawLine($, st); } catch { /* the next measure */ }
    return r;
  });

  // /model and /effort, pressed or typed: what they set, once they ran
  // without an error (see "the session's model and effort as last set")
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const r = await next(e);
    try { if (!commandFailed(r) && (await noteSet($, ss, 'model', e.args))) here.model = ss.model; } catch { /* not noted */ }
    // another model may have another auto-compact window
    if (!commandFailed(r)) autoCompactCheck($, ac, ss.model).catch(() => { /* at the next turn's end */ });
    return r;
  });
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e);
    try { if (!commandFailed(r) && (await noteSet($, ss, 'effort', e.args))) here.effort = ss.effort; } catch { /* not noted */ }
    return r;
  });

  // the whole line, which the footer cuts: /pacing-status, at any time.
  // A new or resumed session runs no agents of this module's knowing; after
  // a reload, the ones kept in the store that the engine still runs come back.
  on('session.start', async ($, e, next) => {
    agents.clear();
    stopTick();
    fresh.clear();
    tasks.clear();
    if (tk.timer) { try { tk.timer.cancel(); } catch { /* gone */ } tk.timer = null; }
    st.surfaces = null;
    try {
      await $.command.register({ name: 'pacing-status', description: 'Pacing: the whole status line, and what to do now.', immediate: true });
    } catch { /* an engine without commands: the line alone */ }
    // the reports the module answers itself (see "reports the module answers
    // itself"), each by itself, so one the engine refuses does not take the
    // others with it
    for (const c of [
      { name: 'pacing-usage', description: 'Pacing: the usage bars and what each tier takes now.' },
      { name: 'pacing-help', description: 'Pacing: the short help.' },
      { name: 'pacing-guide', description: 'Pacing: the whole guide.' },
      { name: 'pacing-doctor', description: 'Pacing: is it working here, and what to do if not.' },
      { name: 'pacing-saved', description: 'Pacing: what agents on cheaper models saved this week.' },
      { name: 'pacing-pane', description: 'Pacing: a pane with the budget, the usage, the agents and what fills the context.' },
    ]) {
      try { await $.command.register(c); } catch { /* an engine without commands */ }
    }
    const result = await next(e);
    // A fresh line at load (a new session, a reload, a new version): the
    // status line kept what the module drew before, which may be old facts
    // and old code's words for up to half an hour. With the meters the last
    // response reported, or those the app's usage tool has, a logged reading
    // now; with none yet, a dry run on the last stored figures, and the
    // first measure takes the logged reading at once (`last` is empty after
    // a load). Started, not awaited: the session's start never waits on it.
    // Silent on any failure.
    (async () => {
      let now;
      try { now = await $.clock.now(); } catch { now = Date.now(); }
      // from here the pane says a reading is on its way (`loading`, apart
      // from `running`: a measure's own reading may still go first)
      loading = true;
      let week, five, known;
      try {
        await learnSurfaces($, st);
        ({ week, five } = await limitsNow($));
        known = !!(week && week.resetsAt);
      } finally { loading = false; }
      if (rd.running) { redraw($); return; }
      // (its own way to a reading: a dry run where none can be logged, and
      // neither the level nor what goes unused is said at a load)
      rd.running = true;
      // a measure that comes meanwhile waits for this one, then decides
      let freed = () => {};
      rd.loadFlight = new Promise(r => { freed = r; });
      try {
        let j = await runReading($, week, five, sessionModel, spend, rd.health);
        const logged = !!j;
        if (!j && !known) {
          const st = await storedReading($);
          if (st && typeof st.all === 'number' && st.reset) {
            const r = await $.process.run(readingArgv($.plugin.root, st.all, st.reset, st.five, st.fiveReset, true), { timeoutMs: 20000 });
            j = r.exitCode === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
          }
        }
        if (j) {
          hold({ ...j, fromLoad: true });
          // a logged reading counts as the last one; a dry one leaves the next due
          if (logged) last = { pct: known ? week.percentUsed : j.all, at: now };
          $.ui.status(lineNow(now));
          // the pane drawn before it came in shows it (live: "No reading yet"
          // after a reload, the pane drawn first and never again)
          redraw($);
        }
      } finally {
        rd.running = false;
        rd.loadFlight = null;
        freed();
        redraw($);
        // the side sessions' first poll came before the reading named this
        // session (no host): asked again, still without toasts
        if (st.quiet) { try { await pollSessions($, st, now); } catch { /* at the next turn's end */ } }
      }
    })().catch(() => { /* a failure draws nothing new */ });
    // the side sessions already working (a reload mid-work): in the line, no toast
    // the subagents a reload found at work, with what was known of them (see
    // "running agents across a reload"): in the line and the next toast as before
    (async () => {
      const n = await restoreAgents($, agents);
      await keepAgents($, st);
      if (!n) return;
      const now = await $.clock.now();
      for (const a of agents.values()) if (a.effort) keptEffort.set(a.id, a.effort);
      st.progressAt = now;
      startTick($, st);
      $.ui.status(lineNow(now));
      redraw($);
    })().catch(() => { /* none known, as before */ });
    (async () => { st.quiet = true; await pollSessions($, st, await $.clock.now()); })().catch(() => { /* none known */ });
    // the pane, unless the person closed it (see PANE_CLOSED); where the
    // surface seats none, nothing is said
    (async () => {
      if (await $.store.get(PANE_CLOSED)) return;
      const bd = await breakdownNow($);
      if (bd) ctxNow = bd;
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE });
    })().catch(() => { /* no pane here */ });
    // the model and effort last set in this session, should a reload have
    // started this memory over
    restoreSwitch($, ss).catch(() => { /* none kept */ });
    // Claude Code's auto-compact window as the user set it, once for this start
    ac.on = true;
    ac.due = true;
    (async () => {
      let model = null;
      try { model = await $.session.model(); } catch { /* the breakdown's */ }
      await autoCompactCheck($, ac, typeof model === 'string' ? model : null);
    })().catch(() => { /* at the next turn's end */ });
    // the background tasks a reload found listed
    restoreTasks($, tk).catch(() => { /* none kept */ });
    // the version this copy was loaded as, and from here a slow look at the
    // one on disk (see "a new version")
    look($, rl);
    try {
      if (rl.timer) rl.timer.cancel();
      rl.timer = $.clock.every(RELOAD_CHECK_EVERY, () => { look($, rl); });
    } catch { /* an engine without timers: the look after a turn */ }
    try {
      if (sharedTimer) sharedTimer.cancel();
      sharedTimer = $.clock.every(SHARED_EVERY, () => { takeShared($, sh).catch(() => { /* its own stands */ }); });
    } catch { /* an engine without timers: its own readings alone */ }
    return result;
  });
  on('command.run', { command: 'pacing-status' }, async ($) => {
    if (!reading) return { text: 'Pacing: no automatic reading yet in this session. /pacing usage takes one now.', isTextDisplayOnly: true };
    // ages and run times as of now, by the engine's clock where it has one
    let now;
    try { now = await $.clock.now(); } catch { now = Date.now(); }
    const text = lineOf(liveLeft(reading, spend.total - liveFrom), sessionModel, tokens, agentTokens, now, true, runningAgents());
    return { text: 'Pacing: ' + text + (reading.do ? '\nNow: ' + reading.do : '')
      + (typeof reading.unused === 'number' ? '\nUnused: at this pace about ' + reading.unused + '% of the week goes unused at the reset; it does not carry over.' : '') + ctxText(await breakdownNow($)), isTextDisplayOnly: true };
  });
  // The report of `budget.mjs last`: the bars and the tier sheet. Where the
  // last reading is too old to show, the module takes one itself first, if
  // the app's usage tool answers; else it says why and where to measure.
  // the pane: what /pacing-status says, a row each, then the context
  // (`session`: the session's model and effort, for the agents' model tags)
  const paneNow = (now, autoCompact = null, session = null, autoCompactLast = null) => {
    const j = reading ? liveLeft(reading, spend.total - liveFrom) : null;
    return paneModel({
      j,
      mix: j ? tierMix(tokens, j.tierOf || {}, j.prices || {}, agentTokens, j.agentTierOf).map(x => ({ name: tierName(j, x.tier), share: x.share })) : [],
      // (an id only where the engine has a transcript to show: a subagent it
      // spawned; the model and effort go to the row's tag, the steps or the
      // time to its bar)
      running: [...runningAgents().map(a => ({ id: a.kind === 'session' || a.provisional ? null : a.id,
        text: (a.kind === 'session' ? 'side session ' : '') + detail(a, now, { task: TASK_MAX, time: 1, est: 1, step: 1 })
          + (a.kind === 'session' && a.description ? ', ' + a.description : ''),
        model: a.model || null, effort: a.effort || null, on: runOn(a), bar: stepBarOf(a, now), out: a.out || [], outAt: a.outAt || 0 })),
      // the runs that ended in the last TASK_DONE_FOR, after them
      ...[...finished.entries()].filter(([, f]) => now - f.endedAt < TASK_DONE_FOR).map(([id, f]) => ({ id, done: true,
        text: finishedText(f.a, f.state, f.endedAt - f.a.startedAt),
        model: f.a.model || null, effort: f.a.effort || null, on: runOn(f.a), bar: null, out: f.out, outAt: f.endedAt }))],
      bd: ctxNow, now, busy: rd.running || loading, failing: readingsFail(rd.health),
      tasks: taskRows(tasks.values(), now), tokens: contextTokens, compacting: pr.compacting, autoCompact, autoCompactLast, session,
    });
  };
  // a person's close keeps it closed in later sessions; a plugin's own, or an
  // unload, does not
  on('ui.close', async ($, e, next) => {
    if (e && e.id === PANE_ID) paneDrawn = false;
    try { if (closedByPerson(e)) await $.store.set(PANE_CLOSED, true); } catch { /* it opens again next session */ }
    return next(e);
  });
  on('command.run', { command: 'pacing-pane' }, async ($) => {
    try { await $.store.delete(PANE_CLOSED); } catch { /* asked for now, at least */ }
    const bd = await breakdownNow($);
    if (bd) ctxNow = bd;
    let r;
    try { r = await $.ui.open({ id: PANE_ID, title: PANE_TITLE }); } catch (err) { r = { isPlaced: false, reason: (err && err.message) || 'refused' }; }
    return { text: r && r.isPlaced ? 'Pacing pane opened.' : 'Pacing pane: not shown (' + ((r && r.reason) || 'no surface') + ').', isTextDisplayOnly: true };
  });
  // Refresh, and the pane's first draw after it opens (the user's word: an
  // opening pane shows fresh figures, not the last reading's): the context
  // at once; then every meter anew (the per-model one too, where the app's
  // usage tool answers), not waiting for a turn's end. At the first draw a
  // reading under PANE_FRESH old is fresh enough and is not taken again.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.plugin && e.plugin !== 'pacing') return next(e);
    st.paneGlance = !!(e.props && e.props.placement === 'widget');
    let now = Date.now();
    try { now = await $.clock.now(); } catch { /* the system's clock */ }
    const refreshPane = first => later($, async () => {
      const bd = await breakdownNow($);
      if (bd) ctxNow = bd;
      redraw($);
      if (rd.running) return;
      let at;
      try { at = await $.clock.now(); } catch { at = Date.now(); }
      if (first && last && at - last.at < PANE_FRESH) return;
      // (a reading that failed redraws too: the mark and the pane's note)
      await takeReading($, rd, { at });
      try { $.ui.status(lineNow(at)); } catch { /* the next measure draws it */ }
      redraw($);
    });
    // the first draw since it opened: fresh figures, once
    if (!paneDrawn) { paneDrawn = true; refreshPane(true); }
    // Compact, in the Context section: the row's Compact now (compactNow),
    // one at a time; the pause's timers end with it, as at the row's press
    const size = typeof contextTokens === 'number' ? contextTokens : ctxNow && ctxNow.totalTokens;
    // the auto-compact window, with its −, + and the toggle for Claude
    // Code's own (autoCompactPress), which returns to the last count kept
    let autoCompact = null;
    try { autoCompact = autoCompactOf(await configOf($)); } catch { /* no row */ }
    const autoCompactBack = autoCompact === 'auto' ? await autoCompactLast($) : null;
    const session = { model: modelNow(), effort: await effortNow($, ss) };
    return paneView($.ui.resolve(e), paneNow(now, autoCompact, session, autoCompactBack), { surface: e.surface, placement: e.props && e.props.placement, now, onRefresh: () => refreshPane(false),
      // only where a main view can show the transcript: the desktop app has
      // none ("no main view here", seen live in 0.9.41), so its rows are text
      onAgent: e.surface === 'terminal' && !viewNone ? id => openAgent($, id) : null,
      onCompact: () => { if (!claimCompact()) return; clearTimers(); redraw($); later($, () => compactNow($, pr, { tokens: size })); },
      onAutoCompact: v => autoCompactPress($, ac, v) });
  });
  on('command.run', { command: 'pacing-usage' }, async ($) => {
    const show = text => ({ text, isTextDisplayOnly: true });
    try {
      let out = await scriptOut($, 'budget.mjs', ['last']);
      if (measureWhy(out) && !rd.running) {
        try {
          let now;
          try { now = await $.clock.now(); } catch { now = Date.now(); }
          if (await takeReading($, rd, { at: now })) {
            $.ui.status(lineNow(now));
            redraw($);
            out = await scriptOut($, 'budget.mjs', ['last']);
          }
        } catch { /* the reason stands */ }
      }
      if (out === null) return show('Pacing: the report could not be made. `/pacing usage` asks the session for it.');
      const why = measureWhy(out);
      return show(why ? 'Pacing: no reading to show (' + why + '). `/pacing usage now` takes a new one.' : usageText(out));
    } catch { return show('Pacing: the report could not be made. `/pacing usage` asks the session for it.'); }
  });
  // the short help and the whole guide, as config.mjs prints them (markdown)
  on('command.run', { command: 'pacing-help' }, async ($) => {
    let out = null;
    try { out = await scriptOut($, 'config.mjs', ['help']); } catch { /* said below */ }
    return { text: out && out.trim() ? out.trim() : 'Pacing: the help could not be read. `/pacing help` asks the session for it.', isTextDisplayOnly: true };
  });
  on('command.run', { command: 'pacing-guide' }, async ($) => {
    let out = null;
    try { out = await scriptOut($, 'config.mjs', ['help', 'full']); } catch { /* said below */ }
    return { text: out && out.trim() ? out.trim() : 'Pacing: the guide could not be read. `/pacing help full` asks the session for it.', isTextDisplayOnly: true };
  });
  // the self-check, whole, in a code block: its lines are columns. Run
  // directly: it exits 1 on a failed check, where scriptOut would give nothing.
  on('command.run', { command: 'pacing-doctor' }, async ($) => {
    let out = '';
    try {
      const r = await $.process.run(['node', $.plugin.root + '/skills/pacing/scripts/doctor.mjs'], { timeoutMs: 20000 });
      out = String((r && r.stdout) || '').replace(/\r/g, '').trim();
    } catch { /* said below */ }
    return { text: out ? '```\n' + out + '\n```' : 'Pacing: the self-check could not run. `/pacing doctor` asks the session for it.', isTextDisplayOnly: true };
  });
  // what delegating saved this week, against the model the session runs on;
  // `detail` adds the table by role and model, in a code block (columns)
  on('command.run', { command: 'pacing-saved' }, async ($, e) => {
    const detail = /\bdetail\b/.test(String((e && e.args) || ''));
    let model = modelNow();
    if (!model) { try { model = await $.session.model(); } catch { /* saved.mjs takes the recommended one */ } }
    let out = null;
    try {
      const args = detail ? ['--detail'] : [];
      // a model saved.mjs does not know: the one the reading recommends
      out = (typeof model === 'string' && model ? await scriptOut($, 'saved.mjs', ['--session', model, ...args]) : null) ?? (await scriptOut($, 'saved.mjs', args));
    } catch { /* said below */ }
    if (!out || !out.trim()) return { text: 'Pacing: the savings could not be read. `/pacing saved` asks the session for it.', isTextDisplayOnly: true };
    const [line, ...rest] = out.trim().split('\n\n');
    return { text: line + (rest.length ? '\n\n```\n' + rest.join('\n\n') + '\n```' : ''), isTextDisplayOnly: true };
  });
  on('prompt.submit', async ($, e, next) => {
    // a background task's notification: the task it names has ended
    try {
      const end = e.origin && e.origin.kind === 'task-notification' ? taskEnded(e.text) : null;
      if (end && tasks.has(end.id)) endTask($, tk, end.id, end.state, await $.clock.now());
    } catch { /* the row stays as it is */ }
    try {
      // only a prompt that starts a turn after a pause, typed by the user; a
      // slash command (/compact, a handover) is the user acting on it already
      const typed = !e.turnId && !e.isMeta && !e.command && !String(e.text || '').trimStart().startsWith('/')
        && !unattended(e.origin);
      // a person in front of the session: the offers are theirs to answer.
      // Once one has typed it stays so: a notification's prompt (a background
      // agent done, while they are away) turned it off, and the row before
      // the cache lapses, made for that hour away, never came.
      if (!e.turnId && !e.isMeta && !unattended(e.origin)) attended = true;
      if (rekey) {
        rekey = false;
        if (rl.loaded) noteLoaded($, rl.loaded);
        keepSwitch($, ss);
        keepAgents($, st);
        keepUnder($, tk.kept);
      }
      // the user compacting or handing over already: the band's offer is answered
      const cmd = e.command ? e.command.name + ' ' + (e.command.args || '') : String(e.text || '').trimStart();
      if (offer && /^\/?(compact\b|pacing handover\b)/.test(cmd)) {
        offered[offer.level] = offer.tokens;
        offer = null;
        redraw($);
      }
      // any prompt starts a turn: the pause is over, and a row it raised goes
      clearTimers();
      if (offer && (typed || offer.level === 'now')) { offer = null; redraw($); }
      if (typed && lastTurnAt !== null && warnedFor !== lastTurnAt) {
        const note = pauseNote(contextTokens, (await $.clock.now()) - lastTurnAt);
        // the row before and after the lapse said it already: no second notice
        // and a pause at a size already told is not told again (pauseDue)
        if (note && nowFor !== lastTurnAt && pauseDue(contextTokens, lastTurnAt, offered)) {
          offered.now = contextTokens; offered.nowPause = lastTurnAt;
          $.ui.toast(note, { timeoutMs: TOAST_LONG });
        }
        if (note) warnedFor = lastTurnAt;
      }
      // what the session is told beside this prompt, in blocks the user does
      // not see; the prompt's own text is never touched
      const notes = [];
      // a full reading is due
      if (typed && reading && reading.needFull) {
        const now = await $.clock.now();
        const key = reading.premiumAt || 'none';
        if (askedFor !== key || now - askedAt >= ASK_AGAIN) {
          const ask = fullReadingAsk(reading);
          askedFor = key;
          askedAt = now;
          if (ask) notes.push(ask);
        }
      }
      // a role's next task goes to a fresh agent: once, beside the next
      // prompt of any origin (a background agent's notification is where the
      // session decides who gets the next task), never beside a command
      if (fresh.size && !e.isMeta && !e.command && !String(e.text || '').trimStart().startsWith('/')) {
        notes.push(freshNote([...fresh.values()]));
        fresh.clear();
      }
      if (notes.length) return next({ ...e, context: [...(e.context ?? []), ...notes] });
    } catch (err) {
      // a warning is a convenience: it never stands in the prompt's way. A
      // failure beneath, in the prompt's own entry, is not this hook's to hide
      if (next.called) throw err;
    }
    // the prompt goes on as typed, always
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) {
      // the turn may have changed a setting: read again, once for this turn's end
      configStale();
      try { lastTurnAt = await $.clock.now(); } catch { /* no clock: no warning */ }
      // the turn's own model: from here it, not the one last set, is the model
      if (e.usage && e.usage.model) {
        sessionModel = e.usage.model;
        if (ss.model) { ss.model = null; keepSwitch($, ss); }
      }
      // a model changed in the menu, a setting changed in this turn, or the
      // start's check still without a breakdown
      autoCompactCheck($, ac, (e.usage && e.usage.model) || null).catch(() => { /* the next turn's end */ });
      // a natural break: one look at the version on disk, once the turn is over
      if (attended) {
        try {
          if (rl.afterTurn) rl.afterTurn.cancel();
          rl.afterTurn = $.clock.after(RELOAD_AFTER_TURN, () => { look($, rl); });
        } catch { /* an engine without timers: no look */ }
      }
    }
    const u = e.usage;
    if (u && u.model) {
      const seen = e.agentId ? agentTokens : tokens;
      const t = (seen[u.model] ||= { in: 0, out: 0, read: 0, write: 0 });
      t.in += u.input_tokens || 0;
      t.out += u.output_tokens || 0;
      t.read += u.cache_read_input_tokens || 0;
      t.write += u.cache_creation_input_tokens || 0;
      // the whole session's again, at the prices of the last reading: a turn
      // before any reading is priced at the next turn, and nothing is lost
      spend.total = spentUsd(tokens, agentTokens, reading && reading.prices, sessionModel);
    }
    // a subagent's run ended: one toast, and the line without it
    if (e.agentId && agents.has(e.agentId)) {
      try {
        const a = agents.get(e.agentId);
        agents.delete(e.agentId);
        keepAgents($, st);
        const now = await $.clock.now();
        if (!agents.size) stopTick();
        // its row stays its minute with how it ended and its report's first lines
        try {
          const state = e.isAborted ? 'stopped' : e.reason === 'error' || e.reason === 'refusal' ? 'failed' : 'done';
          finished.set(e.agentId, { a, endedAt: now, state, out: finishedOut(a, state, e.answer) });
          $.clock.after(TASK_DONE_FOR, () => { finished.delete(e.agentId); redraw($); });
        } catch { /* no row kept */ }
        $.ui.status(lineNow(now));
        redraw($);
        const spent = u ? (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0;
        // Its task on record, and the meters after its work: started, never
        // waited for, so the agent's answer is not held. A reading only when
        // the last one is AGENT_GAP old.
        (async () => {
          if (!e.isAborted) {
            const line = await recordAgent($, a, u, ss);
            if (line) fresh.set(roleFor(a.type), line);
          }
          if (rd.running || (last && now - last.at < AGENT_GAP)) return;
          if (await takeReading($, rd, { at: now })) {
            $.ui.status(lineNow(now));
            redraw($);
          }
        })().catch(() => { /* a record and a reading are conveniences */ });
        // the toast's count is the agent's size where the refresh saw one: the
        // run's usage is every request summed, many times that
        const size = typeof a.tokens === 'number' && a.tokens > 0 ? a.tokens : spent;
        if ((await noticesOn($)) && !(await paneShown($, st))) $.ui.toast(doneText(a, now - a.startedAt, size, runningAgents()), { timeoutMs: TOAST_LONG });
        // a run that ended by itself is the type's history for the estimate
        if (!e.isAborted) {
          try {
            const got = await $.store.get('agentRuns');
            const all = got && typeof got === 'object' ? got : {};
            all[a.type] = keepRuns(all[a.type], now - a.startedAt);
            await $.store.set('agentRuns', all);
          } catch { /* an engine without a store: no estimate */ }
        }
      } catch { /* never disturbs the turn */ }
    }
    // a natural break in a session that has side sessions: one look at which work
    if (!e.agentId && st.children > 0) {
      try { const t = await $.clock.now(); if (t - st.polledAt >= POLL_EVERY) await pollSessions($, st, t); } catch { /* the next look */ }
    }
    // the main thread's turn ended: its foreground agents with it (it waited
    // for them); the engine's list settles the rest
    if (!e.agentId && agents.size) {
      try {
        const before = agents.size;
        for (const [id, a] of agents) if (!a.background) agents.delete(id);
        if (agents.size !== before) keepAgents($, st);
        await settleAgents($, st, await $.clock.now());
        if (!agents.size) stopTick();
        redraw($);
      } catch { /* the count is settled at the next refresh */ }
    }
    // the turn's tokens are in: the line shows them now, not at the next turn
    if (!e.agentId && !rd.running) {
      try { if (reading || agents.size) $.ui.status(lineNow(lastTurnAt ?? Date.now())); } catch { /* never disturbs the turn */ }
    }
    // a natural break: the main thread's turn ended. A session on another
    // model or effort than the reading recommends is offered the switch,
    // once per suggestion; one that no longer needs it loses the row.
    if (!e.agentId && attended && reading) {
      try {
        // the request's own model and effort first: they are what runs
        let model = here.model || modelNow();
        if (!model) { try { model = await $.session.model(); } catch { /* not known */ } }
        const o = (await switchOn($)) ? switchOffer(reading, model, here.effort || await effortNow($, ss), contextTokens) : null;
        if (!o || (sw && sw.key !== o.key)) { if (sw) { sw = null; redraw($); } }
        if (o && !switchSeen.has(o.key)) { switchSeen.add(o.key); sw = o; redraw($); }
      } catch { /* an engine without the band: the start line says it */ }
    }
    // A large session is offered a compaction in the band, once per level
    // and step of growth.
    if (!e.agentId && attended && typeof contextTokens === 'number') {
      try {
        const level = offerLevel(contextTokens);
        const on_ = level ? await compactAskOn($) : false;
        if (on_ && offerDue(level, contextTokens, offered) && !(offer && offer.level === level)) {
          offer = { level, tokens: contextTokens };
          offered[level] = contextTokens;
          redraw($);
        }
        // now: while it sits idle, before the cache lapses and once it has
        clearTimers();
        if (on_) {
          const pause = lastTurnAt, size = contextTokens;
          const raise = lapsed => () => {
            if (lastTurnAt !== pause || !pauseDue(size, pause, offered)) return;
            offer = { level: 'now', tokens: size, lapsed, pause };
            redraw($);
          };
          timers.push($.clock.after(CACHE_TTL - LAPSE_LEAD, raise(false)));
          timers.push($.clock.after(CACHE_TTL, raise(true)));
        }
      } catch { /* an engine without the band: nothing drawn */ }
    }
    // an open pane: a fresh breakdown of the context after the main thread's turn
    if (!e.agentId) {
      (async () => {
        const panes = await $.ui.panes();
        if (!panes || !panes.some(p => p.id === PANE_ID)) return;
        const bd = await breakdownNow($);
        if (bd) { ctxNow = bd; redraw($); }
      })().catch(() => { /* the pane keeps the last */ });
    }
    return result;
  });

  on('turn.step', async function* ($, e, next) {
    try {
      if (!e.agentId) {
        if (typeof e.model === 'string' && e.model) here.model = e.model;
        if (typeof e.effort === 'string' && EFFORT_ORDER.includes(e.effort)) here.effort = e.effort;
      }
    } catch { /* not noted */ }
    // (a subagent's step text is not shown: its box says main tasks alone)
    return yield* next(e);
  });

  on('session.measure', async ($, e, next) => {
    const result = await next(e);
    if (e.context && typeof e.context.tokens === 'number') {
      const before = contextTokens;
      contextTokens = e.context.tokens;
      // the offers start over, as at a compaction pacing heard (a measure
      // is the session's own: its input names no agent)
      if (compactedBetween(before, contextTokens)) {
        forget();
        clearTimers();
        // a switch that said "compact first" is offered again at the turn's
        // end, at the new size
        if (sw && sw.compactFirst) { switchSeen.delete(sw.key); sw = null; }
        redraw($);
      }
    }
    const limits = e.rateLimits || [];
    const week = limits.find(r => r.kind === 'seven_day');
    // no weekly window: an API key, not a subscription, or no response yet
    // (a reading that runs already serves; the one at load is waited for,
    // since it may have had no meters to read yet)
    if (!week || !week.resetsAt || (rd.running && !rd.loadFlight)) return result;
    // the engine's clock, which a test can set; the system's where there is none
    let now;
    try { now = await $.clock.now(); } catch { now = Date.now(); }
    if (rd.loadFlight) { try { await rd.loadFlight; } catch { /* it draws nothing */ } }
    if (rd.running) return result;
    const due = !last || Math.abs(week.percentUsed - last.pct) >= 1 || now - last.at >= MIN_GAP;
    try {
      // every meter where the app's usage tool answers, else these two windows
      // (a failed one redraws too: the pane's note)
      if (due && ((await takeReading($, rd, { at: now, week, five: limits.find(r => r.kind === 'five_hour'), lastFirst: true })) || readingsFail(rd.health))) redraw($);
      // the tier shares move every turn: the line is redrawn even when no
      // new reading was due
      if (reading) {
        // a side session's model before its first turn ends: the one it is
        // set to (a reload starts this memory over, and the measures of a
        // turn come before its end). A name the prices do not know (an
        // alias) waits for the first turn's model rather than being Other.
        let model = sessionModel;
        if (!model && reading.spawned === true) {
          try {
            const m = await $.session.model();
            if (typeof m === 'string' && idOf(m, reading.prices || {})) model = m;
          } catch { /* not known yet */ }
        }
        await learnSurfaces($, st);
        $.ui.status(marked(lineOf(liveLeft(reading, spend.total - liveFrom), model, tokens, agentTokens, now, false, runningAgents(), st.max)));
      }
    } catch {
      // a reading is a convenience: a missing node, a timeout or a bad line
      // must never disturb the session
    }
    return result;
  });
};
