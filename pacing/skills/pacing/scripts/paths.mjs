// Where things live: Claude Code's own folder and the user's data folder in
// it, a project's files there (the role agents' notes, the handovers, the
// agent records), the log of readings, and the desktop app's own files. The
// one place a path under ~/.claude or the app's folder is built: every script
// takes it from here. The data folder is ~/.claude/pacing, outside the plugin
// folder, which an update replaces.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code's folder: ~/.claude, or where CLAUDE_CONFIG_DIR says (its own
// setting for that folder: settings.json, projects/ and the rest move with
// it, and so does the data folder).
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const dataDir = path.join(claudeDir(), 'pacing');
// what a new terminal session starts on (budget.mjs sets model and effortLevel)
export const settingsFile = path.join(claudeDir(), 'settings.json');
// the sessions' transcripts (estimate.mjs)
export const projectsDir = () => path.join(claudeDir(), 'projects');

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

// ---- .jsonl files: the log of readings, the agent records ----
// The lines of a .jsonl file that hold an object, and how many do not parse
// or hold something else: a cut-off write or a stray edit is skipped, never
// fatal. `missing`: no such file; `damaged`: it cannot be read.
export const readJsonl = file => {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { missing: e.code === 'ENOENT', damaged: e.code !== 'ENOENT', rows: [], bad: 0 }; }
  const rows = [];
  let bad = 0;
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const v = JSON.parse(l); if (v && typeof v === 'object' && !Array.isArray(v)) rows.push(v); else bad++; } catch { bad++; }
  }
  return { missing: false, damaged: false, rows, bad };
};
// a reading as budget.mjs logs it: a time and the weekly meter's figure
export const isReading = e => !!e && typeof e === 'object' && !Array.isArray(e) && !Number.isNaN(Date.parse(e.t)) && typeof e.all === 'number';
export const logFile = path.join(dataDir, 'log.jsonl');
// every reading in the log, oldest first
export const readLog = () => readJsonl(logFile).rows.filter(isReading);

// When the hooks module last took a reading (log.jsonl, source 'hook'), as a
// time in ms, if that was in the 24 h before `now`; else null. Where it runs,
// its Switch row is the one place a change of the session's model or effort
// is offered (hook.mjs, doctor.mjs). Only the log's last 64 KB is read: a
// day's readings are a few KB.
export const recentHookReading = (now = Date.now()) => {
  try {
    const log = logFile, size = fs.statSync(log).size, fd = fs.openSync(log, 'r');
    const buf = Buffer.alloc(Math.min(size, 65536));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    fs.closeSync(fd);
    let last = null;
    for (const l of buf.toString('utf8').split('\n')) {
      try { const e = JSON.parse(l), t = Date.parse(e.t); if (e.source === 'hook' && now - t < 24 * 3600000 && (last === null || t > last)) last = t; } catch { /* a cut-off line */ }
    }
    return last;
  } catch { return null; }
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

// ---- the desktop app's own files ----
// The app keeps its data per Windows account in %LOCALAPPDATA%\Claude-Data,
// a folder per app profile: the preset new local sessions start on
// (ccd-session-presets.json), the copies of the plugins it installed (rpm/),
// a record per session (claude-code-sessions/). The app's own layout, not a
// documented interface, and seen on Windows only: where it keeps the same on
// macOS or Linux is not known here, and a guessed path would be a file the
// app never reads. So off Windows there is no such folder (null), and what
// rests on it is left out: the preset (budget.mjs; doctor.mjs says so), the
// installed copies (doctor.mjs), the record of a side session (budget.mjs).
// PACING_TEST_PLATFORM: the tests name the system, so both sides are tested
// on every one.
const platform = () => process.env.PACING_TEST_PLATFORM || process.platform;
export const appDataDir = () => (platform() === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Data') : null);
export const subdirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)); } catch { return []; } };

// Where the app installed the copy of the plugin that `script` belongs to:
// <Claude-Data>/<app>/rpm/<account>/<organisation>/plugin_<id>/..., the two
// folders named by the first eight characters of the account's and the
// organisation's ids (seen so on Windows, compared with the ids the engine
// names). null for a copy from anywhere else: a GitHub install under
// ~/.claude/plugins, a checkout.
export const installOf = (script, base = appDataDir()) => {
  if (!base || !script) return null;
  const rel = path.relative(base, path.resolve(script));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [app, rpm, account, org, plug] = rel.split(/[\\/]/);
  return rpm === 'rpm' && account && org && /^plugin_/.test(plug || '') ? { app: path.join(base, app), account: account.toLowerCase() } : null;
};

// The preset files a reading may change, and whose entry in them. A preset
// file holds an entry per account (`byAccount`, keyed by the account's id),
// and a computer can hold several accounts and app profiles: a reading under
// one account must not move another's preset. The account this session runs
// under is told two ways. The engine names it to every command it runs
// (CLAUDE_CODE_ACCOUNT_UUID, the whole id: seen from the desktop app's
// sessions). And a copy of the plugin the app installed lies under its
// account's folder (installOf): its profile's file alone is written, and the
// entry whose id starts with the folder's eight characters. Told neither way
// (a terminal session running a copy from somewhere else), every entry of
// every file is written, as before: nothing on disk says then which account
// the session's meter belongs to, and for the usual one account that is the
// right one. `account`: 'this' when it was told, 'every' when not.
// null off Windows (appDataDir).
export const presetTargets = (script = process.argv[1]) => {
  const base = appDataDir();
  if (!base) return null;
  const inst = installOf(script, base) || installOf(fileURLToPath(import.meta.url), base);
  const named = String(process.env.CLAUDE_CODE_ACCOUNT_UUID || '').toLowerCase();
  const id = /^[0-9a-f][0-9a-f-]{7,}$/.test(named) ? named : null;
  const files = (inst ? [inst.app] : subdirs(base)).map(d => path.join(d, 'ccd-session-presets.json')).filter(p => fs.existsSync(p));
  const owns = id ? key => String(key).toLowerCase() === id : inst ? key => String(key).toLowerCase().startsWith(inst.account) : () => true;
  return { files, owns, account: id || inst ? 'this' : 'every' };
};
