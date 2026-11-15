// The skill's configuration: the ladder of models it balances between and the
// next-session model switch. Everything the user owns (config.json, log.jsonl,
// state.json, BRIEF.local.md) lives in ~/.claude/pacing, outside the plugin
// folder, which an update replaces. The SessionStart hook is declared by the
// plugin itself (hooks/hooks.json), so nothing here touches settings.json.
//   node config.mjs                 show the config (creates it from the defaults on first run)
//   node config.mjs init            create ~/.claude/pacing and config.json if missing; prints
//                                   "created" or "exists", and what else it set up
//   node config.mjs set <n> <model> <effort>   change tier n (1 = the session model)
//   node config.mjs add <model> <effort>       append a tier at the bottom
//   node config.mjs remove <n>                 drop tier n (at least two must remain)
//   node config.mjs weight <lastDayWeight>
//   node config.mjs next on|off     let budget.mjs set the default model of new sessions
//   node config.mjs premium <model>|none   which model the plan's per-model weekly meter
//                                   belongs to (fable by default); none for a plan without one
//   node config.mjs fallback <model> <effort>|none   the tier that takes the top place while
//                                   the premium model's meter is full (opus high by default)
//   node config.mjs reader <model> <effort>|ladder   the model the reader agent reads at
//                                   (haiku medium by default); ladder: the lowest tier
//   node config.mjs verifier <model> <effort>|ladder   the model the verifier runs plain test
//                                   runs at (haiku medium by default); ladder: the lowest tier
//   node config.mjs reset           back to the defaults (the ladder, the weight, the reader, the verifier)
//   node config.mjs json            the config as JSON (for scripts)
//   node config.mjs version         the plugin's version, from .claude-plugin/plugin.json
//   node config.mjs help [full]     the short help cut from GUIDE.md, or the whole guide
//   node config.mjs where           the data folder
//   node config.mjs handover new [--project <folder>]    the file a session leaving its work
//                                   writes for the next one, and the headings it holds
//   node config.mjs handover [--project <folder>]        the handovers waiting for a project
//   node config.mjs handover done [file] [--project <folder>]   file them away once picked up
//   node config.mjs notes [--project <folder>]   where the role agents' notes for a project
//                                   are, and how long each file is
//   node config.mjs note <role> <one fact> [--project <folder>]   add a line to a role's notes
//   node config.mjs note <role> --replace <words of a stale line> <the fact now> [--project <folder>]
//                                   put the fact in the place of the one line that holds those words
//   node config.mjs agent <role> <agent id> <model> <effort> <tokens> [--project <folder>]
//                                   record a task a role agent finished; the first record of
//                                   an id is a fresh agent, the later ones resumed
//   node config.mjs agents [--project <folder>]   the kept agents (the latest of each role in
//                                   the last 24 h) and the runs' tokens by role and model
// Models are the Agent tool's ids; the label is what the user sees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, EFFORTS, relabel } from './models.mjs';
import { dataDir, projectRoot as rootOf, notesDir, handoverDir, agentsLog, pendingHandovers, ageText } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dataDir, 'config.json');
const localBrief = path.join(dataDir, 'BRIEF.local.md');
// scripts/ -> skills/pacing -> skills -> the plugin root
const manifest = path.join(here, '..', '..', '..', '.claude-plugin', 'plugin.json');
// where the standalone skill kept these files before it became a plugin
const legacyDir = path.join(os.homedir(), '.claude', 'skills', 'pacing');

const version = () => {
  try { return JSON.parse(fs.readFileSync(manifest, 'utf8')).version; } catch { return 'unknown'; }
};

const tier = (model, effort) => ({ model, label: MODELS[model].label, effort });
const defaults = () => ({
  tiers: [tier('fable', 'high'), tier('opus', 'medium'), tier('sonnet', 'medium')],
  lastDayWeight: 1.5,
  setNextModel: true,
  premium: 'fable',
  fallback: { model: 'opus', effort: 'high' },
  reader: { model: 'haiku', effort: 'medium' },
  verifier: { model: 'haiku', effort: 'medium' },
  installed: new Date().toLocaleDateString('sv-SE'),
});
const premiumText = c => (c.premium === undefined ? MODELS.fable.label + ' (default)' : c.premium === null ? 'none' : MODELS[c.premium] ? MODELS[c.premium].label : c.premium);
const fallbackText = c => {
  const f = c.fallback === undefined ? { model: 'opus', effort: 'high' } : c.fallback;
  return f === null ? 'none (the remaining tiers move up)' : (MODELS[f.model] ? MODELS[f.model].label : f.model) + ' ' + f.effort + ' takes tier 1';
};

const readerText = c => {
  const r = c.reader === undefined ? { model: 'haiku', effort: 'medium' } : c.reader;
  return r === 'ladder' ? 'the lowest tier' : (MODELS[r.model] ? MODELS[r.model].label : r.model) + ' ' + r.effort;
};

// a plain run (run the suite, quote what failed) asks little judgment: the
// verifier runs it on a model of its own, like the reader. A check with
// acceptance points to judge stays on the lowest tier.
const verifierText = c => {
  const v = c.verifier === undefined ? { model: 'haiku', effort: 'medium' } : c.verifier;
  return v === 'ladder' ? 'the lowest tier' : (MODELS[v.model] ? MODELS[v.model].label : v.model) + ' ' + v.effort;
};

const write = c => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n'); };
const read = () => {
  if (!fs.existsSync(file)) return null;
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  // an older config held a primary/fallback pair
  if (!c.tiers && c.primary && c.fallback) {
    c.tiers = [c.primary, c.fallback];
    delete c.primary; delete c.fallback;
    write(c);
  }
  // a model renamed since the config was written shows its current label
  if (c.tiers) c.tiers = c.tiers.map(relabel);
  return c;
};

const ROLE = ['the session: judgment work', 'subagents: routine work', 'subagents: bulky output'];
const show = c => {
  c.tiers.forEach((t, i) => {
    const role = ROLE[Math.min(i, ROLE.length - 1)] + (i >= ROLE.length ? ' (lower)' : '');
    console.log('tier ' + (i + 1) + '  ' + (t.label + ' ' + t.effort).padEnd(20) + ' [' + t.model + ']  ' + role);
  });
  console.log('last day weight: ' + c.lastDayWeight + '  (installed ' + c.installed + ', plugin ' + version() + ')');
  console.log('per-model weekly meter: ' + premiumText(c) + '; when it is full: ' + fallbackText(c));
  console.log('reader agent: ' + readerText(c) + ' (bulky reading)');
  console.log('verifier agent: ' + verifierText(c) + ' (plain test runs; checks to judge: the lowest tier)');
  console.log('next-session model switch: ' + (c.setNextModel === false ? 'off' : 'on'));
  console.log('data folder: ' + dataDir);
};
const fail = m => { console.log(m); process.exit(1); };
const checkModel = m => { if (!MODELS[m]) fail('model must be one of ' + Object.keys(MODELS).join(', ')); };
const checkEffort = e => { if (!EFFORTS.includes(e)) fail('effort must be one of ' + EFFORTS.join(', ')); };
const tierNo = (c, a) => { const n = Number(a); if (!(Number.isInteger(n) && n >= 1 && n <= c.tiers.length)) fail('tier must be 1 to ' + c.tiers.length); return n; };

// ---- the role agents' notes: one file per project and role, in the data
//      folder. A retained agent ends with its session; what it learned that
//      the next one would have to find again goes here, a line per fact. ----
const ROLES = ['reader', 'implementer', 'verifier', 'researcher'];
const argv = process.argv.slice(2);
const projectAt = argv.indexOf('--project');
const projectArg = projectAt >= 0 ? argv.splice(projectAt, 2)[1] : null;
const replaceAt = argv.indexOf('--replace');
const replaceArg = replaceAt >= 0 ? argv.splice(replaceAt, 2)[1] : null;
// the project is the repository the command runs in, or the one --project names
const projectRoot = () => rootOf(projectArg);
// what a handover holds, in this order; the session that leaves writes it
const HANDOVER_HEADINGS = ['Goal', 'State: done, verified, not verified', 'Decisions and why', 'Open items, in order', 'Files and commands', 'Ruled out and traps'];
const noteLines = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.startsWith('- ')) : []);
const withoutDate = l => l.slice(2).replace(/ \(\d{4}-\d{2}-\d{2}\)$/, '');

// ---- the kept agents: a session whose history was summarised has lost the
//      ids it kept, and nobody knows what a kept agent costs against a fresh
//      one. Each finished task is a line in agents/<project>.jsonl. ----
// A kept agent's whole history is re-sent with every task, so after this
// many tasks, or a notification this large, the next task goes to a fresh
// one (SKILL.md, "Retain them"). The totals below are what tunes them.
const KEEP_TASKS = 5, KEEP_TOKENS = 150000, KEPT_HOURS = 24;
const readRuns = f => (fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })
  : []);
// 84000, 84k or 84.5k
const parseTokens = v => { const m = /^(\d+(?:\.\d+)?)(k?)$/i.exec(String(v || '')); return m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : null; };
const kTok = n => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
const agoText = t => { const h = (Date.now() - Date.parse(t)) / 3600000; return h < 1 ? Math.max(0, Math.round(h * 60)) + ' min ago' : Math.round(h) + ' h ago'; };
const modelText = r => (MODELS[r.model] ? MODELS[r.model].label : r.model) + ' ' + r.effort;

const [cmd, a, b, d] = argv;
let cfg = read();
switch (cmd || 'show') {
  case 'show':
    if (!cfg) { cfg = defaults(); write(cfg); console.log('config.json created from the defaults'); }
    show(cfg);
    break;
  case 'json':
    if (!cfg) { cfg = defaults(); write(cfg); }
    console.log(JSON.stringify(cfg));
    break;
  case 'version':
    console.log(version());
    break;
  case 'help': {
    // One source: the short help is cut from GUIDE.md, the parts between
    // <!-- help --> and <!-- /help -->, and the commands from its command
    // table, so the two cannot drift. Printed text costs output tokens, so
    // the whole guide (about 2 600 words) only on `help full`.
    const guide = fs.readFileSync(path.join(here, '..', 'GUIDE.md'), 'utf8');
    if (a === 'full') { console.log(guide.replace(/<!-- \/?help -->/g, '')); break; }
    // blank lines trimmed, not spaces: an indented line is a code line
    const parts = [...guide.matchAll(/<!-- help -->([\s\S]*?)<!-- \/help -->/g)].map(m => m[1].replace(/^\s*\n|\s+$/g, ''));
    const table = guide.slice(guide.indexOf('## Commands'));
    const KEYWORDS = ['now', 'full', 'done'];
    const words = [];
    for (const m of table.matchAll(/^\| (.*?) \|/gm)) {
      for (const c of m[1].matchAll(/`\/pacing ([^`]+)`/g)) {
        const w = c[1].split(' ');
        const name = KEYWORDS.includes(w[1]) ? w[0] + ' ' + w[1] : w[0];
        if (!words.includes(name)) words.push(name);
      }
    }
    console.log(['Pacing, the short help (`/pacing help full` shows the whole guide).', ...parts,
      'Commands, each after `/pacing`: ' + words.join(' · ') + '.'].join('\n\n'));
    break;
  }
  case 'where':
    console.log(dataDir);
    break;
  case 'handover': {
    // A session that has grown long leaves its work to a new one: `new` gives
    // the file to write, the SessionStart hook names it to the next session of
    // the project, and `done` files it away once the work is picked up.
    const root = projectRoot(), dir = handoverDir(root);
    if (a === 'new') {
      fs.mkdirSync(dir, { recursive: true });
      const t = new Date(), p2 = n => String(n).padStart(2, '0');
      const stamp = t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + '-' + p2(t.getHours()) + p2(t.getMinutes());
      let f = path.join(dir, stamp + '.md');
      for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, stamp + '-' + i + '.md');
      console.log('write the handover to: ' + f);
      console.log('headings: ' + HANDOVER_HEADINGS.join(' | '));
      break;
    }
    if (a === 'done') {
      const pending = pendingHandovers(root);
      const which = b ? pending.filter(f => path.resolve(f) === path.resolve(b) || path.basename(f) === b) : pending;
      if (!which.length) { console.log(b ? 'no waiting handover named ' + b : 'no handover is waiting for ' + root); break; }
      fs.mkdirSync(path.join(dir, 'done'), { recursive: true });
      for (const f of which) {
        fs.renameSync(f, path.join(dir, 'done', path.basename(f)));
        console.log('picked up: ' + path.basename(f) + ' (kept in ' + path.join(dir, 'done') + ')');
      }
      break;
    }
    if (a) fail('usage: handover | handover new | handover done [file]');
    const pending = pendingHandovers(root);
    if (!pending.length) { console.log('no handover is waiting for ' + root); break; }
    console.log('waiting for ' + root + ':');
    for (const f of pending) console.log('  ' + f + '  (' + ageText(f) + ')');
    break;
  }
  case 'notes': {
    const root = projectRoot(), dir = notesDir(root);
    console.log('notes for ' + root + ': ' + dir);
    for (const r of ROLES) {
      const n = noteLines(path.join(dir, r + '.md')).length;
      console.log('  ' + r.padEnd(12) + (n ? String(n).padStart(3) + ' lines  ' : ' none yet  ') + path.join(dir, r + '.md'));
    }
    break;
  }
  case 'note': {
    if (!ROLES.includes(a)) fail('role must be one of ' + ROLES.join(', '));
    const text = argv.slice(2).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) fail('usage: note <role> "<one durable fact>"');
    if (text.length > 300) fail('one fact, one line: at most 300 characters (this one has ' + text.length + ')');
    const root = projectRoot(), dir = notesDir(root), f = path.join(dir, a + '.md');
    const dated = '- ' + text + ' (' + new Date().toLocaleDateString('sv-SE') + ')';
    // a fact that changed takes the place of its old line, so the file never
    // holds two lines that contradict each other
    if (replaceAt >= 0) {
      const words = String(replaceArg || '').toLowerCase().trim();
      if (!words) fail('usage: note <role> --replace "<a few words of the stale line>" "<the fact as it is now>"');
      if (!fs.existsSync(f)) fail('no notes yet in ' + f + ': nothing to replace');
      const all = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      const hits = all.map((l, i) => (l.startsWith('- ') && l.toLowerCase().includes(words) ? i : -1)).filter(i => i >= 0);
      if (hits.length !== 1) {
        fail(hits.length ? hits.length + ' lines hold "' + replaceArg + '": give more of the stale line\'s words'
          : 'no line holds "' + replaceArg + '": read ' + f + ' and quote the stale line');
      }
      all[hits[0]] = dated;
      fs.writeFileSync(f, all.join('\n'));
      console.log('replaced in ' + f + ' (' + noteLines(f).length + ' lines)');
      break;
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, ['# ' + a + ' notes for ' + root, '',
        'What the next ' + a + ' agent in this project would otherwise have to find again.',
        'One fact per line; edit or remove a line that went stale.', '', ''].join('\n'));
    }
    const lines = noteLines(f);
    if (lines.some(l => withoutDate(l) === text)) { console.log('already noted'); break; }
    fs.appendFileSync(f, dated + '\n');
    console.log('noted in ' + f + ' (' + (lines.length + 1) + ' lines)'
      + (lines.length + 1 > 60 ? '; over 60 lines: say so in your report, the file needs consolidating' : ''));
    break;
  }
  case 'agent': {
    if (!ROLES.includes(a)) fail('role must be one of ' + ROLES.join(', '));
    const [id, model, effort, tokText] = argv.slice(2);
    if (argv.length !== 6) fail('usage: agent <role> <agent id> <model> <effort> <tokens>');
    checkModel(model); checkEffort(effort);
    const tokens = parseTokens(tokText);
    if (tokens === null) fail('tokens must be a number, such as 84000 or 84k');
    const f = agentsLog(projectRoot());
    const tasks = readRuns(f).filter(r => r.id === id).length + 1;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), role: a, id, model, effort, tokens, resumed: tasks > 1 }) + '\n');
    const full = tasks >= KEEP_TASKS || tokens >= KEEP_TOKENS;
    console.log('recorded: ' + a + ' ' + id + ', task ' + tasks + ', ' + kTok(tokens) + ' tokens'
      + (full ? '; the next ' + a + ' task goes to a fresh agent (' + KEEP_TASKS + ' tasks or ' + kTok(KEEP_TOKENS) + ' tokens reached)' : ''));
    break;
  }
  case 'agents': {
    const root = projectRoot(), runs = readRuns(agentsLog(root));
    if (!runs.length) { console.log('no role agent recorded for ' + root); break; }
    const since = Date.now() - KEPT_HOURS * 3600000;
    console.log('kept agents for ' + root + ' (the latest of each role, last ' + KEPT_HOURS + ' h):');
    for (const r of ROLES) {
      const last = runs.filter(x => x.role === r && Date.parse(x.t) >= since).pop();
      if (!last) { console.log('  ' + r.padEnd(12) + 'none'); continue; }
      const tasks = runs.filter(x => x.id === last.id).length;
      const full = tasks >= KEEP_TASKS || last.tokens >= KEEP_TOKENS;
      console.log('  ' + r.padEnd(12) + last.id + '  ' + modelText(last) + ', ' + tasks + (tasks === 1 ? ' task, ' : ' tasks, ')
        + kTok(last.tokens) + ' tokens last, ' + agoText(last.t) + (full ? '; next task: a fresh one' : ''));
    }
    // what a fresh start costs against a resumed task, per role and model
    const groups = new Map();
    for (const x of runs) {
      const key = x.role + '\t' + modelText(x);
      const g = groups.get(key) || { role: x.role, model: modelText(x), fresh: [], resumed: [] };
      (x.resumed ? g.resumed : g.fresh).push(x.tokens);
      groups.set(key, g);
    }
    const sum = l => l.reduce((s, n) => s + n, 0);
    const avg = l => (l.length ? kTok(Math.round(sum(l) / l.length)) : '-');
    const rows = [['role', 'model', 'runs', 'fresh', 'resumed', 'tokens', 'avg fresh', 'avg resumed']];
    for (const g of groups.values()) {
      rows.push([g.role, g.model, String(g.fresh.length + g.resumed.length), String(g.fresh.length), String(g.resumed.length),
        kTok(sum(g.fresh) + sum(g.resumed)), avg(g.fresh), avg(g.resumed)]);
    }
    const w = rows[0].map((_, c) => Math.max(...rows.map(r => r[c].length)));
    console.log('');
    console.log('runs since ' + runs[0].t.slice(0, 10) + ', by role and model:');
    for (const r of rows) console.log('  ' + r.map((v, c) => (c < 2 ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  '));
    break;
  }
  case 'init': {
    fs.mkdirSync(dataDir, { recursive: true });
    if (cfg) {
      console.log('exists');
    } else {
      // a machine that ran the standalone skill keeps its ladder, readings and rules
      const legacy = ['config.json', 'log.jsonl', 'state.json', 'BRIEF.local.md'].filter(f => fs.existsSync(path.join(legacyDir, f)));
      if (legacy.length) {
        for (const f of legacy) fs.copyFileSync(path.join(legacyDir, f), path.join(dataDir, f));
        console.log('migrated ' + legacy.join(', ') + ' from ' + legacyDir + ' (the originals are still there)');
        cfg = read();
      }
      if (!cfg) write(defaults());
      console.log('created');
    }
    // the user's own subagent rules, outside the plugin folder
    if (!fs.existsSync(localBrief)) {
      fs.writeFileSync(localBrief, [
        '# Local brief (this machine only)', '',
        'Blocks pasted into subagent prompts after the general rules of BRIEF.md.',
        'See BRIEF.md section 2 for the template.', '',
        '## General additions', '', '```', '- ', '```', '',
        '## Project blocks', '', '### <project folder>', '', '```', 'Project rules (<project folder>):', '- ', '```', '',
      ].join('\n'));
      console.log('BRIEF.local.md created in ' + dataDir);
    }
    break;
  }
  case 'set': {
    if (!cfg) cfg = defaults();
    const n = tierNo(cfg, a); checkModel(b); checkEffort(d);
    cfg.tiers[n - 1] = tier(b, d);
    write(cfg); show(cfg);
    break;
  }
  case 'add': {
    if (!cfg) cfg = defaults();
    checkModel(a); checkEffort(b);
    if (cfg.tiers.length >= 6) fail('six tiers is the most');
    cfg.tiers.push(tier(a, b));
    write(cfg); show(cfg);
    break;
  }
  case 'remove': {
    if (!cfg) cfg = defaults();
    const n = tierNo(cfg, a);
    if (cfg.tiers.length <= 2) fail('two tiers must remain');
    cfg.tiers.splice(n - 1, 1);
    write(cfg); show(cfg);
    break;
  }
  case 'weight': {
    if (!cfg) cfg = defaults();
    const w = Number(a);
    if (!(w >= 1 && w <= 3)) fail('weight must be a number from 1 to 3');
    cfg.lastDayWeight = w;
    write(cfg); show(cfg);
    break;
  }
  case 'next': {
    if (!cfg) cfg = defaults();
    if (a !== 'on' && a !== 'off') fail('next on | next off');
    cfg.setNextModel = a === 'on';
    write(cfg); show(cfg);
    break;
  }
  case 'premium': {
    if (!cfg) cfg = defaults();
    if (a === 'none') cfg.premium = null;
    else { checkModel(a); cfg.premium = a; }
    write(cfg); show(cfg);
    break;
  }
  case 'fallback': {
    if (!cfg) cfg = defaults();
    if (a === 'none') cfg.fallback = null;
    else { checkModel(a); checkEffort(b); cfg.fallback = { model: a, effort: b }; }
    write(cfg); show(cfg);
    break;
  }
  case 'reader': {
    if (!cfg) cfg = defaults();
    if (a === 'ladder') cfg.reader = 'ladder';
    else { checkModel(a); checkEffort(b); cfg.reader = { model: a, effort: b }; }
    write(cfg); show(cfg);
    break;
  }
  case 'verifier': {
    if (!cfg) cfg = defaults();
    if (a === 'ladder') cfg.verifier = 'ladder';
    else { checkModel(a); checkEffort(b); cfg.verifier = { model: a, effort: b }; }
    write(cfg); show(cfg);
    break;
  }
  case 'reset': {
    // the ladder and the weight go back to the defaults; the install date, the
    // per-model meter and the user's choice about the next-session switch stay
    const keep = cfg || {};
    const c = defaults();
    c.installed = keep.installed || c.installed;
    if (keep.setNextModel === false) c.setNextModel = false;
    if (keep.premium !== undefined) c.premium = keep.premium;
    write(c); console.log('reset to the defaults'); show(c);
    break;
  }
  default:
    fail('commands: show | json | init | help [full] | set <n> <model> <effort> | add <model> <effort> | remove <n> | weight <n> | next on|off | premium <model>|none | fallback <model> <effort>|none | reader <model> <effort>|ladder | verifier <model> <effort>|ladder | reset | version | where | notes | note <role> <fact> | agent <role> <id> <model> <effort> <tokens> | agents | handover [new|done]');
}
