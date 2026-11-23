// What handing work to role agents on cheaper models saved this week, against
// doing the same work on the session's model.
//   node saved.mjs [--detail] [--json] [--session <model>] [--project <folder>] [--now <ISO>]
// The tasks are config.mjs's records of each finished role-agent task
// (paths.mjs agentsLog, one file per project), of every project: the weekly
// meter counts them all. --project <folder> narrows them to one. The week is the one the last
// reading's reset belongs to (log.jsonl), moved on by whole weeks once that
// reset has passed; without a reading, the last 7 days.
// The session model: --session (a short name or a full id, as budget.mjs
// takes it), else what the last reading said the session should run on
// (state.json `next`), else tier 1 of the ladder.
// Each task costs its tokens at its own model's price, and would have cost
// them at the session model's price; saved is the difference, never below 0:
// a task on a dearer model than the session's counts as nothing saved and is
// named apart. In points of the weekly meter when records carry what their
// tasks spent (`spent`, see Prices) and rate.json gives the dollars per point
// (as budget.mjs works it out), else as a share.
//   --detail  a table by role and model as well
//   --json    the figures as one JSON line (for the hooks module)
import fs from 'node:fs';
import path from 'node:path';
import { MODELS, checkConfig } from './models.mjs';
import { dataDir, projectRoot, agentsLog, loadConfig } from './paths.mjs';

const DAY = 24 * 60 * 60 * 1000, HOUR = 60 * 60 * 1000;
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const fail = msg => { console.error(msg); process.exit(1); };
const readLines = f => (fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })
  : []);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const fin = v => typeof v === 'number' && Number.isFinite(v);

const now = opt('--now') ? new Date(opt('--now')) : new Date();
if (Number.isNaN(now.getTime())) fail('--now must be a date, such as 2026-11-22T10:00:00Z');
// the record files read: every project's, or the one --project names
const logs = opt('--project') !== undefined ? [agentsLog(projectRoot(opt('--project')))]
  : (() => { const d = path.dirname(agentsLog('x')); try { return fs.readdirSync(d).filter(n => n.endsWith('.jsonl')).sort().map(n => path.join(d, n)); } catch { return []; } })();

// ---- the session model ----
const shortOf = s => Object.keys(MODELS).find(m => String(s).toLowerCase().includes(m)) || null;
let session = null, sessionFrom = null;
if (opt('--session') !== undefined) {
  session = shortOf(opt('--session'));
  if (!session) fail('--session must name a known model: ' + Object.keys(MODELS).join(', '));
  sessionFrom = 'flag';
}
if (!session) {
  const st = readJson(path.join(dataDir, 'state.json'));
  if (st && st.next && MODELS[st.next.model]) { session = st.next.model; sessionFrom = 'state'; }
}
if (!session) {
  const { cfg } = loadConfig(checkConfig);
  const top = cfg && cfg.tiers && cfg.tiers[0];
  session = top && MODELS[top.model] ? top.model : 'fable';
  sessionFrom = 'config';
}
const sessionLabel = MODELS[session].label;

// ---- the week ----
const isReading = e => !!e && typeof e === 'object' && !Number.isNaN(Date.parse(e.t)) && fin(e.all);
const lastReading = readLines(path.join(dataDir, 'log.jsonl')).filter(e => isReading(e) && !Number.isNaN(Date.parse(e.reset))).at(-1);
let weekEnd = lastReading ? Date.parse(lastReading.reset) : now.getTime() + 1;
while (weekEnd <= now.getTime()) weekEnd += 7 * DAY;
const weekStart = weekEnd - 7 * DAY;

// ---- dollars per point of the weekly meter: budget.mjs's rule on rate.json
//      as it stands (this week's from a rise of 5 points, else the carried
//      one, else this week's from 2 points). A file without v: 2 holds the
//      raw tokens per point of 0.9.15 and before: no rate. ----
const rs = readJson(path.join(dataDir, 'rate.json'));
let rate = null;
if (rs && typeof rs === 'object' && rs.v === 2) {
  const rise = fin(rs.from) && fin(rs.to) ? rs.to - rs.from : 0;
  const usd = fin(rs.usd) ? rs.usd : 0;
  rate = rise >= 5 && usd > 0 ? usd / rise : fin(rs.carried) && rs.carried > 0 ? rs.carried : rise >= 2 && usd > 0 ? usd / rise : null;
}

// ---- prices ----
// A record carries one total (`tokens`), not the input, output and cache
// split the rest of the plugin prices (readings.mjs tierMix): the plugin has
// no blended price of its own, so a total is priced here at a typical agent
// mix of 4 % input, 3 % output, 85 % cache read and 8 % cache write. A record
// that does carry the split, `spent: { in, out, read, write }`, is priced
// exactly. Prices in US dollars per million tokens (models.mjs).
const BLEND = [0.04, 0.03, 0.85, 0.08];
const blended = m => MODELS[m].price.reduce((s, p, i) => s + p * BLEND[i], 0);
const splitOf = r => (r.spent && ['in', 'out', 'read', 'write'].every(k => fin(r.spent[k]) && r.spent[k] >= 0) ? r.spent : null);
const costAt = (r, m) => {
  const s = splitOf(r);
  if (!s) return r.tokens * blended(m) / 1e6;
  const [pin, pout, pread, pwrite] = MODELS[m].price;
  return (s.in * pin + s.out * pout + s.read * pread + s.write * pwrite) / 1e6;
};
// The total a record carries is the agent's size at its last request, not
// what its task spent (readings.mjs, above recordArgv): it prices the ratio
// and the share, which are price ratios, but adds nothing to the tokens or
// the points, so no figure shown understates. Only a split counts there.
const tokensOf = r => { const s = splitOf(r); return s ? s.in + s.out + s.read + s.write : 0; };

// ---- the week's tasks ----
// a record of a model the price table does not know cannot be priced: left out
const tasks = logs.flatMap(readLines).filter(r => r && MODELS[r.model] && fin(r.tokens) && r.tokens >= 0
  && Date.parse(r.t) >= weekStart && Date.parse(r.t) < weekEnd).map(r => {
  const usd = costAt(r, r.model), sessionUsd = costAt(r, session);
  return { role: String(r.role || '?'), model: r.model, tokens: tokensOf(r), usd, sessionUsd, savedUsd: Math.max(0, sessionUsd - usd), above: usd > sessionUsd, split: !!splitOf(r) };
});

const sum = (l, k) => l.reduce((s, x) => s + x[k], 0);
// what a saving in dollars is in points of the weekly meter, at the dollars
// per point rate.json has learned
const pointsOf = usd => (rate ? usd / rate : null);
const figures = l => {
  const usd = sum(l, 'usd'), sessionUsd = sum(l, 'sessionUsd'), savedUsd = sum(l, 'savedUsd');
  // the ratio and the share are of the tasks that ran at or below the
  // session's price: the ones above are named apart
  const below = l.filter(x => !x.above);
  const belowUsd = sum(below, 'usd'), belowSession = sum(below, 'sessionUsd');
  const counted = l.filter(x => x.split);
  return {
    tasks: l.length, counted: counted.length, tokens: sum(counted, 'tokens'), usd, sessionUsd, savedUsd,
    ratio: belowUsd > 0 ? belowSession / belowUsd : null,
    share: belowSession > 0 ? savedUsd / belowSession : null,
    points: counted.length ? pointsOf(sum(counted, 'savedUsd')) : null,
  };
};
const all = figures(tasks);
const aboveTasks = tasks.filter(x => x.above);
const above = { tasks: aboveTasks.length, counted: aboveTasks.filter(x => x.split).length, tokens: sum(aboveTasks, 'tokens'), models: [...new Set(aboveTasks.map(x => MODELS[x.model].label))] };
const groups = [];
for (const x of tasks) {
  let g = groups.find(y => y.role === x.role && y.model === x.model);
  if (!g) { g = { role: x.role, model: x.model, label: MODELS[x.model].label, list: [] }; groups.push(g); }
  g.list.push(x);
}

// ---- words ----
const tok = n => (n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));
const times = r => (r >= 10 ? Math.round(r) : (Math.round(r * 10) / 10).toFixed(1)) + '×';
const pct = s => Math.round(100 * s) + '%';
const ptsText = p => (p < 0.05 ? 'under 0.1 points' : p < 1 ? (Math.round(p * 10) / 10) + ' points' : Math.round(p) + (Math.round(p) === 1 ? ' point' : ' points'));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

const lines = [];
if (!tasks.length) lines.push('No agent work recorded this week.');
else {
  // the tokens only where records carry what their tasks spent
  const tokText = (f, what) => (!f.counted ? '' : ', ' + tok(f.tokens) + ' tokens' + what + (f.counted < f.tasks ? ' (counted on ' + f.counted + ' of them)' : ''));
  let line = 'Delegation this week: ' + plural(all.tasks, 'task') + tokText(all, ' on agents');
  const rest = all.tasks - above.tasks;
  if (above.tasks) line += ', ' + (rest ? above.tasks + ' of them' : all.tasks === 1 ? 'which' : 'all of which') + ' ran above the session\'s model (' + above.models.join(' and ') + ')';
  const they = !above.tasks ? 'they' : rest === 1 ? 'the other one' : 'the other ' + rest;
  if (!rest) line += ': nothing saved.';
  else if (!(all.savedUsd > 0)) line += '; ' + they + ' ran on ' + sessionLabel + ' itself, nothing saved.';
  else {
    line += '; on ' + sessionLabel + ' ' + they + ' would have cost ' + times(all.ratio) + ' as much';
    line += all.points !== null ? ', about ' + ptsText(all.points) + ' of the weekly meter saved.' : ' (about ' + pct(all.share) + ' less).';
  }
  lines.push(line);
}

if (flag('--json')) {
  const r2 = n => (n === null ? null : Math.round(n * 100) / 100);
  const out = f => ({ tasks: f.tasks, counted: f.counted, tokens: f.tokens, usd: r2(f.usd), sessionUsd: r2(f.sessionUsd), savedUsd: r2(f.savedUsd), ratio: r2(f.ratio), share: r2(f.share), points: r2(f.points) });
  console.log(JSON.stringify({
    week: { from: new Date(weekStart).toISOString(), to: new Date(weekEnd).toISOString(), known: !!lastReading },
    session: { model: session, label: sessionLabel, from: sessionFrom },
    usdPerPoint: rate === null ? null : Math.round(rate * 1e4) / 1e4,
    priced: !tasks.length ? null : tasks.every(x => x.split) ? 'split' : tasks.some(x => x.split) ? 'mixed' : 'blended',
    ...out(all), above,
    groups: groups.map(g => ({ role: g.role, model: g.model, label: g.label, above: g.list.every(x => x.above), ...out(figures(g.list)) })),
    text: lines.join('\n'),
  }));
} else {
  for (const l of lines) console.log(l);
  if (flag('--detail') && tasks.length) {
    // saved: in points of the weekly meter with a rate, else the share of
    // what the group would have cost at the session model
    const savedText = (g, f) => (g.list.every(x => x.above) ? 'above' : f.points !== null ? (Math.round(f.points * 10) / 10) + ' pts' : f.share === null ? '-' : pct(f.share));
    const rows = [['role', 'model', 'tasks', 'tokens', 'saved']];
    for (const g of groups) { const f = figures(g.list); rows.push([g.role, g.label, String(f.tasks), f.counted ? tok(f.tokens) : '-', savedText(g, f)]); }
    const w = rows[0].map((_, c) => Math.max(...rows.map(r => r[c].length)));
    console.log('');
    console.log('by role and model, against ' + sessionLabel + ':');
    for (const r of rows) console.log('  ' + r.map((v, c) => (c < 2 ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  '));
  }
}
