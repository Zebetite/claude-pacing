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
import { MODELS } from './models.mjs';
import { updateJson } from './safe.mjs';

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

// each line of a file from the byte `from` on, with the byte it starts at,
// read in pieces: a long session's transcript can be larger than one string
// may hold. `from` must be the start of a line in a file at least that long
// (the byte before it ends a line); else the file is read from its start.
// Returns { from, end }: where the read began, and where the last whole line
// ended (a line still being written is handed over, and starts at `end`);
// null for a file that cannot be opened.
const eachLine = (file, from, buf, fn) => {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  let start = from;
  try {
    if (from > 0 && !(fs.fstatSync(fd).size >= from && fs.readSync(fd, buf, 0, 1, from - 1) === 1 && buf[0] === 10)) from = start = 0;
    let rest = null;
    for (let pos = from; ;) {
      const got = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!got) break;
      const chunk = buf.subarray(0, got);
      let a = 0;
      for (let nl; (nl = chunk.indexOf(10, a)) >= 0; a = nl + 1) {
        const l = rest ? Buffer.concat([rest, chunk.subarray(a, nl)]).toString('utf8') : chunk.toString('utf8', a, nl);
        rest = null;
        fn(l, start);
        start = pos + nl + 1;
      }
      // the buffer is used again by the next read: what is kept is a copy
      if (a < got) rest = rest ? Buffer.concat([rest, chunk.subarray(a)]) : Buffer.from(chunk.subarray(a));
      pos += got;
    }
    if (rest) fn(rest.toString('utf8'), start);
  } catch { /* what was read counts */ } finally { fs.closeSync(fd); }
  return { from, end: start };
};

// ---- where a scan may start ----
// A transcript only grows, a line per event in the order they happened, and
// a reading asks for the last hour or so. Read whole each time, the current
// session's transcript (hundreds of MB in a long session) cost seconds on
// every reading. So a scan that is handed a `cache` file keeps there, per
// transcript, a checkpoint { at, offset }: the byte at which the first line
// that could count and is dated at or after `at` starts, so every such line
// before it is older than `at`. A scan from a `since` at or after `at`
// starts there and misses nothing, in whatever order the lines were written,
// and moves the checkpoint on to its own `since`. A scan from an earlier
// `since` reads from the start and leaves the checkpoint where it is (one
// dated after the scan's `until`, by a clock that ran ahead, is replaced).
// The file holds the transcripts of the last scan only. A failed write is
// harmless: the next scan reads more.
const CACHE_V = 1;
const pointOk = p => !!p && typeof p === 'object' && Number.isFinite(p.at) && Number.isInteger(p.offset) && p.offset >= 0;
const pointsIn = v => (v && typeof v === 'object' && v.v === CACHE_V && v.files && typeof v.files === 'object' && !Array.isArray(v.files) ? v.files : {});

// { usd, messages, files, after } spent from `since` to `until` (ms). `marks`
// (ms, each at or after `since`): for each, in `after`, the dollars spent
// from it on and when the first of them was ({ usd, first }, first null
// where none): one pass serves several windows. `cache`: the file of the
// checkpoints (above); without it every file is read from its start.
export const weekSpend = ({ since, until = Date.now(), dir = projectsDir(), marks = [], cache = null } = {}) => {
  const seen = new Set();
  let usd = 0, messages = 0;
  const after = marks.map(() => ({ usd: 0, first: null }));
  const list = files(dir, since);
  if (!Number.isFinite(since)) cache = null;
  let known = {};
  if (cache) { try { known = pointsIn(JSON.parse(fs.readFileSync(cache, 'utf8'))); } catch { /* none yet, or damaged: every file from its start */ } }
  const points = {};
  const buf = Buffer.alloc(1 << 22);
  for (const f of list) {
    const kept = pointOk(known[f]) ? known[f] : null;
    const cp = kept && since >= kept.at ? kept : null;
    // where the first line dated at or after `since` starts
    let first = null;
    const read = eachLine(f, cp ? cp.offset : 0, buf, (l, at) => {
      if (!l.includes('"assistant"') || !l.includes('"usage"')) return;
      let j;
      try { j = JSON.parse(l); } catch { return; }
      const m = j && j.type === 'assistant' && j.message;
      if (!m || !m.usage) return;
      const t = Date.parse(j.timestamp);
      if (first === null && t >= since) first = at;
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
    if (!cache || !read) continue;
    // none at or after `since` yet: the next line written is the first
    const offset = first !== null ? first : read.end;
    points[f] = cp && read.from === cp.offset && offset === cp.offset ? cp
      : kept && !cp && kept.at <= until ? kept
        : { at: since, offset };
  }
  if (cache && (list.length || Object.keys(known).length)) {
    try {
      // on the file as it is at that moment (safe.mjs): a checkpoint another
      // session moved further meanwhile stays
      updateJson(cache, cur => {
        const theirs = pointsIn(cur), out = {};
        for (const [f, p] of Object.entries(points)) out[f] = pointOk(theirs[f]) && theirs[f].at > p.at && theirs[f].at <= until ? theirs[f] : p;
        return { v: CACHE_V, files: out };
      }, { indent: 0, tries: 3, waitMs: 400 });
    } catch { /* the next scan reads more */ }
  }
  return { usd, messages, files: list.length, after };
};
