// config.mjs: the ladder commands, init and the move from the standalone
// skill, the role agents' notes (with --replace) and the handovers.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, plugin } from './helpers.mjs';

// each test gets its own home: the commands write config.json
const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };
const cfgOf = s => JSON.parse(s.read('config.json'));

describe('the ladder', () => {
  test('show creates the config from the defaults', withHome(s => {
    const r = s.config([]);
    assert.equal(r.code, 0);
    assert.match(r.out, /^config.json created from the defaults$/m);
    assert.match(r.out, /^tier 1 {2}Fable 5.2 high {7}\[fable\] {2}the session: judgment work$/m);
    assert.match(r.out, /^tier 3 {2}Sonnet 5.5 medium {4}\[sonnet\] {2}subagents: bulky output$/m);
    assert.match(r.out, /^per-model meter: Fable 5.2; when it is full: Opus 5.5 high takes tier 1$/m);
    assert.deepEqual(cfgOf(s).tiers.map(t => t.model + ' ' + t.effort), ['fable high', 'opus medium', 'sonnet medium']);
  }));
  test('json prints the config', withHome(s => {
    const c = JSON.parse(s.config(['json']).out);
    assert.equal(c.lastDayWeight, 1.5);
    assert.equal(c.premium, 'fable');
  }));
  test('set, add and remove change the tiers', withHome(s => {
    s.config(['set', '2', 'opus', 'xhigh']);
    assert.deepEqual(cfgOf(s).tiers[1], { model: 'opus', label: 'Opus 5.5', effort: 'xhigh' });
    s.config(['add', 'haiku', 'low']);
    assert.equal(cfgOf(s).tiers.length, 4);
    assert.match(s.config([]).out, /^tier 4 {2}Haiku 5.5 low .*subagents: bulky output \(lower\)$/m);
    s.config(['remove', '1']);
    assert.equal(cfgOf(s).tiers[0].model, 'opus');
  }));
  test('bad input is refused with a reason', withHome(s => {
    const cases = [
      [['set', '5', 'opus', 'high'], /tier must be 1 to 3/],
      [['set', '1', 'gpt', 'high'], /model must be one of fable, opus, sonnet, haiku/],
      [['set', '1', 'opus', 'huge'], /effort must be one of low, medium, high, xhigh, max/],
      [['weight', '4'], /weight must be a number from 1 to 3/],
      [['next', 'maybe'], /next on \| next off/],
      [['frobnicate'], /^commands: /],
    ];
    for (const [args, msg] of cases) {
      const r = s.config(args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.out, msg);
    }
  }));
  test('at most six tiers, at least two', withHome(s => {
    for (const e of ['low', 'medium', 'high']) s.config(['add', 'haiku', e]);
    assert.match(s.config(['add', 'haiku', 'max']).out, /six tiers is the most/);
    for (let i = 0; i < 4; i++) s.config(['remove', '1']);
    assert.equal(cfgOf(s).tiers.length, 2);
    assert.match(s.config(['remove', '1']).out, /two tiers must remain/);
  }));
  test('weight, next, premium and fallback', withHome(s => {
    s.config(['weight', '2']);
    s.config(['next', 'off']);
    s.config(['premium', 'opus']);
    s.config(['fallback', 'sonnet', 'high']);
    let c = cfgOf(s);
    assert.deepEqual([c.lastDayWeight, c.setNextModel, c.premium, c.fallback], [2, false, 'opus', { model: 'sonnet', effort: 'high' }]);
    s.config(['premium', 'none']);
    s.config(['fallback', 'none']);
    c = cfgOf(s);
    assert.deepEqual([c.premium, c.fallback], [null, null]);
    assert.match(s.config([]).out, /^per-model meter: none; when it is full: none \(the remaining tiers move up\)$/m);
  }));
  test('the offers to compact: on by default, off and on again, kept by reset', withHome(s => {
    s.config(['init']);
    assert.match(s.config([]).out, /^offers to compact a large session: on$/m);
    s.config(['compact', 'off']);
    assert.equal(cfgOf(s).compactAsk, false);
    assert.match(s.config([]).out, /^offers to compact a large session: off$/m);
    s.config(['reset']);
    assert.equal(cfgOf(s).compactAsk, false);
    s.config(['apply', 'compact', 'on']);
    assert.equal(cfgOf(s).compactAsk, true);
    const r = s.config(['compact', 'maybe']);
    assert.equal(r.code, 1);
    assert.match(r.out, /compact on \| compact off/);
    // a value that is no switch is dropped with a note, and the default stands
    s.writeConfig({ ...cfgOf(s), compactAsk: 'sometimes' });
    assert.match(s.config([]).out, /the offers to compact are not on or off: the default is used/);
  }));
  test('the notices about running subagents: on by default, off and on again, kept by reset', withHome(s => {
    s.config(['init']);
    assert.match(s.config([]).out, /^toasts about running subagents: on$/m);
    s.config(['notify', 'off']);
    assert.equal(cfgOf(s).agentNotices, false);
    s.config(['reset']);
    assert.equal(cfgOf(s).agentNotices, false);
    s.config(['apply', 'notify', 'on']);
    assert.equal(cfgOf(s).agentNotices, true);
    const r = s.config(['notify', 'maybe']);
    assert.equal(r.code, 1);
    assert.match(r.out, /notify on \| notify off/);
  }));
  test('reset keeps the install date, the meter and the switch', withHome(s => {
    s.writeConfig({ tiers: [{ model: 'haiku', effort: 'low' }, { model: 'haiku', effort: 'max' }], lastDayWeight: 3, setNextModel: false, premium: null, installed: '2025-01-01' });
    s.config(['reset']);
    const c = cfgOf(s);
    assert.equal(c.tiers.length, 3);
    assert.deepEqual([c.lastDayWeight, c.setNextModel, c.premium, c.installed], [1.5, false, null, '2025-01-01']);
  }));
  test('an older primary/fallback config becomes a ladder', withHome(s => {
    s.writeConfig({ primary: { model: 'opus', label: 'Opus 4', effort: 'high' }, fallback: { model: 'sonnet', label: 'Sonnet 4', effort: 'low' }, lastDayWeight: 1.5, installed: 'x' });
    assert.match(s.config([]).out, /^tier 1 {2}Opus 5.5 high/m);
    // shown as a ladder; written as one by the first command that changes a setting
    assert.equal(cfgOf(s).tiers, undefined);
    s.config(['weight', '2']);
    const c = cfgOf(s);
    assert.deepEqual(c.tiers.map(t => t.label + ' ' + t.effort), ['Opus 5.5 high', 'Sonnet 5.5 low']);
    assert.equal(c.primary, undefined);
  }));
  test('version reads the manifest; where names the data folder', withHome(s => {
    const v = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    assert.equal(s.config(['version']).out.trim(), v);
    assert.equal(s.config(['where']).out.trim(), s.data);
  }));
});

describe('init', () => {
  test('creates the folder, the config and BRIEF.local.md; then says exists', withHome(s => {
    const r = s.config(['init']);
    // sentences the session passes on as they stand, and the short help once
    assert.match(r.out, /^created: pacing is set up in .*\. The short help, shown once:$/m);
    assert.match(r.out, /^Pacing, the short help /m);
    assert.match(r.out, /^BRIEF.local.md created in .*: your own rules for subagents go there\.$/m);
    assert.ok(s.exists('config.json') && s.exists('BRIEF.local.md'));
    const again = s.config(['init']);
    assert.equal(again.out.trim(), 'exists');
  }));
  test('takes over the standalone skill\'s files, leaving the originals', withHome(s => {
    const legacy = path.join(s.home, '.claude', 'skills', 'pacing');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ tiers: [{ model: 'opus', effort: 'max' }, { model: 'sonnet', effort: 'low' }], lastDayWeight: 2, installed: '2025-06-01' }));
    fs.writeFileSync(path.join(legacy, 'log.jsonl'), '{"t":"2026-01-01T00:00:00Z","all":1}\n');
    const r = s.config(['init']);
    assert.match(r.out, /^migrated config.json, log.jsonl from .*: the earlier standalone skill's files were taken over \(the originals are still there\)\.$/m);
    assert.equal(cfgOf(s).lastDayWeight, 2);
    assert.ok(s.exists('log.jsonl'));
    assert.ok(fs.existsSync(path.join(legacy, 'config.json')));
  }));
  test('takes over only what the data folder lacks: readings the plugin logged before its first run stay', withHome(s => {
    const legacy = path.join(s.home, '.claude', 'skills', 'pacing');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ tiers: [{ model: 'opus', effort: 'max' }, { model: 'sonnet', effort: 'low' }], lastDayWeight: 2, installed: '2025-06-01' }));
    fs.writeFileSync(path.join(legacy, 'log.jsonl'), '{"t":"2026-01-01T00:00:00Z","all":1}\n');
    fs.writeFileSync(path.join(legacy, 'state.json'), '{"t":"2026-01-01T00:00:00Z","all":1}\n');
    fs.writeFileSync(path.join(legacy, 'BRIEF.local.md'), 'the old rules\n');
    // the plugin took readings with no config.json yet
    const log = '{"t":"2026-11-13T12:00:00Z","all":10}\n{"t":"2026-11-13T13:00:00Z","all":11}\n', state = '{"t":"2026-11-13T13:00:00Z","all":11}\n';
    s.write('log.jsonl', log);
    s.write('state.json', state);
    const r = s.config(['init']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^migrated config\.json, BRIEF\.local\.md from .*: the earlier standalone skill's files were taken over \(the originals are still there\)\.$/m);
    assert.deepEqual([s.read('log.jsonl'), s.read('state.json'), s.read('BRIEF.local.md')], [log, state, 'the old rules\n']);
    assert.equal(cfgOf(s).lastDayWeight, 2);
    assert.doesNotMatch(r.out, /BRIEF\.local\.md created/);
  }));
  test('with every file there already but the config, nothing is taken over and nothing is said of it', withHome(s => {
    const legacy = path.join(s.home, '.claude', 'skills', 'pacing');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'log.jsonl'), 'old\n');
    s.write('log.jsonl', 'new\n');
    const r = s.config(['init']);
    assert.doesNotMatch(r.out, /migrated/);
    assert.match(r.out, /^created: pacing is set up in /m);
    assert.equal(s.read('log.jsonl'), 'new\n');
  }));
});

describe('a config.json that needs a repair', () => {
  // as an older installed copy reads a file a newer one wrote: a tier on a
  // model it does not know
  const NEWER = { tiers: [{ model: 'mythos', label: 'Mythos 1', effort: 'high' }, { model: 'opus', label: 'Opus 5.5', effort: 'medium' }, { model: 'sonnet', label: 'Sonnet 5.5', effort: 'low' }],
    lastDayWeight: 1.5, installed: '2026-01-01' };
  test('commands that read or record leave the file as it is, and say what they found', withHome(s => {
    const text = JSON.stringify(NEWER, null, 2) + '\n';
    s.write('config.json', text);
    const note = /^config\.json: 1 tier without a known model and effort: dropped$/m;
    for (const cmd of [['show'], [], ['json'], ['init'], ['agent', 'reader', 'a1', 'haiku', 'medium', '40000'], ['note', 'reader', 'a fact'], ['notes'], ['agents'], ['handover'],
      ['apply', 'agent', 'reader', 'a2', 'haiku', 'medium', '1k', '+', 'note', 'reader', 'another fact']]) {
      const r = s.config(cmd);
      assert.equal(r.code, 0, cmd.join(' ') + ': ' + r.out + r.err);
      assert.equal(s.read('config.json'), text, cmd.join(' '));
    }
    // shown from the tiers that stand, with the note each time
    const shown = s.config(['show']).out;
    assert.match(shown, /^tier 1 {2}Opus 5\.5 medium/m);
    assert.match(shown, note);
    assert.match(s.config(['show']).out, note);
    // with only one known tier left, the defaults are shown and the file still keeps the user's
    const one = JSON.stringify({ ...NEWER, tiers: NEWER.tiers.slice(0, 2) }, null, 2) + '\n';
    s.write('config.json', one);
    assert.match(s.config(['agent', 'reader', 'a3', 'haiku', 'medium', '1k']).out, /fewer than two tiers: the default ladder is used/);
    assert.equal(s.read('config.json'), one);
  }));
  test('a command that changes a setting writes the repair with its change; then nothing is left to say', withHome(s => {
    s.writeConfig({ ...NEWER, lastDayWeight: 0 });
    const r = s.config(['next', 'off']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^config\.json: 1 tier without a known model and effort: dropped; the last-day weight is not a number from 1 to 3: the default is used$/m);
    const c = cfgOf(s);
    assert.deepEqual([c.tiers.map(t => t.model), c.lastDayWeight, c.setNextModel], [['opus', 'sonnet'], 1.5, false]);
    assert.doesNotMatch(s.config(['show']).out, /^config\.json:/m);
  }));
});

describe('apply and the flags of its commands', () => {
  const slug = p => p.split(/[^A-Za-z0-9._ -]+/).filter(Boolean).join('-');
  const facts = (s, role, project = s.project) => fs.readFileSync(s.file('notes', slug(project), role + '.md'), 'utf8').split(/\r?\n/).filter(l => l.startsWith('- ')).map(l => l.replace(/^- | \(\d{4}-\d{2}-\d{2}\)$/g, ''));
  const runs = (s, project) => { const f = s.file('agents', slug(project) + '.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l).id) : []; };
  const other = s => { const o = path.join(s.home, 'other'); fs.mkdirSync(path.join(o, '.git'), { recursive: true }); return o; };
  test('a note\'s --replace puts the fact in the stale line\'s place, and stays with its own note', withHome(s => {
    s.config(['note', 'reader', 'Build with make all.']);
    s.config(['note', 'reader', 'Lint with eslint.']);
    const r = s.config(['apply', 'note', 'reader', '--replace', 'make all', 'Build with npm run build.', '+', 'note', 'reader', 'Tests live in tests/.', '+', 'agent', 'reader', 'a1', 'haiku', 'medium', '14000']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^replaced in .*reader\.md \(2 lines\)\nnoted in .*reader\.md \(3 lines\)\nrecorded: reader a1, task 1, 14k tokens$/m);
    assert.deepEqual(facts(s, 'reader'), ['Build with npm run build.', 'Lint with eslint.', 'Tests live in tests/.']);
    // a refusal of the replace stops the run, as any refused command does
    const bad = s.config(['apply', 'note', 'reader', '--replace', 'gradle', 'z', '+', 'note', 'reader', 'never added']);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /no line holds "gradle"/);
    assert.equal(facts(s, 'reader').length, 3);
  }));
  test('--project reaches the command it is given with, and every command of the run that names none', withHome(s => {
    const o = other(s);
    const r = s.config(['apply', 'agent', 'reader', 'a1', 'haiku', 'medium', '14000', '--project', o]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual([runs(s, o), runs(s, s.project)], [['a1'], []]);
    // one --project for the run, on its last command
    const all = s.config(['apply', 'agent', 'verifier', 'b2', 'haiku', 'medium', '9000', '+', 'note', 'verifier', 'a fact there', '+', 'weight', '2', '+', 'agent', 'reader', 'a3', 'haiku', 'medium', '1k', '--project', o]);
    assert.equal(all.code, 0, all.out + all.err);
    assert.deepEqual([runs(s, o), runs(s, s.project)], [['a1', 'b2', 'a3'], []]);
    assert.deepEqual(facts(s, 'verifier', o), ['a fact there']);
    assert.equal(cfgOf(s).lastDayWeight, 2);
    assert.equal(all.out.match(/^tier 1 /gm).length, 1);
    // before `apply`, and a command that names its own
    const mixed = s.config(['--project', o, 'apply', 'agent', 'reader', 'a4', 'haiku', 'medium', '1k', '+', 'agent', 'reader', 'h1', 'haiku', 'medium', '1k', '--project', s.project], { cwd: s.home });
    assert.equal(mixed.code, 0, mixed.out + mixed.err);
    assert.deepEqual([runs(s, o), runs(s, s.project)], [['a1', 'b2', 'a3', 'a4'], ['h1']]);
    // only the flags: no command
    const none = s.config(['apply', '--project', o]);
    assert.equal(none.code, 1);
    assert.match(none.out, /^apply takes .*; not --project /);
  }));
});

describe('notes', () => {
  test('notes lists the four roles for the project', withHome(s => {
    const out = s.config(['notes']).out;
    assert.match(out, new RegExp('^notes for ' + s.project.replace(/[\\.]/g, '\\$&') + ': ', 'm'));
    for (const r of ['reader', 'implementer', 'verifier', 'researcher']) assert.match(out, new RegExp('^  ' + r + ' +none yet', 'm'));
  }));
  test('note adds a dated line, once', withHome(s => {
    const r = s.config(['note', 'reader', 'Tests live in tests/.']);
    assert.match(r.out, /^noted in .*reader.md \(1 lines\)$/m);
    assert.match(s.config(['note', 'reader', 'Tests', 'live in', 'tests/.']).out, /^already noted$/m);
    const f = r.out.match(/^noted in (.*) \(/m)[1];
    const text = fs.readFileSync(f, 'utf8');
    assert.match(text, /^# reader notes for /);
    assert.match(text, /^- Tests live in tests\/\. \(\d{4}-\d{2}-\d{2}\)$/m);
    assert.match(s.config(['notes']).out, /^ {2}reader +1 lines/m);
  }));
  test('the project is found from a subfolder, or named with --project', withHome(s => {
    const sub = path.join(s.project, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const a = s.config(['note', 'verifier', 'fact one'], { cwd: sub }).out;
    const b = s.config(['note', 'verifier', 'fact two', '--project', sub], { cwd: s.home }).out;
    assert.equal(a.match(/in (.*) \(/)[1], b.match(/in (.*) \(/)[1]);
    assert.match(b, /\(2 lines\)/);
  }));
  test('a role that is not one of the four, an empty fact, a long fact', withHome(s => {
    assert.match(s.config(['note', 'writer', 'x']).out, /role must be one of reader, implementer, verifier, researcher/);
    assert.match(s.config(['note', 'reader']).out, /^usage: note <role>/m);
    const r = s.config(['note', 'reader', 'x'.repeat(301)]);
    assert.equal(r.code, 1);
    assert.match(r.out, /at most 300 characters \(this one has 301\)/);
  }));
  test('--replace puts the fact in the place of the one stale line', withHome(s => {
    s.config(['note', 'implementer', 'Build with make all.']);
    s.config(['note', 'implementer', 'Lint with eslint.']);
    const r = s.config(['note', 'implementer', '--replace', 'MAKE ALL', 'Build with npm run build.']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^replaced in .*implementer.md \(2 lines\)$/m);
    const text = fs.readFileSync(r.out.match(/^replaced in (.*) \(/m)[1], 'utf8');
    assert.doesNotMatch(text, /make all/);
    // the new fact keeps the old line's place, before the lint line
    assert.ok(text.indexOf('npm run build') < text.indexOf('eslint'));
    assert.ok(text.endsWith('\n'));
  }));
  test('--replace refuses when no line or several lines match', withHome(s => {
    assert.match(s.config(['note', 'reader', '--replace', 'x', 'y']).out, /no notes yet in .*: nothing to replace/);
    s.config(['note', 'reader', 'Build A with make.']);
    s.config(['note', 'reader', 'Build B with make.']);
    assert.match(s.config(['note', 'reader', '--replace', 'with make', 'z']).out, /2 lines hold "with make": give more/);
    assert.match(s.config(['note', 'reader', '--replace', 'gradle', 'z']).out, /no line holds "gradle"/);
    assert.match(s.config(['note', 'reader', '--replace', '', 'z']).out, /^usage: note <role> --replace/m);
  }));
  test('the headings of a notes file are never taken for a line to replace', withHome(s => {
    s.config(['note', 'reader', 'one fact']);
    // "reader notes for" is in the file's title line, not in a fact
    assert.match(s.config(['note', 'reader', '--replace', 'reader notes for', 'z']).out, /no line holds/);
  }));
});

describe('handover', () => {
  test('new names a dated file in the project\'s folder and the headings', withHome(s => {
    const r = s.config(['handover', 'new']);
    const f = r.out.match(/^write the handover to: (.*)$/m)[1];
    assert.equal(path.dirname(f), path.join(s.data, 'handover', s.project.split(/[^A-Za-z0-9._ -]+/).filter(Boolean).join('-')));
    assert.match(path.basename(f), /^\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
    assert.match(r.out, /^headings: Goal \| State: done, verified, not verified \| Decisions and why \| Open items, in order \| Files and commands \| Ruled out and traps$/m);
    // the file is not written by the script; a second one in the same minute gets -2
    fs.writeFileSync(f, '# h\n');
    assert.match(s.config(['handover', 'new']).out, /-2\.md$/m);
  }));
  test('the list, then done files it away into done/', withHome(s => {
    assert.match(s.config(['handover']).out, /^no handover is waiting for /);
    const f = s.config(['handover', 'new']).out.match(/to: (.*)$/m)[1];
    fs.writeFileSync(f, '# h\n');
    assert.match(s.config(['handover']).out, /^waiting for .*:\n {2}.*\.md {2}\(under an hour ago\)$/m);
    const done = s.config(['handover', 'done']);
    assert.match(done.out, /^picked up: .*\.md \(kept in .*done\)$/m);
    assert.ok(!fs.existsSync(f));
    assert.ok(fs.existsSync(path.join(path.dirname(f), 'done', path.basename(f))));
    assert.match(s.config(['handover', 'done']).out, /^no handover is waiting for /);
  }));
  test('done with a name files away only that one', withHome(s => {
    const dir = path.dirname(s.config(['handover', 'new']).out.match(/to: (.*)$/m)[1]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-01-01-0900.md'), 'a');
    fs.writeFileSync(path.join(dir, '2026-01-02-0900.md'), 'b');
    assert.match(s.config(['handover', 'done', '2026-01-01-0900.md']).out, /^picked up: 2026-01-01-0900.md/m);
    assert.match(s.config(['handover', 'done', 'nope.md']).out, /^no waiting handover named nope.md$/m);
    assert.match(s.config(['handover', 'done', path.join(dir, '2026-01-02-0900.md')]).out, /^picked up: 2026-01-02-0900.md/m);
  }));
  test('an unknown sub-command is refused', withHome(s => {
    const r = s.config(['handover', 'old']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^usage: handover/);
  }));
});

describe('kept agents', () => {
  test('agent records a task; the first record of an id is fresh, later ones resumed', withHome(s => {
    assert.match(s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '40000']).out, /^recorded: reader a1, task 1, 40k tokens$/m);
    assert.match(s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '52.5k']).out, /^recorded: reader a1, task 2, 53k tokens$/m);
    const f = s.file('agents', s.project.split(/[^A-Za-z0-9._ -]+/).filter(Boolean).join('-') + '.jsonl');
    const runs = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(runs.map(r => [r.role, r.id, r.model, r.effort, r.tokens, r.resumed]),
      [['reader', 'a1', 'haiku', 'medium', 40000, false], ['reader', 'a1', 'haiku', 'medium', 52500, true]]);
    assert.ok(runs.every(r => !('spent' in r)), 'a record without --spent carries none');
  }));
  test('agent --spent keeps what the task spent; a bad split is left out', withHome(s => {
    assert.match(s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '40000', '--spent', '1200,800,350000,9000']).out, /^recorded: reader a1, task 1, 40k tokens$/m);
    assert.match(s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '--spent', '0,0,0,0', '41000']).out, /^recorded: reader a1, task 2, 41k tokens$/m);
    for (const bad of ['1,2,3', '1,2,3,-4', '1,2,x,4', '1.5,2,3,4']) assert.equal(s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '42000', '--spent', bad]).code, 0);
    const f = s.file('agents', s.project.split(/[^A-Za-z0-9._ -]+/).filter(Boolean).join('-') + '.jsonl');
    const runs = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(runs.map(r => r.spent), [{ in: 1200, out: 800, read: 350000, write: 9000 }, { in: 0, out: 0, read: 0, write: 0 }, undefined, undefined, undefined, undefined]);
    assert.ok(runs.every(r => r.tokens >= 40000));
  }));
  test('the fifth task or 150k tokens says the next task goes to a fresh agent', withHome(s => {
    for (let i = 1; i <= 4; i++) assert.doesNotMatch(s.config(['agent', 'verifier', 'v1', 'sonnet', 'medium', '10k']).out, /fresh/);
    assert.match(s.config(['agent', 'verifier', 'v1', 'sonnet', 'medium', '10k']).out, /task 5, .*the next verifier task goes to a fresh agent/);
    assert.match(s.config(['agent', 'implementer', 'i1', 'opus', 'high', '150000']).out, /task 1, 150k tokens; the next implementer task goes to a fresh agent/);
  }));
  test('agents lists the latest of each role and the totals by role and model', withHome(s => {
    assert.match(s.config(['agents']).out, /^no role agent recorded for /);
    s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '40k']);
    s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '60k']);
    s.config(['agent', 'reader', 'a2', 'haiku', 'medium', '30k']);
    s.config(['agent', 'implementer', 'i1', 'opus', 'medium', '90k']);
    const out = s.config(['agents']).out;
    assert.match(out, /^kept agents for .* \(the latest of each role, last 24 h\):$/m);
    assert.match(out, /^ {2}reader {6}a2 {2}Haiku 5.5 medium, 1 task, 30k tokens last, 0 min ago$/m);
    assert.match(out, /^ {2}implementer i1 {2}Opus 5.5 medium, 1 task, 90k tokens last/m);
    assert.match(out, /^ {2}verifier {4}none$/m);
    assert.match(out, /^ {2}role +model +runs +fresh +resumed +tokens +avg fresh +avg resumed$/m);
    assert.match(out, /^ {2}reader +Haiku 5.5 medium +3 +2 +1 +130k +35k +60k$/m);
    assert.match(out, /^ {2}implementer +Opus 5.5 medium +1 +1 +0 +90k +90k +-$/m);
  }));
  test('bad input is refused', withHome(s => {
    assert.match(s.config(['agent', 'boss', 'x', 'opus', 'high', '1']).out, /role must be one of/);
    assert.match(s.config(['agent', 'reader', 'x', 'opus', 'high']).out, /^usage: agent /);
    assert.match(s.config(['agent', 'reader', 'x', 'gpt', 'high', '1']).out, /model must be one of/);
    assert.match(s.config(['agent', 'reader', 'x', 'opus', 'high', 'lots']).out, /tokens must be a number/);
  }));
  test('each project has its own record', withHome(s => {
    s.config(['agent', 'reader', 'a1', 'haiku', 'medium', '1k']);
    const other = path.join(s.home, 'other');
    fs.mkdirSync(path.join(other, '.git'), { recursive: true });
    assert.match(s.config(['agents', '--project', other]).out, /^no role agent recorded for /);
  }));
});

describe('the reader setting', () => {
  test('Haiku 5.5 medium by default; a model and effort, or ladder', withHome(s => {
    assert.match(s.config([]).out, /^reader agent: Haiku 5.5 medium \(bulky reading\)$/m);
    s.config(['reader', 'sonnet', 'low']);
    assert.deepEqual(cfgOf(s).reader, { model: 'sonnet', effort: 'low' });
    assert.match(s.config(['reader', 'ladder']).out, /^reader agent: the lowest tier/m);
    assert.equal(cfgOf(s).reader, 'ladder');
    assert.match(s.config(['reader', 'gpt', 'low']).out, /model must be one of/);
    s.config(['reset']);
    assert.deepEqual(cfgOf(s).reader, { model: 'haiku', effort: 'medium' });
  }));
});

test('verifier: a model of its own for plain runs, or the ladder', () => {
  const s = sandbox();
  try {
    assert.match(s.config(['show']).out, /^verifier agent: Haiku 5\.5 medium \(plain test runs; checks to judge: the lowest tier\)$/m);
    assert.match(s.config(['verifier', 'sonnet', 'low']).out, /^verifier agent: Sonnet 5\.5 low/m);
    assert.deepEqual(JSON.parse(s.read('config.json')).verifier, { model: 'sonnet', effort: 'low' });
    assert.match(s.config(['verifier', 'ladder']).out, /^verifier agent: the lowest tier/m);
    assert.equal(s.config(['verifier', 'gpt', 'low']).code, 1);
    assert.match(s.config(['reset']).out, /^verifier agent: Haiku 5\.5 medium/m);
  } finally { s.cleanup(); }
});

describe('the offer to switch', () => {
  test('on by default, off and on again, kept by reset, a bad value refused', () => {
    const s = sandbox();
    try {
      s.config(['init']);
      assert.match(s.config([]).out, /^offers to switch this session to the recommended model or effort: on$/m);
      s.config(['switch', 'off']);
      assert.equal(JSON.parse(s.read('config.json')).switchAsk, false);
      s.config(['reset']);
      assert.equal(JSON.parse(s.read('config.json')).switchAsk, false);
      s.config(['apply', 'switch', 'on']);
      assert.equal(JSON.parse(s.read('config.json')).switchAsk, true);
      const r = s.config(['switch', 'maybe']);
      assert.equal(r.code, 1);
      assert.match(r.out, /switch on \| switch off/);
    } finally { s.cleanup(); }
  });
});

describe('the panel of the running agents, removed', () => {
  test('an old config.json with agentsPanel loads without a word; panel is no command, and the guide no longer names it', withHome(s => {
    s.config(['init']);
    assert.equal(cfgOf(s).agentsPanel, undefined);
    for (const old of ['off', 'auto', true]) {
      s.writeConfig({ ...cfgOf(s), agentsPanel: old });
      const out = s.config([]).out;
      assert.doesNotMatch(out, /panel|config\.json: /i, String(old));
    }
    const r = s.config(['panel', 'off']);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.out, /panel auto/);
    const guide = fs.readFileSync(path.join(plugin, 'skills', 'pacing', 'GUIDE.md'), 'utf8');
    assert.ok(!guide.includes('/pacing-agents'));
    assert.ok(!guide.includes('/pacing panel'));
  }));
});

describe('the reload at a new version', () => {
  test('on by default, off and on again, kept by reset, a bad value refused or dropped', () => {
    const s = sandbox();
    try {
      s.config(['init']);
      assert.match(s.config([]).out, /^New-version row above the prompt \(off: one toast per version instead\): on$/m);
      s.config(['reload', 'off']);
      assert.equal(JSON.parse(s.read('config.json')).autoReload, false);
      assert.match(s.config([]).out, /^New-version row above the prompt \(off: one toast per version instead\): off$/m);
      s.config(['reset']);
      assert.equal(JSON.parse(s.read('config.json')).autoReload, false);
      s.config(['apply', 'reload', 'on']);
      assert.equal(JSON.parse(s.read('config.json')).autoReload, true);
      const r = s.config(['reload', 'maybe']);
      assert.equal(r.code, 1);
      assert.match(r.out, /reload on \| reload off/);
      // a value that is no switch is dropped with a note, and the default stands
      s.writeConfig({ ...JSON.parse(s.read('config.json')), autoReload: 'sometimes' });
      assert.match(s.config([]).out, /the reload at a new version is not on or off: the default is used/);
    } finally { s.cleanup(); }
  });
  test('the guide says what it does, in the module\'s own words', () => {
    const guide = fs.readFileSync(path.join(plugin, 'skills', 'pacing', 'GUIDE.md'), 'utf8').replace(/\s+/g, ' ');
    // a toast leads with the icon of its kind where "Pacing: " stood
    assert.ok(guide.includes('`📦 Pacing 0.9.16 is installed: type /reload-plugins to load it, or open a new session.`'));
    assert.ok(guide.includes('`/pacing reload off` turns the row off'));
    // no Reload button any more, nothing the plugin runs or fills
    assert.ok(!guide.includes('**Reload**'));
    assert.ok(!guide.includes('🔄'));
  });
});
