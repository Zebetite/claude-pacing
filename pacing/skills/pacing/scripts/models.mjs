// The models a ladder tier can hold: the Agent tool's short name as the key,
// the label the user sees, and the full id the desktop app's preset and model
// picker use. The one place to edit when a model comes or goes.
// price: US dollars per million tokens, as the API lists them (input, output,
// cache read, cache write at 1.25 x input). The weekly meter is not priced in
// dollars, but it weighs models the same way, so these turn token counts into
// an estimate of each tier's share of what was used.
export const MODELS = {
  fable: { label: 'Fable 5.2', id: 'claude-fable-5-2', price: [8, 40, 0.2, 10] },
  opus: { label: 'Opus 5.5', id: 'claude-opus-5-5', price: [4, 20, 0.2, 5] },
  sonnet: { label: 'Sonnet 5.5', id: 'claude-sonnet-5-5', price: [2, 10, 0.1, 2.5] },
  haiku: { label: 'Haiku 5.5', id: 'claude-haiku-5-5', price: [0.1, 0.5, 0.01, 0.125] },
};
// A tier as stored (config.json, state.json) carries the label of the day it
// was written; a known model is always shown under its current label.
export const relabel = t => (t && MODELS[t.model] ? { ...t, label: MODELS[t.model].label } : t);
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// A config.json as read from disk, checked value by value: what the commands
// never write (a hand edit, a cut-off save) is dropped for its default, and
// named in `problems`, so a damaged file gives a report with a note and not
// a crash or a budget line of NaN. Returns the settings that stand.
export const checkConfig = raw => {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { cfg: {}, problems: ['it does not hold settings: the defaults are used'] };
  const c = { ...raw };
  const tierOk = t => t && typeof t === 'object' && !!MODELS[t.model] && EFFORTS.includes(t.effort);
  const helperOk = v => v === 'ladder' || tierOk(v);
  // an older config held a primary/fallback pair
  if (!c.tiers && tierOk(c.primary) && tierOk(c.fallback)) { c.tiers = [c.primary, c.fallback]; delete c.primary; delete c.fallback; }
  if (c.tiers !== undefined) {
    const kept = Array.isArray(c.tiers) ? c.tiers.filter(tierOk) : [];
    const dropped = (Array.isArray(c.tiers) ? c.tiers.length : 1) - kept.length;
    if (dropped) problems.push(dropped + ' tier' + (dropped > 1 ? 's' : '') + ' without a known model and effort: dropped');
    if (kept.length < 2) { delete c.tiers; problems.push('fewer than two tiers: the default ladder is used'); } else c.tiers = kept.slice(0, 6).map(relabel);
  }
  const drop = (key, ok, what) => { if (c[key] !== undefined && !ok(c[key])) { delete c[key]; problems.push(what + ': the default is used'); } };
  drop('lastDayWeight', v => typeof v === 'number' && v >= 1 && v <= 3, 'the last-day weight is not a number from 1 to 3');
  drop('premium', v => v === null || (typeof v === 'string' && !!MODELS[v]), 'the per-model meter names no known model');
  drop('fallback', v => v === null || tierOk(v), 'the fallback is not a known model and effort');
  drop('reader', helperOk, 'the reader\'s model is not a known model and effort');
  drop('verifier', helperOk, 'the verifier\'s model is not a known model and effort');
  drop('setNextModel', v => typeof v === 'boolean', 'the next-session switch is not on or off');
  drop('compactAsk', v => typeof v === 'boolean', 'the offers to compact are not on or off');
  drop('agentNotices', v => typeof v === 'boolean', 'the notices about running subagents are not on or off');
  drop('switchAsk', v => typeof v === 'boolean', 'the offers to switch model or effort are not on or off');
  drop('autoReload', v => typeof v === 'boolean', 'the reload at a new version is not on or off');
  return { cfg: c, problems };
};
