// estimate.mjs: what the local transcripts cost in a window, and the
// checkpoints (scan.json) that let a reading go on in each transcript from
// where the one before found the window's first line. With or without them
// the sums are the same: every case here is scanned both ways.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, scripts, RESET } from './helpers.mjs';

const { weekSpend } = await import(pathToFileURL(path.join(scripts, 'estimate.mjs')).href);

const T = h => Date.parse('2026-11-13T00:00:00Z') + h * 3600000;
const iso = h => new Date(T(h)).toISOString();
// an assistant line: $4 per million input tokens on Opus 5.5
const line = (id, h, input, model = 'claude-opus-5-5') => JSON.stringify({ type: 'assistant', timestamp: iso(h), message: { id, model, usage: { input_tokens: input } } });
const user = h => JSON.stringify({ type: 'user', timestamp: iso(h), message: { content: 'the "assistant" said "usage" ' + 'x'.repeat(300) } });
// a home with two transcripts and a subagent's; `cache` is where the checkpoints go
const home = () => {
  const s = sandbox();
  const dir = path.join(s.home, '.claude', 'projects');
  const a = path.join(dir, 'X--proj', 'a.jsonl'), b = path.join(dir, 'X--proj', 'b.jsonl'), sub = path.join(dir, 'X--proj', 'a', 'subagents', 'agent-1.jsonl');
  fs.mkdirSync(path.dirname(sub), { recursive: true });
  return { s, dir, a, b, sub, cache: path.join(s.data, 'scan.json') };
};
const points = h => JSON.parse(fs.readFileSync(h.cache, 'utf8')).files;
// the bytes a scan read from the transcripts (Node 18's readFileSync goes
// through fs.openSync and fs.readSync too, so reads of scan.json are left
// out by their fd; a closed transcript's fd number is reused for it)
const reading = fn => {
  const real = fs.readSync, open = fs.openSync, close = fs.closeSync, fds = new Set();
  let bytes = 0;
  fs.openSync = (f, ...a) => { const fd = open(f, ...a); if (String(f).endsWith('.jsonl')) fds.add(fd); else fds.delete(fd); return fd; };
  fs.closeSync = fd => { fds.delete(fd); return close(fd); };
  fs.readSync = (fd, ...a) => { const got = real(fd, ...a); if (fds.has(fd)) bytes += got; return got; };
  try { return { out: fn(), bytes }; } finally { fs.readSync = real; fs.openSync = open; fs.closeSync = close; }
};
// the same scan with the checkpoints and without them
const both = (h, o) => {
  const plain = weekSpend({ dir: h.dir, ...o });
  const cached = reading(() => weekSpend({ dir: h.dir, cache: h.cache, ...o }));
  assert.deepEqual(cached.out, plain, 'since ' + new Date(o.since).toISOString());
  return { ...plain, bytes: cached.bytes };
};

describe('a scan from its checkpoints', () => {
  test('gives what a scan from the start of every file gives, as the window moves on, and reads less', () => {
    const h = home();
    try {
      // a: a long session; lines out of order, one that does not parse, a
      // response written twice, a line with a character of several bytes
      fs.writeFileSync(h.a, [user(1), line('a1', 1, 1e6), line('a2', 2, 5e5), line('a2', 2, 5e5), '{not json "assistant" "usage"', user(3), line('a4', 4, 2e5),
        line('a3', 3.5, 1e5), user(5).replace('said', 'säid ✓'), line('a5', 5, 3e5), line('a6', 6, 4e5), line('a7', 7, 1e5, 'claude-fable-5-1')].join('\n') + '\n');
      // b: a resumed session that copied a's first lines; its last line is still being written
      fs.writeFileSync(h.b, [line('a1', 1, 1e6), line('a2', 2, 5e5), line('b1', 6.5, 2.5e5), line('b2', 7.5, 1e6)].join('\n'));
      fs.writeFileSync(h.sub, [line('s1', 4.5, 1e6, 'claude-haiku-5-5'), line('s2', 6.2, 5e6, 'claude-sonnet-5-5')].join('\n') + '\n');
      const whole = [h.a, h.b, h.sub].reduce((n, f) => n + fs.statSync(f).size, 0);
      // the first scan has no checkpoints: everything is read
      const first = both(h, { since: T(0), until: T(8), marks: [T(0), T(4)] });
      assert.equal(first.bytes, whole);
      // a1 $4, a2 $2 once, a4 $0.8, a3 $0.4, a5 $1.2, a6 $1.6, a7 $0.8 at Fable's price, b1 $1, b2 $4, s1 $0.1, s2 $10
      assert.equal(Math.round(first.usd * 1e4) / 1e4, 25.9);
      assert.equal(first.messages, 11);
      assert.deepEqual(points(h)[h.a], { at: T(0), offset: Buffer.byteLength(user(1)) + 1 });
      let before = whole;
      for (const since of [T(0), T(1.5), T(3), T(3.6), T(4.2), T(5), T(6.3), T(7.2), T(7.8)]) {
        const r = both(h, { since, until: T(8), marks: [since, Math.max(since, T(6))] });
        assert.ok(r.bytes <= before, 'never more than the scan before: ' + r.bytes + ' after ' + before);
        before = r.bytes;
      }
      // past every line: each checkpoint is where the next line will start
      // (b's last line has no end yet, and is read again), dated by the scan
      // that moved it there
      assert.deepEqual(points(h), { [h.a]: { at: T(7.2), offset: fs.statSync(h.a).size }, [h.b]: { at: T(7.2), offset: fs.statSync(h.b).size - Buffer.byteLength(line('b2', 7.5, 1e6)) },
        [h.sub]: { at: T(6.3), offset: fs.statSync(h.sub).size } });
      assert.equal(before, Buffer.byteLength(line('b2', 7.5, 1e6)) + 3, 'the unfinished line, and the byte before each checkpoint');
      // a window that ends before the checkpoints' lines
      both(h, { since: T(7.9), until: T(7.95) });
    } finally { h.s.cleanup(); }
  });
  test('a file that grew between two scans: the new lines count, and only they are read', () => {
    const h = home();
    try {
      fs.writeFileSync(h.a, [line('a1', 1, 1e6), user(2), line('a2', 3, 5e5)].join('\n') + '\n');
      assert.equal(both(h, { since: T(2.5), until: T(4) }).usd, 2);
      const was = fs.statSync(h.a).size;
      fs.appendFileSync(h.a, [user(3.5), line('a3', 3.8, 2.5e5), line('a4', 5, 1e6)].join('\n') + '\n');
      // the same window as before, a later end: a2 again, and a3
      const r = both(h, { since: T(2.5), until: T(4) });
      assert.equal(r.usd, 3);
      assert.ok(r.bytes < fs.statSync(h.a).size, 'not from the start');
      // the window moved past a2: from a2 on, and the checkpoint moves to a3
      const next = both(h, { since: T(3.5), until: T(6) });
      assert.equal(next.usd, 5);
      assert.deepEqual(points(h)[h.a], { at: T(3.5), offset: was + Buffer.byteLength(user(3.5)) + 1 });
      // a line appended half, then its end: counted once it is whole
      const l = line('a5', 5.5, 5e5);
      fs.appendFileSync(h.a, l.slice(0, 40));
      assert.equal(both(h, { since: T(5.2), until: T(6) }).usd, 0);
      fs.appendFileSync(h.a, l.slice(40) + '\n');
      assert.equal(both(h, { since: T(5.2), until: T(6) }).usd, 2);
    } finally { h.s.cleanup(); }
  });
  test('a file that was truncated or written anew is read from its start', () => {
    const h = home();
    try {
      const lines = [line('a1', 1, 1e6), user(2), line('a2', 3, 5e5), line('a3', 4, 2.5e5)];
      fs.writeFileSync(h.a, lines.join('\n') + '\n');
      assert.equal(both(h, { since: T(3.5), until: T(9) }).usd, 1);
      const at = points(h)[h.a].offset;
      assert.equal(at, Buffer.byteLength(lines.slice(0, 3).join('\n')) + 1);
      // shorter than its checkpoint, with a line that counts
      fs.writeFileSync(h.a, line('n1', 5, 1e6) + '\n');
      assert.ok(fs.statSync(h.a).size < at);
      assert.equal(both(h, { since: T(3.5), until: T(9) }).usd, 4);
      assert.deepEqual(points(h)[h.a], { at: T(3.5), offset: 0 });
      // long enough again, but no line starts at the checkpoint
      fs.writeFileSync(h.cache, JSON.stringify({ v: 1, files: { [h.a]: { at: T(3.5), offset: at } } }));
      fs.writeFileSync(h.a, [line('m1', 4, 1e6), line('m2', 5, 1e6), line('m3', 6, 1e6), line('m4', 7, 1e6), line('m5', 8, 1e6)].join('\n') + '\n');
      assert.notEqual(fs.readFileSync(h.a)[at - 1], 10);
      assert.equal(both(h, { since: T(3.6), until: T(9) }).usd, 20);
      assert.deepEqual(points(h)[h.a], { at: T(3.6), offset: 0 });
    } finally { h.s.cleanup(); }
  });
  test('a window from before the checkpoint reads from the start and leaves it; a damaged file of checkpoints is none', () => {
    const h = home();
    try {
      fs.writeFileSync(h.a, [line('a1', 1, 1e6), line('a2', 3, 5e5), line('a3', 5, 2.5e5)].join('\n') + '\n');
      assert.equal(both(h, { since: T(4), until: T(9) }).usd, 1);
      const cp = points(h)[h.a];
      // the week-wide pass, asked with the same file of checkpoints
      const wide = both(h, { since: T(0), until: T(9) });
      assert.equal(wide.usd, 7);
      assert.equal(wide.bytes, fs.statSync(h.a).size);
      assert.deepEqual(points(h)[h.a], cp);
      // a checkpoint dated after the scan's end (a clock that ran ahead) is replaced
      fs.writeFileSync(h.cache, JSON.stringify({ v: 1, files: { [h.a]: { at: T(500), offset: fs.statSync(h.a).size } } }));
      assert.equal(both(h, { since: T(2), until: T(9) }).usd, 3);
      assert.deepEqual(points(h)[h.a], { at: T(2), offset: Buffer.byteLength(line('a1', 1, 1e6)) + 1 });
      for (const text of ['{"v": 1, "files": {', 'null', '[]', JSON.stringify({ v: 0, files: { [h.a]: { at: T(1), offset: 5 } } }),
        JSON.stringify({ v: 1, files: { [h.a]: { at: 'now', offset: 5 } } }), JSON.stringify({ v: 1, files: { [h.a]: { at: T(1), offset: -4 } } })]) {
        fs.writeFileSync(h.cache, text);
        assert.equal(both(h, { since: T(2), until: T(9) }).usd, 3, text);
        assert.deepEqual(points(h)[h.a], { at: T(2), offset: Buffer.byteLength(line('a1', 1, 1e6)) + 1 });
      }
      // a file of checkpoints that cannot be written: the scan still answers
      fs.rmSync(h.cache);
      fs.mkdirSync(h.cache);
      assert.equal(weekSpend({ dir: h.dir, cache: h.cache, since: T(2), until: T(9) }).usd, 3);
    } finally { h.s.cleanup(); }
  });
  test('a transcript no longer in the window leaves the file; without transcripts none is made', () => {
    const h = home();
    try {
      assert.equal(weekSpend({ dir: h.dir, cache: h.cache, since: T(0), until: T(9) }).files, 0);
      assert.ok(!fs.existsSync(h.cache));
      fs.writeFileSync(h.a, line('a1', 1, 1e6) + '\n');
      fs.writeFileSync(h.b, line('b1', 2, 1e6) + '\n');
      both(h, { since: T(0), until: T(9) });
      assert.deepEqual(Object.keys(points(h)).sort(), [h.a, h.b]);
      // b was last written before the window: it is not scanned, and not kept
      const old = new Date(Date.now() - 3 * 3600000);
      fs.utimesSync(h.b, old, old);
      both(h, { since: Date.now() - 3600000 });
      assert.deepEqual(Object.keys(points(h)), [h.a]);
    } finally { h.s.cleanup(); }
  });
});

describe('budget.mjs: the pass at every automatic reading', () => {
  test('keeps its checkpoints in scan.json; a dry reading and a reading for the skill keep none', () => {
    const h = home();
    try {
      const t = h2 => '2026-11-13T' + String(h2).padStart(2, '0') + ':00:00.000Z';
      const run = (now, ...more) => { const r = h.s.budget(['--all', '10', '--reset', RESET, '--now', now, ...more]); assert.equal(r.code, 0, r.out + r.err); return r; };
      fs.writeFileSync(h.a, [line('a1', 9, 1e6), line('a2', 11.5, 5e5)].join('\n') + '\n');
      run(t(12), '--source', 'hook', '--dry');
      run(t(12));
      assert.ok(!fs.existsSync(h.cache));
      run(t(12), '--source', 'hook');
      // the last hour's first line is a2
      assert.deepEqual(points(h)[h.a], { at: Date.parse(t(11)), offset: Buffer.byteLength(line('a1', 9, 1e6)) + 1 });
    } finally { h.s.cleanup(); }
  });
});
