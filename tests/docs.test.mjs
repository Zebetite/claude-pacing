// The words match the scripts: every command a user can give is in SKILL.md's
// arguments and GUIDE.md's command table, and every file SKILL.md sends the
// session to exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plugin, scripts } from './helpers.mjs';

const skillDir = path.join(plugin, 'skills', 'pacing');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
// the routing rules, loaded only when work is delegated
const routeDir = path.join(plugin, 'skills', 'route');
const route = fs.readFileSync(path.join(routeDir, 'SKILL.md'), 'utf8');
const words = t => t.split(/\s+/).filter(Boolean).length;
const descriptionOf = t => t.match(/^description: (.*)$/m)[1];
const guide = fs.readFileSync(path.join(skillDir, 'GUIDE.md'), 'utf8');
const config = fs.readFileSync(path.join(scripts, 'config.mjs'), 'utf8');

// the commands config.mjs answers to, from its "commands:" message
const commands = config.match(/fail\('commands: (.*)'\);/)[1].split(' | ').map(c => c.split(' ')[0]);
// those the session or the agents run for themselves, not the user
const INTERNAL = ['show', 'json', 'init', 'where', 'note', 'agent', 'apply', 'start', 'part'];
const userCommands = commands.filter(c => !INTERNAL.includes(c));

test('config.mjs\'s command list is read', () => {
  assert.ok(userCommands.includes('set') && userCommands.includes('handover'), userCommands.join(' '));
});
// a typed subcommand invokes the skill anyway: the description says which
// plain words should pick it, not the list of commands
for (const c of userCommands) {
  test('`' + c + '` is in SKILL.md\'s arguments and in GUIDE.md', () => {
    const args = skill.slice(skill.indexOf('## 0. Arguments'), skill.indexOf('## 1. Measure'));
    assert.ok(args.includes('`' + c), 'arguments');
    assert.ok(guide.includes('`/pacing ' + c), 'GUIDE.md');
  });
}

for (const [name, text, dir] of [['pacing', skill, skillDir], ['route', route, routeDir]]) {
  test('every file the ' + name + ' skill names exists', () => {
    const named = [...text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g)].map(m => path.join(dir, m[1]));
    // a bare file name is one of the pacing skill's files
    const bare = [...text.matchAll(/\b([A-Z]+\.md)\b/g)].map(m => m[1])
      .filter(f => !['SKILL.md', 'CLAUDE.md'].includes(f) && !f.endsWith('.local.md')).map(f => path.join(skillDir, f));
    assert.ok(named.length > 0);
    for (const f of [...named, ...bare]) assert.ok(fs.existsSync(f), f);
  });
}

test('budget.mjs\'s flags in SKILL.md\'s Measure command are all known to the script', () => {
  const budget = fs.readFileSync(path.join(scripts, 'budget.mjs'), 'utf8');
  const known = JSON.parse(budget.match(/const KNOWN = (\[.*?\]);/)[1].replace(/'/g, '"'));
  const line = skill.match(/^node "\$\{CLAUDE_SKILL_DIR\}\/scripts\/budget.mjs" --all .*$/m)[0];
  for (const f of line.match(/--[a-z-]+/g)) assert.ok(known.includes(f.slice(2)), f);
});

// a plain `usage` loads only the pacing skill; delegating work loads the
// route skill too, once per session; the descriptions go out on every turn
// of every session. The limits are the sizes of 0.9.12 and a small margin,
// so that later edits cannot grow them back unnoticed.
const bodyOf = t => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const LIMITS = { pacingWords: 960, routeWords: 1100, pacingChars: 300, routeChars: 340 };
test('each skill body stays lean: pacing ' + LIMITS.pacingWords + ' words, route ' + LIMITS.routeWords + ' at most', () => {
  assert.ok(words(bodyOf(skill)) <= LIMITS.pacingWords, 'pacing: ' + words(bodyOf(skill)) + ' words');
  assert.ok(words(bodyOf(route)) <= LIMITS.routeWords, 'route: ' + words(bodyOf(route)) + ' words');
});
test('each skill description stays short, and says what plain words pick the pacing skill', () => {
  assert.ok(descriptionOf(skill).length <= LIMITS.pacingChars, 'pacing: ' + descriptionOf(skill).length + ' characters');
  assert.ok(descriptionOf(route).length <= LIMITS.routeChars, 'route: ' + descriptionOf(route).length + ' characters');
  for (const w of ['usage', 'allowance', 'which model', 'throttling']) assert.ok(descriptionOf(skill).includes(w), w);
});

test('the two skills answer to different words: reports and settings, and delegation', () => {
  assert.match(route, /^name: route$/m);
  assert.doesNotMatch(descriptionOf(route), /usage|setup|help/);
  assert.match(descriptionOf(route), /delegation/);
  assert.match(descriptionOf(skill), /`pacing:route`/);
  // the listing's cap per description
  for (const d of [descriptionOf(skill), descriptionOf(route)]) assert.ok(d.length <= 1536, d.length + ' characters');
  // each rule lives in one skill only
  for (const r of ['**Retain them**', '**Context line**', '## Classes of work']) {
    assert.ok(route.includes(r), r);
    assert.ok(!skill.includes(r), r);
  }
  const flatSkill = skill.replace(/\s+/g, ' '), flatRoute = route.replace(/\s+/g, ' ');
  for (const r of ['Every tool call re-reads the whole', 'Name models with their effort']) {
    assert.ok(flatSkill.includes(r), r);
    assert.ok(!flatRoute.includes(r), r);
  }
  // how a waiting handover is picked up: the start line's alone (hook.mjs)
  for (const t of [skill, route]) assert.doesNotMatch(t, /not an instruction|Picking one up/);
  const hook = fs.readFileSync(path.join(scripts, 'hook.mjs'), 'utf8');
  assert.match(hook, /not an instruction: the user decides what happens next/);
});

test('the start line sends the session to the route skill before delegating', () => {
  const hook = fs.readFileSync(path.join(scripts, 'hook.mjs'), 'utf8');
  assert.equal((hook.match(/load the `pacing:route` skill once before the first delegation/gi) || []).length, 2);
});

test('SETUP.md writes every setting with config.mjs\'s own words', () => {
  const setup = fs.readFileSync(path.join(skillDir, 'SETUP.md'), 'utf8');
  for (const c of ['set', 'add', 'remove', 'weight', 'next', 'premium', 'fallback', 'reader', 'verifier']) {
    assert.ok(commands.includes(c), c + ' is a config.mjs command');
    assert.ok(setup.includes('`' + c + ' '), c);
  }
});

test('HANDOVER.md asks for the headings config.mjs prints', () => {
  const handover = fs.readFileSync(path.join(skillDir, 'HANDOVER.md'), 'utf8');
  assert.ok(handover.includes('config.mjs" handover new'));
  const headings = JSON.parse(config.match(/const HANDOVER_HEADINGS = (\[.*?\]);/)[1].replace(/'/g, '"'));
  assert.equal(headings.length, 6);
  // each heading's first word is asked for in the file's own words
  for (const h of headings) assert.ok(handover.toLowerCase().includes(h.split(/[ :,]/)[0].toLowerCase()), h);
});

test('the plugin README names every file in the skill folder', () => {
  const readme = fs.readFileSync(path.join(plugin, 'README.md'), 'utf8');
  for (const f of fs.readdirSync(skillDir).filter(f => f.endsWith('.md'))) assert.ok(readme.includes(f), f);
  for (const f of fs.readdirSync(scripts)) assert.ok(readme.includes(f.replace(/\.mjs$/, '')), f);
});

test('the route skill tells a plain run from a check, and batches small tasks', () => {
  assert.match(route, /`pacing:verifier` \| .* \| a plain run: its own, the `verifier` line/);
  assert.match(route, /A plain run asks only whether it passed and quotes what failed; a check\s+judges a result against points the task names/);
  assert.match(route, /Several small tasks for one role go to the kept agent in\s+one message, never one start each/);
  assert.match(route, /a task too small for a start waits\s+for the next batch or stays in the session/);
});

test('the plugin description fits the library: 500 characters at most, the same in the marketplace', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(plugin, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.ok(manifest.description.length <= 500, manifest.description.length + ' characters');
  assert.equal(market.plugins.find(p => p.name === 'pacing').description, manifest.description);
});

// The session tools refuse the calling session, and where the hooks module
// runs its Switch row offers the change: the session asks nothing about its
// own model or effort, and gives steps only where no module runs.
test('a switch of this session is offered by the Switch row; steps only without the hooks module', () => {
  const r = route.replace(/\s+/g, ' '), p = skill.replace(/\s+/g, ' ');
  assert.match(r, /\*\*Over\*\* \(`effort:` line\): one step less effort here saves most\. Where the hooks module runs \(a pacing status line shows\), its Switch row offers it: say nothing\. Without it \(as in a terminal\), say it once, in one line, before medium work leaves \(`\/effort <level>` or the model menu\)\. Never ask: this session cannot change its own model or effort\./);
  const over = r.slice(r.indexOf('**Over**'), r.indexOf('**Other sessions**'));
  assert.doesNotMatch(over, /set_session|new sessions default/);
  assert.match(r, /`set_session_effort`; the app asks; other sessions only\)/);
  assert.match(p, /\*\*This session's model or effort\*\*: it cannot change them itself\. Where the hooks module runs \(a pacing status line shows\), its Switch row above the prompt is the only offer: give no steps and ask nothing; name the fact in a few words, as above\. Without it \(as in a terminal\), the line starts "switch the session to <model> <effort>", in the model menu's words\./);
  assert.doesNotMatch(p, /first reply starts with one short line telling the user to switch/);
  // the report's examples name facts, never steps
  const examples = skill.slice(skill.indexOf('## 2. Report')).split('```')[1];
  assert.doesNotMatch(examples, /model menu|\/effort|switch the session/);
});
