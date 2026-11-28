// The bulk settings test (what the setup test of 0.9.1-beta found), one
// ladder per test file so node --test runs the three at once: run one
// after another they took 38 s, the longest of the node tests.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RESET } from './helpers.mjs';

const NOW = '2026-11-13T12:00:00Z';
const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };
const dry = (s, ...a) => s.budget(['--reset', RESET, '--now', NOW, '--dry', ...a]);

export const bulk = which => {
  describe('the settings a setup can choose, in bulk: ladder ' + (which + 1), () => {
    // a sample of the matrix that found the bugs above: each run must exit 0,
    // print no undefined or NaN, and route nothing to a model that is out
    const ladders = [[['fable', 'max'], ['haiku', 'low']], [['opus', 'xhigh'], ['fable', 'low'], ['haiku', 'medium']], [['fable', 'high'], ['fable', 'medium'], ['fable', 'low']]];
    const label = { fable: 'Fable 5.2', opus: 'Opus 5.5', haiku: 'Haiku 5.5' };
    for (const ladder of [ladders[which]]) for (const premium of ['fable', 'opus', 'none']) for (const fallback of [['opus', 'high'], ['fable', 'high'], 'none']) {
      test(ladder.map(t => t.join(' ')).join(', ') + '; premium ' + premium + '; fallback ' + (fallback === 'none' ? 'none' : fallback.join(' ')), withHome(s => {
        const cmds = [];
        if (ladder.length === 2) cmds.push(['remove', '3']);
        ladder.forEach(([m, e], i) => cmds.push(['set', String(i + 1), m, e]));
        cmds.push(['premium', premium], fallback === 'none' ? ['fallback', 'none'] : ['fallback', ...fallback], ['reader', 'fable', 'low'], ['verifier', 'opus', 'low']);
        const a = s.config(['apply', ...cmds.flatMap((c, i) => (i ? ['+', ...c] : c))]);
        assert.equal(a.code, 0, a.out);
        for (const [all, prem] of [[10, 2], [10, 30], [22, 100], [96, 50]]) {
          const r = dry(s, '--all', String(all), '--premium', String(prem), '--context-tokens', '700000', '--session', 'claude-opus-5-5');
          assert.equal(r.code, 0, r.err);
          assert.equal(r.err, '');
          assert.doesNotMatch(r.out, /undefined|\bNaN\b|\bnull\b/);
          if (premium !== 'none' && prem === 100) {
            const out = r.out.split(/\r?\n/).filter(l => /^ {2}(judgment|medium|routine|trivial|bulky|reader|verifier) |^next session|^context /.test(l)).join('\n')
              .replace(/a check with points to judge.*/g, '');
            assert.ok(!new RegExp('(-> (tier \\d )?|judgment on |medium on |routine on |next session: )' + label[premium].replace('.', '\\.')).test(out), label[premium] + ' is out but named:\n' + out);
          }
        }
      }));
    }
  });
};
