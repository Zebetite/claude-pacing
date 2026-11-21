// Automatic readings: after a turn, the engine hands this module the session's
// rate-limit windows (session.measure). When the weekly all-models window
// moved a whole point, or 30 min passed, it runs budget.mjs --source hook,
// which logs the reading, keeps state.json fresh for the next session's start
// line, and answers in one JSON line. The status line shows the result, each
// tier marked by a coloured circle, and a change of level one toast:
//
//   77% of budget, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (36% Weekly, 40% Fable)
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
// (Weekly · Fable) and extra usage are not in what the engine hands a plugin;
// budget.mjs carries the per-model figure over from the last reading, and the
// skill's own readings stay for both.
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
  ? 'Pacing: this session is ' + Math.round(tokens / 1000) + 'k tokens and sat idle ' + span(idleMs)
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
  ? 'Pacing: compacted from ' + kTok(before) + ' to ' + kTok(after) + ' tokens.'
  : 'Pacing: compacted. The status line shows the new size after the next turn.');
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
// reading is due: the module cannot read the per-model meter, the session
// can. One line, once per stale figure, and again after an hour if nothing
// came of it; never a tool call on every turn.
const ASK_AGAIN = 60 * 60 * 1000;
export const fullReadingAsk = j => (j && j.needFull
  ? 'Pacing (automatic note, not from the user): ' + j.needFull
    + (j.premium != null ? '; it read ' + Math.round(j.premium) + ' % then' + (j.premiumEstimate != null ? ' and is about ' + Math.round(j.premiumEstimate) + ' % by estimate' : '') : '')
    + '. The automatic readings cannot read that meter. Before the next piece of work, take a full reading: run the `pacing` skill with `usage now`, and follow its do: line.'
  : null);

// A session another session started (a side session in the desktop app)
// says so up front, with the tier of the model it runs on:
//   ⚪Tier 2 Sub Agent - 77% of budget, ⚪Tier 2[90%] 🟤Tier 4[10%], (36% Weekly, 40% Fable)
// `self` is that tier ('Other' off the ladder), or null for any other session.
// `now` (ms) dates a carried per-model figure: "71% Fable 15h ago, est. 90%".
// The status line, compact. The desktop app gives it what is left of the
// composer's footer beside the model and mode pickers, and cuts the rest with
// an ellipsis: about 33 characters while a turn runs. So what matters comes
// first and a cut takes only the tail:
//   a side session's own tier   🟡T1 sub
//   the budget share            Budget 107%
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

// ---- subagents at work ----
// The session's own subagents, from the engine's events: agent.spawn starts
// one (type, model; its effort from the Agent call), its loop's turn.complete
// ends it. $.agent.list() settles the count: an agent it lists as neither
// pending nor running is gone. The main thread's turn ending ends every
// foreground agent (the turn waited for them); a new or resumed session
// starts with none. While any run:
//   the status line leads with them, the whole line within LINE_MAX, in
//   steps: each agent with its time, then names, then the count and the
//   longest run, then the count alone; never without the count, and the
//   level with its share always shows;
//   a toast when one starts and when one ends, and every 5 minutes while
//   any runs (`/pacing notify off` quiets the toasts);
//   a background agent still running after the turn ended gets a row in the
//   band above the prompt, under the offer to compact, never over it.
// Toasts and the row are one line each, within MSG_MAX.
export const LINE_MAX = HEAD_MAX;
export const MSG_MAX = 80;
export const REFRESH_EVERY = 30 * 1000;
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
  return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + '.' + m[3] : String(id || '');
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
// "reader 3m ~60% searching": as much as `parts` asks for
const detail = (a, now, parts) => [roleOf(a.type), parts.time ? dur(now - a.startedAt) : '', parts.est ? estText(a, now) : '', parts.step && a.step ? a.step : '']
  .filter(Boolean).join(' ');
// the status line's agent part, the first step that fits `room`. An
// estimate takes the time's place before it goes; the count never goes.
export const agentPart = (agents, now, room) => {
  const n = agents.length;
  if (!n) return '';
  const longest = dur(now - Math.min(...agents.map(a => a.startedAt)));
  if (n === 1) {
    const a = agents[0], on = runOn(a), e = estText(a, now);
    return firstFit([
      '⏳ ' + detail(a, now, { time: 1, est: 1 }) + (on ? ' (' + on + ')' : ''),
      '⏳ ' + detail(a, now, { time: 1, est: 1 }),
      ...(e ? ['⏳ ' + roleOf(a.type) + ' ' + e] : []),
      '⏳ ' + detail(a, now, { time: 1 }),
      '⏳ ' + roleOf(a.type), '⏳1'], room);
  }
  const anyEst = agents.some(a => estText(a, now));
  return firstFit([
    '⏳ ' + n + ' agents · ' + agents.map(a => detail(a, now, { time: 1, est: 1 })).join(' · '),
    ...(anyEst ? ['⏳ ' + n + ' agents · ' + agents.map(a => estText(a, now) ? roleOf(a.type) + ' ' + estText(a, now) : detail(a, now, { time: 1 })).join(' · ')] : []),
    '⏳ ' + n + ' agents · ' + agents.map(a => detail(a, now, { time: 1 })).join(' · '),
    '⏳ ' + n + ' agents · ' + agents.map(a => roleOf(a.type)).join(' · '),
    '⏳ ' + n + ' agents ' + longest,
    '⏳ ' + n + ' agents',
    '⏳' + n,
  ], room);
};
const running = n => (n === 0 ? 'no agents running now' : n === 1 ? '1 agent running' : n + ' agents running');
export const startedText = (a, n) => firstFit([
  'Pacing: ' + roleOf(a.type) + ' started' + (runOn(a) ? ' on ' + runOn(a) : '') + '; ' + running(n) + '.',
  'Pacing: ' + roleOf(a.type) + ' started; ' + running(n) + '.',
], MSG_MAX);
export const doneText = (a, ms, tokens, n) => firstFit([
  'Pacing: ' + roleOf(a.type) + ' done in ' + dur(ms) + (tokens ? ', ' + Math.round(tokens / 1000) + 'k tokens' : '') + '; ' + (n ? running(n).replace('running', 'still running') : running(0)) + '.',
  'Pacing: ' + roleOf(a.type) + ' done in ' + dur(ms) + '; ' + running(n) + '.',
], MSG_MAX);
export const progressText = (agents, now) => {
  const n = agents.length, longest = dur(now - Math.min(...agents.map(a => a.startedAt)));
  const who = n === 1 ? '1 agent' : n + ' agents';
  return firstFit([
    'Pacing: ' + who + ' still working: ' + agents.map(a => detail(a, now, { time: 1, est: 1, step: 1 })).join(', ') + '.',
    'Pacing: ' + who + ' still working: ' + agents.map(a => detail(a, now, { time: 1, est: 1 })).join(', ') + '.',
    'Pacing: ' + who + ' still working: ' + agents.map(a => detail(a, now, { time: 1 })).join(', ') + '.',
    'Pacing: ' + who + ' still working, the longest for ' + longest + '.',
  ], MSG_MAX);
};
export const backgroundText = (agents, now, room = MSG_MAX) => {
  const n = agents.length, who = n === 1 ? '1 agent' : n + ' agents';
  const longest = dur(now - Math.min(...agents.map(a => a.startedAt)));
  return firstFit([
    '⏳ ' + who + ' still working in the background: ' + agents.map(a => detail(a, now, { time: 1, est: 1, step: 1 })).join(', '),
    '⏳ ' + who + ' still working in the background: ' + agents.map(a => detail(a, now, { time: 1, est: 1 })).join(', '),
    '⏳ ' + who + ' still working in the background: ' + agents.map(a => detail(a, now, { time: 1 })).join(', '),
    '⏳ ' + who + ' still working in the background, the longest for ' + longest,
    '⏳ ' + who + ' still working, ' + longest,
    '⏳ ' + who,
  ], Math.min(room, MSG_MAX));
};
// the session's own agents still running, by the engine's list; null where
// the engine has no list
async function liveAgents($) {
  try {
    const list = await $.agent.list();
    return new Set(list.filter(a => a.status === 'pending' || a.status === 'running').map(a => a.id));
  } catch { return null; }
}
// drop the agents the engine no longer runs; without its list, those of the
// background that have run implausibly long
async function settleAgents($, agents, now) {
  const live = await liveAgents($);
  for (const [id, a] of agents) if (live ? !live.has(id) : now - a.startedAt > STALE_AGENT) agents.delete(id);
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
// the effort the session runs at, where the engine says (CLAUDE_EFFORT)
async function effortNow($) {
  try { const v = await $.env.get('CLAUDE_EFFORT'); return typeof v === 'string' && v ? v : null; } catch { return null; }
}

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
    key: kind + ':' + t.model + ':' + t.effort });
  if (rec && onPrem && !sameModel(rec.model, prem) && j.premiumOut)
    return make('out', rec, name + ' is out until the reset. Switch this session to ' + rec.label + ' ' + rec.effort + '.');
  if (rec && onPrem && !sameModel(rec.model, prem) && j.premiumHeld)
    return make('held', rec, name + '\'s own meter is over its line. Switch to ' + rec.label + ' ' + rec.effort + '; ' + name.split(' ')[0] + ' stays for hard tasks.');
  if (rec && (!sameModel(curModel, rec.model) || (curEffort && curEffort !== rec.effort && !j.effortStep)))
    return make('model', rec, 'This week\'s budget suggests ' + rec.label + ' ' + rec.effort + ' for this session.');
  const step = j.effortStep;
  if (step && sameModel(curModel, step.model) && (!curEffort || EFFORT_ORDER.indexOf(curEffort) > EFFORT_ORDER.indexOf(step.effort)))
    return make('effort', step, 'Over budget: one step less effort saves the most. Switch to ' + step.label + ' ' + step.effort + '.');
  return null;
};
export const switchedText = (target, nowModel, nowEffort) => (sameModel(nowModel, target.model)
  ? 'Pacing: this session now runs on ' + modelLabel(nowModel) + (nowEffort ? ' ' + nowEffort : target.effort ? ' ' + target.effort : '') + '.'
  : 'Pacing: the switch did not take; the session still runs on ' + modelLabel(nowModel) + '. The model menu does it: ' + target.label + ', effort ' + target.effort + '.');
// The head is the weekly meter's level and share. The per-model meter shows
// as its week's usage among the meters and nowhere else: a share of its line
// ("Fable held 158%") read as usage over 100 %. When that meter set the
// level, the head has the share alone, without the level's word, which
// would not match the weekly share beside it.
// A side session (one another session started, `spawned`) shows no per-model
// meter at all: the figure is the account's, its session on the per-model
// model is the one that started it, and in a side session's narrow line it
// read as the side session's own use.
const sideOf = (j, self) => self !== null || j.spawned === true;
// While subagents run (`agents`, see "subagents at work"), the line leads
// with them and the whole line stays within LINE_MAX: a side session's tier
// if there is room, the agents (shrunk in steps, never without their count),
// the level with its share (always), then the tier split and the meters only
// as far as they fit whole.
export const statusText = (j, mix, self = null, now = Date.now(), agents = []) => {
  const side = sideOf(j, self);
  const name = j.premiumLabel && !side ? j.premiumLabel.split(' ')[0] : null;
  // the weekly meter's share of today's budget line, without a word on it:
  // over 100 % is over. The toast on a change of level says the rest.
  const level = 'Budget ' + (j.ofBudget != null ? j.ofBudget + '%' : '-');
  const sub = self !== null ? square(self) + (self === 'Other' ? 'Other' : 'T' + self) + ' sub' : null;
  const split = mix.length ? mix.map(x => square(x.tier) + (x.tier === 'Other' ? 'Other' : 'T' + x.tier) + ' ' + x.share + '%').join(' ') : null;
  const meters = ['week ' + Math.round(j.all) + '%'];
  if (j.premium != null && name) {
    const age = j.premiumAt ? now - Date.parse(j.premiumAt) : 0;
    const est = j.premiumEstimate != null && Math.round(j.premiumEstimate) > Math.round(j.premium) ? ' est ' + Math.round(j.premiumEstimate) + '%' : '';
    meters.push(name + ' ' + Math.round(j.premium) + '%' + (age > CARRIED_CURRENT ? ' (' + ageText(age) + ' old' + est + ')' : ''));
  }
  if (agents.length) {
    // the agents' fixed share: what the level leaves. A side session's tier
    // goes first only where it costs the agents no step of their detail.
    const room = LINE_MAX - chars(level) - 3;
    const lead = agentPart(agents, now, room);
    const withSub = sub && agentPart(agents, now, room - chars(sub) - 3) === lead;
    let line = [withSub ? sub : null, lead, level].filter(Boolean).join(' · ');
    for (const more of [split, meters.join(' ')]) if (more && chars(line + ' · ' + more) <= LINE_MAX) line += ' · ' + more;
    return line;
  }
  const parts = [[sub, level].filter(Boolean).join(' · ')];
  if (split) parts.push(split);
  parts.push(meters.join(' '));
  return parts.join(' · ');
};

// the long form, as the line read before 0.9.5: for /pacing-status
export const fullText = (j, mix, self = null, now = Date.now()) => {
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
  // the weekly meter's share of its line; the per-model meter shows as its
  // usage among the meters only (see statusText)
  // (the "Now:" line /pacing-status adds says what to do about it)
  const share = j.ofBudget != null ? 'Budget ' + j.ofBudget + '%' : null;
  if (self !== null) parts.push(square(self) + (self === 'Other' ? 'Other' : 'Tier ' + self) + ' Sub Agent' + (share ? ' - ' + share : ''));
  else if (share) parts.push(share);
  if (mix.length) parts.push(mix.map(x => square(x.tier) + (x.tier === 'Other' ? 'Other' : 'Tier ' + x.tier) + '[' + x.share + '%]').join(' '));
  parts.push('(' + meters.join(', ') + ')');
  return parts.join(', ');
};

// the status line from a reading. A side session leads with its own tier, by
// the model its main thread runs on; a model off the ladder is Other.
export const lineOf = (j, model, tokens, agentTokens, now, full = false, agents = []) => {
  const prices = j.prices || {}, tierOf = j.tierOf || {};
  const child = j.spawned === true && typeof model === 'string' && model !== '';
  const id = child ? idOf(model, prices) : null;
  const self = child ? (id && tierOf[id]) || 'Other' : null;
  if (full) return fullText(j, tierMix(tokens, tierOf, prices, agentTokens, j.agentTierOf), self, now)
    + (agents.length ? '\nAgents running: ' + agents.map(a => detail(a, now, { time: 1, est: 1, step: 1 }) + (runOn(a) ? ' (' + runOn(a) + ')' : '') + (a.description ? ', ' + a.description : '')).join('; ')
      + (agents.some(a => estText(a, now)) ? '\n~ is a rough estimate from how long that kind of agent usually takes, not a measure of the work done.' : '') : '');
  return statusText(j, tierMix(tokens, tierOf, prices, agentTokens, j.agentTierOf), self, now, agents);
};

/** @type {import('claude-code').Register} */
export const register = on => {
  // this module's memory, for this session; a reload starts it over, and
  // budget.mjs keeps the log thin across sessions and reloads by itself
  // tokens per model id: the session's own turns, and its subagents'
  const tokens = {};
  const agentTokens = {};
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
  // the session's own subagents now running, by id; the effort each Agent
  // call asked for, by its tool call; the refresh timer while any run; when
  // the last progress toast went out
  const agents = new Map();
  const efforts = new Map();
  let agentTick = null;
  let progressAt = 0;
  const runningAgents = () => [...agents.values()].sort((a, b) => a.startedAt - b.startedAt);
  const stopTick = () => { if (agentTick) { try { agentTick.cancel(); } catch { /* gone */ } agentTick = null; } };
  // the status line as it stands, with the agents when any run
  const lineNow = now => {
    const list = runningAgents();
    if (reading) return lineOf(reading, sessionModel, tokens, agentTokens, now, false, list);
    return list.length ? agentPart(list, now, LINE_MAX) : undefined;
  };

  // an Agent call's effort, which agent.spawn does not carry
  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    try { if (e.effort && e.tool_use_id) efforts.set(e.tool_use_id, e.effort); } catch { /* no effort known */ }
    return next(e);
  });

  // what a running agent is doing: its latest tool call
  on('tool.call', ($, e, next) => {
    try { if (e.agentId && agents.has(e.agentId)) agents.get(e.agentId).step = stepOf(e.tool); } catch { /* no step known */ }
    return next(e);
  });

  // a subagent of the main thread starts (or a kept one is sent its next task)
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e);
    try {
      if (r && r.agentId && !e.parentAgentId && !e.isTeammate) {
        const now = await $.clock.now();
        const type = e.subagentType || 'general-purpose';
        // the type's recent finished runs, for the estimate; none on an engine without a store
        let runs = [];
        try { const all = await $.store.get('agentRuns'); if (all && typeof all === 'object' && Array.isArray(all[type])) runs = all[type]; } catch { /* no history */ }
        const a = { id: r.agentId, type, description: e.description, model: r.model || e.model || e.parentModel,
          effort: efforts.get(e.tool_use_id), background: !!e.background, startedAt: now, runs, step: null };
        efforts.delete(e.tool_use_id);
        if (!agents.size) progressAt = now;
        agents.set(a.id, a);
        if (!agentTick) {
          agentTick = $.clock.every(REFRESH_EVERY, () => {
            (async () => {
              const t = await $.clock.now();
              await settleAgents($, agents, t);
              if (!agents.size) stopTick();
              $.ui.status(lineNow(t));
              redraw($);
              if (agents.size && t - progressAt >= PROGRESS_EVERY) {
                progressAt = t;
                if (await noticesOn($)) $.ui.toast(progressText(runningAgents(), t));
              }
            })().catch(() => { /* a refresh never disturbs the session */ });
          });
        }
        $.ui.status(lineNow(now));
        if (await noticesOn($)) $.ui.toast(startedText(a, agents.size));
      }
    } catch { /* an engine without timers or toasts: the count alone */ }
    return r;
  });

  // the band above the prompt: the suggest, urge and now offers, and under
  // them a row for background agents still at work. Hidden while a turn
  // runs, under a survey, and over a subagent's transcript.
  // One action row at a time, by urgency: a switch away from a model that is
  // out or held, then the offer to compact, then a calm switch (another
  // model, or one step less effort). The background agents' row goes under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = e.props || {};
    const background = runningAgents().filter(a => a.background);
    if ((!offer && !sw && !background.length) || p.hasSurvey || p.isWorking || (p.view && p.view.agentId) || (e.plugin && e.plugin !== 'pacing')) return next(e);
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
        Text(target.urgent ? { color: 'warning', children: target.text } : { dimColor: true, children: target.text }),
        Button({ key: 'pacing-switch', label: 'Switch', variant: target.urgent ? 'primary' : 'secondary', onPress: async () => {
          sw = null;
          redraw($);
          let ran = true;
          try {
            const was = await $.session.model();
            if (!sameModel(was, target.model)) await $.command.run({ command: 'model', args: target.model });
            if (target.effort && (await effortNow($)) !== target.effort) await $.command.run({ command: 'effort', args: target.effort });
          } catch { ran = false; }
          if (!ran) {
            // the command as text in the box, for the user to send
            try { await $.prompt.fill({ text: '/model ' + target.model, mode: 'replace' }); } catch { /* the menu alone */ }
            $.ui.toast('Pacing: press Enter to switch to ' + target.label + (target.effort ? '; then set effort ' + target.effort + ' in the model menu' : '') + '.');
            return;
          }
          try { $.ui.toast(switchedText(target, await $.session.model(), await effortNow($))); } catch { /* no read-back */ }
        } }),
        Button({ key: 'pacing-switch-not-now', label: 'Not now', role: 'dismiss', dimColor: true, onPress: () => { sw = null; redraw($); } }),
      ] });
      return stack(switchRow);
    }
    if (!offer) return Box({ flexDirection: 'column', children: [agentRow] });
    const shown = offer;
    const urge = shown.level !== 'suggest';
    const words = shown.level === 'now' ? nowText(shown.tokens, shown.lapsed) : offerText(shown.level, shown.tokens);
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
          if (r && r.skip) $.ui.toast('Pacing: the compaction did not run: ' + r.skip);
          else {
            $.ui.toast(compactedText((r && r.tokensBefore) || shown.tokens, r && r.tokensAfter));
            forget();
            contextTokens = (r && r.tokensAfter) || null;
          }
        } catch {
          $.ui.toast('Pacing: a compaction cannot start while a turn runs. Type /compact once it ends.');
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

  // the whole line, which the footer cuts: /pacing-status, at any time.
  // A new or resumed session runs no agents of this module's knowing.
  on('session.start', async ($, e, next) => {
    agents.clear();
    stopTick();
    try {
      await $.command.register({ name: 'pacing-status', description: 'Pacing: the whole status line, and what to do now.', immediate: true });
    } catch { /* an engine without commands: the line alone */ }
    return next(e);
  });
  on('command.run', { command: 'pacing-status' }, async () => {
    if (!reading) return { text: 'Pacing: no automatic reading yet in this session. /pacing usage reads now.' };
    const text = lineOf(reading, sessionModel, tokens, agentTokens, lastTurnAt ?? Date.now(), true, runningAgents());
    return { text: 'Pacing: ' + text + (reading.do ? '\nNow: ' + reading.do : '') };
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
        if (note && nowFor !== lastTurnAt) $.ui.toast(note, { timeoutMs: 15000 });
        if (note) warnedFor = lastTurnAt;
      }
      // a full reading is due: the session is told beside this prompt, in a
      // block the user does not see; the prompt's own text is never touched
      if (typed && reading && reading.needFull) {
        const now = await $.clock.now();
        const key = reading.premiumAt || 'none';
        if (askedFor !== key || now - askedAt >= ASK_AGAIN) {
          const ask = fullReadingAsk(reading);
          askedFor = key;
          askedAt = now;
          if (ask) return next({ ...e, context: [...(e.context ?? []), ask] });
        }
      }
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
      if (e.usage && e.usage.model) sessionModel = e.usage.model;
    }
    const u = e.usage;
    if (u && u.model) {
      const seen = e.agentId ? agentTokens : tokens;
      const t = (seen[u.model] ||= { in: 0, out: 0, read: 0, write: 0 });
      t.in += u.input_tokens || 0;
      t.out += u.output_tokens || 0;
      t.read += u.cache_read_input_tokens || 0;
      t.write += u.cache_creation_input_tokens || 0;
    }
    // a subagent's run ended: one toast, and the line without it
    if (e.agentId && agents.has(e.agentId)) {
      try {
        const a = agents.get(e.agentId);
        agents.delete(e.agentId);
        const now = await $.clock.now();
        if (!agents.size) stopTick();
        $.ui.status(lineNow(now));
        redraw($);
        const spent = u ? (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0;
        if (await noticesOn($)) $.ui.toast(doneText(a, now - a.startedAt, spent, agents.size));
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
    // the main thread's turn ended: its foreground agents with it (it waited
    // for them); the engine's list settles the rest
    if (!e.agentId && agents.size) {
      try {
        for (const [id, a] of agents) if (!a.background) agents.delete(id);
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
        let model = sessionModel;
        if (!model) { try { model = await $.session.model(); } catch { /* not known */ } }
        const o = (await switchOn($)) ? switchOffer(reading, model, await effortNow($)) : null;
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
        const five = limits.find(r => r.kind === 'five_hour');
        const argv = ['node', $.plugin.root + '/skills/pacing/scripts/budget.mjs',
          '--all', String(week.percentUsed), '--reset', week.resetsAt, '--source', 'hook'];
        if (five) argv.push('--five', String(five.percentUsed), ...(five.resetsAt ? ['--five-reset', five.resetsAt] : []));
        const r = await $.process.run(argv, { timeoutMs: 20000 });
        const j = r.exitCode === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
        if (j) {
          if (reading && j.level !== reading.level) {
            $.ui.toast('Pacing: ' + levelPhrase(reading.level) + ' -> ' + levelPhrase(j.level) + (j.levelBy === 'premium' && j.premiumLabel ? ' (' + j.premiumLabel.split(' ')[0] + ' meter)' : '') + '. ' + (j.do || ''));
          } else if (reading && !!j.premiumHeld !== !!reading.premiumHeld) {
            // the per-model meter moved the session off its model, or let it back
            $.ui.toast('Pacing: ' + (j.do || ''));
          }
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
        $.ui.status(lineOf(reading, model, tokens, agentTokens, now, false, runningAgents()));
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
