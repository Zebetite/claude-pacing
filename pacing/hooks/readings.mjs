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

// what budget.mjs is run with for a reading from the hooks module; `dry`
// computes from given figures and logs nothing
export const readingArgv = (root, all, reset, five, fiveReset, dry) => ["node", root + "/skills/pacing/scripts/budget.mjs",
  "--all", String(all), "--reset", reset, "--source", "hook",
  ...(typeof five === "number" ? ["--five", String(five), ...(fiveReset ? ["--five-reset", fiveReset] : [])] : []),
  ...(dry ? ["--dry"] : [])];
// the last reading budget.mjs stored for the start line (state.json), or null
async function storedReading($) {
  try {
    const home = (await $.env.get("USERPROFILE")) || (await $.env.get("HOME"));
    if (!home) return null;
    return JSON.parse(await $.fs.read(home + "/.claude/pacing/state.json"));
  } catch { return null; }
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
//   steps: each agent with its assignment, what it is doing, its time and
//   the estimate, then less and less of that, then names, then the count;
//   never without the count, and the budget share always shows;
//   a toast when one starts and when one ends, and every 5 minutes while
//   any runs (`/pacing notify off` quiets the toasts);
//   a background agent still running after the turn ended gets a row in the
//   band above the prompt, under the offer to compact, never over it.
// Toasts and the row are one line each, within MSG_MAX.
// While agents run the whole line keeps within LINE_MAX: a line of 75
// characters was seen whole in the desktop app's footer, and a module cannot
// learn the room it really has (it varies with the window and what else
// stands there; one screenshot showed 33 before the ellipsis during a turn).
// So the order is the agents, the budget share, the usage: a cut by the app
// takes the least important end.
export const LINE_MAX = 75;
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
// One agent as the user reads it: its name, its assignment (the short
// description it was started with), what it is doing now, how long it has
// run, the estimate, in that order; as much as `parts` asks for.
//   with a step      reader: read the logs, searching 3m ~60%
//   without one      reader is running: read the logs 3m
//   no assignment    reader searching 3m ~60%, reader is running 3m
// `parts.task` is how many characters of the assignment show (cut with an
// ellipsis past it; 0 or absent: none). `parts.quote` is the toasts' form,
// which says "running" itself: reader "read the logs", searching 3m ~60%.
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
  return [head, parts.time ? dur(now - a.startedAt) : '', parts.est ? estText(a, now) : ''].filter(Boolean).join(' ');
};
// What shows of every agent, from all of it to the names alone: for all of
// them at each step and from the right, the estimate goes, then the step,
// then the assignment (cut shorter and shorter, then gone), then the time
// and "is running" with it.
const shrinks = (agents, more = {}) => {
  const longest = Math.max(0, ...agents.map(a => chars(taskOf(a))));
  const out = [{ task: TASK_MAX, step: 1, time: 1, est: 1 }, { task: TASK_MAX, step: 1, time: 1 }, { task: TASK_MAX, time: 1 }];
  for (let n = longest - 1; n >= TASK_MIN; n--) out.push({ task: n, time: 1 });
  out.push({ time: 1 }, {});
  return out.map(parts => ({ ...parts, ...more }));
};
// "2 Agents", "2 Agents are running": the count, only for more than one;
// `word` goes before "running" ("still", "also")
export const countText = list => list.length + (list.length === 1 ? ' Agent' : ' Agents');
export const runningText = (list, word = '') => countText(list) + (list.length === 1 ? ' is ' : ' are ') + (word ? word + ' ' : '') + 'running';
// the status line's agent part: each agent in full, "⏳ implementer:
// Auto-reload on plugin update, editing 2m ~60%", then less of each (see
// shrinks) down to the names alone, "⏳ reader, ⏳ researcher"; then, with
// more than one, the count as a sentence, "⏳ 2 Agents are running", and
// last the bare count, "⏳ 2 Agents". "Agent" stands for a named single
// agent only where a lone side session's title does not fit even alone.
export const agentPart = (agents, now, room) => {
  const n = agents.length;
  if (!n) return '';
  return firstFit([
    ...shrinks(agents).map(parts => agents.map(a => '⏳ ' + detail(a, now, parts)).join(', ')),
    ...(n > 1 ? ['⏳ ' + runningText(agents), '⏳ ' + countText(agents)] : agents[0].kind === 'session' ? ['⏳ 1 Agent is running', '⏳ 1 Agent'] : []),
    '⏳' + n,
  ], room);
};
// who else runs, for a toast: by name for one or two, a count for more
const others = (list, word) => (list.length === 0 ? 'nothing else is running'
  : list.length <= 2 ? list.map(nameOf).join(' and ') + (list.length === 1 ? ' is ' : ' are ') + word + ' running'
  : runningText(list, word));
// the assignment in a toast, quoted, whole and then cut shorter and shorter
const quoted = (task, n) => (task ? ' "' + cut(task, n) + '"' : '');
const cuts = task => { const out = []; for (let n = chars(task) - 1; n >= TASK_MIN; n--) out.push(n); return out; };
// "Pacing: implementer is running "Auto-reload on plugin update" on Fable 5.2
// high; reader is also running." What gives way past MSG_MAX, in order: who
// else runs, the assignment's end, the assignment, the model.
export const startedText = (a, list) => {
  const rest = list.filter(x => x !== a && x.id !== a.id);
  const head = 'Pacing: ' + nameOf(a) + ' is running', task = taskOf(a), on = runOn(a) ? ' on ' + runOn(a) : '';
  return firstFit([
    head + quoted(task, TASK_MAX) + on + (rest.length ? '; ' + others(rest, 'also') : '') + '.',
    head + quoted(task, TASK_MAX) + on + '.',
    ...cuts(task).map(n => head + quoted(task, n) + on + '.'),
    head + on + '.',
    head + '.',
  ], MSG_MAX);
};
// "Pacing: implementer is done with "Auto-reload on plugin update" after 3m,
// 41k tokens; nothing else is running." What gives way: the tokens, who else
// runs, the assignment's end, the assignment.
export const doneText = (a, ms, tokens, list) => {
  const head = 'Pacing: ' + nameOf(a) + ' is done', task = taskOf(a), after = ' after ' + dur(ms);
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
// The toast: "Pacing: still running: implementer "Auto-reload on plugin
// update", editing 12m ~60%.", several joined by "; " while an assignment
// shows and by ", " once none does.
export const progressText = (agents, now) => {
  const longest = dur(now - Math.min(...agents.map(a => a.startedAt)));
  const each = parts => { const items = agents.map(a => detail(a, now, parts)); return items.join(items.some(i => i.includes('"')) ? '; ' : ', '); };
  return firstFit([
    ...shrinks(agents, { quote: 1 }).map(parts => 'Pacing: still running: ' + each(parts) + '.'),
    'Pacing: ' + runningText(agents, 'still') + ', the longest for ' + longest + '.',
    'Pacing: ' + runningText(agents, 'still') + '.',
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
    return new Set(list.filter(a => a.status === 'pending' || a.status === 'running').map(a => a.id));
  } catch { return null; }
}
// drop the agents the engine no longer runs; without its list, those of the
// background that have run implausibly long
async function settleAgents($, agents, now) {
  const live = await liveAgents($);
  for (const [id, a] of agents) {
    if (a.kind === 'session' || a.provisional) continue;
    if (live ? !live.has(id) : now - a.startedAt > STALE_AGENT) agents.delete(id);
  }
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
    'Pacing: side session ' + shortTitle(row) + ' is running' + also + '.',
    'Pacing: a side session is running' + also + '.',
  ], MSG_MAX);
};
export const sessionDoneText = (a, ms, list) => firstFit([
  'Pacing: side session ' + (a.label || 'side session') + ' ended its turn after ' + dur(ms) + '; ' + others(list, 'still') + '.',
  'Pacing: a side session ended its turn after ' + dur(ms) + '.',
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
  const notify = !st.quiet && (await noticesOn($));
  let changed = false;
  for (const [id, a] of st.agents) {
    if (a.kind === 'session' && !ids.has(id)) {
      st.agents.delete(id);
      changed = true;
      if (notify) $.ui.toast(sessionDoneText(a, t - a.startedAt, st.list()));
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
// The compact line: the budget share, then the usage meters, with no tiers
// (the tier split is /pacing-status's, in the long form):
//   Budget 77% · usage: Weekly 36%, Fable 40%
// A side session leads with a plain "sub" and shows no per-model meter.
// While subagents run (`agents`, see "subagents at work"), the line leads
// with them and the whole line stays within LINE_MAX: "sub" if it costs the
// agents nothing, the agents (shrunk in steps, never without their count),
// the budget share (always), then the usage only as far as it fits whole,
// the per-model figure going before the weekly one.
// `mix` is no longer drawn here; it stays in the signature for fullText's sake.
export const statusText = (j, mix, self = null, now = Date.now(), agents = []) => {
  const side = sideOf(j, self);
  const name = j.premiumLabel && !side ? j.premiumLabel.split(' ')[0] : null;
  // the weekly meter's share of today's budget line, without a word on it:
  // over 100 % is over. The toast on a change of level says the rest.
  const level = 'Budget ' + (j.ofBudget != null ? j.ofBudget + '%' : '-');
  const sub = side ? 'sub' : null;
  const weekly = 'usage: Weekly ' + Math.round(j.all) + '%';
  let usage = weekly;
  // the per-model figure as last read, plainly: its age and the estimate are
  // /pacing-status's, and a stale one still brings the note asking for a
  // full reading
  if (j.premium != null && name) usage += ' ' + name + ' ' + Math.round(j.premium) + '%';
  if (agents.length) {
    // the agents' fixed share: what the budget share leaves. "sub" goes
    // first only where it costs the agents no step of their detail.
    const room = LINE_MAX - chars(level) - 3;
    const lead = agentPart(agents, now, room);
    const withSub = sub && agentPart(agents, now, room - chars(sub) - 3) === lead;
    const line = [withSub ? sub : null, lead, level].filter(Boolean).join(' · ');
    for (const more of [usage, weekly]) if (chars(line + ' · ' + more) <= LINE_MAX) return line + ' · ' + more;
    return line;
  }
  return [sub, level, usage].filter(Boolean).join(' · ');
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
    + (agents.length ? '\nRunning: ' + agents.map(a => (a.kind === 'session' ? 'side session ' : '') + detail(a, now, { task: TASK_MAX, time: 1, est: 1, step: 1 }) + (runOn(a) ? ' (' + runOn(a) + ')' : '') + (a.kind === 'session' && a.description ? ', ' + a.description : '')).join('; ')
      + (agents.some(a => estText(a, now)) ? '\n~ is a rough estimate from how long that kind of agent usually takes, not a measure of the work done.' : '') : '');
  return statusText(j, tierMix(tokens, tierOf, prices, agentTokens, j.agentTierOf), self, now, agents);
};

// ---- a new version: the session reloads its plugins by itself ----
// The desktop app syncs installed plugins about every 20 minutes and
// replaces this plugin's files in place; an open session ran the old code
// until someone typed /reload-plugins. So the module does it:
//   it knows the version it was loaded as (plugin.json, read at load) and
//   reads the file again RELOAD_AFTER_TURN after a turn ends and every
//   RELOAD_CHECK_EVERY: one $.fs.read, no process, no model call;
//   another version there, in a session a person has typed in, with no turn
//   running, no survey up and no subagent of its own at work: /reload-plugins
//   as if typed ($.command.run, from a timer: the engine refuses it inside
//   a hook the turn waits on), once per version;
//   the copy the reload brings says so at its load, "Pacing: updated to
//   0.9.11 and reloaded." (a mark the copy that asked left in $.store under
//   the session's id tells it; the mark goes once it is said);
//   a run the engine rejects: "Pacing 0.9.11 is installed: type
//   /reload-plugins to load it.", once per version.
// A reload starts changed modules only: a version that left this file as it
// was keeps this copy running. So RELOAD_SETTLE after the command ran, the
// copy that asked looks once more. Its own file on disk as it was loaded:
// it is the new version's code, and says "updated". Its file changed and it
// still runs: the reload did not take, and the person is asked to type it.
// Never a second attempt for a version: a fresh copy takes the version on
// disk as its own, and a copy that stays remembers what it asked for.
// A manifest that does not read or names no version (half-written during a
// sync) is no change, and is read again at the next look. A side session
// nobody types in is left alone: it loads the new version at its next start.
// `/pacing reload off` turns it off.
export const RELOAD_CHECK_EVERY = 5 * 60 * 1000;
export const RELOAD_AFTER_TURN = 2 * 1000;
export const RELOAD_SETTLE = 10 * 1000;
// a command that neither ran nor was refused in this long is given up
export const RELOAD_GIVE_UP = 10 * 60 * 1000;
// the version a manifest's text names, or null
export const versionOf = text => { try { const v = JSON.parse(text).version; return typeof v === 'string' && v ? v : null; } catch { return null; } };
export const reloadedText = version => 'Pacing: updated to ' + version + ' and reloaded.';
export const reloadAskText = version => 'Pacing ' + version + ' is installed: type /reload-plugins to load it.';
// whether the reload at a new version is on (config.json's autoReload; on unless false)
async function reloadOn($) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
    if (!home) return true;
    return JSON.parse(await $.fs.read(home + '/.claude/pacing/config.json')).autoReload !== false;
  } catch { return true; }
}
// the version plugin.json names now, and this module's own text; null when unreadable
async function versionOnDisk($) { try { return versionOf(await $.fs.read($.plugin.root + '/.claude-plugin/plugin.json')); } catch { return null; } }
async function codeOnDisk($) { try { return await $.fs.read($.plugin.root + '/hooks/readings.mjs'); } catch { return null; } }
// where this session's mark is kept in the store, or null where the engine gives no id
async function reloadKey($) { try { const id = await $.session.id(); return id ? 'reload:' + id : null; } catch { return null; } }
function say($, text) { try { $.ui.toast(text, { timeoutMs: 15000 }); } catch { /* an engine without toasts */ } }
async function unmark($, key) { if (key) { try { await $.store.delete(key); } catch { /* no store */ } } }
// /reload-plugins as if typed. Started, never awaited: it is queued until
// the session is idle, and may never answer the copy it unloads.
async function runReload($, rl, key, version) {
  try { await $.command.run({ command: 'reload-plugins' }); } catch {
    // rejected, or an engine without the call: the person types it
    if (rl.asked && rl.asked.version === version) { rl.asked = null; await unmark($, key); say($, reloadAskText(version)); }
    return;
  }
  // it ran and this copy still runs: one more look says which it is
  if (rl.asked && rl.asked.version === version) {
    rl.asked.ran = true;
    try { $.clock.after(RELOAD_SETTLE, () => { look($, rl); }); } catch { /* the slow timer looks */ }
  }
}
// one look at the version on disk; `rl` is the copy's memory (see register).
// Never throws: a look is a convenience, and the next one tries again.
async function look($, rl) {
  if (rl.looking) return;
  rl.looking = true;
  try {
    const disk = await versionOnDisk($);
    if (!disk) return;
    const key = await reloadKey($);
    let mark;
    if (key) { try { mark = await $.store.get(key); } catch { /* no store */ } }
    if (rl.loaded === null) {
      // this copy's first look: what it was loaded as. A mark here is the
      // reload this session asked for, which brought this copy.
      rl.loaded = disk;
      rl.code = await codeOnDisk($);
      if (mark) { await unmark($, key); say($, reloadedText(disk)); }
      return;
    }
    if (rl.asked) {
      // this copy asked for a reload and still runs
      if (!rl.asked.ran && (rl.busy || (await $.clock.now()) - rl.asked.at < RELOAD_GIVE_UP)) return;
      const { version, ran } = rl.asked;
      rl.asked = null;
      // the mark gone: a fresh copy has taken over and said so
      if (key && !mark) return;
      await unmark($, key);
      if (ran && rl.code !== null && (await codeOnDisk($)) === rl.code) { rl.loaded = version; say($, reloadedText(version)); }
      else say($, reloadAskText(version));
      return;
    }
    if (disk === rl.loaded || disk === rl.acted) return;
    if (!rl.free() || !(await reloadOn($))) return;
    rl.acted = disk;
    rl.asked = { version: disk, at: await $.clock.now(), ran: false };
    if (key) { try { await $.store.set(key, { version: disk, at: rl.asked.at }); } catch { /* no store: this copy's own memory */ } }
    runReload($, rl, key, disk).catch(() => { /* said already, or the next look */ });
  } catch { /* the next look */ } finally { rl.looking = false; }
}

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
  // the session's own subagents and side sessions now running, by id; the
  // effort each Agent call asked for, by its tool call. `st` holds what the
  // refresh (top-level tick) reads and writes: the timer, when the agents were
  // last settled and the side sessions polled, how long side sessions are
  // watched for after one was started or messaged, the last progress toast.
  const agents = new Map();
  const efforts = new Map();
  const runningAgents = () => [...agents.values()].sort((x, y) => x.startedAt - y.startedAt);
  // the status line as it stands, with the agents when any run
  const lineNow = now => {
    const list = runningAgents();
    if (reading) return lineOf(reading, sessionModel, tokens, agentTokens, now, false, list);
    return list.length ? agentPart(list, now, LINE_MAX) : undefined;
  };
  const st = { agents, timer: null, settledAt: 0, polledAt: 0, watchUntil: 0, progressAt: 0, host: null, children: 0, quiet: false, watchSince: 0,
    list: runningAgents, lineNow, reading: () => reading };
  const stopTick = () => stopTickOf(st);

  // the reload at a new version (see "a new version"): what the looks read
  // and write. The version and the text this copy was loaded as, the version
  // it asked a reload for and that request while it is open ({ version, at,
  // ran }), whether a main-thread turn runs, whether the band was last drawn
  // under a survey, the timers, and whether a reload may run now.
  const rl = { loaded: null, code: null, acted: null, asked: null, busy: false, survey: false, looking: false, timer: null, afterTurn: null,
    free: () => attended && !rl.busy && !rl.survey && !runningAgents().some(a => a.kind !== 'session') };

  // a main-thread turn runs from here to its turn.complete: no reload meanwhile
  on('turn.start', ($, e, next) => {
    if (!e.agentId) rl.busy = true;
    return next(e);
  });

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
      }
    } catch { /* the spawn shows it */ }
    try { return await next(e); } finally {
      if (agents.has(key)) {
        agents.delete(key);
        try { $.ui.status(lineNow(await $.clock.now())); } catch { /* the next refresh */ }
      }
    }
  });

  // what a running agent is doing: its latest tool call. A side session
  // started or messaged from the main thread: watch the side sessions for a
  // minute, from the next refresh on.
  on('tool.call', async ($, e, next) => {
    try { if (e.agentId && agents.has(e.agentId)) agents.get(e.agentId).step = stepOf(e.tool); } catch { /* no step known */ }
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
          effort: efforts.get(e.tool_use_id), background: !!e.background, startedAt: early ? early.startedAt : now, runs: [], step: null };
        efforts.delete(e.tool_use_id);
        if (!agents.size) st.progressAt = now;
        agents.set(a.id, a);
        startTick($, st);
        // in the line at once; its history for the estimate after
        $.ui.status(lineNow(now));
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
  // model, or one step less effort). The background agents' row goes under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = e.props || {};
    // for the reload at a new version: never under a survey
    if (!(p.view && p.view.agentId) && (!e.plugin || e.plugin === 'pacing')) rl.survey = !!p.hasSurvey;
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
    const result = await next(e);
    // A fresh line at load (a new session, a reload, a new version): the
    // status line kept what the module drew before, which may be old facts
    // and old code's words for up to half an hour. With the meters the last
    // response reported, a full reading now; with none yet, a dry run on the
    // last stored figures, and the first measure takes the full reading at
    // once (`last` is empty after a load). Started, not awaited: the
    // session's start never waits on it. Silent on any failure.
    (async () => {
      let now;
      try { now = await $.clock.now(); } catch { now = Date.now(); }
      let limits = [];
      try { limits = (await $.session.usage()).rateLimits || []; } catch { /* none yet */ }
      const week = limits.find(r => r.kind === 'seven_day');
      const five = limits.find(r => r.kind === 'five_hour');
      let argv = null;
      if (week && week.resetsAt) {
        argv = readingArgv($.plugin.root, week.percentUsed, week.resetsAt, five && five.percentUsed, five && five.resetsAt, false);
      } else {
        const st = await storedReading($);
        if (st && typeof st.all === 'number' && st.reset) argv = readingArgv($.plugin.root, st.all, st.reset, st.five, st.fiveReset, true);
      }
      if (!argv || running) return;
      running = true;
      try {
        const r = await $.process.run(argv, { timeoutMs: 20000 });
        const j = r.exitCode === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
        if (j) {
          reading = { ...j, fromLoad: true };
          // a full reading counts as the last one; a dry one leaves the next due
          if (week && week.resetsAt) last = { pct: week.percentUsed, at: now };
          $.ui.status(lineNow(now));
        }
      } finally { running = false; }
    })().catch(() => { /* a failure draws nothing new */ });
    // the side sessions already working (a reload mid-work): in the line, no toast
    (async () => { st.quiet = true; await pollSessions($, st, await $.clock.now()); })().catch(() => { /* none known */ });
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
    if (!reading) return { text: 'Pacing: no automatic reading yet in this session. /pacing usage reads now.' };
    // ages and run times as of now, by the engine's clock where it has one
    let now;
    try { now = await $.clock.now(); } catch { now = Date.now(); }
    const text = lineOf(reading, sessionModel, tokens, agentTokens, now, true, runningAgents());
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
      // a natural break: one look at the version on disk, once the turn is
      // over (a timer: /reload-plugins cannot run from inside this hook)
      rl.busy = false;
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
        if (await noticesOn($)) $.ui.toast(doneText(a, now - a.startedAt, spent, runningAgents()));
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
        const argv = readingArgv($.plugin.root, week.percentUsed, week.resetsAt, five && five.percentUsed, five && five.resetsAt, false);
        const r = await $.process.run(argv, { timeoutMs: 20000 });
        const j = r.exitCode === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
        if (j) {
          // a reading the module took at load is no level the user was told of
          if (reading && !reading.fromLoad && j.level !== reading.level) {
            $.ui.toast('Pacing: ' + levelPhrase(reading.level) + ' -> ' + levelPhrase(j.level) + (j.levelBy === 'premium' && j.premiumLabel ? ' (' + j.premiumLabel.split(' ')[0] + ' meter)' : '') + '. ' + (j.do || ''));
          } else if (reading && !reading.fromLoad && !!j.premiumHeld !== !!reading.premiumHeld) {
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
