// saved.mjs: what handing work to role agents on cheaper models saved this
// week against the session's model, from config.mjs's records of each task.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RESET } from './helpers.mjs';
import { projectSlug } from '../pacing/skills/pacing/scripts/paths.mjs';

// the week of RESET: 2026-11-12 12:00 to 2026-11-19 12:00 UTC
const NOW = '2026-11-18T12:00:00.000Z';
const saved = (s, args = [], now = NOW) => s.run('saved.mjs', [...args, '--now', now]);
const reading = s => s.write('log.jsonl', JSON.stringify({ t: '2026-11-18T10:00:00.000Z', all: 30, line: 40, level: 'ahead', reset: RESET }) + '\n');
const records = (s, list) => s.write('agents/' + projectSlug(s.project) + '.jsonl',
  list.map((r, i) => JSON.stringify({ role: 'implementer', id: 'a' + i, effort: 'medium', resumed: false, ...r })).join('\n') + '\n');
// $0.133 per point of the weekly meter (100 000 tokens at Opus 5.5's blended price)
const rate = s => s.write('rate.json', JSON.stringify({ v: 2, reset: RESET, from: 10, to: 20, usd: 1.33, carried: null }) + '\n');
// what records carry today: one total, the agent's size, no split
const plain = [
  { t: '2026-11-10T09:00:00.000Z', model: 'sonnet', tokens: 1e6 }, // the week before
  { t: '2026-11-15T09:00:00.000Z', model: 'sonnet', tokens: 100000, role: 'reader' },
  { t: '2026-11-16T09:00:00.000Z', model: 'haiku', tokens: 50000, role: 'verifier' },
];
// with what each task spent: Opus 5.5 would have cost $0.37 and $1.18,
// Sonnet 5.5 cost $0.185 and Haiku 5.5 $0.0395
const split = [
  { t: '2026-11-10T09:00:00.000Z', model: 'haiku', tokens: 9000, spent: { in: 1e6, out: 1e6, read: 1e6, write: 1e6 } },
  { t: '2026-11-15T09:00:00.000Z', model: 'sonnet', tokens: 60000, spent: { in: 10000, out: 5000, read: 400000, write: 30000 } },
  { t: '2026-11-16T09:00:00.000Z', model: 'haiku', tokens: 40000, spent: { in: 20000, out: 10000, read: 2000000, write: 100000 }, role: 'reader' },
];

describe('saved.mjs', () => {
  test('no records: says so, in every form', () => {
    const s = sandbox();
    try {
      reading(s);
      let r = saved(s, ['--session', 'opus']);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, 'No agent work recorded this week.\n');
      assert.equal(saved(s, ['--detail']).out, 'No agent work recorded this week.\n');
      // records of the week before only: none this week
      records(s, [plain[0]]);
      r = saved(s, ['--json']);
      const j = JSON.parse(r.out);
      assert.equal(j.tasks, 0);
      assert.equal(j.text, 'No agent work recorded this week.');
      assert.equal(j.priced, null);
    } finally { s.cleanup(); }
  });

  test('totals only: the ratio and the share, no tokens and no points even with a rate', () => {
    const s = sandbox();
    try {
      reading(s); rate(s); records(s, plain);
      const r = saved(s, ['--session', 'opus']);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, 'Delegation this week: 2 tasks; on Opus 5.5 they would have cost 2.9× as much (about 66% less).\n');
    } finally { s.cleanup(); }
  });

  test('with what tasks spent: tokens, and points of the weekly meter from the rate', () => {
    const s = sandbox();
    try {
      reading(s); rate(s); records(s, split);
      const r = saved(s, ['--session', 'claude-opus-5-5']);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, 'Delegation this week: 2 tasks, 2.6M tokens on agents; on Opus 5.5 they would have cost 6.9× as much, about 10 points of the weekly meter saved.\n');
    } finally { s.cleanup(); }
  });

  test('with what tasks spent but no rate: the share', () => {
    const s = sandbox();
    try {
      reading(s); records(s, split);
      const r = saved(s, ['--session', 'opus']);
      assert.equal(r.out, 'Delegation this week: 2 tasks, 2.6M tokens on agents; on Opus 5.5 they would have cost 6.9× as much (about 86% less).\n');
    } finally { s.cleanup(); }
  });

  test('some records with a split: the tokens say on how many', () => {
    const s = sandbox();
    try {
      reading(s); rate(s); records(s, [split[1], plain[2]]);
      const r = saved(s, ['--session', 'opus']);
      assert.match(r.out, /^Delegation this week: 2 tasks, 445k tokens on agents \(counted on 1 of them\); on Opus 5\.5 they would have cost [\d.]+× as much, about 1 point of the weekly meter saved\.\n$/);
    } finally { s.cleanup(); }
  });

  test('a task on a dearer model: named apart, nothing saved on it', () => {
    const s = sandbox();
    try {
      reading(s);
      records(s, [{ t: '2026-11-15T09:00:00.000Z', model: 'fable', tokens: 100000 }, { t: '2026-11-16T09:00:00.000Z', model: 'sonnet', tokens: 100000 }]);
      let r = saved(s, ['--session', 'opus']);
      assert.equal(r.out, 'Delegation this week: 2 tasks, 1 of them ran above the session\'s model (Fable 5.2); on Opus 5.5 the other one would have cost 2.0× as much (about 50% less).\n');
      const j = JSON.parse(saved(s, ['--session', 'opus', '--json']).out);
      assert.deepEqual(j.above, { tasks: 1, counted: 0, tokens: 0, models: ['Fable 5.2'] });
      r = saved(s, ['--session', 'sonnet']);
      assert.equal(r.out, 'Delegation this week: 2 tasks, 1 of them ran above the session\'s model (Fable 5.2); the other one ran on Sonnet 5.5 itself, nothing saved.\n');
      records(s, [{ t: '2026-11-15T09:00:00.000Z', model: 'fable', tokens: 100000 }]);
      r = saved(s, ['--session', 'opus']);
      assert.equal(r.out, 'Delegation this week: 1 task, which ran above the session\'s model (Fable 5.2): nothing saved.\n');
    } finally { s.cleanup(); }
  });

  test('the week follows the last reading, moved on once its reset passed', () => {
    const s = sandbox();
    try {
      reading(s);
      records(s, [{ t: '2026-11-18T09:00:00.000Z', model: 'sonnet', tokens: 1000 }, { t: '2026-11-19T13:00:00.000Z', model: 'sonnet', tokens: 1000 }, { t: '2026-11-20T09:00:00.000Z', model: 'sonnet', tokens: 1000 }]);
      const j = JSON.parse(saved(s, ['--session', 'opus', '--json'], '2026-11-21T12:00:00.000Z').out);
      assert.equal(j.tasks, 2);
      assert.deepEqual(j.week, { from: RESET, to: '2026-11-26T12:00:00.000Z', known: true });
    } finally { s.cleanup(); }
  });

  test('every project by default, as the weekly meter counts them; --project narrows to one', () => {
    const s = sandbox();
    try {
      reading(s); records(s, plain);
      s.write('agents/' + projectSlug('X:/other/repo') + '.jsonl', JSON.stringify({ t: '2026-11-17T09:00:00.000Z', role: 'reader', id: 'b0', model: 'haiku', effort: 'low', tokens: 20000 }) + '\n');
      assert.equal(JSON.parse(saved(s, ['--session', 'opus', '--json']).out).tasks, 3);
      // from another folder too: the default does not depend on where it runs
      assert.equal(JSON.parse(s.run('saved.mjs', ['--session', 'opus', '--json', '--now', NOW], { cwd: s.home }).out).tasks, 3);
      assert.equal(JSON.parse(saved(s, ['--session', 'opus', '--json', '--project', s.project]).out).tasks, 2);
      assert.equal(JSON.parse(saved(s, ['--session', 'opus', '--json', '--project', s.home]).out).tasks, 0);
    } finally { s.cleanup(); }
  });

  test('the session model: --session, else state.json next, else tier 1', () => {
    const s = sandbox();
    try {
      reading(s); records(s, plain);
      assert.equal(JSON.parse(saved(s, ['--json']).out).session.label, 'Fable 5.2');
      s.write('state.json', JSON.stringify({ next: { model: 'sonnet', label: 'Sonnet 5.5', effort: 'medium' } }));
      assert.deepEqual(JSON.parse(saved(s, ['--json']).out).session, { model: 'sonnet', label: 'Sonnet 5.5', from: 'state' });
      assert.equal(JSON.parse(saved(s, ['--json', '--session', 'opus']).out).session.from, 'flag');
      const r = saved(s, ['--session', 'gpt']);
      assert.equal(r.code, 1);
      // a refusal is on standard output, as in every script
      assert.equal(r.out.trim(), '--session must name a known model: fable, opus, sonnet, haiku');
      assert.equal(r.err, '');
    } finally { s.cleanup(); }
  });

  test('--detail: the line, then a table by role and model', () => {
    const s = sandbox();
    try {
      reading(s); rate(s);
      records(s, [...split, { t: '2026-11-17T09:00:00.000Z', model: 'fable', tokens: 5000 }]);
      const r = saved(s, ['--session', 'opus', '--detail']);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.lines, [
        'Delegation this week: 3 tasks, 2.6M tokens on agents (counted on 2 of them), 1 of them ran above the session\'s model (Fable 5.2); on Opus 5.5 the other 2 would have cost 6.9× as much, about 10 points of the weekly meter saved.',
        '',
        'by role and model, against Opus 5.5:',
        '  role         model       tasks  tokens    saved',
        '  implementer  Sonnet 5.5      1    445k  1.4 pts',
        '  reader       Haiku 5.5       1    2.1M  8.6 pts',
        '  implementer  Fable 5.2       1       -    above',
        '',
      ]);
      // without a rate the saved column is the share
      s.write('rate.json', '{}');
      assert.match(saved(s, ['--session', 'opus', '--detail']).out, /^  reader +Haiku 5\.5 +1 +2\.1M +97%$/m);
      // and so with an older file, raw tokens per point without v: 2
      s.write('rate.json', JSON.stringify({ reset: RESET, from: 10, to: 20, tokens: 1e6, carried: null }) + '\n');
      assert.match(saved(s, ['--session', 'opus', '--detail']).out, /^  reader +Haiku 5\.5 +1 +2\.1M +97%$/m);
      assert.equal(JSON.parse(saved(s, ['--session', 'opus', '--json']).out).usdPerPoint, null);
    } finally { s.cleanup(); }
  });

  test('--json: one line with the figures, the groups and the text', () => {
    const s = sandbox();
    try {
      reading(s); rate(s); records(s, split);
      const r = saved(s, ['--session', 'opus', '--json']);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.trim().split('\n').length, 1);
      const j = JSON.parse(r.out);
      assert.deepEqual(Object.keys(j), ['week', 'session', 'usdPerPoint', 'priced', 'tasks', 'counted', 'tokens', 'usd', 'sessionUsd', 'savedUsd', 'ratio', 'share', 'points', 'above', 'groups', 'text']);
      assert.equal(j.priced, 'split');
      assert.equal(j.usdPerPoint, 0.133);
      assert.equal(j.tasks, 2);
      assert.equal(j.tokens, 2575000);
      assert.equal(j.usd, 0.22);
      assert.equal(j.sessionUsd, 1.55);
      assert.equal(j.points, 9.97);
      assert.deepEqual(j.groups.map(g => [g.role, g.model, g.tasks, g.above]), [['implementer', 'sonnet', 1, false], ['reader', 'haiku', 1, false]]);
      assert.equal(j.text, 'Delegation this week: 2 tasks, 2.6M tokens on agents; on Opus 5.5 they would have cost 6.9× as much, about 10 points of the weekly meter saved.');
    } finally { s.cleanup(); }
  });
});

// what a script refuses is one line on standard output, exit code 1: the
// session and the hooks module read one stream
describe('saved.mjs, arguments it refuses', () => {
  test('a flag without its value, and a --now that is no date', () => {
    const s = sandbox();
    try {
      reading(s); records(s, plain);
      for (const [args, line] of [
        [['--project'], '--project needs a value: --project <folder>'],
        [['--project', '--json'], '--project needs a value: --project <folder>'],
        [['--session'], '--session needs a value: --session <model>'],
        [['--json', '--now'], '--now needs a value: --now <ISO date>'],
        [['--now', 'garbage'], '--now must be a date, such as 2026-11-22T10:00:00Z, not "garbage"'],
      ]) {
        const r = s.run('saved.mjs', args);
        assert.equal(r.code, 1, args.join(' '));
        assert.equal(r.out.trim(), line);
        assert.equal(r.err, '');
      }
      // --project with its folder still narrows
      assert.equal(JSON.parse(saved(s, ['--session', 'opus', '--json', '--project', s.project]).out).tasks, 2);
    } finally { s.cleanup(); }
  });
});
