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

test('every file SKILL.md names under the skill folder exists', () => {
  const named = [...skill.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g)].map(m => m[1]);
  const bare = [...skill.matchAll(/\b([A-Z]+\.md)\b/g)].map(m => m[1]).filter(f => !['SKILL.md', 'CLAUDE.md'].includes(f) && !f.endsWith('.local.md'));
  assert.ok(named.length > 0);
  for (const f of [...named, ...bare]) assert.ok(fs.existsSync(path.join(skillDir, f)), f);
});

test('budget.mjs\'s flags in SKILL.md\'s Measure command are all known to the script', () => {
  const budget = fs.readFileSync(path.join(scripts, 'budget.mjs'), 'utf8');
  const known = JSON.parse(budget.match(/const KNOWN = (\[.*?\]);/)[1].replace(/'/g, '"'));
  const line = skill.match(/^node "\$\{CLAUDE_SKILL_DIR\}\/scripts\/budget.mjs" --all .*$/m)[0];
  for (const f of line.match(/--[a-z-]+/g)) assert.ok(known.includes(f.slice(2)), f);
});

test('SKILL.md stays lean: about 2 000 words at most', () => {
  const words = skill.split(/\s+/).filter(Boolean).length;
  assert.ok(words <= 2000, words + ' words');
});

test('SETUP.md writes every setting with config.mjs\'s own words', () => {
  const setup = fs.readFileSync(path.join(skillDir, 'SETUP.md'), 'utf8');
  for (const c of ['set', 'add', 'remove', 'weight', 'next', 'premium', 'fallback', 'reader']) {
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
