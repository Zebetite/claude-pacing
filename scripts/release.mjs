#!/usr/bin/env node
// Releases the pacing plugin in one command, so a release is one tool call
// instead of a dozen. What it does not do needs the app or the browser:
// PublishPlugin, and removing the "My uploads" copy on claude.ai.
//
//   node scripts/release.mjs test
//       runs the three checks at once (node --test, the kit tests, the strict
//       validation) and remembers the files they passed on
//   node scripts/release.mjs release <version> --message <file> --notes <file>
//       bumps plugin.json, runs the checks unless they already passed on these
//       files (the version aside), refuses CRLF in a file that was LF, commits
//       with the message file, pulls if GitHub moved, pushes, tags, and creates
//       the GitHub release; --dry stops before the commit and puts
//       plugin.json back
//
// The notes file holds this version's `## Changed` section and its
// `### <version>` changelog entry; the earlier entries come from the previous
// release's body.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'pacing');
const MANIFEST = path.join(PLUGIN, '.claude-plugin', 'plugin.json');
const DOCS = path.join(ROOT, 'docs', 'auto-readings.md');
const REPO = 'Zebetite/claude-pacing';
const CACHE = path.join(os.tmpdir(), 'pacing-release-checks.json');
// what the checks read: a change anywhere here runs them again
const CHECKED = ['pacing', 'tests', 'package.json'];

const VERSION_RE = /("version"\s*:\s*")([^"]+)(")/;
export const versionOf = text => (text.match(VERSION_RE) || [])[2] ?? null;
export const withVersion = (text, version) => text.replace(VERSION_RE, `$1${version}$3`);

// The release body: this version's Changed section, then the changelog with
// this version's entry first and the previous release's entries after it.
export function notesOf(draft, version, previousBody = '') {
  const text = draft.replace(/\r\n/g, '\n');
  const at = text.search(new RegExp('^### ' + version.replace(/\./g, '\\.') + '\\s*$', 'm'));
  if (at < 0) throw new Error(`the notes have no "### ${version}" entry`);
  const changed = text.slice(0, at).replace(/^## Changelog.*$/m, '').trim();
  if (!/^## Changed/m.test(changed)) throw new Error('the notes have no "## Changed" section');
  const entry = text.slice(at).trim();
  const prev = previousBody.replace(/\r\n/g, '\n');
  const heading = (prev.match(/^## Changelog.*$/m) || ['## Changelog'])[0];
  const first = prev.search(/^### /m);
  const earlier = first < 0 ? '' : prev.slice(first).trim()
    // a release made again: its old entry goes
    .replace(new RegExp('^### ' + version.replace(/\./g, '\\.') + '\\s*\\n[\\s\\S]*?(?=^### |(?![\\s\\S]))', 'm'), '').trim();
  return [changed, heading, entry, earlier].filter(Boolean).join('\n\n') + '\n';
}

// ---- running things ----

const say = text => process.stdout.write(text + '\n');
const fail = text => { process.stderr.write('release: ' + text + '\n'); process.exit(1); };
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const ghExe = () => {
  const full = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe');
  return fs.existsSync(full) ? full : 'gh';
};
const gh = (...args) => execFileSync(ghExe(), args, { cwd: ROOT, encoding: 'utf8' }).trim();

// The newest claude.exe the desktop app keeps, else `claude` on the PATH.
function claudeExe() {
  if (process.env.CLAUDE_EXE) return process.env.CLAUDE_EXE;
  const found = [];
  const base = path.join(process.env.LOCALAPPDATA || '', 'Claude-Data');
  const dirs = p => { try { return fs.readdirSync(p); } catch { return []; } };
  for (const d of dirs(base).filter(n => n.startsWith('claude_'))) {
    const cc = path.join(base, d, 'claude-code');
    for (const v of dirs(cc)) for (const h of dirs(path.join(cc, v))) {
      const exe = path.join(cc, v, h, 'claude.exe');
      if (fs.existsSync(exe)) found.push({ v: v.split('.').map(Number), exe });
    }
  }
  found.sort((a, b) => { for (let i = 0; i < 3; i++) if ((b.v[i] || 0) !== (a.v[i] || 0)) return (b.v[i] || 0) - (a.v[i] || 0); return 0; });
  return found.length ? found[0].exe : 'claude';
}

const run = (label, cmd, args) => new Promise(resolve => {
  const t0 = Date.now();
  let out = '';
  const p = spawn(cmd, args, { cwd: ROOT, windowsHide: true });
  p.stdout.on('data', b => { out += b; });
  p.stderr.on('data', b => { out += b; });
  p.on('error', e => resolve({ label, ok: false, out: String(e), s: 0 }));
  p.on('close', code => resolve({ label, ok: code === 0, out, s: (Date.now() - t0) / 1000 }));
});

// What the checks passed on: every file under CHECKED, plugin.json's version aside.
function checkedHash() {
  const files = git('ls-files', '-co', '--exclude-standard', '--', ...CHECKED).split('\n').filter(Boolean).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    let body = fs.readFileSync(full);
    if (path.resolve(full) === MANIFEST) body = Buffer.from(withVersion(body.toString('utf8'), '0'));
    h.update(f + '\0').update(body).update('\0');
  }
  return h.digest('hex');
}
const passedOn = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')).hash; } catch { return null; } };

async function checks() {
  const exe = claudeExe();
  const results = await Promise.all([
    run('node tests', process.execPath, ['--test']),
    run('kit tests', exe, ['plugin', 'test', PLUGIN]),
    run('validation', exe, ['plugin', 'validate', PLUGIN, '--profile', 'directory', '--strict']),
  ]);
  for (const r of results) {
    const count = r.label === 'node tests' ? (r.out.match(/^# pass (\d+)/m) || [])[1]
      : r.label === 'kit tests' ? (r.out.match(/^\s*(\d+) pass/m) || [])[1] : null;
    say(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${count ? ` (${count} pass)` : ''}, ${r.s.toFixed(0)} s`);
    if (!r.ok) say(r.out.split('\n').filter(l => /fail|error|✘|✖|not ok/i.test(l)).slice(0, 40).join('\n') || r.out.slice(-3000));
  }
  if (results.some(r => !r.ok)) fail('the checks failed: nothing released');
  fs.writeFileSync(CACHE, JSON.stringify({ hash: checkedHash(), at: new Date().toISOString() }));
}

// A file that was LF in HEAD and now has CRLF (Python's text mode on Windows did it).
function crlfTurned() {
  const changed = git('status', '--porcelain', '-uall').split('\n').filter(Boolean).map(l => l.slice(3).replace(/^.* -> /, ''));
  return changed.filter(f => {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;
    const bytes = fs.readFileSync(full);
    // a binary file (a picture) has no lines: a NUL byte says so
    if (bytes.includes(0)) return false;
    if (!bytes.includes('\r\n')) return false;
    try { return !execFileSync('git', ['show', 'HEAD:' + f.replace(/\\/g, '/')], { cwd: ROOT }).includes('\r\n'); } catch { return true; }
  });
}

const arg = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function release(args) {
  const t0 = Date.now();
  const step = text => say(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${text}`);
  const version = args[0];
  const messageFile = arg(args, '--message');
  const notesFile = arg(args, '--notes');
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version || '')) fail('usage: release <version> --message <file> --notes <file>');
  if (!messageFile || !fs.existsSync(messageFile)) fail('--message <file>: the commit message');
  if (!notesFile || !fs.existsSync(notesFile)) fail('--notes <file>: the Changed section and the ### entry');
  const tag = 'v' + version;
  if (git('tag', '-l', tag)) fail(`${tag} exists already`);
  if (!fs.readFileSync(DOCS, 'utf8').includes(`(${version})`)) fail(`docs/auto-readings.md has no section for (${version})`);

  // the notes first: a mistake in them stops it before anything is changed
  const previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
  const notes = notesOf(fs.readFileSync(notesFile, 'utf8'), version, gh('release', 'view', previous, '--repo', REPO, '--json', 'body', '-q', '.body'));

  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  if (versionOf(manifest) !== version) fs.writeFileSync(MANIFEST, withVersion(manifest, version));
  step(`plugin.json at ${version} (was ${versionOf(manifest)}); previous release ${previous}`);

  if (args.includes('--no-checks')) step('checks skipped (--no-checks)');
  else if (passedOn() === checkedHash()) step('checks passed on these files already: not run again');
  else { step('running the checks'); await checks(); }

  const turned = crlfTurned();
  if (turned.length) fail('CRLF in files that were LF: ' + turned.join(', '));

  if (args.includes('--dry')) {
    // everything checked, nothing committed: plugin.json goes back
    fs.writeFileSync(MANIFEST, manifest);
    const out = path.join(os.tmpdir(), `pacing-notes-${version}.md`);
    fs.writeFileSync(out, notes);
    step(`dry run: would commit, push, tag ${tag} and release; notes in ${out}`);
    return;
  }

  // (.claude-plugin: the marketplace entry, whose description is the plugin's)
  git('add', '-A', '--', 'pacing', 'docs', 'tests', 'scripts', '.claude-plugin', 'README.md', 'package.json');
  say(git('diff', '--cached', '--stat'));
  git('commit', '-q', '-F', messageFile);
  step('committed ' + git('log', '--oneline', '-1'));

  git('fetch', '-q', 'origin', 'main');
  if (Number(git('rev-list', '--count', 'HEAD..origin/main')) > 0) { git('pull', '-q', '--rebase', 'origin', 'main'); step('GitHub had moved: rebased on it'); }
  git('push', '-q', 'origin', 'HEAD:main');
  git('tag', '-a', tag, '-m', 'pacing ' + version);
  git('push', '-q', 'origin', tag);
  step(`pushed main and ${tag}`);

  const notesOut = path.join(os.tmpdir(), `pacing-notes-${version}.md`);
  fs.writeFileSync(notesOut, notes);
  const url = gh('release', 'create', tag, '--repo', REPO, '--verify-tag', '--title', 'pacing ' + version, '--notes-file', notesOut);
  step('GitHub release ' + url);
  say('next: PublishPlugin with replace: true, then remove the My uploads copy on claude.ai');
}

const [cmd, ...rest] = process.argv.slice(2);
// run as a command, not when a test imports it
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (cmd === 'test') await checks();
  else if (cmd === 'release') await release(rest);
  else fail('usage: node scripts/release.mjs test | release <version> --message <file> --notes <file>');
}
