// config.mjs help: one screen cut from GUIDE.md, so the two cannot drift;
// help full: the whole guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, plugin, scripts } from './helpers.mjs';

const guide = fs.readFileSync(path.join(plugin, 'skills', 'pacing', 'GUIDE.md'), 'utf8');
const config = fs.readFileSync(path.join(scripts, 'config.mjs'), 'utf8');
const help = args => { const s = sandbox(); try { const r = s.config(['help', ...args]); assert.equal(r.code, 0, r.out); return r.out; } finally { s.cleanup(); } };
const words = t => t.split(/\s+/).filter(Boolean).length;

test('the short help is one screen: under 300 words, a few times shorter than the guide', () => {
  const short = help([]);
  assert.ok(words(short) <= 300, words(short) + ' words');
  assert.ok(words(guide) > 4 * words(short), words(guide) + ' against ' + words(short));
});

test('every part of it is the guide\'s own words, and the parts it needs are marked', () => {
  const short = help([]);
  const parts = [...guide.matchAll(/<!-- help -->([\s\S]*?)<!-- \/help -->/g)].map(m => m[1].trim());
  assert.ok(parts.length >= 4, parts.length + ' marked parts');
  for (const p of parts) assert.ok(short.includes(p), p.slice(0, 60));
  // what it must hold: what the plugin does, the two setup steps, the status line
  assert.match(short, /easier work goes to subagents on cheaper models/);
  assert.match(short, /\*\*1\.\*\* Type `\/pacing setup`/);
  assert.match(short, /\*\*2\.\*\* In the model menu/);
  assert.match(short, /^ {4}Budget: 2h 10m left · usage: Weekly 36% Fable 40%$/m);
  assert.match(short, /\/pacing-status/);
  assert.doesNotMatch(short, /<!--/);
});

test('the command list names every command a user can give', () => {
  const short = help([]);
  const list = short.match(/^Commands, each after `\/pacing`: (.*)\.$/m)[1].split(' · ');
  const commands = config.match(/fail\('commands: (.*)'\);/)[1].split(' | ').map(c => c.split(' ')[0]);
  const INTERNAL = ['show', 'json', 'init', 'where', 'note', 'agent', 'apply', 'start', 'part'];
  for (const c of commands.filter(c => !INTERNAL.includes(c))) assert.ok(list.includes(c), c);
  for (const c of ['usage', 'usage now', 'help full', 'setup', 'log', 'week', 'handover done']) assert.ok(list.includes(c), c);
});

test('help full is the whole guide, its markers left out', () => {
  const full = help(['full']);
  assert.equal(full.trim(), guide.replace(/<!-- \/?help -->/g, '').trim());
});
