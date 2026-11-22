// All work stays in the main session: no text in the skills, the guide, the
// handover steps or the report offers a new session, except as the last
// resort (the session cannot be compacted, or the user asks for one). A
// sentence that names a new session for another reason, the default model
// of new sessions or what a new session's start line says, is allowed too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plugin, sandbox } from './helpers.mjs';

const skillDir = path.join(plugin, 'skills', 'pacing');
const texts = {
  'pacing SKILL.md': fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'),
  'route SKILL.md': fs.readFileSync(path.join(plugin, 'skills', 'route', 'SKILL.md'), 'utf8'),
  'GUIDE.md': fs.readFileSync(path.join(skillDir, 'GUIDE.md'), 'utf8'),
  'HANDOVER.md': fs.readFileSync(path.join(skillDir, 'HANDOVER.md'), 'utf8'),
};

// the sentences that name a new session: table cells and sentences apart
const sentencesNaming = text => text.replace(/\s*\n\s*/g, ' ').split(/(?<=[.!?:;])\s+|\s\|\s/)
  .filter(s => /new session|another session/i.test(s));

// why a sentence may name one
const ALLOWED = [
  /\bnever offer/i, /never offers one/i, /last resort/i, /cannot be compacted/i, /only way/i, // the last resort
  /default (?:model )?(?:to|for|of) .*new sessions|new sessions (?:default|now start)|for new sessions/i, // the default model
  /start line/i, /the new session does/i, // a handover's file, read by the session that starts next
  /another session (?:started|drives|has been|wrote|ran|cleared)|that another session started|another one has been/i, // side sessions, the shared-checkout notice
  /pointing the user at another session/i, /never open .* another session/i, // the rule against pointing elsewhere
];
// what may never be said
const FORBIDDEN = [/starts? in a new session/i, /better started in a new session/i, /(?<!never )offer a new session/i, /a new session(?:,| with a handover)? only for/i];

for (const [name, text] of Object.entries(texts)) {
  test(name + ' offers no new session but as the last resort', () => {
    for (const re of FORBIDDEN) assert.doesNotMatch(text.replace(/\s*\n\s*/g, ' '), re, name);
    for (const s of sentencesNaming(text)) assert.ok(ALLOWED.some(re => re.test(s)), name + ': ' + s);
  });
}

test('the report offers no new session but as the last resort, at any size', () => {
  const sb = sandbox();
  try {
    for (const tokens of ['300000', '500000', '900000']) {
      const out = sb.budget(['--all', '10', '--reset', '2026-11-19T12:00:00Z', '--now', '2026-11-13T12:00:00Z', '--dry', '--context-tokens', tokens]).out;
      for (const re of FORBIDDEN) assert.doesNotMatch(out, re, tokens);
      for (const s of sentencesNaming(out)) assert.ok(ALLOWED.some(re => re.test(s)), tokens + ': ' + s);
      // compacting and going on here is the advice at every size
      assert.match(out, /\/compact/, tokens);
    }
  } finally { sb.cleanup(); }
});

test('the route skill says the outcome comes back here, in full', () => {
  const route = texts['route SKILL.md'].replace(/\s*\n\s*/g, ' ');
  assert.match(route, /give the user the whole outcome here: what changed, what was verified and how, what is open, any decision needed/);
  assert.match(route, /send it to the same agent with SendMessage/);
  assert.match(route, /Never end a reply by pointing the user at another session or a transcript/);
});

test('a task that needs the user\'s input stays in the session; the rest is the session\'s judgment, not a fixed list', () => {
  const route = texts['route SKILL.md'].replace(/\s*\n\s*/g, ' ');
  assert.match(route, /a task that needs the user's input on the way \(a question, a choice, a go-ahead\) stays here/);
  assert.match(route, /Anything else may go to an agent unless you judge it belongs here; a step that is outward-facing or hard to undo usually does/);
  // the brief keeps its own rule
  assert.match(route, /never commit, push or publish unasked/);
});

test('the session says what runs, one line each and no more', () => {
  const route = texts['route SKILL.md'].replace(/\s*\n\s*/g, ' ');
  assert.match(route, /\*\*Say what runs\*\*, one line each and no more: on delegating, the agent, its model and effort, and its task; when the user writes while agents run, the reply starts with how many run and what each is doing/);
});

test('each role agent\'s report leaves the session nothing to ask back', () => {
  const report = name => fs.readFileSync(path.join(plugin, 'agents', name + '.md'), 'utf8').split('## Report')[1].replace(/\s*\n\s*/g, ' ');
  assert.match(report('implementer'), /done, or not done and why.*with its command.*any decision you need, as a question/);
  assert.match(report('reader'), /The answer first.*what you could not settle/);
  assert.match(report('researcher'), /source URL.*what is not documented or could not be opened/);
  assert.match(report('verifier'), /The verdict first.*the command that ran.*what was not checked and why/);
});

test('the outcome carries the important content itself, and a task in parts sends an update per part', () => {
  const route = texts['route SKILL.md'].replace(/\s*\n\s*/g, ' ');
  assert.match(route, /and the important content itself, verbatim \(texts the user will see, example lines, drafts, each choice and why\)/);
  assert.match(route, /Pass on a part's update in a few lines when it arrives/);
  // the agents get the rest from BRIEF.md, printed by their start-up call
  const brief = fs.readFileSync(path.join(skillDir, 'BRIEF.md'), 'utf8').replace(/\s*\n\s*/g, ' ');
  assert.match(brief, /holds the important content itself, verbatim: the texts the user will see, example lines, drafts and wording, each choice made and why, and what could not be done or verified/);
  assert.match(brief, /send the session a short update with SendMessage to "main" when each part is done/);
  assert.match(brief, /none for routine steps, since each one wakes the session/);
  assert.match(brief, /ToolSearch "select:SendMessage"/);
  for (const name of ['implementer', 'reader', 'researcher', 'verifier']) {
    const file = fs.readFileSync(path.join(plugin, 'agents', name + '.md'), 'utf8');
    // the tools an update needs
    assert.match(file, /^tools: .*SendMessage, ToolSearch$/m, name);
    // the one rule of the report that must hold even when the start-up call fails
    const report = file.split('## Report')[1].replace(/\s*\n\s*/g, ' ');
    assert.match(report, /[Gg]ive the important content itself/, name);
  }
});
