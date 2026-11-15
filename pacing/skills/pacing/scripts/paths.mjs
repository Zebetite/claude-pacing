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
