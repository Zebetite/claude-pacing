// The pacing pane as pictures for the README: pacing's own drawing
// (pacing/hooks/pane.mjs) with sample figures, laid out as HTML that stands
// in for the desktop app's elements, and shot with a headless Chrome or
// Edge. Nothing is read or measured.
//
//   node scripts/pane-images.mjs            writes docs/images/pane-*.png,
//                                           and copies them to pacing/images
//
// The app draws Box, Text, Button and Svg itself; here they are flex boxes,
// text in the app's dark theme, and the same SVG. Spacing and type sizes
// are close to the app's, not the same.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paneView } from '../pacing/hooks/pane.mjs';
import { paneModel } from '../pacing/hooks/readings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'images');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// an element is { html }: its markup; a string child is text
const el = html => ({ html });
const kids = c => (Array.isArray(c) ? c : c == null ? [] : [c]).flat(Infinity).filter(x => x != null && x !== false).map(x => (x && typeof x === 'object' ? x.html : esc(x))).join('');
const CELL = 8;
const COLOR = { success: '#4ade80', warning: '#fbbf24', error: '#f87171' };
const SIZE = { title: 28, caption: 12 };
const WEIGHT = { medium: 500, semibold: 600, bold: 700 };
// the element table the pane is drawn with
const t = {
  Box: p => {
    const st = ['display:flex', 'flex-direction:' + (p.flexDirection || 'row'), 'min-width:0'];
    if (p.rowGap) st.push('row-gap:' + p.rowGap * CELL + 'px');
    if (p.columnGap) st.push('column-gap:' + p.columnGap * CELL + 'px');
    if (p.paddingX) st.push('padding:4px ' + p.paddingX * CELL + 'px');
    if (p.backgroundColor) st.push('background:' + p.backgroundColor);
    if (p.justifyContent) st.push('justify-content:' + p.justifyContent);
    if (p.alignItems) st.push('align-items:' + p.alignItems);
    if (p.flexShrink != null) st.push('flex-shrink:' + p.flexShrink);
    if (p.flexWrap) st.push('flex-wrap:' + p.flexWrap);
    if (p.flexGrow != null) st.push('flex-grow:' + p.flexGrow);
    // a border: 'round' with round corners, 'dashed' broken, any other plain
    if (p.borderStyle) st.push('border:1px ' + (p.borderStyle === 'dashed' ? 'dashed' : 'solid') + ' ' + (p.borderColor || '#4b5563'), 'border-radius:' + (p.borderStyle === 'round' ? 6 : 2) + 'px', 'padding:4px ' + (p.paddingX || 1) * CELL + 'px');
    return el('<div style="' + st.join(';') + '">' + kids(p.children) + '</div>');
  },
  Text: p => {
    const st = ['font-size:' + (SIZE[p.size] || 14) + 'px', 'line-height:1.35'];
    if (p.weight) st.push('font-weight:' + (WEIGHT[p.weight] || 400));
    if (p.mono) st.push('font-family:ui-monospace,Consolas,Menlo,monospace');
    if (p.tabular) st.push('font-variant-numeric:tabular-nums');
    if (p.color) st.push('color:' + (COLOR[p.color] || p.color));
    if (p.dimColor) st.push('color:#9ca3af');
    if (p.backgroundColor) st.push('background:' + p.backgroundColor, 'border-radius:3px', 'align-self:center', 'white-space:pre');
    if (p.wrap === 'truncate-end') st.push('white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    return el('<div style="' + st.join(';') + '">' + kids(p.children) + '</div>');
  },
  Button: p => el('<div><span style="display:inline-block;padding:5px 14px;border:1px solid #4b5563;border-radius:6px;font-size:13px;color:#e5e7eb">' + esc(p.label) + '</span></div>'),
  Svg: p => el('<div style="' + (p.width ? 'width:' + p.width + 'px;height:' + p.height + 'px;flex-shrink:0' : 'width:100%') + '">'
    + p.source.replace('<svg ', '<svg style="display:block;width:100%;height:auto" ') + '</div>'),
};

// the prices a reading carries, for the agents' model tags (↑ or ↓ against
// the session's model); the agents' rows as readings.mjs makes them
const PRICES = { 'claude-fable-5-2': [8], 'claude-opus-5-5': [4], 'claude-sonnet-5-5': [2], 'claude-haiku-5-5': [0.1] };
const made = (j, session, running) => ({ running: paneModel({ j: { prices: PRICES, ...j }, session, running }).running });
const base = {
  level: 'ok', levelText: 'Within budget',
  budget: { big: '9h 30m', sub: 'left to use today to stay on budget' },
  notes: [],
  mix: [{ name: 'Opus 5.5 high', share: 64 }, { name: 'Sonnet 5.5 medium', share: 24 }, { name: 'Haiku 5.5 medium', share: 12 }],
  context: { used: '183k', of: '1M', pct: 18 }, contextNote: '', empty: '',
};
const SHOTS = [
  {
    // Fable held, the session on the fallback tier, agents on several models
    name: 'pane-agents',
    m: {
      ...base,
      meters: [
        { label: 'Weekly', pct: 55, line: 73.3, note: 'budget line 73%' },
        { label: 'Fable 5.2', pct: 83, line: 73.3, loud: true, over: true, note: '10 points over its budget line 73%: held, kept for hard tasks' },
        { label: '5-hour', pct: 46, line: null, five: true, note: 'resets in 2h 10m' },
      ],
      ...made({ all: 55, line: 73.3, premium: 83, premiumHeld: true, premiumLabel: 'Fable 5.2' },
      { model: 'claude-opus-5-5', effort: 'high' }, [
        // (the two with the newest output show its box: the implementer and the
        // researcher that just finished; the reviewer's is older)
        { id: 'a1', text: 'reviewer: the release notes, step 1 of 3 · 6m', model: 'claude-fable-5-2', effort: 'high', on: 'Fable 5.2 high', bar: { done: 1, total: 3 },
          out: ['Read pane.mjs → 737 lines'], outAt: 10 },
        { id: 'a2', text: 'implementer: step 2 of 4, the band row · 4m, about 3m left', model: 'claude-sonnet-5-5', effort: 'medium', on: 'Sonnet 5.5 medium', bar: { done: 2, total: 4 },
          out: ['Edit readings.mjs → saved', 'The band row now waits for the turn to end.', 'Bash npm test → # pass 448'], outAt: 30 },
        { id: 'a3', text: 'reader: reading the test logs · 2m 10s, about 1m left', model: 'claude-haiku-5-5', effort: 'medium', on: 'Haiku 5.5 medium', bar: { frac: 0.65 } },
        { id: null, text: 'side session 1m 30s, Fix the docs build', model: null, effort: null, on: '', bar: null },
        { id: 'a4', done: true, text: 'researcher: the hooks API ✓ done · 3m', model: 'claude-sonnet-5-5', effort: 'medium', on: 'Sonnet 5.5 medium', bar: null,
          out: ['turn.step gives each step\'s text, tool.call each result.', 'turn.complete carries the report as its answer.'], outAt: 20 },
      ]),
      // a shell in the background, as the pane's last section lists it
      tasks: [{ kind: 'shell', what: 'Run the dev server', state: 'running', time: '12m' }],
    },
  },
  {
    // within budget, an agent above the session's model
    name: 'pane-within',
    m: {
      ...base,
      budget: { big: '14h', sub: 'left to use today to stay on budget' },
      meters: [
        { label: 'Weekly', pct: 38, line: 57.1, note: 'budget line 57%' },
        { label: 'Fable 5.2', pct: 44, line: 57.1, loud: true, over: false, note: 'budget line 57%' },
        { label: '5-hour', pct: 18, line: null, five: true, note: 'resets in 3h 40m' },
      ],
      mix: [{ name: 'Opus 5.5 high', share: 58 }, { name: 'Fable 5.2 xhigh', share: 30 }, { name: 'Haiku 5.5 medium', share: 12 }],
      ...made({ all: 38, line: 57.1, premium: 44, premiumLabel: 'Fable 5.2' },
      { model: 'claude-opus-5-5', effort: 'high' }, [
        { id: 'a1', text: 'reviewer: the settings page, step 3 of 5 · 7m', model: 'claude-fable-5-2', effort: 'xhigh', on: 'Fable 5.2 xhigh', bar: { done: 3, total: 5 } },
        { id: 'a2', text: 'verifier: running the test suite · 40s, about 2m left', model: 'claude-haiku-5-5', effort: 'medium', on: 'Haiku 5.5 medium', bar: { frac: 0.25 } },
      ]),
      context: { used: '96k', of: '1M', pct: 10 },
    },
  },
  {
    // the week itself 4 over its line: time over, the words in their normal
    // colours (up to 5 over)
    name: 'pane-week-over',
    m: {
      ...base,
      level: 'over', levelText: 'Over the budget line · +4',
      budget: { big: '1h 40m', sub: 'over today\'s budget' },
      meters: [
        { label: 'Weekly', pct: 77, line: 73.3, note: 'budget line 73%' },
        { label: 'Fable 5.2', pct: 68, line: 73.3, loud: true, over: false, note: 'budget line 73%' },
        { label: '5-hour', pct: 71, line: null, five: true, note: 'resets in 1h 30m · full in 1h 10m at this pace' },
      ],
      ...made({ all: 77, line: 73.3, premium: 68, premiumLabel: 'Fable 5.2', level: 'over', weekLevel: 'over' },
      { model: 'claude-fable-5-2', effort: 'high' }, [
        { id: 'a1', text: 'researcher: reading the API docs · 1m 20s, about 2m left', model: 'claude-sonnet-5-5', effort: 'medium', on: 'Sonnet 5.5 medium', bar: { frac: 0.4 } },
        { id: 'a2', text: 'implementer: step 1 of 3, the settings page · 2m', model: 'claude-opus-5-5', effort: 'medium', on: 'Opus 5.5 medium', bar: { done: 1, total: 3 } },
      ]),
      mix: [{ name: 'Fable 5.2 high', share: 48 }, { name: 'Opus 5.5 medium', share: 34 }, { name: 'Sonnet 5.5 medium', share: 18 }],
      context: { used: '312k', of: '1M', pct: 31 },
    },
  },
];

const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!browser) { console.error('pane-images: no Chrome or Edge found'); process.exit(1); }
// the shot is the window's height: cut it under the last row that is not
// the page's background, with 32 px to spare (Windows: System.Drawing)
const crop = png => {
  const ps = "Add-Type -AssemblyName System.Drawing; $p='" + png.replace(/'/g, "''") + "'; $b=[System.Drawing.Bitmap]::FromFile($p); "
    + "$bg=$b.GetPixel(2,$b.Height-2).ToArgb(); $last=0; for($y=$b.Height-1;$y -ge 0;$y-=2){ for($x=0;$x -lt $b.Width;$x+=6){ if($b.GetPixel($x,$y).ToArgb() -ne $bg){ $last=$y; break } }; if($last){ break } }; "
    + "$h=[Math]::Min($b.Height,$last+32); $c=$b.Clone((New-Object System.Drawing.Rectangle 0,0,$b.Width,$h),$b.PixelFormat); $b.Dispose(); $c.Save($p,[System.Drawing.Imaging.ImageFormat]::Png); $c.Dispose()";
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
};
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-images-'));
const W = 400, H = 2200;
for (const s of SHOTS) {
  const body = paneView(t, s.m, { surface: 'desktop', placement: 'dock', onRefresh: () => {} });
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1f1f1e;color:#e5e7eb;font-family:system-ui,Segoe UI,sans-serif">'
    + '<div id="pane" style="width:' + (W - 32) + 'px;padding:16px">' + body.html + '</div></body>';
  const file = path.join(tmp, s.name + '.html');
  fs.writeFileSync(file, html);
  const png = path.join(out, s.name + '.png');
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    '--window-size=' + W + ',' + H, '--screenshot=' + png, pathToFileURL(file).href], { stdio: 'ignore' });
  if (process.platform === 'win32') crop(png);
  console.log('wrote ' + path.relative(root, png));
}
fs.rmSync(tmp, { recursive: true, force: true });
// the plugin ships them too: the organization library's page shows the
// plugin's README and not images from other sites
const shipped = path.join(root, 'pacing', 'images');
fs.mkdirSync(shipped, { recursive: true });
for (const s of SHOTS) fs.copyFileSync(path.join(out, s.name + '.png'), path.join(shipped, s.name + '.png'));
