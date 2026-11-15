// budget.mjs last: the report from the last reading, with no new measurement,
// when that reading is fresh enough; else one "measure:" line saying why.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RESET, levelOf, block } from './helpers.mjs';

const NOW = '2026-11-13T12:00:00.000Z';
const at = min => new Date(Date.parse(NOW) + min * 60000).toISOString();
const reading = (s, all, now = NOW, more = []) => assert.equal(s.budget(['--all', String(all), '--reset', RESET, '--now', now, ...more]).code, 0);
const last = (s, now) => s.budget(['last', '--now', now]);
const lines = s => s.read('log.jsonl').trim().split('\n').length;

describe('budget.mjs last', () => {
  test('no reading yet: measure', () => {
    const s = sandbox();
    try {
      const r = last(s, NOW);
      assert.equal(r.code, 0);
      assert.equal(r.out.trim(), 'measure: no reading yet');
    } finally { s.cleanup(); }
  });
  test('a reading 10 min old: the report, saying what it rests on, and nothing written', () => {
    const s = sandbox();
    try {
      reading(s, 10, NOW, ['--premium', '2', '--five', '20', '--five-reset', '2026-11-13T15:00:00.000Z']);
      const settings = s.read('../settings.json');
      const r = last(s, at(10));
      assert.equal(r.code, 0, r.out);
      const b = block(r.out);
      assert.equal(b[0], 'last reading 11-13 12:00, 10 min ago, not measured now');
      assert.equal(b[1], 'not in it: context, extra usage · /pacing usage now measures');
      assert.ok(b.some(l => l.startsWith('5-hour ')), '5-hour bar carried');
      assert.ok(b.some(l => /^Fable 5\.2 .* · read 11-13 12:00$/.test(l)), 'the per-model figure says when it was read');
      for (const l of b) assert.ok(l.length <= 68, l);
      assert.equal(levelOf(r.out), 'ahead');
      assert.doesNotMatch(r.out, /^context /m);
      assert.equal(lines(s), 1, 'not logged');
      assert.equal(s.read('../settings.json'), settings, 'settings untouched');
    } finally { s.cleanup(); }
  });
  test('the line is drawn for now: across midnight it steps up', () => {
    const s = sandbox();
    try {
      reading(s, 18, '2026-11-13T23:50:00.000Z', ['--premium', '2']);
      // 18 % is on pace against 20 %, ahead of 33.3 % after midnight
      assert.equal(levelOf(last(s, '2026-11-14T00:10:00.000Z').out), 'ahead');
    } finally { s.cleanup(); }
  });
  test('older than 30 min, after the reset, or at stop: measure', () => {
    const s = sandbox();
    try {
      reading(s, 10, NOW, ['--premium', '2']);
      assert.equal(last(s, at(31)).out.trim(), 'measure: the last reading is 31 min old');
      assert.equal(last(s, at(-5)).out.trim(), 'measure: the last reading is dated after now');
      reading(s, 96, at(40), ['--premium', '2']);
      assert.equal(last(s, at(45)).out.trim(), 'measure: the week is nearly used, and extra usage is only in a full reading');
      reading(s, 90, '2026-11-19T11:50:00.000Z', ['--premium', '2']);
      assert.equal(last(s, '2026-11-19T12:05:00.000Z').out.trim(), 'measure: the week has reset since the last reading');
    } finally { s.cleanup(); }
  });
  test('an automatic reading serves, its per-model figure carried while fresh enough', () => {
    const s = sandbox();
    try {
      // 2 % against a 20 % line: 18 points under, so an hour-old figure serves
      reading(s, 10, NOW, ['--premium', '2']);
      s.budget(['--all', '12', '--reset', RESET, '--now', at(40), '--source', 'hook']);
      const r = last(s, at(50));
      assert.match(block(r.out)[0], /^last reading 11-13 12:40, 10 min ago \(automatic\), not measured now$/);
      assert.match(r.out, /^Fable 5\.2 used 2 % \(read 2026-11-13 12:00, carried over\)/m);
      // the automatic reading is 21 min old, but the figure it carries is past an hour
      assert.equal(last(s, at(61)).out.trim(), 'measure: Fable 5.2\'s meter was read 61 min ago');
    } finally { s.cleanup(); }
  });
  test('a per-model figure near its line must be under 30 min old', () => {
    const s = sandbox();
    try {
      reading(s, 10, NOW, ['--premium', '10']);
      s.budget(['--all', '12', '--reset', RESET, '--now', at(40), '--source', 'hook']);
      assert.equal(last(s, at(45)).out.trim(), 'measure: Fable 5.2\'s meter was read 45 min ago');
    } finally { s.cleanup(); }
    const t = sandbox();
    try {
      reading(t, 10, NOW, ['--premium', '10']);
      assert.match(last(t, at(25)).out, /not measured now/, 'the skill\'s own reading, 25 min old');
    } finally { t.cleanup(); }
  });
  test('no per-model figure in the week: measure, unless the plan has none or another model is tier 1', () => {
    const s = sandbox();
    try {
      s.budget(['--all', '10', '--reset', RESET, '--now', NOW, '--source', 'hook']);
      assert.equal(last(s, at(5)).out.trim(), 'measure: Fable 5.2\'s meter is not in the last reading');
      s.config(['set', '1', 'opus', 'high']);
      assert.match(last(s, at(5)).out, /not measured now/);
      s.config(['reset']);
      s.config(['premium', 'none']);
      assert.match(last(s, at(5)).out, /not measured now/);
    } finally { s.cleanup(); }
  });
});
