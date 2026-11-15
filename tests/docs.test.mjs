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
// those the session runs for itself, not the user
const INTERNAL = ['show', 'json', 'init', 'where', 'note', 'agent'];
const userCommands = commands.filter(c => !INTERNAL.includes(c));

test('config.mjs\'s command list is read', () => {
  assert.ok(userCommands.includes('set') && userCommands.includes('handover'), userCommands.join(' '));
});
for (const c of userCommands) {
  test('`' + c + '` is in SKILL.md\'s description and arguments, and in GUIDE.md', () => {
    const description = skill.match(/^description: (.*)$/m)[1];
    assert.ok(description.includes('`' + c), 'description');
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
// route skill too, once per session
test('each skill stays lean: 1 200 words at most', () => {
  assert.ok(words(skill) <= 1200, 'pacing: ' + words(skill) + ' words');
  assert.ok(words(route) <= 1200, 'route: ' + words(route) + ' words');
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
