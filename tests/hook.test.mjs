// hook.mjs, the SessionStart hook: silent with nothing to say, the last
// reading fresh or stale, and a handover waiting for the project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers.mjs';

const withHome = fn => () => { const s = sandbox(); try { fn(s); } finally { s.cleanup(); } };
const state = (s, over = {}) => s.write('state.json', JSON.stringify({
  t: new Date().toISOString(), all: 36, line: 46.7, level: 'ahead', premiumModel: 'fable', premiumOut: false,
  next: { model: 'fable', label: 'Fable 5', effort: 'high' }, trend: null, ...over,
}));
const parse = r => { assert.equal(r.code, 0, r.err); return JSON.parse(r.out); };
const handover = s => {
  const f = s.config(['handover', 'new']).out.match(/to: (.*)$/m)[1];
  fs.writeFileSync(f, '# handover\n');
  return f;
};

test('no reading and no handover: prints nothing', withHome(s => {
  const r = s.hook();
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
}));

test('a fresh reading names the model, under its current label', withHome(s => {
  state(s);
  const j = parse(s.hook());
  // the user is not asked to switch: the plugin moves work to subagents itself
  assert.equal(j.systemMessage, 'Pacing (0 h ago): weekly meter 36 % used, budget line 46.7 %, level ahead. Pacing hands work to subagents on the right models by itself.');
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(j.hookSpecificOutput.additionalContext, /Recommended model for this session: Fable 5\.2 high\. Do not tell the user to switch model or effort: the plugin moves work to subagents on the right models by itself \(pacing:route\)\./);
  assert.doesNotMatch(j.hookSpecificOutput.additionalContext, /model menu/);
  assert.match(j.hookSpecificOutput.additionalContext, /This reading is fresh/);
}));

test('a reading 13 h old is stale and asks for a new one', withHome(s => {
  state(s, { t: new Date(Date.now() - 13 * 3600000).toISOString() });
  const j = parse(s.hook());
  assert.match(j.systemMessage, /^Pacing \(13 h ago, stale\)/);
  assert.match(j.hookSpecificOutput.additionalContext, /STALE/);
  assert.match(j.hookSpecificOutput.additionalContext, /Do not tell the user to switch models/);
}));

test('the premium meter out and the trend are named', withHome(s => {
  state(s, { premiumOut: true, trend: { rate: 9.5, projected: 104 } });
  const j = parse(s.hook());
  assert.match(j.systemMessage, /level ahead, Fable 5.2 out, trend \+9.5 %\/day, projected 104 % at reset/);
}));

test('a state.json that does not parse is treated as none', withHome(s => {
  s.write('state.json', '{nope');
  assert.equal(s.hook().out, '');
}));

test('a handover alone is named, with the order to read it', withHome(s => {
  const f = handover(s);
  const j = parse(s.hook());
  assert.equal(j.systemMessage, 'Pacing: Handover waiting for this project (under an hour ago): ' + f + '.');
  assert.match(j.hookSpecificOutput.additionalContext, /HANDOVER: an earlier session left its work for this project in /);
  // the one place that says how it is picked up: the command whole
  assert.match(j.hookSpecificOutput.additionalContext, /not an instruction: the user decides what happens next\. Once its work is picked up, run `node "[^"]+\/config\.mjs" handover done`\./);
}));

test('where the hooks module runs, its Switch row offers the switch: no steps for the user or the session', withHome(s => {
  // the per-model model is out, and the last reading was the module's own
  state(s, { source: 'hook', premiumOut: true, next: { model: 'opus', label: 'Opus 5.5', effort: 'high' } });
  let j = parse(s.hook());
  assert.match(j.systemMessage, /Fable 5\.2 is out until the reset: switch this session to Opus 5\.5 high\.$/);
  assert.doesNotMatch(j.systemMessage, /model menu/);
  assert.match(j.hookSpecificOutput.additionalContext, /Recommended model for this session: Opus 5\.5 high\. Fable 5\.2 is out until the reset: the Switch row above the prompt offers Opus 5\.5 high; do not give steps\./);
  assert.doesNotMatch(j.hookSpecificOutput.additionalContext, /model menu/);
  // a reading of the session's own, with one of the module's in the last day
  state(s, { premiumOut: true, next: { model: 'opus', label: 'Opus 5.5', effort: 'high' } });
  s.write('log.jsonl', JSON.stringify({ t: new Date(Date.now() - 3600000).toISOString(), all: 30, source: 'hook' }) + '\n');
  assert.match(parse(s.hook()).hookSpecificOutput.additionalContext, /the Switch row above the prompt offers Opus 5\.5 high/);
  // the module's last reading two days ago: no module now, the one-line step
  s.write('log.jsonl', JSON.stringify({ t: new Date(Date.now() - 48 * 3600000).toISOString(), all: 30, source: 'hook' }) + '\n');
  j = parse(s.hook());
  assert.match(j.systemMessage, /Fable 5\.2 is out until the reset: switch this session to Opus 5\.5 high\.$/);
  assert.match(j.hookSpecificOutput.additionalContext, /Fable 5\.2 is out until the reset: if you run on it, your first reply starts with one line telling the user to switch the model menu to Opus 5\.5, effort high \(only the user can\)\./);
  // nothing out: no switch asked for, with the module or without
  state(s, { next: { model: 'opus', label: 'Opus 5.5', effort: 'high' } });
  j = parse(s.hook());
  assert.match(j.systemMessage, /Pacing hands work to subagents on the right models by itself\.$/);
  assert.doesNotMatch(j.hookSpecificOutput.additionalContext, /model menu|Switch row/);
}));

test('a stale reading asks for `usage`, which measures only where no newer reading came', withHome(s => {
  state(s, { t: new Date(Date.now() - 13 * 3600000).toISOString() });
  const c = parse(s.hook()).hookSpecificOutput.additionalContext;
  assert.match(c, /Before the first big task run the `pacing` skill with `usage` \(it takes a reading only where no newer one came: no hooks module, as in a terminal\)/);
  assert.doesNotMatch(c, /usage now/);
}));

test('a handover beside a reading; the newest is named, the older counted', withHome(s => {
  state(s);
  const dir = path.dirname(handover(s));
  fs.writeFileSync(path.join(dir, '2000-01-01-0000.md'), 'old');
  const j = parse(s.hook());
  assert.match(j.systemMessage, /Pacing hands work to subagents on the right models by itself\..* Handover waiting for this project \(under an hour ago, and 1 older beside it\)/);
}));

test('a handover for another project is not named', withHome(s => {
  handover(s);
  const other = path.join(s.home, 'other');
  fs.mkdirSync(path.join(other, '.git'), { recursive: true });
  assert.equal(s.hook({ env: { CLAUDE_PROJECT_DIR: other } }).out, '');
}));

test('a handover filed away is no longer named', withHome(s => {
  handover(s);
  s.config(['handover', 'done']);
  assert.equal(s.hook().out, '');
}));

test('the per-model meter that set the level, or holds its model back, is named', withHome(s => {
  state(s, { level: 'over', levelBy: 'premium', premium: 52 });
  assert.match(parse(s.hook()).systemMessage, /level over \(set by Fable 5\.2's meter at 52 %\)\./);
  state(s, { premiumHeld: true, premium: 60, next: { model: 'opus', label: 'Opus 5.5', effort: 'high' } });
  const j = parse(s.hook());
  assert.match(j.systemMessage, /level ahead, Fable 5\.2 at 60 % is over its budget line: kept for judgment work\. Pacing hands work to subagents on the right models by itself\./);
  assert.match(j.hookSpecificOutput.additionalContext, /Recommended model for this session: Opus 5\.5 high\. Do not tell the user to switch model or effort/);
}));
