// Where a project's files live in the user's data folder. Shared by config.mjs
// (the role agents' notes, the handovers) and hook.mjs (the handover a new
// session should read). Everything here is under ~/.claude/pacing, outside the
// plugin folder, which an update replaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const dataDir = path.join(os.homedir(), '.claude', 'pacing');

// the project is the repository a folder belongs to, wherever inside it
export const projectRoot = start => {
  const dir = path.resolve(start || process.cwd());
  for (let up = dir; ; up = path.dirname(up)) {
    if (fs.existsSync(path.join(up, '.git'))) return up;
    if (path.dirname(up) === up) return dir;
  }
};

// X:\pacing -> X-pacing, /home/me/app -> home-me-app
export const projectSlug = root => root.split(/[^A-Za-z0-9._ -]+/).filter(Boolean).join('-');

export const notesDir = root => path.join(dataDir, 'notes', projectSlug(root));
export const handoverDir = root => path.join(dataDir, 'handover', projectSlug(root));
// one line per task a role agent finished in the project: the kept agents and
// what they cost
export const agentsLog = root => path.join(dataDir, 'agents', projectSlug(root) + '.jsonl');

// the handovers of a project that no session has picked up yet, oldest first;
// the ones picked up are kept in the folder's done/ subfolder
export const pendingHandovers = root => {
  const dir = handoverDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => path.join(dir, f));
};

export const ageText = f => {
  const h = (Date.now() - fs.statSync(f).mtimeMs) / 3600000;
  return h < 1 ? 'under an hour ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago';
};

// config.json, read and checked (models.mjs checkConfig). `missing`: no file
// yet, a first run; `damaged`: the file does not parse, and the defaults
// stand in until a command rewrites it.
export const configFile = path.join(dataDir, 'config.json');
export const loadConfig = check => {
  if (!fs.existsSync(configFile)) return { cfg: null, problems: [], missing: true, damaged: false };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return { cfg: {}, problems: ['it does not parse: the defaults are used until it is repaired (`/pacing reset` rewrites it and keeps a copy)'], missing: false, damaged: true }; }
  const { cfg, problems } = check(raw);
  // changed: the check dropped, converted or relabelled something
  return { cfg, problems, missing: false, damaged: false, changed: JSON.stringify(cfg) !== JSON.stringify(raw) };
};

// ---- sessions at work in a project ----
// Two sessions editing one checkout overwrite each other's work. Each session
// leaves a mark per project, <data>/sessions/<project>.json, an entry per
// session id with when it was first and last seen there: at its start
// (hook.mjs), at each reading (budget.mjs), and so after turns where the hooks
// module runs. A new session's start line then says another one has been at
// work there. A notice, never a block.
//
// How long a mark counts: a session whose hooks module marks it (live) is
// seen at least every 30 min while it works, so 45 min without a mark means
// it stopped; one that marks only at its start and at readings may work for
// a long stretch between two marks, so it counts for 2 h. Longer would warn
// of sessions long closed (a closed app leaves its mark behind); shorter
// would miss one in the middle of a task.
const MIN = 60000;
export const LIVE_MS = 45 * MIN, QUIET_MS = 120 * MIN;
const FORGET_MS = 24 * 60 * MIN;
export const sessionsFile = root => path.join(dataDir, 'sessions', projectSlug(root) + '.json');
const entriesOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const fresh = (e, now) => !!e && typeof e.t === 'number' && now - e.t >= 0 && now - e.t <= (e.live ? LIVE_MS : QUIET_MS);

// note that session `id` is at work in the project; `update` is safe.mjs's
// updateJson, handed in so this file needs nothing from it. Never throws:
// a mark is a convenience.
export const markSession = (update, root, id, { live = false, now = Date.now() } = {}) => {
  if (!id) return;
  try {
    update(sessionsFile(root), cur => {
      const all = entriesOf(cur), mine = all[id];
      // seen less than a minute ago in the same way: nothing new to say
      if (mine && fresh(mine, now) && now - mine.t < MIN && !!mine.live === live) return null;
      for (const k of Object.keys(all)) if (!(now - all[k].t <= FORGET_MS)) delete all[k];
      all[id] = { since: mine && fresh(mine, now) ? mine.since : now, t: now, ...(live || (mine && mine.live && fresh(mine, now)) ? { live: true } : {}) };
      return all;
    }, { tries: 3, waitMs: 400 });
  } catch { /* another time */ }
};
// the session ended (or its conversation was cleared): its mark goes
export const unmarkSession = (update, root, id) => {
  if (!id) return;
  try { update(sessionsFile(root), cur => { const all = entriesOf(cur); if (!all[id]) return null; delete all[id]; return all; }, { tries: 3, waitMs: 400 }); } catch { /* it goes stale by itself */ }
};
// the other sessions with a mark that still counts, the latest first
export const otherSessions = (root, id, now = Date.now()) => {
  try {
    const all = entriesOf(JSON.parse(fs.readFileSync(sessionsFile(root), 'utf8')));
    return Object.entries(all).filter(([k, e]) => k !== id && fresh(e, now)).map(([k, e]) => ({ id: k, since: typeof e.since === 'number' ? e.since : e.t, t: e.t })).sort((a, b) => b.t - a.t);
  } catch { return []; }
};
