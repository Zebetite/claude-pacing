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

const MIN_GAP = 30 * 60 * 1000;

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

// the session's spend by tier, from the tokens seen per model id
export const tierMix = (tokens, tierOf, prices) => {
  const byTier = new Map();
  for (const [model, t] of Object.entries(tokens)) {
    const id = Object.keys(prices).find(p => model.startsWith(p));
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

export const statusText = (j, mix) => {
  const meters = [Math.round(j.all) + '% Weekly'];
  if (j.premium != null && j.premiumLabel) meters.push(Math.round(j.premium) + '% ' + j.premiumLabel.split(' ')[0]);
  const parts = [];
  if (j.ofBudget != null) parts.push(j.ofBudget + '% of budget');
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

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
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
          if (reading && j.level !== reading.level) $.ui.toast('Pacing: ' + reading.level + ' -> ' + j.level + '. ' + (j.do || ''));
          reading = j;
        }
      }
      // the tier shares move every turn: the line is redrawn even when no
      // new reading was due
      if (reading) $.ui.status(statusText(reading, tierMix(tokens, reading.tierOf || {}, reading.prices || {})));
    } catch {
      // a reading is a convenience: a missing node, a timeout or a bad line
      // must never disturb the session
    } finally {
      running = false;
    }
    return result;
  });
};
