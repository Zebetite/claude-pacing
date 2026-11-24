// The pacing pane as pictures for the README: pacing's own drawing
// (pacing/hooks/pane.mjs) with sample figures, laid out as HTML that stands
// in for the desktop app's elements, and shot with a headless Chrome or
// Edge. Nothing is read or measured.
//
//   node scripts/pane-images.mjs            writes docs/images/pane-*.png
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
    return el('<div style="' + st.join(';') + '">' + kids(p.children) + '</div>');
  },
  Text: p => {
    const st = ['font-size:' + (SIZE[p.size] || 14) + 'px', 'line-height:1.35'];
    if (p.weight) st.push('font-weight:' + (WEIGHT[p.weight] || 400));
    if (p.mono) st.push('font-family:ui-monospace,Consolas,Menlo,monospace');
    if (p.tabular) st.push('font-variant-numeric:tabular-nums');
    if (p.color) st.push('color:' + (COLOR[p.color] || p.color));
    if (p.dimColor) st.push('color:#9ca3af');
    if (p.wrap === 'truncate-end') st.push('white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    return el('<div style="' + st.join(';') + '">' + kids(p.children) + '</div>');
  },
  Button: p => el('<div><span style="display:inline-block;padding:5px 14px;border:1px solid #4b5563;border-radius:6px;font-size:13px;color:#e5e7eb">' + esc(p.label) + '</span></div>'),
  Svg: p => el('<div style="' + (p.width ? 'width:' + p.width + 'px;height:' + p.height + 'px;flex-shrink:0' : 'width:100%') + '">'
    + p.source.replace('<svg ', '<svg style="display:block;width:100%;height:auto" ') + '</div>'),
};

const base = {
  level: 'ok', levelText: 'Within budget',
  budget: { big: '9h 30m', sub: 'left to use today to stay on budget' },
  notes: [],
  mix: [{ name: 'Opus 5.5 high', share: 64 }, { name: 'Sonnet 5.5 medium', share: 24 }, { name: 'Haiku 5.5 medium', share: 12 }],
  context: { used: '183k', of: '1M', pct: 18 }, contextNote: '', empty: '',
};
const SHOTS = [
  {
    name: 'pane-agents',
    m: {
      ...base,
      meters: [
        { label: 'Weekly', pct: 55, line: 73.3, note: 'budget line 73%' },
        { label: 'Fable 5.2', pct: 83, line: 73.3, loud: true, over: true, note: '10 points over its budget line 73%: held, kept for hard tasks' },
      ],
      running: [
        'reader: reading the test logs · 2m 10s (Haiku 5.5 medium)',
        'implementer: step 2 of 4, the band row · 4m, about 3m left (Opus 5.5 high)',
        'side session 1m 30s, Fix the docs build',
      ],
    },
  },
  {
    name: 'pane-within',
    m: {
      ...base,
      budget: { big: '14h', sub: 'left to use today to stay on budget' },
      meters: [
        { label: 'Weekly', pct: 38, line: 57.1, note: 'budget line 57%' },
        { label: 'Fable 5.2', pct: 44, line: 57.1, loud: true, over: false, note: 'budget line 57%' },
      ],
      running: ['verifier: running the test suite · 40s (Haiku 5.5 medium)'],
      context: { used: '96k', of: '1M', pct: 10 },
    },
  },
  {
    // the week itself over its line: the top area in amber, time over
    name: 'pane-week-over',
    m: {
      ...base,
      level: 'over', levelText: 'Over the budget line',
      budget: { big: '1h 40m', sub: 'over today\'s budget' },
      meters: [
        { label: 'Weekly', pct: 79, line: 73.3, note: 'budget line 73%' },
        { label: 'Fable 5.2', pct: 68, line: 73.3, loud: true, over: false, note: 'budget line 73%' },
      ],
      running: [
        'researcher: reading the API docs · 1m 20s (Sonnet 5.5 medium)',
        'implementer: step 1 of 3, the settings page · 2m (Opus 5.5 medium)',
      ],
      mix: [{ name: 'Opus 5.5 high', share: 48 }, { name: 'Sonnet 5.5 medium', share: 34 }, { name: 'Haiku 5.5 medium', share: 18 }],
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
const W = 400, H = 1400;
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
