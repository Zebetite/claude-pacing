// What the setup test of 0.9.1-beta found: a model whose meter is full named
// for a whole task, a start line recommending "unknown", crashes on a damaged
// config, state or log, odd readings taken at face value; and the calls and
// lines that cost tokens for nothing (apply, --brief, the first-run line).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, plugin, RESET, levelOf, lineOf, routeOf } from './helpers.mjs';

const NOW = '2026-11-13T12:00:00Z';
const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };
const dry = (s, ...a) => s.budget(['--reset', RESET, '--now', NOW, '--dry', ...a]);
const whole = out => (out.match(/without asking \((.*?)\)/) || [])[1];

describe('a whole task never goes to a model whose meter is full or held', () => {
  test('the per-model meter on the fallback\'s model (premium opus), Opus out', withHome(s => {
    s.config(['premium', 'opus']);
    const out = dry(s, '--all', '10', '--premium', '100', '--context-tokens', '700000').out;
    assert.equal(whole(out), 'judgment on Fable 5.2 high, medium on Sonnet 5.5 medium, routine on Sonnet 5.5 medium');
  }));
  test('the fallback set to the per-model meter\'s model, that model out or held', withHome(s => {
    s.config(['fallback', 'fable', 'high']);
    assert.match(whole(dry(s, '--all', '10', '--premium', '100', '--context-tokens', '700000').out), /^judgment on Opus 5\.5 medium,/);
    assert.match(whole(dry(s, '--all', '10', '--premium', '30', '--context-tokens', '700000').out), /^judgment on Opus 5\.5 medium,/);
    // while that model is neither, the fallback stands
    assert.match(whole(dry(s, '--all', '10', '--premium', '5', '--context-tokens', '700000').out), /^judgment on Fable 5\.2 high,/);
  }));
});

describe('the start line with no model to recommend', () => {
  const start = s => { const st = JSON.parse(s.read('state.json')); st.t = new Date().toISOString(); s.write('state.json', JSON.stringify(st)); return JSON.parse(s.hook().out); };
  test('every tier on the model whose meter is full, no fallback: it says so, never "unknown"', withHome(s => {
    s.config(['apply', 'set', '2', 'fable', 'low', '+', 'remove', '3', '+', 'fallback', 'none']);
    s.budget(['--all', '10', '--premium', '100', '--reset', RESET, '--now', NOW]);
    const j = start(s);
    assert.match(j.systemMessage, /Fable 5\.2 out\. No model is left on the ladder until the reset: wrap up, or add a tier or a fallback on another model/);
    assert.match(j.hookSpecificOutput.additionalContext, /No model is left on the ladder until the reset.*your first reply starts with one line telling the user so/);
    assert.doesNotMatch(j.systemMessage + j.hookSpecificOutput.additionalContext, /unknown/);
  }));
  test('a state without the field names no model, and none is invented', withHome(s => {
    s.write('state.json', JSON.stringify({ t: new Date().toISOString(), all: 10, line: 20, level: 'ahead', reset: RESET }));
    const j = JSON.parse(s.hook().out);
    assert.match(j.systemMessage, /level ahead\. This reading names no model: `\/pacing usage now` takes a new one\./);
    assert.doesNotMatch(j.systemMessage, /unknown/);
  }));
  test('a state with no usable time or figures is no reading: nothing is said', withHome(s => {
    for (const st of [{ t: 'yesterday', all: 10, line: 20, level: 'ahead' }, { t: new Date().toISOString(), all: 10 }, [1, 2], 'text']) {
      s.write('state.json', JSON.stringify(st));
      const r = s.hook();
      assert.equal(r.code, 0);
      assert.equal(r.out, '', JSON.stringify(st));
    }
  }));
});

describe('a damaged or hand-edited config.json', () => {
  const ok = { tiers: [{ model: 'fable', label: 'Fable 5.2', effort: 'high' }, { model: 'opus', label: 'Opus 5.5', effort: 'medium' }], lastDayWeight: 1.5, installed: 'x' };
  test('a file that does not parse: the report goes on from the defaults and says so', withHome(s => {
    for (const text of ['', '{"tiers": [{"model": "fable"']) {
      s.write('config.json', text);
      const r = dry(s, '--all', '22', '--premium', '10');
      assert.equal(r.code, 0, r.err);
      assert.equal(levelOf(r.out), 'over');
      assert.match(r.out, /^config\.json: it does not parse: the defaults are used until it is repaired/m);
      assert.equal(r.err, '');
    }
  }));
  test('config.mjs sets a file that does not parse aside and goes on from the defaults', withHome(s => {
    s.write('config.json', '{"tiers": [{"model": "fable"');
    const r = s.config(['weight', '2']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^config\.json did not parse: a copy is kept as config\.json\.damaged, and the defaults are used$/m);
    assert.equal(s.read('config.json.damaged'), '{"tiers": [{"model": "fable"');
    assert.equal(JSON.parse(s.read('config.json')).lastDayWeight, 2);
  }));
  test('values no command writes fall back to their defaults, with a note; none reaches the budget line', withHome(s => {
    const cases = [
      [{ ...ok, lastDayWeight: 'heavy' }, /the last-day weight is not a number from 1 to 3/],
      [{ ...ok, lastDayWeight: -3 }, /the last-day weight is not a number from 1 to 3/],
      [{ ...ok, premium: 'gpt' }, /the per-model meter names no known model/],
      [{ ...ok, fallback: { model: 'gpt', effort: 'high' } }, /the fallback is not a known model and effort/],
      [{ ...ok, reader: 'fast', verifier: 7 }, /the reader's model is not a known model and effort.*the verifier's model/],
      [{ ...ok, tiers: [{ model: 'fable' }, { model: 'opus' }] }, /2 tiers without a known model and effort: dropped; fewer than two tiers: the default ladder is used/],
      [{ ...ok, tiers: [{ model: 'gpt', effort: 'high' }, ...ok.tiers] }, /1 tier without a known model and effort: dropped/],
      [{ ...ok, tiers: [ok.tiers[0]] }, /fewer than two tiers: the default ladder is used/],
    ];
    for (const [c, note] of cases) {
      s.writeConfig(c);
      const r = dry(s, '--all', '22', '--premium', '30');
      assert.equal(r.code, 0, JSON.stringify(c) + r.err);
      assert.equal(lineOf(r.out), 20, 'the line is a number');
      assert.match(r.out.split(/\r?\n/).find(l => l.startsWith('config.json: ')) || '', note);
      assert.doesNotMatch(r.out, /undefined|NaN/);
      const h = s.budget(['--all', '22', '--reset', RESET, '--now', NOW, '--dry', '--source', 'hook']);
      assert.equal(JSON.parse(h.out.trim()).line, 20);
    }
    for (const raw of ['null', '[]', '"text"']) {
      s.write('config.json', raw);
      const r = dry(s, '--all', '22');
      assert.equal(r.code, 0, raw + r.err);
      assert.match(r.out, /^config\.json: it does not hold settings: the defaults are used$/m);
    }
  }));
  test('config.mjs says what it found and shows no undefined; the repair is written by the next change of a setting', withHome(s => {
    s.writeConfig({ ...ok, tiers: [{ model: 'fable' }, { model: 'opus' }], lastDayWeight: 0 });
    const r = s.config(['show']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^tier 1 {2}Fable 5\.2 high/m);
    assert.match(r.out, /^config\.json: 2 tiers without a known model and effort: dropped; fewer than two tiers: the default ladder is used; the last-day weight is not a number from 1 to 3: the default is used$/m);
    assert.doesNotMatch(r.out, /undefined/);
    // a command that only reads leaves the file: the next one says it again
    assert.match(s.config(['show']).out, /^config\.json: 2 tiers without/m);
    assert.equal(JSON.parse(s.read('config.json')).lastDayWeight, 0);
    // written with a change: then nothing is left to say
    s.config(['weight', '2']);
    assert.doesNotMatch(s.config(['show']).out, /^config\.json:/m);
    assert.equal(JSON.parse(s.read('config.json')).tiers.length, 3);
  }));
  test('a sound config gets no note', withHome(s => {
    s.config(['show']);
    assert.doesNotMatch(dry(s, '--all', '22').out, /^config\.json:/m);
  }));
});

describe('a damaged log', () => {
  test('lines that are no readings are skipped by the report, log and week', withHome(s => {
    s.write('log.jsonl', 'garbage\n{"t":"x","all":5}\n{"all":5}\n[1,2]\nnull\n"text"\n{"t":"2026-11-12T13:00:00Z","reset":"' + RESET + '"}\n');
    const r = dry(s, '--all', '10');
    assert.equal(r.code, 0, r.err);
    assert.equal(levelOf(r.out), 'ahead');
    assert.equal(s.budget(['log']).out.trim(), 'no readings yet');
    assert.equal(s.budget(['week']).out.trim(), 'no readings yet');
    assert.equal(s.budget(['log']).code, 0);
  }));
});

describe('odd readings', () => {
  test('an empty value is not 0 %, and no meter is below 0', withHome(s => {
    for (const a of [['--all', ''], ['--all', ' '], ['--all', '-5'], ['--all', '10', '--premium', '-3'], ['--all', '10', '--premium', ''], ['--all', '10', '--five', '-1'], ['--all', '10', '--context-tokens', '-5']]) {
      const r = dry(s, ...a);
      assert.equal(r.code, 1, a.join(' '));
      assert.match(r.out, /^bad input: percents must be numbers from 0/, a.join(' '));
    }
    // over 100 is a real reading with extra usage on
    assert.equal(levelOf(dry(s, '--all', '150').out), 'stop');
  }));
  test('"an Opus", "a Fable" in the upward line', withHome(s => {
    assert.match(dry(s, '--all', '10', '--premium', '30').out, /may go to a Fable 5\.2 high subagent/);
    s.config(['apply', 'set', '1', 'opus', 'xhigh', '+', 'set', '2', 'fable', 'low', '+', 'premium', 'opus']);
    assert.match(dry(s, '--all', '10', '--premium', '30').out, /may go to an Opus 5\.5 xhigh subagent/);
    // room in both meters: one step above tier 1's xhigh
    assert.match(dry(s, '--all', '10', '--premium', '5', '--session', 'claude-fable-5-2').out, /may go to an Opus 5\.5 max subagent/);
  }));
});

describe('fewer calls, fewer lines', () => {
  test('a first run is said by the report itself, once there are no settings', withHome(s => {
    assert.match(dry(s, '--all', '10').out, /^first run: no settings yet, the defaults are used; run config\.mjs init once$/m);
    s.config(['init']);
    assert.doesNotMatch(dry(s, '--all', '10').out, /^first run:/m);
  }));
  test('--brief: the level, the routing in one line, what to do; a quarter of the full report', withHome(s => {
    s.config(['init']);
    const args = ['--all', '22', '--premium', '10', '--five', '14', '--five-reset', '2026-11-13T15:00:00Z', '--context', '12', '--context-tokens', '120000', '--session', 'claude-fable-5-2',
      '--categories', 'Messages=90000,System tools=25000,MCP tools=5000'];
    const full = dry(s, ...args).out, brief = dry(s, ...args, '--brief').out;
    assert.deepEqual(brief.trim().split(/\r?\n/), [
      'Weekly used 22 %, delta +2, Fable 5.2 10 % -> over',
      'Fable 5.2 used 10 %, delta -10 -> ahead',
      'route: judgment, trivial -> Fable 5.2 high (the session); medium, routine -> Opus 5.5 medium; bulky -> Sonnet 5.5 medium; reader -> Haiku 5.5 medium; verifier -> Haiku 5.5 medium (plain runs; checks to judge -> Sonnet 5.5 medium)',
      'do: medium tasks leave the session\'s model too',
      'next session: Fable 5.2 high',
    ]);
    assert.ok(brief.length * 4 < full.length * 1.2, brief.length + ' against ' + full.length);
  }));
  test('--brief keeps what advises: the 5-hour hold, the context line, the MCP note, a held model', withHome(s => {
    s.config(['init']);
    const brief = dry(s, '--all', '10', '--premium', '30', '--five', '90', '--five-reset', '2026-11-13T15:00:00Z', '--context-tokens', '440000',
      '--categories', 'Messages=90000,System tools=25000,MCP tools=40000', '--brief').out;
    for (const re of [/^5-hour window 90 %.*-> HOLD heavy work/m, /^context 440k tokens -> suggest compacting/m, /^fixed overhead .* -> MCP tools are 40k of it/m,
      /^Weekly used .* Fable 5\.2 held$/m, /^do: Fable 5\.2's meter is at throttle: this session belongs on Opus 5\.5 high now, and Fable 5\.2 is kept for judgment work; the Switch row offers it/m, /^upward: /m, /^route: judgment, medium, routine, trivial -> Opus 5\.5 high \(the session\)/m]) assert.match(brief, re);
    // and leaves out what only describes
    assert.doesNotMatch(brief, /^(day \d|allowance today|spend rate|trend:|tier {2}model)/m);
  }));
  test('a reading with --brief still logs, and last --brief reports from it', withHome(s => {
    s.config(['init']);
    const r = s.budget(['--all', '10', '--premium', '2', '--reset', RESET, '--now', NOW, '--brief']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^settings\.json: the terminal CLI now defaults to Fable 5\.2 high/m);
    assert.ok(s.exists('state.json'));
    const l = s.budget(['last', '--brief', '--now', '2026-11-13T12:10:00Z']).out.trim().split(/\r?\n/);
    assert.equal(l[0], 'last reading 11-13 12:00, 10 min ago, not read now');
    assert.ok(l.some(x => x.startsWith('route: ')));
    assert.ok(l.length <= 7, l.join('\n'));
    assert.equal(s.budget(['last', '--brief', '--now', '2026-11-13T13:10:00Z']).out.trim(), 'measure: the last reading is 70 min old');
  }));
  test('apply: several settings in one run, the config shown once', withHome(s => {
    const r = s.config(['apply', 'set', '2', 'sonnet', 'low', '+', 'add', 'haiku', 'low', '+', 'weight', '2', '+', 'premium', 'none', '+', 'verifier', 'ladder', '+', 'next', 'off']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.out.match(/^tier 1 /gm).length, 1);
    const c = JSON.parse(s.read('config.json'));
    assert.deepEqual([c.tiers.length, c.tiers[1].model, c.lastDayWeight, c.premium, c.verifier, c.setNextModel], [4, 'sonnet', 2, null, 'ladder', false]);
  }));
  test('apply stops at the first command that is refused, and says which', withHome(s => {
    const r = s.config(['apply', 'weight', '2', '+', 'set', '9', 'fable', 'high', '+', 'weight', '3']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^set 9 fable high: tier must be 1 to 3\nstopped there: the commands before it were applied, the ones after it were not$/m);
    assert.equal(JSON.parse(s.read('config.json')).lastDayWeight, 2);
  }));
  test('apply: agent records in one run; only settings, records and notes pass', withHome(s => {
    const r = s.config(['apply', 'agent', 'reader', 'a1', 'haiku', 'medium', '14000', '+', 'agent', 'verifier', 'b2', 'haiku', 'medium', '9000']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^recorded: reader a1, task 1, 14k tokens\nrecorded: verifier b2, task 1, 9k tokens$/m);
    assert.doesNotMatch(r.out, /^tier 1 /m);
    for (const bad of [['apply'], ['apply', 'reset'], ['apply', 'weight', '2', '+', 'handover', 'done']]) {
      const b = s.config(bad);
      assert.equal(b.code, 1, bad.join(' '));
      assert.match(b.out, /^apply /);
    }
  }));
  test('help takes nothing or full; premium needs a model or none', withHome(s => {
    assert.equal(s.config(['help', 'fulll']).code, 1);
    assert.equal(s.config(['help', 'fulll']).out.trim(), 'help | help full');
    assert.equal(s.config(['premium']).out.trim(), 'premium <model> | premium none');
  }));
  test('the reader and the verifier default to Haiku when the session names no model', () => {
    const model = f => fs.readFileSync(path.join(plugin, 'agents', f), 'utf8').match(/^model: (.*)$/m)[1];
    assert.deepEqual([model('reader.md'), model('verifier.md')], ['haiku', 'haiku']);
    assert.deepEqual([model('implementer.md'), model('researcher.md')], ['inherit', 'inherit']);
  });
  test('the skills and the setup steps name the cheaper paths', () => {
    const read = (...p) => fs.readFileSync(path.join(plugin, 'skills', ...p), 'utf8');
    assert.match(read('pacing', 'SETUP.md'), /config\.mjs" apply set 1 fable high \+ add haiku low \+ weight 2/);
    assert.match(read('pacing', 'SETUP.md'), /the tiers \(2 to 6\)/);
    assert.match(read('pacing', 'SKILL.md'), /\*\*A `first run:` line\*\* in a script's output, and only then:/);
    assert.match(read('pacing', 'SKILL.md'), /config\.mjs" init`, and pass on what it\s+prints as it stands/);
    assert.match(read('route', 'SKILL.md'), /budget\.mjs" last --brief`/);
    // the hooks module records each finished agent; the session only where it does not run
    assert.match(read('route', 'SKILL.md'), /Without the hooks module \(no\s+pacing status line\), record each finished task: `config\.mjs agent\s+<role> <agent id> <model> <effort> <tokens>`, beside the next tool call, never alone\./);
    assert.doesNotMatch(read('route', 'SKILL.md'), /\*\*Record each finished task\*\*/);
    // the module takes the readings: no unasked reading after a big task
    assert.doesNotMatch(read('pacing', 'SKILL.md'), /after (?:a|each) big task/);
    assert.doesNotMatch(read('route', 'SKILL.md'), /after each big task/);
  });
});
