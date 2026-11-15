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
