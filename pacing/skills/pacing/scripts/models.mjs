// The models a ladder tier can hold: the Agent tool's short name as the key,
// the label the user sees, and the full id the desktop app's preset and model
// picker use. The one place to edit when a model comes or goes.
export const MODELS = {
  fable: { label: 'Fable 5.1', id: 'claude-fable-5-1' },
  opus: { label: 'Opus 5.5', id: 'claude-opus-5-5' },
  sonnet: { label: 'Sonnet 5.5', id: 'claude-sonnet-5-5' },
  haiku: { label: 'Haiku 5.5', id: 'claude-haiku-5-5' },
};
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
