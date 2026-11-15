// Safe writes for the files the scripts read, change and write back. Several
// sessions and agents run these scripts at once, and a plain read-change-write
// loses the update of whoever wrote in between. Files that only grow by one
// line per call (log.jsonl, the agents log) need none of this: an append is
// one write.
//   atomicWrite(file, text)    a temporary file in the same folder, renamed
//                              over the target: a reader never sees half a
//                              file, and a crash leaves the old one
//   updateFile(file, change)   read, change, and write back only if the file
//                              is still what was read; else again from the
//                              fresh content, a few times, then a clear error
// The last check and the rename happen under a short lock file, since two
// writers could otherwise both pass the check together. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// a pause that blocks this process only: the scripts are synchronous
const sleep = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms)); };
const hash = text => (text === null ? 'none' : createHash('sha256').update(text).digest('hex'));
const readOrNull = file => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
// what Windows answers while another process has the file open, or a virus
// scanner is looking at it: worth a short wait, not an error
const BUSY = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'];

export const atomicWrite = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (!BUSY.includes(e.code) || i >= 40) { try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ } throw e; }
      sleep(15 + Math.random() * 30);
    }
  }
};

// A lock file beside the target, created with the exclusive flag: only one
// process gets it. Held for a check and a rename, a few milliseconds. One
// older than `staleMs` was left by a process that died: it is taken over.
// `waitMs` is how long to wait for a living holder before giving up.
export const withLock = (file, fn, { waitMs = 5000, staleMs = 10000 } = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && !BUSY.includes(e.code)) throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; /* gone meanwhile: try again at once */ }
      if (age > staleMs) { try { fs.unlinkSync(lock); } catch { /* another process took it over */ } continue; }
      if (Date.now() > until) throw new Error('could not write ' + path.basename(file) + ': another process holds its lock (' + lock + '); try again');
      sleep(10 + Math.random() * 25);
    }
  }
  held.add(lock);
  try { return fn(); } finally { held.delete(lock); try { fs.unlinkSync(lock); } catch { /* taken over as stale: its new holder removes it */ } }
};
// a command that ends inside a change (a refusal, process.exit) must not
// leave its lock for the others to wait out
const held = new Set();
process.on('exit', () => { for (const lock of held) { try { fs.unlinkSync(lock); } catch { /* gone */ } } });

// change(text) gets the file's text (null when there is none) and returns the
// new text, or null to leave the file as it is. It may run more than once,
// each time on fresh content, so it must not keep anything from a run before.
// Returns the text that stands.
//
// The first try is optimistic: the change is worked out with no lock held,
// and written only if the file is still what was read. A writer that lost
// that race makes its next tries with the lock held from the read to the
// write, so the scripts' own writers queue up and none is starved; the
// compare stays, for a writer that knows nothing of the lock (the app, an
// editor).
export const updateFile = (file, change, { tries = 8, waitMs, staleMs } = {}) => {
  const attempt = locked => {
    const before = readOrNull(file);
    const seen = hash(before);
    const next = change(before);
    if (next === null || next === undefined || next === before) return { done: true, text: before };
    // for the tests: widen the gap between the read and the write, so that
    // writers really overlap
    if (!locked && process.env.PACING_TEST_WRITE_GAP_MS) sleep(Number(process.env.PACING_TEST_WRITE_GAP_MS));
    const swap = () => {
      // someone wrote since the read: the change is made again on what is there now
      if (hash(readOrNull(file)) !== seen) return { done: false };
      atomicWrite(file, next);
      return { done: true, text: next };
    };
    return locked ? swap() : withLock(file, swap, { waitMs, staleMs });
  };
  for (let i = 0; i < tries; i++) {
    const r = i === 0 ? attempt(false) : withLock(file, () => attempt(true), { waitMs, staleMs });
    if (r.done) return r.text;
  }
  throw new Error('could not write ' + path.basename(file) + ': it kept changing under the write (' + tries + ' tries); try again');
};

// a JSON file, changed as a value: change(value) gets the parsed content (null
// when there is none or it does not parse) and returns the new value, or null
// to leave it
export const updateJson = (file, change, { indent = 2, ...opts } = {}) => {
  let out = null;
  updateFile(file, text => {
    let value = null;
    if (text !== null) { try { value = JSON.parse(text); } catch { value = null; } }
    out = change(value);
    return out === null || out === undefined ? null : JSON.stringify(out, null, indent) + '\n';
  }, opts);
  return out;
};
