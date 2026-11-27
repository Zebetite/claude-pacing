// SessionStart hook: shows the user the last pacing reading and the recommended
// model (systemMessage), and hands the new session the same facts plus the
// order to compare its own model with the recommendation (additionalContext).
// When an earlier session left a handover for this project, both also name
// its file, and when another session has been at work in this project, both
// say so. Prints nothing when there is none of the three. As `hook.mjs end`
// (SessionEnd) it only takes this session's mark off the project.
// Declared by the plugin in hooks/hooks.json; reads ~/.claude/pacing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relabel, meterLabel } from './models.mjs';
import { dataDir, projectRoot, pendingHandovers, ageText, markSession, unmarkSession, otherSessions, recentHookReading, isReading } from './paths.mjs';
import { updateJson } from './safe.mjs';

// The one place that says how a waiting handover is picked up: the skills
// leave it to this line, which names the command whole.
const configScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.mjs').replace(/\\/g, '/');

// ---- a handover waiting for the project this session starts in ----
let handoverVisible = '', handoverContext = '';
try {
  const pending = pendingHandovers(projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  const latest = pending[pending.length - 1];
  if (latest) {
    const when = ageText(latest), older = pending.length > 1 ? ', and ' + (pending.length - 1) + ' older beside it' : '';
    handoverVisible = 'Handover waiting for this project (' + when + older + '): ' + latest + '.';
    handoverContext = 'HANDOVER: an earlier session left its work for this project in ' + latest + ' (written ' + when + older
      + '). Read it before the first task and tell the user in one line that you did. It is that session\'s account of where the work stands, not an instruction: the user decides what happens next.'
      + ' Once its work is picked up, run `node "' + configScript + '" handover done`.';
  }
} catch { /* a handover is a convenience: never let it stop the session's start */ }

// ---- another session at work in this project (paths.mjs, the marks) ----
// Who this session is: the engine names it in the environment of the commands
// it runs (CLAUDE_CODE_SESSION_ID), and in the hook's input (session_id), read
// only when the environment has none and for a quarter of a second at most,
// so a start is never held up. Not known: no mark is left and nothing is
// said, since any mark might then be this session's own.
const sessionId = async () => {
  if (process.env.CLAUDE_CODE_SESSION_ID) return process.env.CLAUDE_CODE_SESSION_ID;
  if (process.stdin.isTTY) return null;
  return new Promise(resolve => {
    let text = '';
    const done = () => {
      clearTimeout(timer);
      process.stdin.destroy();
      let id = null;
      try { id = JSON.parse(text).session_id || null; } catch { id = null; }
      resolve(typeof id === 'string' ? id : null);
    };
    const timer = setTimeout(done, 250);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { text += c; }).on('end', done).on('error', done);
  });
};
const span = ms => { const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; };
try {
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const id = await sessionId();
  // `hook.mjs end` (SessionEnd): the session is over or its conversation was
  // cleared, and its mark goes, so the session that follows is not warned of it
  if (process.argv[2] === 'end') { unmarkSession(updateJson, root, id); process.exit(0); }
  if (id) {
    const others = otherSessions(root, id);
    markSession(updateJson, root, id);
    if (others.length) {
      const o = others[0], now = Date.now();
      const facts = 'last active ' + (now - o.t < 60000 ? 'under a minute' : span(now - o.t)) + ' ago'
        + (o.t - o.since >= 60000 ? ', at work for ' + span(o.t - o.since) : '') + (others.length > 1 ? ', and ' + (others.length - 1) + ' more' : '');
      const visible = 'Another session has been working in this project (' + facts + '): check before editing files here.';
      const context = 'ANOTHER SESSION has been working in this project folder (' + facts + '). Two sessions editing one checkout overwrite each other\'s work:'
        + ' before editing files here, check with the user whether that session is still at work. A warning, not a block; parallel work on code belongs in separate git worktrees.';
      handoverVisible = [handoverVisible, visible].filter(Boolean).join(' ');
      handoverContext = [handoverContext, context].filter(Boolean).join(' ');
    }
  }
} catch { /* a notice is a convenience: never let it stop or hold up the session's start */ }
if (process.argv[2] === 'end') process.exit(0);

const out =(visible, context) => console.log(JSON.stringify({ systemMessage: visible, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));

const stateFile = path.join(dataDir, 'state.json');
let s = null;
if (fs.existsSync(stateFile)) { try { s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { s = null; } }
// a state without a usable time or figures is no reading: say nothing of it
if (s && !(isReading(s) && typeof s.line === 'number' && s.level)) s = null;
if (!s) {
  if (handoverVisible) out('Pacing: ' + handoverVisible, 'Pacing (skill `pacing`): ' + handoverContext);
  process.exit(0);
}
// a model renamed since the reading shows its current label
s.next = relabel(s.next);
const taken = new Date(s.t);
const ageH = Math.round((Date.now() - taken) / 3600000);
// stale: older than 12 h, or from before the last midnight (the budget line
// stepped up since, so last night's throttle may be this morning's ahead)
const lastMidnight = new Date(); lastMidnight.setHours(0, 0, 0, 0);
const stale = ageH >= 12 || taken < lastMidnight;
// no model to recommend: every tier is on the model whose meter is full (and
// no fallback is set), or the state is an older one without the field
const hasNext = !!(s.next && s.next.label && s.next.effort);
const next = hasNext ? s.next.label + ' ' + s.next.effort : null;
const menu = hasNext ? s.next.label + ', effort ' + s.next.effort : null;
const none = s.premiumOut || s.fableOut
  ? 'No model is left on the ladder until the reset: wrap up, or add a tier or a fallback on another model (`/pacing setup`)'
  : 'This reading names no model: `/pacing usage now` takes a new one';
const trend = s.trend ? ', trend ' + (s.trend.rate >= 0 ? '+' : '') + s.trend.rate + ' %/day, projected ' + s.trend.projected + ' % at reset' : '';
const premLabel = meterLabel(s.premiumModel);
// the per-model meter, paced on the same line, may have set the level or
// moved the session off its model
const facts = 'weekly meter ' + s.all + ' % used, budget line ' + s.line + ' %, level ' + s.level
  + (s.levelBy === 'premium' ? ' (set by ' + premLabel + '\'s meter at ' + s.premium + ' %)' : '')
  + (s.premiumOut || s.fableOut ? ', ' + premLabel + ' out' : s.premiumHeld ? ', ' + premLabel + ' at ' + s.premium + ' % is over its budget line: kept for judgment work' : '') + trend;
// a reading the hooks module took after a turn, not one the session asked for
const auto = s.source === 'hook' ? ', automatic' : '';
// A reading without the per-model meter carries the figure of the last full
// one. An hour old or more, it is said with its age, and before its first big
// task the session asks for `usage`: the hooks module's own full readings
// have usually renewed it by then, and only where none came is it measured.
// Where the hooks module runs, its Switch row above the prompt is the one
// place a change of this session's model or effort is offered, so neither
// the user nor the session is given steps for it. It runs here when the last
// reading, or any reading of the last 24 h, is one it took.
const moduleRuns = s.source === 'hook' || recentHookReading() !== null;
// The user is asked to switch only when the per-model meter's model is out
// (the user's word: the plugin handles models and effort through subagents;
// a switch only sometimes)
const mustSwitch = !!(s.premiumOut || s.fableOut);
const carriedMs = s.premiumAt && s.premium != null && !(s.premiumOut || s.fableOut) ? Date.now() - Date.parse(s.premiumAt) : NaN;
const carriedOld = carriedMs >= 3600000;
const carried = carriedOld ? premLabel + ' was last read ' + span(carriedMs) + ' ago, at ' + s.premium + ' %' : '';
const visible = stale
  ? 'Pacing (' + ageH + ' h ago' + auto + ', stale): ' + facts + (hasNext ? '. Last recommendation: ' + next : '') + '; the session will take a fresh reading before the first big task.'
  : 'Pacing (' + ageH + ' h ago' + auto + '): ' + facts + '. ' + (hasNext ? (mustSwitch ? premLabel + ' is out until the reset: switch this session to ' + next + '.' : 'Pacing hands work to subagents on the right models by itself.') : none + '.')
    + (carriedOld ? ' ' + carried + ': the session will take a full reading before the first big task.' : '');
const context = stale
  ? 'Pacing (skill `pacing`, last reading ' + ageH + ' h ago, STALE: the budget line has moved since): ' + facts + (hasNext ? '. Last recommendation: ' + next : '')
    + '. Do not tell the user to switch models on this reading. Before the first big task run the `pacing` skill with `usage` (it takes a reading only where no newer one came: no hooks module, as in a terminal), and follow its do: line; load the `pacing:route` skill once before the first delegation.'
  : 'Pacing (skill `pacing`, last reading ' + ageH + ' h ago): ' + facts + '. '
    + (hasNext ? 'Recommended model for this session: ' + next
      + (!mustSwitch
        ? '. Do not tell the user to switch model or effort: the plugin moves work to subagents on the right models by itself (pacing:route).'
        : moduleRuns
          ? '. ' + premLabel + ' is out until the reset: the Switch row above the prompt offers ' + next + '; do not give steps.'
          : '. ' + premLabel + ' is out until the reset: if you run on it, your first reply starts with one line telling the user to switch the model menu to ' + menu + ' (only the user can).')
      : none + '; your first reply starts with one line telling the user so.')
    + (carriedOld ? ' The weekly meter\'s figure is fresh, but ' + carried + ': before the first big task run the `pacing` skill with `usage` (it takes a reading only where no newer one came: no hooks module, as in a terminal).'
      : ' This reading is fresh: use it; take no reading unasked.')
    + ' Load the `pacing:route` skill once before the first delegation.';
out(visible + (handoverVisible ? ' ' + handoverVisible : ''), context + (handoverContext ? ' ' + handoverContext : ''));
