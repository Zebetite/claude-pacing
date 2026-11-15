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
// pause. It shows as the prompt is submitted, before the request goes out, but
// it never holds or changes the prompt: that turn still pays, and the advice
// is for the breaks after it.

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
    + ', so its cache has lapsed and this turn stores it all again. After a break, /compact or a handover first is cheaper.'
  : null);

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

// the session's spend by tier, from the tokens seen per model id
export const tierMix = (tokens, tierOf, prices) => {
  const byTier = new Map();
  for (const [model, t] of Object.entries(tokens)) {
    const id = idOf(model, prices);
    if (!id) continue;
    const [pin, pout, pread, pwrite] = prices[id];
    const usd = (t.in * pin + t.out * pout + t.read * pread + t.write * pwrite) / 1e6;
    const key = tierOf[id] ?? 'Other';
    byTier.set(key, (byTier.get(key) || 0) + usd);
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

// "09:40": the time a carried figure was read, on the engine's clock
const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// A session another session started (a side session in the desktop app)
// says so up front, with the tier of the model it runs on:
//   ⚪Tier 2 Sub Agent - 77% of budget, ⚪Tier 2[90%] 🟤Tier 4[10%], (36% Weekly, 40% Fable)
// `self` is that tier ('Other' off the ladder), or null for any other session.
export const statusText = (j, mix, self = null) => {
  const meters = [Math.round(j.all) + '% Weekly'];
  // the engine never hands a plugin the per-model meter: its figure is carried
  // over from the last full reading, and says from when
  if (j.premium != null && j.premiumLabel) meters.push(Math.round(j.premium) + '% ' + j.premiumLabel.split(' ')[0] + (j.premiumAt ? ' at ' + hhmm(j.premiumAt) : ''));
  const parts = [];
  // the budget share of the meter that decides: the per-model one when it set
  // the level or moved the session off its model
  const share = (j.levelBy === 'premium' || j.premiumHeld) && j.premiumOfBudget != null && j.premiumLabel
    ? j.premiumOfBudget + '% of ' + j.premiumLabel.split(' ')[0] + ' budget'
    : j.ofBudget != null ? j.ofBudget + '% of budget' : null;
  if (self !== null) parts.push(square(self) + (self === 'Other' ? 'Other' : 'Tier ' + self) + ' Sub Agent' + (share ? ' - ' + share : ''));
  else if (share) parts.push(share);
  if (mix.length) parts.push(mix.map(x => square(x.tier) + (x.tier === 'Other' ? 'Other' : 'Tier ' + x.tier) + '[' + x.share + '%]').join(' '));
  parts.push('(' + meters.join(', ') + ')');
  return parts.join(', ') + (j.level === 'stop' ? ', wrap up' : '');
};

/** @type {import('claude-code').Register} */
export const register = on => {
  // this module's memory, for this session; a reload starts it over, and
  // budget.mjs keeps the log thin across sessions and reloads by itself
  const tokens = {};
  let last = null;
  let reading = null;
  let running = false;
  // for the warning after a pause: when the main thread's last turn ended (a
  // subagent's turn keeps only its own cache warm), the session's size at the
  // last measure, and the pause already warned of
  let lastTurnAt = null;
  let contextTokens = null;
  let warnedFor = null;
  // a session another session started: the desktop app sets
  // CLAUDE_CODE_CHILD_SESSION=1 in its environment (read once; not part of
  // the documented hooks API, so anything else counts as a session of its
  // own). The model it runs on: its main thread's last turn.
  let child = null;
  let sessionModel = null;

  on('prompt.submit', async ($, e, next) => {
    try {
      // only a prompt that starts a turn after a pause, typed by the user; a
      // slash command (/compact, a handover) is the user acting on it already
      const typed = !e.turnId && !e.isMeta && !e.command && !String(e.text || '').trimStart().startsWith('/')
        && !unattended(e.origin);
      if (typed && lastTurnAt !== null && warnedFor !== lastTurnAt) {
        const note = pauseNote(contextTokens, (await $.clock.now()) - lastTurnAt);
        if (note) {
          warnedFor = lastTurnAt;
          $.ui.toast(note, { timeoutMs: 15000 });
        }
      }
    } catch {
      // a warning is a convenience: it never stands in the prompt's way
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
      const t = (tokens[u.model] ||= { in: 0, out: 0, read: 0, write: 0 });
      t.in += u.input_tokens || 0;
      t.out += u.output_tokens || 0;
      t.read += u.cache_read_input_tokens || 0;
      t.write += u.cache_creation_input_tokens || 0;
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
    const now = Date.now();
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
            $.ui.toast('Pacing: ' + reading.level + ' -> ' + j.level + (j.levelBy === 'premium' && j.premiumLabel ? ' (' + j.premiumLabel.split(' ')[0] + ' meter)' : '') + '. ' + (j.do || ''));
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
        if (child === null) {
          try { child = (await $.env.get('CLAUDE_CODE_CHILD_SESSION')) === '1'; } catch { child = false; }
        }
        const prices = reading.prices || {}, tierOf = reading.tierOf || {};
        const id = child && sessionModel ? idOf(sessionModel, prices) : null;
        const self = !child || !sessionModel ? null : (id && tierOf[id]) || 'Other';
        $.ui.status(statusText(reading, tierMix(tokens, tierOf, prices), self));
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
