// Automatic readings: after a turn, the engine hands this module the session's
// rate-limit windows (session.measure). When the weekly all-models window
// moved a whole point, or 30 min passed, it runs budget.mjs --source hook,
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

const MIN_GAP = 30 * 60 * 1000;

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
//   suggest  from 300 000 tokens, once a turn has ended: one calm line in the
//            band above the prompt, with Compact now and Not now. It never
//            interrupts and stays until answered or the next prompt.
//   urge     from 500 000 tokens: the same band, plainer words, the cost, and
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
// Once per level; again only after the session grew by a further 100 000
// tokens, or (now) after a new pause. Never while a turn runs, never in a
// subagent, and only once a person has typed in the session (a side session
// another session drives has nobody to ask). `/pacing compact off` turns the
// offers off; the pause notice then shows as it did before them. An engine
// without the band, the timers or $.session.compact keeps the notice too.
export const SUGGEST_AT = 300000;
export const URGE_AT = 500000;
export const OFFER_STEP = 100000;
export const COMPACT_INSTRUCTIONS = 'Keep what this session must not lose: the goal; the decisions made and why; '
  + 'the open items, in order; the files and commands that matter; what was tried and ruled out.';
const kTok = n => Math.round(n / 1000) + 'k';
// the band's level for a session of this size, or null
export const offerLevel = tokens => (tokens >= URGE_AT ? 'urge' : tokens >= SUGGEST_AT ? 'suggest' : null);
// whether a level may be offered now, given the size at its last offer
export const offerDue = (level, tokens, offered) => !!level && (offered[level] == null || tokens >= offered[level] + OFFER_STEP);
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
// the setting in config.json: on unless it says false
export const compactAskOf = text => { try { return JSON.parse(text).compactAsk !== false; } catch { return true; } };
// read when an offer is due, so a change applies at once; any failure: on
async function compactAskOn($) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (!home) return true;
    return compactAskOf(await $.fs.read(home + '/.claude/pacing/config.json'));
  } catch { return true; }
}

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
  try {
    const home = (await $.env.get("USERPROFILE")) || (await $.env.get("HOME"));
    if (!home) return null;
    return JSON.parse(await $.fs.read(home + "/.claude/pacing/state.json"));
  } catch { return null; }
}
// config.json as it stands, or {} (read where it is needed, so a change applies at once)
async function configOf($) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (!home) return {};
    const c = JSON.parse(await $.fs.read(home + '/.claude/pacing/config.json'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch { return {}; }
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
  const texts = [];
  if (res && typeof res.text === 'string') texts.push(res.text);
  const r = res && res.result;
  const content = Array.isArray(r) ? r : r && Array.isArray(r.content) ? r.content : [];
  for (const c of content) if (c && typeof c.text === 'string') texts.push(c.text);
  for (const t of texts) {
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
async function runReading($, week, five, session, spend = null) {
  const total = spend ? spend.total : 0;
  const spent = spend ? total - spend.sent : 0;
  const run = async argv => {
    const r = await $.process.run(argv, { timeoutMs: 20000 });
    const j = r.exitCode === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
    if (j && spend) spend.sent = total;
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
// A change of level is one toast, and so is the session moved off the
// per-model meter's model, or let back. A reading the module took at load is
// no level the user was told of.
function sayLevel($, was, j) {
  if (!was || was.fromLoad) return;
  if (j.level !== was.level) {
    $.ui.toast(levelIcon(j) + ' ' + levelPhrase(was.level) + ' -> ' + levelPhrase(j.level) + (j.levelBy === 'premium' && j.premiumLabel ? ' (' + j.premiumLabel.split(' ')[0] + '\'s meter)' : '') + '. ' + (j.do || ''), { timeoutMs: TOAST_LONG });
  } else if (!!j.premiumHeld !== !!was.premiumHeld) {
    $.ui.toast(levelIcon(j) + ' ' + (j.do || ''), { timeoutMs: TOAST_LONG });
  }
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
// shows less than there is. Until a rate is learned, the points of the week,
// without the word tokens ("Budget: 5%"); "Budget: -" only with no figure at
// all.
export const tokensText = n => {
  const a = Math.abs(n);
  if (a < 1000) return '0K';
  const k = Math.round(a / 1000);
  return (n < 0 ? '-' : '') + (k < 1000 ? k + 'K' : (a / 1e6).toFixed(1) + 'M');
};
export const budgetText = j => {
  const left = j && j.left && typeof j.left === 'object' ? j.left : {};
  if (typeof left.tokens === 'number') return 'Budget tokens: ' + tokensText(left.tokens);
  const points = typeof left.points === 'number' ? left.points : j && typeof j.line === 'number' && typeof j.all === 'number' ? j.line - j.all : null;
  return 'Budget: ' + (points !== null ? Math.round(points) + '%' : '-');
};

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
async function settleAgents($, agents, now) {
  const live = await liveAgents($);
  let dropped = false;
  for (const [id, a] of agents) {
    if (a.kind === 'session' || a.provisional) continue;
    if (live ? !live.has(id) : now - a.startedAt > STALE_AGENT) { agents.delete(id); dropped = true; continue; }
    const row = live && live.get(id);
    if (row && row.tokenCount > 0) a.tokens = row.tokenCount;
    if (row && !a.effort && EFFORT_ORDER.includes(row.effort)) a.effort = row.effort;
  }
  if (dropped) await keepAgents($, agents);
}

// ---- running agents across a reload ----
// A reload starts this module's memory over, and a subagent already at work
// was then known by nothing: the line and the toasts lost its role, its
// assignment, its time and its step. So what they need of each running
// subagent is kept in $.store under the session's id ('agents:<id>'):
// written when one starts, takes a new step or part, or ends (never on the
// refresh), the key deleted when none runs. At the load it is read back,
// only the agents $.agent.list() still runs; without the list, none. The
// time it started is the first one, so the time and the estimate go on.
// Side sessions are not kept: the poll at load finds them again.
const KEPT = ['id', 'type', 'description', 'model', 'effort', 'background', 'startedAt', 'step', 'part', 'tokens'];
async function agentsKey($) { try { const id = await $.session.id(); return id ? 'agents:' + id : null; } catch { return null; } }
async function keepAgents($, agents) {
  try {
    const key = await agentsKey($);
    if (!key) return;
    const list = [...agents.values()].filter(a => !a.provisional && a.kind !== 'session')
      .map(a => Object.fromEntries(KEPT.filter(k => a[k] !== undefined && a[k] !== null).map(k => [k, a[k]])));
    if (list.length) await $.store.set(key, list); else await $.store.delete(key);
  } catch { /* no store or no id: this copy's own memory */ }
}
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
  const texts = [];
  if (res && typeof res.text === 'string') texts.push(res.text);
  const r = res && res.result;
  const content = Array.isArray(r) ? r : r && Array.isArray(r.content) ? r.content : [];
  for (const c of content) if (c && typeof c.text === 'string') texts.push(c.text);
  for (const t of texts) { try { const v = JSON.parse(t); if (Array.isArray(v)) return v; } catch { /* not this one */ } }
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
  if (t - st.settledAt >= SETTLE_EVERY) { st.settledAt = t; await settleAgents($, st.agents, t); }
  const watching = t < st.watchUntil || [...st.agents.values()].some(a => a.kind === 'session');
  if (watching && t - st.polledAt >= POLL_EVERY) await pollSessions($, st, t);
  if (!st.agents.size && t >= st.watchUntil) stopTickOf(st);
  $.ui.status(st.lineNow(t));
  redraw($);
  if (st.agents.size && t - st.progressAt >= PROGRESS_EVERY) {
    st.progressAt = t;
    if (await noticesOn($)) $.ui.toast(progressText(st.list(), t));
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
      if (notify) $.ui.toast(sessionDoneText(a, t - a.startedAt, st.list()), { timeoutMs: TOAST_LONG });
    }
  }
  for (const r of live) {
    if (st.agents.has(r.sessionId)) continue;
    if (!st.agents.size) st.progressAt = t;
    // one the main thread just started or messaged: its time from then
    const since = st.watchSince && t - st.watchSince <= WATCH_FOR ? st.watchSince : t;
    st.agents.set(r.sessionId, { id: r.sessionId, kind: 'session', type: r.name || r.title || 'session', label: shortTitle(r), description: r.title, startedAt: since, background: true, runs: [], step: null });
    changed = true;
    if (notify) $.ui.toast(sessionStartedText(r, st.list()));
  }
  st.quiet = false;
  if (st.agents.size) startTick($, st);
  if (changed) { $.ui.status(st.lineNow(t)); redraw($); }
}
// whether the toasts about agents are on (config.json's agentNotices; on unless false)
async function noticesOn($) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (!home) return true;
    return JSON.parse(await $.fs.read(home + '/.claude/pacing/config.json')).agentNotices !== false;
  } catch { return true; }
}
// whether the offer to switch the session's model or effort is on (switchAsk)
async function switchOn($) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (!home) return true;
    return JSON.parse(await $.fs.read(home + '/.claude/pacing/config.json')).switchAsk !== false;
  } catch { return true; }
}
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
//   model   another model or effort than the reading recommends: calm
//   effort  at "over", one step less effort on tier 1: calm
// Switch runs /model and /effort as if typed (a live test: $.command.run
// with /model answered "Set model to ... for this session only", and
// $.session.model() agreed); where a run fails, the box is filled with the
// command for the user to send. Once per suggestion; Not now holds until the
// recommendation changes. Never switches without the press.
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const sameModel = (cur, id) => typeof cur === 'string' && typeof id === 'string' && cur.startsWith(id);
export const switchOffer = (j, curModel, curEffort) => {
  if (!j || typeof curModel !== 'string' || !curModel) return null;
  const rec = j.recommend, prem = j.premiumModelId, name = j.premiumLabel || 'The per-model model';
  const onPrem = sameModel(curModel, prem);
  const make = (kind, t, text) => ({ kind, model: t.model, label: t.label, effort: t.effort, text, urgent: kind === 'out' || kind === 'held',
    icon: kind === 'out' ? ICON.stop : kind === 'held' ? ICON.worse : ICON.switched, key: kind + ':' + t.model + ':' + t.effort });
  if (rec && onPrem && !sameModel(rec.model, prem) && j.premiumOut)
    return make('out', rec, name + ' is out until the reset. Switch this session to ' + rec.label + ' ' + rec.effort + '.');
  if (rec && onPrem && !sameModel(rec.model, prem) && j.premiumHeld)
    return make('held', rec, name + '\'s meter is over its budget line. Switch to ' + rec.label + ' ' + rec.effort + '; ' + name.split(' ')[0] + ' stays for hard tasks.');
  if (rec && (!sameModel(curModel, rec.model) || (curEffort && curEffort !== rec.effort && !j.effortStep)))
    return make('model', rec, 'This week\'s budget suggests ' + rec.label + ' ' + rec.effort + ' for this session.');
  const step = j.effortStep;
  if (step && sameModel(curModel, step.model) && (!curEffort || EFFORT_ORDER.indexOf(curEffort) > EFFORT_ORDER.indexOf(step.effort)))
    return make('effort', step, 'Over budget: one step less effort saves the most. Switch to ' + step.label + ' ' + step.effort + '.');
  return null;
};
// After a press. `was`: the model before it; where the model changed, the
// app's model menu may go on naming that one for a while, and the toast says
// so. A read-back that disagrees right after the press is read again after
// READ_BACK_LAG; a command that ran without an error is trusted over it.
export const READ_BACK_LAG = 2000;
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
  const share = budgetText(j);
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
async function reloadOn($) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (!home) return true;
    return JSON.parse(await $.fs.read(home + '/.claude/pacing/config.json')).autoReload !== false;
  } catch { return true; }
}
// the version plugin.json names now; null when unreadable
async function versionOnDisk($) { try { return versionOf(await $.fs.read($.plugin.root + '/.claude-plugin/plugin.json')); } catch { return null; } }
function say($, text) { try { $.ui.toast(text, { timeoutMs: TOAST_LONG }); } catch { /* an engine without toasts */ } }
// one look at the version on disk; `rl` is the copy's memory (see register).
// Never throws: a look is a convenience, and the next one tries again.
async function look($, rl) {
  if (rl.looking) return;
  rl.looking = true;
  try {
    const disk = await versionOnDisk($);
    if (!disk) return;
    // this copy's first look: what it was loaded as
    if (rl.loaded === null) { rl.loaded = disk; return; }
    if (disk === rl.loaded || disk === rl.acted || !rl.typed()) return;
    rl.acted = disk;
    // off: one toast for this version, no row
    if (!(await reloadOn($))) { say($, reloadText(disk)); return; }
    // the row for this version, unless Not now was pressed for it
    if (rl.dismissed.has(disk)) return;
    rl.row = disk;
    redraw($);
  } catch { /* the next look */ } finally { rl.looking = false; }
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
  let running = false;
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
  const modelNow = () => ss.model || sessionModel;
  // the offer to compact: the one in the band ({ level, tokens }) or null, the
  // size at each level's last offer, and whether a person has typed here
  let offer = null;
  let offered = {};
  let attended = false;
  // the pause's timers, and the pause (its last turn's end) a drawn now row spoke for
  let timers = [];
  let nowFor = null;
  const clearTimers = () => { for (const t of timers) { try { t.cancel(); } catch { /* gone */ } } timers = []; };
  const forget = () => { offer = null; offered = {}; };
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
  // a role whose next task goes to a fresh agent: the line for the session,
  // by role, until the next prompt carries it
  const fresh = new Map();
  const runningAgents = () => [...agents.values()].sort((x, y) => x.startedAt - y.startedAt);
  // the status line as it stands, with the agents when any run
  const lineNow = now => {
    const list = runningAgents();
    if (reading) return lineOf(reading, sessionModel, tokens, agentTokens, now, false, list, st.max);
    return list.length ? agentPart(list, now, st.max) : undefined;
  };
  const st = { agents, timer: null, settledAt: 0, polledAt: 0, watchUntil: 0, progressAt: 0, host: null, children: 0, quiet: false, watchSince: 0, max: LINE_MAX, surfaces: null,
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
        const moved = step !== a.step || part !== (a.part || null);
        a.step = step;
        a.part = part;
        if (moved) { redraw($); keepAgents($, agents); }
      }
    } catch { /* no step known */ }
    const toSession = !e.agentId && (e.tool === 'mcp__ccd_session__start_session' || e.tool === 'mcp__ccd_session_mgmt__send_message'
      || (e.tool === 'SendMessage' && /^local_/.test(String(e.to || ''))));
    if (!toSession) return next(e);
    const r = await next(e);
    try {
      st.watchSince = await $.clock.now();
      st.watchUntil = st.watchSince + WATCH_FOR;
      st.polledAt = 0;
      startTick($, st);
    } catch { /* no watch */ }
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
        const a = { id: r.agentId, type, description: e.description, model: r.model || e.model || e.parentModel,
          effort: efforts.get(e.tool_use_id) || keptEffort.get(r.agentId), background: !!e.background, startedAt: early ? early.startedAt : now, runs: [], step: null };
        efforts.delete(e.tool_use_id);
        if (a.effort) keptEffort.set(a.id, a.effort);
        // a fresh agent of a role is what a waiting line about one asked for
        if (!e.resume && roleFor(type)) fresh.delete(roleFor(type));
        if (!agents.size) st.progressAt = now;
        agents.set(a.id, a);
        keepAgents($, agents);
        startTick($, st);
        // in the line at once; its history for the estimate after
        $.ui.status(lineNow(now));
        redraw($);
        try { const all = await $.store.get('agentRuns'); if (all && typeof all === 'object' && Array.isArray(all[type])) a.runs = all[type]; } catch { /* no history */ }
        if (await noticesOn($)) $.ui.toast(startedText(a, runningAgents()));
      }
    } catch { /* an engine without timers or toasts: the count alone */ }
    return r;
  });

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
        Button({ key: 'pacing-switch', label: 'Switch', variant: target.urgent ? 'primary' : 'secondary', onPress: async () => {
          sw = null;
          redraw($);
          let ran = true, was = null, modelAsked = false, modelRan = null;
          try {
            was = ss.model || (await $.session.model());
            if (!sameModel(was, target.model)) {
              modelAsked = true;
              modelRan = await $.command.run({ command: 'model', args: target.model });
              if (commandFailed(modelRan)) throw new Error('refused');
              ss.model = target.model;
            }
            if (target.effort && (await effortNow($, ss)) !== target.effort) {
              if (commandFailed(await $.command.run({ command: 'effort', args: target.effort }))) throw new Error('refused');
              ss.effort = target.effort;
            }
            await keepSwitch($, ss);
          } catch { ran = false; }
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
            const model = sameModel(nowModel, target.model) || (modelRan && !commandFailed(modelRan)) ? target.model : nowModel;
            $.ui.toast(switchedText(target, model, effort, was), sameModel(model, target.model) ? undefined : { timeoutMs: TOAST_LONG });
          };
          let nowModel = null;
          try { nowModel = await $.session.model(); } catch { /* no read-back */ }
          if (sameModel(nowModel, target.model) || !modelAsked) { tell(sameModel(was, target.model) ? target.model : nowModel); return; }
          try {
            $.clock.after(READ_BACK_LAG, async () => {
              let again = nowModel;
              try { again = await $.session.model(); } catch { /* the first read stands */ }
              try { tell(again); } catch { /* no toast */ }
            });
          } catch { tell(nowModel); }
        } }),
        Button({ key: 'pacing-switch-not-now', label: 'Not now', role: 'dismiss', dimColor: true, onPress: () => { sw = null; redraw($); } }),
      ] });
      return stack(switchRow);
    }
    if (!offer && rl.row) {
      const version = rl.row;
      const reloadRow = Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, children: [
        Text({ dimColor: true, children: reloadText(version) }),
        Button({ key: 'pacing-reload-not-now', label: 'Not now', role: 'dismiss', dimColor: true, onPress: () => { rl.dismissed.add(version); rl.row = null; redraw($); } }),
      ] });
      return stack(reloadRow);
    }
    if (!offer) return Box({ flexDirection: 'column', children: [agentRow] });
    const shown = offer;
    const urge = shown.level !== 'suggest';
    const words = shown.level === 'now' ? ICON.pause + ' ' + nowText(shown.tokens, shown.lapsed) : ICON.compacted + ' ' + offerText(shown.level, shown.tokens);
    // drawn: the notice after this pause need not say it again
    if (shown.level === 'now') nowFor = shown.pause;
    const offerRow = Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, children: [
      Text(urge ? { color: 'warning', children: words } : { dimColor: true, children: words }),
      Button({ key: 'pacing-compact', label: 'Compact now', variant: urge ? 'primary' : 'secondary', onPress: async () => {
        offer = null;
        offered[shown.level] = shown.tokens;
        clearTimers();
        redraw($);
        try {
          const r = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS });
          if (r && r.skip) $.ui.toast(ICON.failed + ' the compaction did not run: ' + r.skip, { timeoutMs: TOAST_LONG });
          else {
            $.ui.toast(compactedText((r && r.tokensBefore) || shown.tokens, r && r.tokensAfter));
            forget();
            contextTokens = (r && r.tokensAfter) || null;
          }
        } catch {
          $.ui.toast(ICON.failed + ' a compaction cannot start while a turn runs. Type /compact once it ends.', { timeoutMs: TOAST_LONG });
        }
      } }),
      Button({ key: 'pacing-not-now', label: 'Not now', role: 'dismiss', dimColor: true, onPress: () => {
        if (shown.level === 'now') clearTimers();
        offer = null;
        offered[shown.level] = shown.tokens;
        redraw($);
      } }),
    ] });
    return agentRow ? Box({ flexDirection: 'column', children: [offerRow, agentRow] }) : offerRow;
  });

  // a compaction the person or the engine ran: the offers start over, and
  // the agents are counted again from the engine's list (none without it)
  on('session.compact', async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId && r && r.messages) {
      forget();
      contextTokens = r.tokensAfter || null;
      try {
        const live = await liveAgents($);
        for (const id of [...agents.keys()]) if (!live || !live.has(id)) agents.delete(id);
        if (!agents.size) stopTick();
        $.ui.status(lineNow(await $.clock.now()));
      } catch { /* the line is redrawn at the next measure */ }
      redraw($);
    }
    return r;
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
    try { if (!commandFailed(r)) await noteSet($, ss, 'model', e.args); } catch { /* not noted */ }
    return r;
  });
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e);
    try { if (!commandFailed(r)) await noteSet($, ss, 'effort', e.args); } catch { /* not noted */ }
    return r;
  });

  // the whole line, which the footer cuts: /pacing-status, at any time.
  // A new or resumed session runs no agents of this module's knowing; after
  // a reload, the ones kept in the store that the engine still runs come back.
  on('session.start', async ($, e, next) => {
    agents.clear();
    stopTick();
    fresh.clear();
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
      await learnSurfaces($, st);
      const { week, five } = await limitsNow($);
      const known = !!(week && week.resetsAt);
      if (running) return;
      running = true;
      try {
        let j = await runReading($, week, five, sessionModel, spend);
        const logged = !!j;
        if (!j && !known) {
          const st = await storedReading($);
          if (st && typeof st.all === 'number' && st.reset) {
            const r = await $.process.run(readingArgv($.plugin.root, st.all, st.reset, st.five, st.fiveReset, true), { timeoutMs: 20000 });
            j = r.exitCode === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
          }
        }
        if (j) {
          reading = { ...j, fromLoad: true };
          // a logged reading counts as the last one; a dry one leaves the next due
          if (logged) last = { pct: known ? week.percentUsed : j.all, at: now };
          $.ui.status(lineNow(now));
        }
      } finally { running = false; }
    })().catch(() => { /* a failure draws nothing new */ });
    // the side sessions already working (a reload mid-work): in the line, no toast
    // the subagents a reload found at work, with what was known of them (see
    // "running agents across a reload"): in the line and the next toast as before
    (async () => {
      const n = await restoreAgents($, agents);
      await keepAgents($, agents);
      if (!n) return;
      const now = await $.clock.now();
      for (const a of agents.values()) if (a.effort) keptEffort.set(a.id, a.effort);
      st.progressAt = now;
      startTick($, st);
      $.ui.status(lineNow(now));
      redraw($);
    })().catch(() => { /* none known, as before */ });
    (async () => { st.quiet = true; await pollSessions($, st, await $.clock.now()); })().catch(() => { /* none known */ });
    // the model and effort last set in this session, should a reload have
    // started this memory over
    restoreSwitch($, ss).catch(() => { /* none kept */ });
    // the version this copy was loaded as, and from here a slow look at the
    // one on disk (see "a new version")
    look($, rl);
    try {
      if (rl.timer) rl.timer.cancel();
      rl.timer = $.clock.every(RELOAD_CHECK_EVERY, () => { look($, rl); });
    } catch { /* an engine without timers: the look after a turn */ }
    return result;
  });
  on('command.run', { command: 'pacing-status' }, async ($) => {
    if (!reading) return { text: 'Pacing: no automatic reading yet in this session. /pacing usage takes one now.', isTextDisplayOnly: true };
    // ages and run times as of now, by the engine's clock where it has one
    let now;
    try { now = await $.clock.now(); } catch { now = Date.now(); }
    const text = lineOf(reading, sessionModel, tokens, agentTokens, now, true, runningAgents());
    return { text: 'Pacing: ' + text + (reading.do ? '\nNow: ' + reading.do : ''), isTextDisplayOnly: true };
  });
  // The report of `budget.mjs last`: the bars and the tier sheet. Where the
  // last reading is too old to show, the module takes one itself first, if
  // the app's usage tool answers; else it says why and where to measure.
  on('command.run', { command: 'pacing-usage' }, async ($) => {
    const show = text => ({ text, isTextDisplayOnly: true });
    try {
      let out = await scriptOut($, 'budget.mjs', ['last']);
      if (measureWhy(out) && !running) {
        running = true;
        try {
          let now;
          try { now = await $.clock.now(); } catch { now = Date.now(); }
          const { week, five } = await limitsNow($);
          const j = await runReading($, week, five, sessionModel, spend);
          if (j) {
            last = { pct: week && week.resetsAt ? week.percentUsed : j.all, at: now };
            sayLevel($, reading, j);
            reading = j;
            $.ui.status(lineNow(now));
            out = await scriptOut($, 'budget.mjs', ['last']);
          }
        } catch { /* the reason stands */ } finally { running = false; }
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
    try {
      // only a prompt that starts a turn after a pause, typed by the user; a
      // slash command (/compact, a handover) is the user acting on it already
      const typed = !e.turnId && !e.isMeta && !e.command && !String(e.text || '').trimStart().startsWith('/')
        && !unattended(e.origin);
      // a person in front of the session: the offers are theirs to answer
      if (!e.turnId && !e.isMeta) attended = !unattended(e.origin);
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
        if (note && nowFor !== lastTurnAt) $.ui.toast(note, { timeoutMs: TOAST_LONG });
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
      try { lastTurnAt = await $.clock.now(); } catch { /* no clock: no warning */ }
      // the turn's own model: from here it, not the one last set, is the model
      if (e.usage && e.usage.model) {
        sessionModel = e.usage.model;
        if (ss.model) { ss.model = null; keepSwitch($, ss); }
      }
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
        keepAgents($, agents);
        const now = await $.clock.now();
        if (!agents.size) stopTick();
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
          if (running || (last && now - last.at < AGENT_GAP)) return;
          running = true;
          try {
            const { week, five } = await limitsNow($);
            const j = await runReading($, week, five, sessionModel, spend);
            if (j) {
              last = { pct: week && week.resetsAt ? week.percentUsed : j.all, at: now };
              sayLevel($, reading, j);
              reading = j;
              $.ui.status(lineNow(now));
              redraw($);
            }
          } finally { running = false; }
        })().catch(() => { /* a record and a reading are conveniences */ });
        if (await noticesOn($)) $.ui.toast(doneText(a, now - a.startedAt, spent, runningAgents()), { timeoutMs: TOAST_LONG });
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
        if (agents.size !== before) keepAgents($, agents);
        await settleAgents($, agents, await $.clock.now());
        if (!agents.size) stopTick();
        redraw($);
      } catch { /* the count is settled at the next refresh */ }
    }
    // the turn's tokens are in: the line shows them now, not at the next turn
    if (!e.agentId && !running) {
      try { if (reading || agents.size) $.ui.status(lineNow(lastTurnAt ?? Date.now())); } catch { /* never disturbs the turn */ }
    }
    // a natural break: the main thread's turn ended. A session on another
    // model or effort than the reading recommends is offered the switch,
    // once per suggestion; one that no longer needs it loses the row.
    if (!e.agentId && attended && reading) {
      try {
        let model = modelNow();
        if (!model) { try { model = await $.session.model(); } catch { /* not known */ } }
        const o = (await switchOn($)) ? switchOffer(reading, model, await effortNow($, ss)) : null;
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
            if (lastTurnAt !== pause) return;
            offer = { level: 'now', tokens: size, lapsed, pause };
            redraw($);
          };
          timers.push($.clock.after(CACHE_TTL - LAPSE_LEAD, raise(false)));
          timers.push($.clock.after(CACHE_TTL, raise(true)));
        }
      } catch { /* an engine without the band: nothing drawn */ }
    }
    return result;
  });

  on('session.measure', async ($, e, next) => {
    const result = await next(e);
    if (e.context && typeof e.context.tokens === 'number') contextTokens = e.context.tokens;
    const limits = e.rateLimits || [];
    const week = limits.find(r => r.kind === 'seven_day');
    // no weekly window: an API key, not a subscription, or no response yet
    if (!week || !week.resetsAt || running) return result;
    // the engine's clock, which a test can set; the system's where there is none
    let now;
    try { now = await $.clock.now(); } catch { now = Date.now(); }
    const due = !last || Math.abs(week.percentUsed - last.pct) >= 1 || now - last.at >= MIN_GAP;
    try {
      if (due) {
        running = true;
        last = { pct: week.percentUsed, at: now };
        // every meter where the app's usage tool answers, else these two windows
        const j = await runReading($, week, limits.find(r => r.kind === 'five_hour'), sessionModel, spend);
        if (j) {
          sayLevel($, reading, j);
          reading = j;
        }
      }
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
        $.ui.status(lineOf(reading, model, tokens, agentTokens, now, false, runningAgents(), st.max));
      }
    } catch {
      // a reading is a convenience: a missing node, a timeout or a bad line
      // must never disturb the session
    } finally {
      running = false;
    }
    return result;
  });
};
