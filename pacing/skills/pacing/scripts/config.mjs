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
//   node config.mjs reset           back to the defaults (the ladder and the weight)
//   node config.mjs json            the config as JSON (for scripts)
//   node config.mjs version         the plugin's version, from .claude-plugin/plugin.json
//   node config.mjs where           the data folder
// Models are the Agent tool's ids; the label is what the user sees.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, EFFORTS, relabel } from './models.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(os.homedir(), '.claude', 'pacing');
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
  installed: new Date().toLocaleDateString('sv-SE'),
});
const premiumText = c => (c.premium === undefined ? MODELS.fable.label + ' (default)' : c.premium === null ? 'none' : MODELS[c.premium] ? MODELS[c.premium].label : c.premium);
const fallbackText = c => {
  const f = c.fallback === undefined ? { model: 'opus', effort: 'high' } : c.fallback;
  return f === null ? 'none (the remaining tiers move up)' : (MODELS[f.model] ? MODELS[f.model].label : f.model) + ' ' + f.effort + ' takes tier 1';
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
  console.log('next-session model switch: ' + (c.setNextModel === false ? 'off' : 'on'));
  console.log('data folder: ' + dataDir);
};
const fail = m => { console.log(m); process.exit(1); };
const checkModel = m => { if (!MODELS[m]) fail('model must be one of ' + Object.keys(MODELS).join(', ')); };
const checkEffort = e => { if (!EFFORTS.includes(e)) fail('effort must be one of ' + EFFORTS.join(', ')); };
const tierNo = (c, a) => { const n = Number(a); if (!(Number.isInteger(n) && n >= 1 && n <= c.tiers.length)) fail('tier must be 1 to ' + c.tiers.length); return n; };

const [cmd, a, b, d] = process.argv.slice(2);
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
  case 'where':
    console.log(dataDir);
    break;
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
    fail('commands: show | json | init | set <n> <model> <effort> | add <model> <effort> | remove <n> | weight <n> | next on|off | premium <model>|none | fallback <model> <effort>|none | reset | version | where');
}
