// The role agents: one file per role config.mjs knows. Each starts with one
// call, `config.mjs start <role>`, which prints BRIEF.md's standing rules, the
// notes commands for its own role, its notes and the user's BRIEF.local.md for
// the project; its own file keeps the rules that must hold if that call fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plugin, scripts, sandbox } from './helpers.mjs';

const agentsDir = path.join(plugin, 'agents');
const flat = t => t.replace(/\s+/g, ' ');
const words = t => t.split(/\s+/).filter(Boolean).length;
const roles = JSON.parse(fs.readFileSync(path.join(scripts, 'config.mjs'), 'utf8').match(/const ROLES = (\[.*?\]);/)[1].replace(/'/g, '"'));
const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort();
const agent = r => {
  const text = fs.readFileSync(path.join(agentsDir, r + '.md'), 'utf8');
  // a checkout with CRLF line ends reads the same
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const field = k => (front[1].match(new RegExp('^' + k + ': (.*)$', 'm')) || [])[1];
  const own = text.slice(front[0].length);
  return { text, own, body: flat(own), name: field('name'), tools: (field('tools') || '').split(/,\s*/), description: field('description') };
};
const brief = flat(fs.readFileSync(path.join(plugin, 'skills', 'pacing', 'BRIEF.md'), 'utf8'));
const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };

test('one agent file per role, and no other', () => {
  assert.deepEqual(files, roles.map(r => r + '.md').sort());
});

// the rules BRIEF.md section 1 gives every subagent
const CORE = [
  'Work only inside the project folder named in the task. Never touch any other folder or repository',
  'Never commit, push, tag or publish unless the task says so.',
  'Never enter or repeat credentials.',
  'Never delete data',
  'Report faithfully',
];
test('BRIEF.md still holds the core rules', () => {
  for (const rule of CORE) assert.ok(brief.includes(rule), rule);
});

for (const r of roles) {
  test(r + ': name, a description that says when to use it, and one start-up call', () => {
    const a = agent(r);
    assert.equal(a.name, r);
    assert.match(a.description, /^"Pacing role agent/);
    assert.doesNotMatch(a.description, /keeps one for the whole session/);
    assert.ok(a.body.includes('config.mjs" start ' + r + ' --project "<project folder>"'), 'the start-up call');
    assert.match(a.body, /If it fails, go on under the rules here/);
    // what the start-up call prints is not repeated here
    for (const gone of ['## Standing rules', 'config.mjs" notes', 'BRIEF.local.md', 'config.mjs" note ', 'Re-check a figure']) assert.ok(!a.body.includes(gone), r + ' still holds: ' + gone);
  });
  test(r + ': the rules that hold even when the start-up call fails', () => {
    const a = agent(r);
    if (r === 'implementer') assert.ok(a.body.includes('Never commit, push, tag or publish unless the task says so.'));
    else {
      assert.match(a.body, /change nothing: no edits, .*no git command that changes state; never commit, push, tag or publish/);
    }
    assert.match(a.body, /important content itself/);
  });
  test(r + ': only the implementer may edit files', () => {
    const edits = agent(r).tools.some(t => ['Edit', 'Write', 'NotebookEdit'].includes(t));
    assert.equal(edits, r === 'implementer');
  });
  test(r + ': start prints the rules, the notes commands for its role, its notes and the progress command', withHome(s => {
    s.config(['note', r, 'the suite takes 4 s', '--project', s.project]);
    const res = s.config(['start', r, '--project', s.project]);
    assert.equal(res.code, 0, res.out);
    const out = flat(res.out);
    assert.ok(out.startsWith('Pacing start-up for the ' + r + ', project ' + s.project + '. Follow all of it; the project\'s own CLAUDE.md rules come first.'), out.slice(0, 120));
    for (const rule of CORE) assert.ok(out.includes(rule), rule);
    const self = path.join(scripts, 'config.mjs').replace(/\\/g, '/');
    assert.ok(out.includes('node "' + self + '" note ' + r + ' --project "' + s.project + '" "<one fact'), 'note');
    assert.ok(out.includes('node "' + self + '" note ' + r + ' --project "' + s.project + '" --replace "'), 'replace');
    assert.ok(out.includes('node "' + self + '" part 0 <total>'), 'part');
    assert.ok(out.includes('not line numbers or counts'), 'keeps counts out of notes');
    assert.ok(out.includes('Re-check a figure you quote from an earlier task'));
    // updates: one per finished part, and on a long task one at least every ten minutes
    assert.ok(out.includes('send the session a short update with SendMessage to "main" when each part is done'), 'an update per part');
    assert.ok(out.includes('On a long task, send one at least every ten minutes while you work, even mid-part, in a few lines (what is done, what you are on, what passes); never stop work to write a long one.'), 'the ten-minute rule');
    assert.match(out, /Your notes \(.*\): - the suite takes 4 s \(\d{4}-\d{2}-\d{2}\)/);
    assert.doesNotMatch(out, /<role>|<project folder>|\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.equal(s.exists('config.json'), false, 'start writes no settings');
  }));
}

test('start without a role is the brief for a general-purpose agent: no notes, no role commands', withHome(s => {
  const out = s.config(['start', '--project', s.project]).out;
  assert.match(out, /^Pacing brief for a subagent, project /);
  for (const rule of CORE) assert.ok(flat(out).includes(rule), rule);
  // the time rule for updates is every subagent's, not the role agents' alone
  assert.ok(flat(out).includes('On a long task, send one at least every ten minutes while you work, even mid-part'), 'the ten-minute rule');
  assert.doesNotMatch(out, /Your notes|config\.mjs" note |part 0/);
  assert.match(out, /^BRIEF\.local\.md: none \(/m);
  const bad = s.config(['start', 'boss']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^usage: start \[<role>\] --project "<project folder>"; role: reader, implementer, verifier, researcher$/m);
}));

test('start gives the user\'s general additions and this project\'s block, never another project\'s', withHome(s => {
  const other = path.join(s.home, 'work', 'other');
  s.write('BRIEF.local.md', ['# Local brief', '', 'intro', '', '## General additions', '', '```', '- Never translate "CloudBackend PaaS".', '```', '',
    '## Project blocks', '', '### ' + s.project, '', '```', 'Project rules (' + s.project + '):', '- Tests use ?dryrun=1.', '```', '',
    '### ' + other, '', '```', 'Project rules (' + other + '):', '- Secret of the other project.', '```', ''].join('\n'));
  const out = s.config(['start', 'verifier', '--project', s.project]).out;
  assert.match(out, /Never translate "CloudBackend PaaS"\./);
  assert.match(out, /Tests use \?dryrun=1\./);
  assert.doesNotMatch(out, /Secret of the other project/);
  assert.doesNotMatch(out, /^intro$/m);
  // a folder inside the project gets the project's block
  const sub = path.join(s.project, 'src');
  fs.mkdirSync(sub);
  assert.match(s.config(['start', 'reader', '--project', sub]).out, /Tests use \?dryrun=1\./);
  // the other project sees its own block, and the general additions
  fs.mkdirSync(path.join(other, '.git'), { recursive: true });
  const theirs = s.config(['start', 'reader', '--project', other]).out;
  assert.match(theirs, /Secret of the other project/);
  assert.doesNotMatch(theirs, /dryrun/);
}));

test('start says when BRIEF.local.md holds no rules for the project: the template as created', withHome(s => {
  s.config(['init']);
  assert.match(s.config(['start', 'reader', '--project', s.project]).out, /^BRIEF\.local\.md: no rules for this project \(/m);
}));

test('part prints one line and writes nothing; a bad call prints one line of usage', withHome(s => {
  for (const [args, want] of [[['2', '4'], 'part 2 of 4'], [['0', '3'], 'part 0 of 3'], [['3', '3'], 'part 3 of 3']]) {
    const r = s.config(['part', ...args]);
    assert.equal(r.code, 0);
    assert.equal(r.out, want + '\n');
  }
  for (const bad of [[], ['2'], ['5', '4'], ['1', '0'], ['-1', '4'], ['1.5', '4'], ['a', 'b'], ['1', '2', '3']]) {
    const r = s.config(['part', ...bad]);
    assert.equal(r.code, 1, bad.join(' '));
    assert.equal(r.out.trim().split('\n').length, 1, bad.join(' '));
    assert.match(r.out, /^usage: part <done> <total>/);
  }
  assert.equal(fs.existsSync(s.data), false, 'nothing written');
}));

// each agent body is read at every agent start: it may not grow back unseen
const BODY_WORDS = 360;
const DESCRIPTION_CHARS = 260;
for (const r of roles) {
  test(r + ': the body stays under ' + BODY_WORDS + ' words and the description under ' + DESCRIPTION_CHARS + ' characters', () => {
    const a = agent(r);
    assert.ok(words(a.own) <= BODY_WORDS, r + ': ' + words(a.own) + ' words');
    assert.ok(a.description.length <= DESCRIPTION_CHARS, r + ': ' + a.description.length + ' characters');
  });
}
