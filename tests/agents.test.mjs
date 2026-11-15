// The role agents: one file per role config.mjs knows, each carrying the core
// standing rules of BRIEF.md and the notes commands for its own role.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plugin, scripts } from './helpers.mjs';

const agentsDir = path.join(plugin, 'agents');
const flat = t => t.replace(/\s+/g, ' ');
const roles = JSON.parse(fs.readFileSync(path.join(scripts, 'config.mjs'), 'utf8').match(/const ROLES = (\[.*?\]);/)[1].replace(/'/g, '"'));
const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort();
const agent = r => {
  const text = fs.readFileSync(path.join(agentsDir, r + '.md'), 'utf8');
  // a checkout with CRLF line ends reads the same
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)[1];
  const field = k => (front.match(new RegExp('^' + k + ': (.*)$', 'm')) || [])[1];
  return { text, body: flat(text), name: field('name'), tools: (field('tools') || '').split(/,\s*/), description: field('description') };
};
const brief = flat(fs.readFileSync(path.join(plugin, 'skills', 'pacing', 'BRIEF.md'), 'utf8'));

test('one agent file per role, and no other', () => {
  assert.deepEqual(files, roles.map(r => r + '.md').sort());
});

// the rules BRIEF.md section 1 gives every subagent; each agent words the
// commit and delete rules for what its tools allow, so the core is checked
const CORE = [
  'Work only inside the project folder named in the task. Never touch any other folder or repository.',
  'Never commit or push',
  'Never enter or repeat credentials.',
  'Never delete data',
  'Report faithfully',
];
test('BRIEF.md still holds the core rules the agents are checked for', () => {
  for (const rule of CORE) assert.ok(brief.includes(rule), rule);
});

for (const r of roles) {
  test(r + ': name, description and the core standing rules', () => {
    const a = agent(r);
    assert.equal(a.name, r);
    assert.match(a.description, /^"Pacing role agent/);
    for (const rule of CORE) assert.ok(a.body.includes(rule), r + ' lacks: ' + rule);
  });
  test(r + ': reads its notes and BRIEF.local.md, writes and replaces notes for its own role', () => {
    const a = agent(r);
    assert.ok(a.body.includes('config.mjs" notes --project "<project folder>"'));
    assert.ok(a.body.includes('~/.claude/pacing/BRIEF.local.md'));
    assert.ok(a.body.includes('config.mjs" note ' + r + ' --project "<project folder>" "<one fact'));
    assert.ok(a.body.includes('config.mjs" note ' + r + ' --project "<project folder>" --replace "'));
    assert.ok(a.body.includes('not line numbers or counts'), 'keeps counts out of notes');
  });
  test(r + ': re-checks a figure it quotes from an earlier task', () => {
    assert.ok(agent(r).body.includes('Re-check a figure you quote from an earlier task'));
  });
  test(r + ': only the implementer may edit files', () => {
    const edits = agent(r).tools.some(t => ['Edit', 'Write', 'NotebookEdit'].includes(t));
    assert.equal(edits, r === 'implementer');
  });
}
