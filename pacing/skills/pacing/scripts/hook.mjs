// SessionStart hook: shows the user the last pacing reading and the recommended
// model (systemMessage), and hands the new session the same facts plus the
// order to compare its own model with the recommendation (additionalContext).
// When an earlier session left a handover for this project, both also name
// its file. Prints nothing when there is neither a reading nor a handover.
// Declared by the plugin in hooks/hooks.json; reads ~/.claude/pacing.
import fs from 'node:fs';
import path from 'node:path';
import { MODELS, relabel } from './models.mjs';
import { dataDir, projectRoot, pendingHandovers, ageText } from './paths.mjs';

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
      + ' Once its work is picked up, run the `pacing` skill with `handover done`.';
  }
} catch { /* a handover is a convenience: never let it stop the session's start */ }

const out = (visible, context) => console.log(JSON.stringify({ systemMessage: visible, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));

const stateFile = path.join(dataDir, 'state.json');
let s = null;
if (fs.existsSync(stateFile)) { try { s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { s = null; } }
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
const next = s.next ? s.next.label + ' ' + s.next.effort : 'unknown';
const menu = s.next ? s.next.label + ', effort ' + s.next.effort : 'unknown';
const trend = s.trend ? ', trend ' + (s.trend.rate >= 0 ? '+' : '') + s.trend.rate + ' %/day, projected ' + s.trend.projected + ' % at reset' : '';
const premLabel = s.premiumModel && MODELS[s.premiumModel] ? MODELS[s.premiumModel].label : 'Fable';
const facts = 'all models ' + s.all + ' % used, budget line ' + s.line + ' %, level ' + s.level + (s.premiumOut || s.fableOut ? ', ' + premLabel + ' out' : '') + trend;
const visible = stale
  ? 'Pacing (' + ageH + ' h ago, stale): ' + facts + '. Last recommendation: ' + next + '; the session will take a fresh reading before the first big task.'
  : 'Pacing (' + ageH + ' h ago): ' + facts + '. Recommended session model: ' + next + '. Check the model menu shows ' + menu + '.';
const context = stale
  ? 'Pacing (skill `pacing`, last reading ' + ageH + ' h ago, STALE: the budget line has moved since): ' + facts + '. Last recommendation: ' + next
    + '. Do not tell the user to switch models on this reading. Run the `pacing` skill (section 1, Measure) before the first big task and follow its do: line; read BRIEF.md before delegating.'
  : 'Pacing (skill `pacing`, last reading ' + ageH + ' h ago): ' + facts + '. Recommended session model: ' + next
    + '. If the model and effort you run on (named in your system prompt) differ from that, your first reply starts with one line telling the user to switch the model menu to ' + menu
    + ' (only the user can). This reading is fresh: use it, do not measure again until the first big task is done. Read BRIEF.md before delegating.';
out(visible + (handoverVisible ? ' ' + handoverVisible : ''), context + (handoverContext ? ' ' + handoverContext : ''));
