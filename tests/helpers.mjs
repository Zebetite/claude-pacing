// Shared by the tests: every script runs in a child process whose home is a
// fresh temp folder, so nothing a test does reaches the real ~/.claude.
// HOME and USERPROFILE move os.homedir(); APPDATA and LOCALAPPDATA move the
// desktop app's preset folder that budget.mjs writes on Windows. TZ is UTC so
// the budget line's midnight step falls where the tests expect it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..');
export const plugin = path.join(repo, 'pacing');
export const scripts = path.join(plugin, 'skills', 'pacing', 'scripts');

// a temp home with a project (a folder holding .git) inside it
export const sandbox = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pacing-test-'));
  const project = path.join(home, 'work', 'proj');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  const env = { ...process.env };
  // whatever the session that runs the tests set must not leak in
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_')) delete env[k];
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TZ: 'UTC',
    CLAUDE_PROJECT_DIR: project,
  });
  const data = path.join(home, '.claude', 'pacing');
  const run = (script, args = [], opts = {}) => {
    const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], {
      cwd: opts.cwd || project, env: { ...env, ...(opts.env || {}) }, encoding: 'utf8',
      // what the engine hands a hook on its standard input
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
    return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split(/\r?\n/) };
  };
  return {
    home, project, data, env, run,
    budget: (args, opts) => run('budget.mjs', args, opts),
    config: (args, opts) => run('config.mjs', args, opts),
    hook: opts => run('hook.mjs', (opts && opts.args) || [], opts),
    file: (...p) => path.join(data, ...p),
    read: (...p) => fs.readFileSync(path.join(data, ...p), 'utf8'),
    exists: (...p) => fs.existsSync(path.join(data, ...p)),
    write: (rel, text) => { const f = path.join(data, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; },
    writeConfig: c => { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify(c)); },
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
};

// A week that resets on Thursday 2026-11-19 at 12:00 UTC: it starts Thursday
// 2026-11-12 at 12:00 and touches 8 calendar days.
export const RESET = '2026-11-19T12:00:00.000Z';
// the level budget.mjs printed: "All models used ... -> <level>", with the marks
// that may follow it: raised by the trend, set by the per-model meter, that
// model out or held
export const levelOf = out => {
  const m = out.match(/^All models used .* -> ([a-z ]+?)(?: \(raised by the trend\))?(?: \(set by the .+? meter\))?(?:, \S+ \S+ (?:out|held))?$/m);
  return m ? m[1] : null;
};
export const lineOf = out => Number((out.match(/budget line now ([\d.]+) %/) || [])[1]);
// the bars and the tier sheet: every line before "day N of M"
export const block = out => {
  const lines = out.split(/\r?\n/);
  return lines.slice(0, lines.findIndex(l => /^day \d+ of \d+/.test(l)));
};
export const routeOf = (out, cls) => (out.match(new RegExp('^  ' + cls + ' *-> (.*)$', 'm')) || [])[1];
// the tier sheet's rows, each with its wrapped last column joined again
export const sheetRows = out => {
  const lines = block(out);
  const rows = [];
  for (const l of lines.slice(lines.findIndex(l => l.startsWith('─')) + 1)) {
    if (/^\s/.test(l) && rows.length) rows[rows.length - 1] += ' ' + l.trim();
    else if (l) rows.push(l);
  }
  return rows;
};
