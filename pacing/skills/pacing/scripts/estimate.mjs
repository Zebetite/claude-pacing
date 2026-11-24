// What this week's local sessions cost, from their transcripts: the first
// figure for "Budget tokens" before budget.mjs has learned its rate from the
// meter (rate.json). Every Claude Code session on this computer, the desktop
// app's included, writes ~/.claude/projects/<project>/<session>.jsonl, and its
// subagents write <session>/subagents/*.jsonl; each assistant line carries the
// model and its usage. A response is written once per content block with the
// same usage, and a resumed or forked session copies earlier lines into a new
// file: each message id counts once. Priced as the hooks module prices a
// session (readings.mjs spentUsd): input, output, cache read and cache write
// at the model's own prices, so the estimate and the learned rate stand on
// one footing. Use on another device or on the web is not in these files: the
// estimate errs low, and so shows less left than there is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { MODELS } from './models.mjs';

export const projectsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

// a model id ("claude-opus-5-5", an older "claude-fable-5-1") priced as its family
const priceOf = id => {
  if (typeof id !== 'string') return null;
  for (const m of Object.values(MODELS)) if (id === m.id) return m.price;
  for (const [k, m] of Object.entries(MODELS)) if (id.includes(k)) return m.price;
  return null;
};

const n = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const files = (dir, since, out = []) => {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) files(p, since, out);
    else if (d.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch { /* gone */ }
    }
  }
  return out;
};

// each line of a file, read in pieces: a long session's transcript can be
// larger than one string may hold
const eachLine = (file, fn) => {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return; }
  const buf = Buffer.alloc(1 << 22), dec = new StringDecoder('utf8');
  let rest = '';
  try {
    for (;;) {
      const got = fs.readSync(fd, buf, 0, buf.length, null);
      if (!got) break;
      const parts = (rest + dec.write(buf.subarray(0, got))).split('\n');
      rest = parts.pop();
      for (const l of parts) fn(l);
    }
    rest += dec.end();
    if (rest) fn(rest);
  } catch { /* what was read counts */ } finally { fs.closeSync(fd); }
};

// { usd, messages, files, after } spent from `since` to `until` (ms). `marks`
// (ms, each at or after `since`): for each, in `after`, the dollars spent
// from it on and when the first of them was ({ usd, first }, first null
// where none): one pass serves several windows.
export const weekSpend = ({ since, until = Date.now(), dir = projectsDir(), marks = [] } = {}) => {
  const seen = new Set();
  let usd = 0, messages = 0;
  const after = marks.map(() => ({ usd: 0, first: null }));
  const list = files(dir, since);
  for (const f of list) {
    eachLine(f, l => {
      if (!l.includes('"assistant"') || !l.includes('"usage"')) return;
      let j;
      try { j = JSON.parse(l); } catch { return; }
      const m = j && j.type === 'assistant' && j.message;
      if (!m || !m.usage) return;
      const t = Date.parse(j.timestamp);
      if (!(t >= since && t <= until)) return;
      const key = m.id || j.requestId || j.uuid;
      if (key) { if (seen.has(key)) return; seen.add(key); }
      const p = priceOf(m.model);
      if (!p) return;
      const u = m.usage;
      const cost = (n(u.input_tokens) * p[0] + n(u.output_tokens) * p[1] + n(u.cache_read_input_tokens) * p[2] + n(u.cache_creation_input_tokens) * p[3]) / 1e6;
      usd += cost;
      messages++;
      marks.forEach((at, i) => {
        if (t < at) return;
        after[i].usd += cost;
        if (after[i].first === null || t < after[i].first) after[i].first = t;
      });
    });
  }
  return { usd, messages, files: list.length, after };
};
