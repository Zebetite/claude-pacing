// The pacing pane's drawing: a plain model in, a tree out. No `$`, no state:
// readings.mjs builds the model (paneModel) and hands it here with the
// surface's element table. Where the table has `Svg` (desktop, vscode,
// mobile) the meters are drawn as vector bars and a ring; the terminal has
// none, and gets the same figures as rows of block characters.
//
// A drawing inside an Svg cannot see the theme, so its colours are fixed and
// chosen to read on a dark and on a light page: the tracks are a translucent
// grey, and every figure is a Text beside the drawing, never inside it.

export const LEVEL_COLORS = { ok: '#22d3ee', over: '#fbbf24', throttle: '#fb923c', stop: '#f43f5e' };
// theme keys for the same four, for Text
const LEVEL_TEXT = { ok: 'success', over: 'warning', throttle: 'warning', stop: 'error' };
// the head-up display's own line colour: the frames, ticks and headings
export const HUD = '#22b8d8';
const LINE = HUD;
export const PALETTE = ['#22d3ee', '#a78bfa', '#fbbf24', '#f472b6', '#34d399', '#60a5fa', '#94a3b8'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
// A level's colour run: a lit bar or dial passes through these from its
// start to its end, so more of it lit shows more colours.
export const SWEEPS = {
  '#22d3ee': ['#22d3ee', '#818cf8', '#e879f9'],
  '#fbbf24': ['#fde047', '#fb923c', '#f472b6'],
  '#fb923c': ['#fb923c', '#f43f5e', '#e879f9'],
  '#f43f5e': ['#fb7185', '#e11d48', '#c026d3'],
  '#34d399': ['#34d399', '#22d3ee', '#818cf8'],
};
// each section's own accent: its heading and its figures
export const ACCENTS = { week: '#22d3ee', models: '#a78bfa', agents: '#f472b6', context: '#34d399' };
const blend = (a, b, k) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = s => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * k);
  return '#' + [16, 8, 0].map(s => c(s).toString(16).padStart(2, '0')).join('');
};
// the colour at `k` (0 to 1) along a level's run; a colour without a run is itself
export const sweepAt = (color, k) => {
  const stops = SWEEPS[color];
  if (!stops) return color;
  const at = clamp(k, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(at));
  return blend(stops[i], stops[i + 1], at - i);
};
const num = n => (Math.round(n * 100) / 100).toString();
const GLOW = '<filter id="glow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';

// One horizontal bar, as a row of slanted cells: segments side by side (each
// a share of 100) light their cells in their colour, the rest stay dim; an
// optional marker (a share of 100) is a bright tick with a small arrow head.
// A thin frame with corner marks runs under it.
export const BAR_CELLS = 36;
// `loud` (a per-model meter's budget line, the user's word: very visible,
// more so when over): a thick line in amber with a tag above it naming the
// line; past it, the cells over the line turn red on a red band, and the
// line and its tag turn red, the tag saying by how much (still: the user's
// word, a pulse drew too much).
export const LINE_TAG = 18;
export const barSvg = (segments, marker = null, w = 480, h = 34, loud = false) => {
  if (loud && marker !== null) return loudBarSvg(segments, marker, w, h + LINE_TAG + 10);
  // with a marker, room above the cells for its arrow
  if (marker !== null) h += 5;
  const n = BAR_CELLS, gap = 3, slant = 5, top = marker !== null ? 13 : 8, ch = 14;
  const cw = (w - slant - gap * (n - 1)) / n;
  const total = clamp(segments.reduce((a, s) => a + Math.max(0, s.pct), 0), 0, 100);
  // at least one cell for anything above nothing
  const lit = total > 0 ? Math.max(1, Math.round(total / 100 * n)) : 0;
  const colorAt = i => {
    if (segments.length === 1) return sweepAt(segments[0].color, i / (n - 1));
    const at = (i + 0.5) / lit * total;
    let run = 0;
    for (const s of segments) { run += Math.max(0, s.pct); if (at <= run) return s.color; }
    return segments.length ? segments[segments.length - 1].color : HUD;
  };
  const cell = (i, fill, extra) => {
    const x = i * (cw + gap);
    return '<path d="M' + num(x + slant) + ' ' + top + 'h' + num(cw) + 'l' + (-slant) + ' ' + ch + 'h' + num(-cw) + 'z" fill="' + fill + '"' + extra + '/>';
  };
  let on = '', off = '';
  for (let i = 0; i < n; i++) { if (i < lit) on += cell(i, colorAt(i), ''); else off += cell(i, '#808080', ' fill-opacity="0.2"'); }
  let tick = '';
  if (marker !== null) {
    const x = num(clamp(marker, 0, 100) / 100 * (w - slant) + slant / 2);
    // a rect, not a line: a filter on a zero-wide box draws nothing
    // the arrow above it, large and edged dark (the user's word: more visible)
    tick = '<rect x="' + num(x - 1.75) + '" y="6" width="3.5" height="' + (h - 11) + '" rx="1.5" fill="#f8fafc" filter="url(#glow)"/>'
      + '<path d="M' + x + ' 12l-7 -11h14z" fill="#f8fafc" stroke="#0b1220" stroke-width="1" stroke-linejoin="round"/>';
  }
  const by = h - 4;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + '<defs>' + GLOW + '</defs>'
    + '<path d="M0 ' + (by - 4) + 'v4h' + w + 'v-4" fill="none" stroke="' + HUD + '" stroke-opacity="0.55" stroke-width="1"/>'
    + off + '<g filter="url(#glow)">' + on + '</g>' + tick + '</svg>';
};
const loudBarSvg = (segments, marker, w, h) => {
  const n = BAR_CELLS, gap = 3, slant = 5, ch = 14, top = LINE_TAG + 14;
  const cw = (w - slant - gap * (n - 1)) / n;
  const total = clamp(segments.reduce((a, s) => a + Math.max(0, s.pct), 0), 0, 100);
  const lit = total > 0 ? Math.max(1, Math.round(total / 100 * n)) : 0;
  const m = clamp(marker, 0, 100);
  const over = total > m;
  const lineCol = over ? LEVEL_COLORS.stop : AMBER;
  const x = clamp(m / 100 * (w - slant) + slant / 2, 2, w - 2);
  const base = segments.length ? segments[0].color : HUD;
  const cell = (i, fill, extra) => {
    const cx = i * (cw + gap);
    return '<path d="M' + num(cx + slant) + ' ' + top + 'h' + num(cw) + 'l' + (-slant) + ' ' + ch + 'h' + num(-cw) + 'z" fill="' + fill + '"' + extra + '/>';
  };
  let on = '', hot = '', off = '';
  for (let i = 0; i < n; i++) {
    const mid = i * (cw + gap) + slant / 2 + cw / 2;
    if (i >= lit) off += cell(i, '#808080', ' fill-opacity="0.2"');
    else if (mid > x) hot += cell(i, LEVEL_COLORS.stop, '');
    else on += cell(i, sweepAt(base, i / (n - 1)), '');
  }
  // the stretch over the line, as a band behind the cells
  const xEnd = lit / n * (w - slant) + slant / 2;
  const band = over && xEnd > x
    ? '<rect x="' + num(x) + '" y="' + (top - 3) + '" width="' + num(xEnd - x) + '" height="' + (ch + 6) + '" fill="' + LEVEL_COLORS.stop + '" fill-opacity="0.22"/>' : '';
  const word = over ? 'OVER +' + Math.round(total - m) : 'BUDGET ' + Math.round(m) + '%';
  const tw = word.length * 8 + 12, lw = over ? 6 : 5;
  const tx = clamp(x - tw / 2, 0, w - tw);
  const tag = '<g>'
    + '<rect x="' + num(tx) + '" y="0" width="' + num(tw) + '" height="' + LINE_TAG + '" rx="2" fill="' + lineCol + '"/>'
    + '<text x="' + num(tx + tw / 2) + '" y="' + (LINE_TAG - 5) + '" text-anchor="middle" ' + FONT + ' font-size="12.5" font-weight="700" letter-spacing="0.5" fill="#0b1220">' + word + '</text>'
    + '<rect x="' + num(x - lw / 2) + '" y="' + (LINE_TAG + 6) + '" width="' + lw + '" height="' + (h - 9 - LINE_TAG) + '" rx="1.5" fill="' + lineCol + '" filter="url(#glow)"/>'
    // an arrow under the tag, as the weekly bar has, larger
    + '<path d="M' + num(x) + ' ' + (LINE_TAG + 13) + 'l-8 -12h16z" fill="' + lineCol + '" stroke="#0b1220" stroke-width="1" stroke-linejoin="round"/>'
    + '</g>';
  const by = h - 4;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + '<defs>' + GLOW + '</defs>'
    + '<path d="M0 ' + (by - 4) + 'v4h' + w + 'v-4" fill="none" stroke="' + HUD + '" stroke-opacity="0.55" stroke-width="1"/>'
    + band + off + '<g filter="url(#glow)">' + on + hot + '</g>' + tag + '</svg>';
};

// The week's dial: `pct` of the main arc lit in `color` with a glow, a tick
// at `marker`, a ring of scale marks, and two thin rings turning slowly
// around it. The figure stands in the middle.
export const ringSvg = (pct, color, marker = null, size = 132, label = 'WEEK') => {
  const c = size / 2, r = c - 22, sw = 9, len = 2 * Math.PI * r;
  const fill = clamp(pct, 0, 100) / 100 * len;
  const circle = (rad, extra) => '<circle cx="' + c + '" cy="' + c + '" r="' + num(rad) + '" fill="none" ' + extra + '/>';
  const spin = (from, to, dur) => '<animateTransform attributeName="transform" type="rotate" from="' + from + ' ' + c + ' ' + c + '" to="' + to + ' ' + c + ' ' + c + '" dur="' + dur + 's" repeatCount="indefinite"/>';
  // sixty scale marks, every fifth one longer
  const scale = r + sw / 2 + 4, mark = 2 * Math.PI * scale / 60;
  let tick = '';
  if (marker !== null) {
    const a = (clamp(marker, 0, 100) / 100) * 2 * Math.PI - Math.PI / 2;
    const at = d => [num(c + Math.cos(a) * d), num(c + Math.sin(a) * d)];
    const [x1, y1] = at(r - sw / 2 - 3), [x2, y2] = at(r + sw / 2 + 7);
    tick = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#e5e7eb" stroke-width="2.5" stroke-linecap="round" filter="url(#glow)"/>';
  }
  const outer = c - 4, inner = r - sw / 2 - 7;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">'
    + '<defs>' + GLOW.replace('y="-80%"', 'y="-30%"').replace('height="260%"', 'height="160%"') + '</defs>'
    // the outer ring: three long arcs, turning
    + '<g>' + circle(outer, 'stroke="' + HUD + '" stroke-opacity="0.75" stroke-width="1.5" stroke-dasharray="' + num(2 * Math.PI * outer / 3 - 14) + ' 14"') + spin(0, 360, 48) + '</g>'
    // the scale
    + circle(scale, 'stroke="' + HUD + '" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="1.2 ' + num(mark - 1.2) + '" transform="rotate(-90 ' + c + ' ' + c + ')"')
    + circle(scale + 1.5, 'stroke="' + HUD + '" stroke-opacity="0.8" stroke-width="6" stroke-dasharray="1.6 ' + num(mark * 5 - 1.6) + '" transform="rotate(-90 ' + c + ' ' + c + ')"')
    // the track and the lit arc
    + circle(r, 'stroke="#808080" stroke-opacity="0.2" stroke-width="' + sw + '"')
    + (fill > 0 ? circle(r, 'stroke="' + color + '" stroke-width="' + sw + '" stroke-dasharray="' + num(fill) + ' ' + num(len) + '" transform="rotate(-90 ' + c + ' ' + c + ')" filter="url(#glow)"') : '')
    // the inner ring: two short arcs, turning the other way
    + '<g>' + circle(inner, 'stroke="' + HUD + '" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="' + num(Math.PI * inner * 0.3) + ' ' + num(Math.PI * inner * 0.7) + '"') + spin(360, 0, 30) + '</g>'
    + tick
    + '<text x="' + c + '" y="' + num(c + 3) + '" text-anchor="middle" font-family="ui-monospace,Consolas,Menlo,monospace" font-size="' + num(size / 5.2) + '" font-weight="700" fill="' + color + '">' + Math.round(clamp(pct, 0, 999)) + '%</text>'
    + '<text x="' + c + '" y="' + num(c + 15) + '" text-anchor="middle" font-family="ui-monospace,Consolas,Menlo,monospace" font-size="' + num(size / 16) + '" letter-spacing="2" fill="' + HUD + '">' + label + '</text>'
    + '</svg>';
};

// An agent at work, as a small robot: a head with eyes that blink, an
// antenna whose light pulses, and a mouth of bars that move while it works.
// `i` staggers the animations so a row of them does not move as one.
export const robotSvg = (color = HUD, i = 0, size = 48) => {
  const d = (0.37 * i) % 2;
  const anim = (attr, values, dur, begin = 0) => '<animate attributeName="' + attr + '" values="' + values + '" dur="' + dur + 's" begin="' + num(begin + d) + 's" repeatCount="indefinite"/>';
  const eye = x => '<rect x="' + x + '" y="20" width="7" height="6" rx="1.5" fill="' + color + '" filter="url(#glow)">' + anim('height', '6;6;0.8;6;6', 3.6) + anim('y', '20;20;22.6;20;20', 3.6) + '</rect>';
  const bar = (x, k) => '<rect x="' + x + '" y="32" width="3" height="4" fill="' + color + '">' + anim('height', '2;6;3;5;2', 0.9, k * 0.15) + anim('y', '34;30;33;31;34', 0.9, k * 0.15) + '</rect>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 48 48">'
    + '<defs>' + GLOW.replace('y="-80%"', 'y="-50%"').replace('height="260%"', 'height="200%"') + '</defs>'
    // antenna
    + '<path d="M24 12V6" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>'
    + '<circle cx="24" cy="5" r="2.6" fill="' + color + '" filter="url(#glow)">' + anim('opacity', '1;0.25;1', 1.4) + '</circle>'
    // ears
    + '<rect x="4" y="20" width="4" height="10" rx="1.5" fill="' + color + '" fill-opacity="0.7"/><rect x="40" y="20" width="4" height="10" rx="1.5" fill="' + color + '" fill-opacity="0.7"/>'
    // head
    + '<rect x="9" y="12" width="30" height="28" rx="6" fill="' + color + '" fill-opacity="0.12" stroke="' + color + '" stroke-width="2"/>'
    + eye(14.5) + eye(26.5)
    + bar(16.5, 0) + bar(20.5, 1) + bar(24.5, 2) + bar(28.5, 3)
    // a scan line passing over the face
    + '<rect x="11" y="14" width="26" height="1.5" fill="' + color + '" fill-opacity="0.5">' + anim('y', '14;37;14', 2.8) + '</rect>'
    + '</svg>';
};

// the same bar in block characters, for a surface without Svg
// (`marker`: a budget line drawn as ┃ in its place)
export const barText = (segments, cells = 24, marker = null) => {
  const full = clamp(Math.round(segments.reduce((n, s) => n + s.pct, 0) / 100 * cells), 0, cells);
  const s = ('█'.repeat(full) + '░'.repeat(cells - full)).split('');
  if (marker !== null) s[clamp(Math.round(clamp(marker, 0, 100) / 100 * cells) - 1, 0, cells - 1)] = '┃';
  return s.join('');
};

// ---- other dials for the week ----
// Each takes what ringSvg takes and draws the same three things another
// way: how much of the week is used, where the budget line is, the figure.
const SVG = (w, h, body, filter = GLOW.replace('y="-80%"', 'y="-30%"').replace('height="260%"', 'height="160%"')) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><defs>' + filter + '</defs>' + body + '</svg>';
const FONT = 'font-family="ui-monospace,Consolas,Menlo,monospace"';
// a point at `deg` (0 at the top, clockwise) and distance `d` from (cx, cy)
const polar = (cx, cy, deg, d) => { const a = (deg - 90) * Math.PI / 180; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; };
// an arc of radius r from deg a0 to a1, clockwise
const arc = (cx, cy, r, a0, a1) => {
  const [x0, y0] = polar(cx, cy, a0, r), [x1, y1] = polar(cx, cy, a1, r);
  return 'M' + num(x0) + ' ' + num(y0) + 'A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + num(x1) + ' ' + num(y1);
};

// A gauge: three quarters of a circle, open at the bottom, with a needle.
export const gaugeSvg = (pct, color, marker = null, size = 132, label = 'WEEK') => {
  const c = size / 2, r = c - 20, from = -135, sweep = 270, p = clamp(pct, 0, 100);
  const at = v => from + sweep * clamp(v, 0, 100) / 100;
  let ticks = '';
  for (let i = 0; i <= 20; i++) {
    const [x1, y1] = polar(c, c, at(i * 5), r + 8), [x2, y2] = polar(c, c, at(i * 5), r + (i % 5 ? 12 : 16));
    ticks += '<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" stroke="' + HUD + '" stroke-opacity="' + (i % 5 ? 0.45 : 0.9) + '" stroke-width="1.5"/>';
  }
  const [nx, ny] = polar(c, c, at(p), r - 12), [bx, by] = polar(c, c, at(p), 12);
  let mark = '';
  if (marker !== null) {
    const [x1, y1] = polar(c, c, at(marker), r - 8), [x2, y2] = polar(c, c, at(marker), r + 8);
    mark = '<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" stroke="#e5e7eb" stroke-width="2.5" stroke-linecap="round" filter="url(#glow)"/>';
  }
  return SVG(size, size, ticks
    + '<path d="' + arc(c, c, r, from, from + sweep) + '" fill="none" stroke="#808080" stroke-opacity="0.2" stroke-width="9" stroke-linecap="round"/>'
    + (p > 0 ? '<path d="' + arc(c, c, r, from, at(p)) + '" fill="none" stroke="' + color + '" stroke-width="9" stroke-linecap="round" filter="url(#glow)"/>' : '')
    + mark
    + '<line x1="' + num(bx) + '" y1="' + num(by) + '" x2="' + num(nx) + '" y2="' + num(ny) + '" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>'
    + '<circle cx="' + c + '" cy="' + c + '" r="3" fill="' + color + '"/>'
    + '<text x="' + c + '" y="' + num(c + 34) + '" text-anchor="middle" ' + FONT + ' font-size="' + num(size / 6) + '" font-weight="700" fill="' + color + '">' + Math.round(p) + '%</text>'
    + '<text x="' + c + '" y="' + num(c + 46) + '" text-anchor="middle" ' + FONT + ' font-size="' + num(size / 16) + '" letter-spacing="2" fill="' + HUD + '">' + label + '</text>');
};

// A reactor readout in the manner of a ship's console. From the outside in:
// four bracket arcs turning slowly, a ring of fine scale marks, the data ring
// (forty-eight blocks in a hollow channel, lit clockwise from the top in the
// level's gradient), an inner ring of three dashed arcs turning the other
// way, and the glowing core with the figure. The budget line is a white
// pointer outside the data ring, and a small word says which side of it the
// week is on.
export const AMBER = '#fbbf24';
// the week's budget line on the dial: white, a colour no ring or bar takes
export const BUDGET_LINE = '#f8fafc';
// the dial's frame and core marks: fixed colours that differ from one
// another and stay the same at every level (the user's word: they should
// not change with the figure); only the data ring and the figure follow it.
// Greens: no level's colour run (SWEEPS) takes one, so the frame never
// matches the ring (the user's word)
export const FRAME = { brackets: ['#a3e635', '#10b981'], inner: '#34d399', core: '#a3e635' };
// the figure in the core and a few small marks: white (the user's word)
export const FIGURE = '#f8fafc';
// behind a readout: a faint grid, and a mark in each corner
const backdrop = s => {
  let g = '';
  for (let v = 20; v < s; v += 20) g += '<path d="M' + v + ' 0V' + s + 'M0 ' + v + 'H' + s + '" stroke="' + HUD + '" stroke-opacity="0.09" stroke-width="0.6"/>';
  const k = 9, e = s - 1;
  return g + '<path d="M1 ' + k + 'V1H' + k + 'M' + (e - k + 1) + ' 1H' + e + 'V' + k + 'M' + e + ' ' + (e - k + 1) + 'V' + e + 'H' + (e - k + 1) + 'M' + k + ' ' + e + 'H1V' + (e - k + 1) + '" fill="none" stroke="' + HUD + '" stroke-opacity="0.9" stroke-width="1.4"/>';
};
export const reactorSvg = (pct, color, marker = null, size = 160, label = 'WEEK USED') => {
  const c = 80, p = clamp(pct, 0, 100);
  const line = (a, r0, r1, extra) => { const [x1, y1] = polar(c, c, a, r0), [x2, y2] = polar(c, c, a, r1); return '<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" ' + extra + '/>'; };
  const ring = (r, extra) => '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" ' + extra + '/>';
  const turn = (body, from, to, dur) => '<g>' + body + '<animateTransform attributeName="transform" type="rotate" from="' + from + ' ' + c + ' ' + c + '" to="' + to + ' ' + c + ' ' + c + '" dur="' + dur + 's" repeatCount="indefinite"/></g>';
  const stroke = (col, w, op = 1) => 'stroke="' + col + '" stroke-width="' + w + '"' + (op < 1 ? ' stroke-opacity="' + op + '"' : '');
  // outside the data ring solid colours, no blends (the user's word: more
  // colour, more contrast), the same at every level (FRAME)
  // the bracket arcs, one a quadrant, two colours by turns
  let brackets = '';
  for (let q = 0; q < 4; q++) brackets += '<path d="' + arc(c, c, 77, q * 90 + 18, q * 90 + 72) + '" fill="none" ' + stroke(FRAME.brackets[q % 2], 2.5, 0.95) + '/>';
  // the scale: a mark every 5 degrees, longer every 30, and the four axes
  let scale = '';
  for (let a = 0; a < 360; a += 5) scale += line(a, a % 30 ? 67 : 65, 70, stroke(HUD, a % 30 ? 0.8 : 1.4, a % 30 ? 0.45 : 0.9));
  for (let a = 0; a < 360; a += 90) scale += line(a, 71, 79, stroke(HUD, 1.2, 0.9));
  // the data ring, the one part in a gradient (the user's word): the lit
  // blocks run the level's colour run from the top to the figure, with a
  // glow; the unlit ones a faint grey
  const n = 48, step = 360 / n, lit = p / 100 * n, span = Math.max(1, Math.ceil(lit) - 1);
  let blocks = '', dark = '';
  for (let i = 0; i < n; i++) {
    const part = clamp(lit - i, 0, 1);
    const d = arc(c, c, 56, i * step + 1, (i + 1) * step - 1);
    if (part > 0) blocks += '<path d="' + d + '" fill="none" ' + stroke(sweepAt(color, i / span), 8, 0.45 + 0.55 * part) + '/>';
    else dark += '<path d="' + d + '" fill="none" ' + stroke('#808080', 8, 0.16) + '/>';
  }
  blocks = dark + '<g filter="url(#glow)">' + blocks + '</g>';
  // the budget line: a pointer outside the ring and a hair line across it
  let pointer = '', word = '';
  if (marker !== null) {
    const a = clamp(marker, 0, 100) * 3.6;
    const [tx, ty] = polar(c, c, a, 62), [lx, ly] = polar(c, c, a - 4, 71), [rx, ry] = polar(c, c, a + 4, 71);
    // in a colour of its own (the user's word: not the ring's), with a dark
    // edge so it stands on a lit ring of any level's colour
    pointer = line(a, 47, 64, stroke('#0b1220', 4.5)) + line(a, 47, 64, stroke(BUDGET_LINE, 2.5))
      + '<path d="M' + num(tx) + ' ' + num(ty) + 'L' + num(lx) + ' ' + num(ly) + 'L' + num(rx) + ' ' + num(ry) + 'z" fill="' + BUDGET_LINE + '" stroke="#0b1220" stroke-width="1"/>';
    const over = pct > marker;
    word = '<text x="' + c + '" y="' + (c - 15) + '" text-anchor="middle" ' + FONT + ' font-size="6.5" letter-spacing="1.5" fill="' + (over ? AMBER : HUD) + '">' + (over ? 'OVER LINE' : 'NOMINAL') + '</text>';
  }
  // the inner ring: three dashed arcs with a white square node at each start
  let inner = '';
  for (let k = 0; k < 3; k++) {
    const [dx, dy] = polar(c, c, k * 120, 43);
    inner += '<path d="' + arc(c, c, 43, k * 120, k * 120 + 96) + '" fill="none" ' + stroke(FRAME.inner, 2) + ' stroke-dasharray="7 2"/>'
      + '<rect x="' + num(dx - 2) + '" y="' + num(dy - 2) + '" width="4" height="4" fill="' + FIGURE + '" transform="rotate(' + k * 120 + ' ' + num(dx) + ' ' + num(dy) + ')"/>';
  }
  // the core, a reactor's glow (the user's pick of the sketches): a white
  // heart fading out through green, breathing slowly; ten angled cells round
  // it; a thin white rim; and under the figure a strip of twelve cells lit
  // by the week in the level's gradient
  let cells = '';
  for (let i = 0; i < 10; i++) {
    const a0 = i * 36 + 4, a1 = i * 36 + 32;
    const q = [polar(c, c, a0, 30), polar(c, c, a1, 30), polar(c, c, a1 - 3, 36), polar(c, c, a0 + 3, 36)];
    cells += '<polygon points="' + q.map(([x, y]) => num(x) + ',' + num(y)).join(' ') + '" fill="' + FRAME.inner + '" fill-opacity="0.75"/>';
  }
  const on = Math.round(p / 100 * 12);
  let strip = '';
  for (let i = 0; i < 12; i++) strip += '<rect x="' + num(62 + i * 3) + '" y="101" width="2.2" height="3" fill="' + (i < on ? sweepAt(color, i / Math.max(1, on - 1)) : '#808080') + '" fill-opacity="' + (i < on ? 1 : 0.25) + '"/>';
  const core = '<circle cx="' + c + '" cy="' + c + '" r="31" fill="url(#heart)"><animate attributeName="opacity" values="0.8;1;0.8" dur="4s" repeatCount="indefinite"/></circle>'
    + cells + ring(29, stroke(FIGURE, 0.8, 0.8));
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 160 160">'
    + '<defs>' + GLOW + '<radialGradient id="heart"><stop offset="0" stop-color="' + FIGURE + '" stop-opacity="0.55"/><stop offset="0.45" stop-color="' + FRAME.inner + '" stop-opacity="0.25"/><stop offset="1" stop-color="' + FRAME.inner + '" stop-opacity="0"/></radialGradient></defs>'
    + backdrop(160) + turn(brackets, 0, 360, 90)
    + ring(74, stroke(HUD, 0.8, 0.4)) + scale
    + ring(61.5, stroke(HUD, 0.8, 0.5)) + ring(50.5, stroke(HUD, 0.8, 0.5))
    + blocks + pointer
    + turn(inner, 360, 0, 40)
    + core + strip + word
    + '<text x="' + c + '" y="' + (c + 7) + '" text-anchor="middle" ' + FONT + ' font-size="24" font-weight="700" fill="' + FIGURE + '">' + Math.round(clamp(pct, 0, 999)) + '%</text>'
    + '<text x="' + c + '" y="' + (c + 18) + '" text-anchor="middle" ' + FONT + ' font-size="6.5" letter-spacing="1.5" fill="' + HUD + '">' + label + '</text>'
    + '</svg>';
};

// A console's ruler: a base line with fine marks, three solid blocks at its
// start and a bracket at its end. Drawn under the dial, between the readout
// and the meters.
export const rulerSvg = (w = 480, h = 12) => {
  let marks = '';
  for (let x = 60, i = 0; x < w - 16; x += 10, i++) marks += '<path d="M' + x + ' ' + (i % 5 ? 5 : 2) + 'V8" stroke="' + HUD + '" stroke-opacity="' + (i % 5 ? 0.4 : 0.85) + '" stroke-width="1"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + '<rect x="0" y="2" width="12" height="6" fill="' + HUD + '"/><rect x="16" y="2" width="12" height="6" fill="' + HUD + '" fill-opacity="0.65"/><rect x="32" y="2" width="12" height="6" fill="' + AMBER + '"/>'
    + '<path d="M52 8H' + (w - 8) + '" stroke="' + HUD + '" stroke-opacity="0.7" stroke-width="1"/>' + marks
    + '<path d="M' + (w - 8) + ' 1h7v10h-7" fill="none" stroke="' + HUD + '" stroke-width="1.2"/></svg>';
};

// A power level: bars rising like a signal meter, lit up to the figure.
export const levelSvg = (pct, color, marker = null, size = 132, label = 'WEEK') => {
  const n = 16, gap = 3, left = 6, base = size - 30, top = 34, p = clamp(pct, 0, 100);
  const bw = (size - left * 2 - gap * (n - 1)) / n, lit = p / 100 * n;
  let bars = '';
  for (let i = 0; i < n; i++) {
    const h = 10 + (base - top - 10) * (i + 1) / n, x = left + i * (bw + gap), part = clamp(lit - i, 0, 1);
    const hue = sweepAt(color, i / (n - 1));
    const rect = extra => '<rect x="' + num(x) + '" y="' + num(base - h) + '" width="' + num(bw) + '" height="' + num(h) + '" rx="1.5" ' + extra + '/>';
    bars += rect('fill="#808080" fill-opacity="0.2"') + (part > 0 ? rect('fill="' + hue + '" fill-opacity="' + num(0.35 + 0.65 * part) + '" filter="url(#glow)"') : '');
  }
  let mark = '';
  if (marker !== null) {
    const x = num(left + clamp(marker, 0, 100) / 100 * (size - left * 2));
    mark = '<path d="M' + x + ' ' + (top - 6) + 'V' + (base + 4) + '" stroke="#e5e7eb" stroke-width="2" stroke-dasharray="3 3" stroke-linecap="round"/>';
  }
  return SVG(size, size,
    '<text x="' + left + '" y="24" ' + FONT + ' font-size="' + num(size / 5.5) + '" font-weight="700" fill="' + color + '">' + Math.round(p) + '%</text>'
    + '<text x="' + (size - left) + '" y="24" text-anchor="end" ' + FONT + ' font-size="' + num(size / 16) + '" letter-spacing="2" fill="' + HUD + '">' + label + '</text>'
    + bars + mark
    + '<path d="M' + left + ' ' + (base + 7) + 'H' + (size - left) + '" stroke="' + HUD + '" stroke-opacity="0.6" stroke-width="1"/>');
};

// The pane's frame: an edge across its top (a tab with a cut corner, a step
// down to the line, fine marks at the far end) and one across its bottom (a
// notch in the middle holding three blocks).
export const edgeSvg = (bottom = false, w = 480, h = 16, HUD = LINE) => {
  const s = 'fill="none" stroke="' + HUD + '" stroke-width="1.3"';
  let marks = '';
  for (let x = w - 96; x < w - 14; x += 8) marks += '<path d="M' + x + ' 10v4" stroke="' + HUD + '" stroke-opacity="0.55" stroke-width="1"/>';
  const body = bottom
    ? '<path d="M1 1v7l6 6h' + (w / 2 - 47) + 'l6 -6h68l6 6h' + (w / 2 - 47) + 'l6 -6V1" ' + s + '/>'
      + '<rect x="' + (w / 2 - 24) + '" y="11" width="12" height="3" fill="' + HUD + '"/><rect x="' + (w / 2 - 6) + '" y="11" width="12" height="3" fill="' + HUD + '" fill-opacity="0.6"/><rect x="' + (w / 2 + 12) + '" y="11" width="12" height="3" fill="' + AMBER + '"/>'
    : '<path d="M1 15V7l6 -6h130l7 7H' + (w - 8) + 'l7 7" ' + s + '/>'
      + '<rect x="12" y="5" width="46" height="4" fill="' + HUD + '"/><rect x="64" y="5" width="14" height="4" fill="' + AMBER + '"/><rect x="84" y="5" width="8" height="4" fill="' + HUD + '" fill-opacity="0.55"/>' + marks;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + body + '</svg>';
};

// A section's frame: an edge above it and one below, each section's its own
// shape, in the section's accent, filled with the same light tint the
// section's body has so the three read as one panel.
//   week:    a tab at the left with blocks, fine marks at the right; below, a
//            cut corner at the left and a notch at the right
//   agents:  a raised tab in the middle with three lights; below, a notch in
//            the middle with three blocks
//   models:  a tab at the right, slanted hatching at the left; below, the
//            mirror of it
//   context: a bracket at each end and a broken line between; the same below
export const TINT = 0.09;
export const FRAMES = ['week', 'agents', 'models', 'context'];
export const frameSvg = (kind = 'week', bottom = false, accent = HUD, w = 480) => {
  const h = bottom ? 12 : 14, e = w - 1;
  const st = 'fill="none" stroke="' + accent + '" stroke-width="1.3"';
  const rect = (x, y, rw, rh, op = 1) => '<rect x="' + x + '" y="' + y + '" width="' + rw + '" height="' + rh + '" fill="' + accent + '"' + (op < 1 ? ' fill-opacity="' + op + '"' : '') + '/>';
  let hatch = '';
  const hatchAt = (from, y) => { for (let x = from; x < from + 64; x += 7) hatch += '<path d="M' + x + ' ' + (y + 4) + 'l4 -4" stroke="' + accent + '" stroke-opacity="0.7" stroke-width="1.1"/>'; };
  let line, extra = '';
  if (!bottom) {
    if (kind === 'agents') {
      line = 'M1 14V7H' + (w / 2 - 60) + 'l6 -6h108l6 6H' + e + 'V14';
      extra = [-18, 0, 18].map((d, i) => '<circle cx="' + (w / 2 + d) + '" cy="5" r="2" fill="' + accent + '"><animate attributeName="opacity" values="1;0.25;1" dur="1.8s" begin="' + (i * 0.3) + 's" repeatCount="indefinite"/></circle>').join('')
        + rect(8, 10, 22, 2, 0.6) + rect(w - 30, 10, 22, 2, 0.6);
    } else if (kind === 'models') {
      line = 'M1 14V7H' + (w - 104) + 'l6 -6h91l6 6V14';
      hatchAt(10, 9);
      extra = rect(w - 90, 4, 34, 3.5) + rect(w - 51, 4, 10, 3.5, 0.55) + rect(w - 36, 4, 10, 3.5, 0.55) + hatch;
    } else if (kind === 'context') {
      line = 'M11 4H1V14M' + (e - 10) + ' 4H' + e + 'V14';
      extra = '<path d="M17 4H' + (e - 16) + '" ' + st + ' stroke-dasharray="20 6"/>' + rect(17, 8, 40, 2, 0.6) + rect(w - 57, 8, 40, 2, 0.6);
    } else {
      line = 'M1 14V6l5 -5h92l6 6H' + e + 'V14';
      let marks = '';
      for (let x = w - 92; x < w - 10; x += 8) marks += '<path d="M' + x + ' 10v3" stroke="' + accent + '" stroke-opacity="0.6" stroke-width="1"/>';
      extra = rect(10, 4.5, 34, 3.5) + rect(49, 4.5, 10, 3.5, 0.55) + marks;
    }
  } else if (kind === 'agents') {
    line = 'M1 0V5l6 6H' + (w / 2 - 46) + 'l6 -6h80l6 6H' + (e - 6) + 'l6 -6V0';
    extra = rect(w / 2 - 26, 8, 12, 3) + rect(w / 2 - 6, 8, 12, 3, 0.6) + rect(w / 2 + 14, 8, 12, 3, 0.35);
  } else if (kind === 'models') {
    line = 'M1 0V5l6 6h86l6 -6H' + e + 'V0';
    hatchAt(w - 74, 1);
    extra = rect(12, 7, 30, 2.5) + rect(47, 7, 9, 2.5, 0.55) + hatch;
  } else if (kind === 'context') {
    line = 'M1 0V8H11M' + (e - 10) + ' 8H' + e + 'V0';
    extra = '<path d="M17 8H' + (e - 16) + '" ' + st + ' stroke-dasharray="20 6"/>';
  } else {
    line = 'M1 0V5l6 6H' + (w - 96) + 'l6 -6H' + e + 'V0';
    extra = rect(w - 84, 7, 12, 3) + rect(w - 68, 7, 12, 3, 0.6) + rect(w - 52, 7, 12, 3, 0.35);
  }
  // the tint under the edge: the outline closed along the body's side; the
  // bracket frame has no closed outline, so a plain band
  const fill = kind === 'context'
    ? '<rect x="1" y="' + (bottom ? 0 : 4) + '" width="' + (w - 2) + '" height="' + (bottom ? 8 : 10) + '" fill="' + accent + '" fill-opacity="' + TINT + '"/>'
    : '<path d="' + line + 'Z" fill="' + accent + '" fill-opacity="' + TINT + '"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
    + fill + '<path d="' + line + '" ' + st + '/>' + extra + '</svg>';
};

export const DIALS = { ring: ringSvg, gauge: gaugeSvg, reactor: reactorSvg, level: levelSvg };
export const DIAL = 'reactor';

// The tree. `t` is the surface's element table; `m` the model:
//   level 'ok' | 'over' | 'throttle' | 'stop', levelText
//   budget { big, sub } | null: the time left today, and what that means
//   meters [{ label, pct, line?, note? }]
//   notes [text]
//   mix [{ name, share }], running [text]
//   context { used, of, pct } | null, contextNote
//   empty (text, when there is no reading)
// `o`: surface, placement, onRefresh, dial (a key of DIALS).
export const paneView = (t, m, o = {}) => {
  const { Box, Text, Button } = t;
  // the terminal's table may carry an Svg that draws nothing: go by the surface
  const hasSvg = o.surface !== 'terminal' && typeof t.Svg === 'function';
  const color = LEVEL_COLORS[m.level] || LEVEL_COLORS.ok;
  const col = (children, extra = {}) => Box({ flexDirection: 'column', ...extra, children: children.filter(Boolean) });
  const row = (children, extra = {}) => Box({ flexDirection: 'row', ...extra, children: children.filter(Boolean) });
  const cap = (text, extra = {}) => Text({ size: 'caption', dimColor: true, ...extra, children: text });
  const head = (text, accent = HUD) => Text({ size: 'caption', mono: true, weight: 'semibold', color: accent, children: '▸ ' + text.toUpperCase() });
  const bar = (segments, marker, alt, loud = false) => (hasSvg
    ? t.Svg({ source: barSvg(segments, marker, 480, 34, loud), alt })
    : Text({ color: segments[0] ? segments[0].color : undefined, children: barText(segments, 24, loud ? marker : null) }));
  // a section: its drawn upper edge in its accent, then its rows (no box)
  const tint = hex => { const v = parseInt(hex.slice(1), 16); return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + TINT + ')'; };
  const panel = (kind, children, extra = {}) => {
    const accent = ACCENTS[kind] || HUD;
    if (!hasSvg) return col(children, extra);
    return col([
      t.Svg({ source: frameSvg(kind, false, accent), alt: 'The upper edge of a section' }),
      Box({ flexDirection: 'column', paddingX: 1, backgroundColor: tint(accent), ...extra, children: children.filter(Boolean) }),
      t.Svg({ source: frameSvg(kind, true, accent), alt: 'The lower edge of a section' }),
    ]);
  };
  const between = (left, right) => row([left, right], { justifyContent: 'space-between', columnGap: 1 });
  const dot = c => Text({ color: c, children: '● ' });
  const legend = (c, name, value) => between(
    row([dot(c), Text({ wrap: 'truncate-end', children: name })], { flexShrink: 1 }),
    Text({ tabular: true, mono: true, color: c, children: value }));
  const meterColor = x => (x.pct >= 100 ? LEVEL_COLORS.stop : x.line != null && x.pct > x.line ? LEVEL_COLORS.over : LEVEL_COLORS.ok);

  // the minimized form: the budget and the week's bar, nothing to press
  if (o.placement === 'widget') {
    const w = m.meters && m.meters[0];
    return col([
      Text({ weight: 'semibold', children: m.budget ? m.budget.big + ' ' + m.budget.sub : (m.empty || 'Pacing') }),
      w ? bar([{ pct: w.pct, color: meterColor(w) }], w.line ?? null, w.label + ' ' + Math.round(w.pct) + '% used') : null,
      w ? cap(w.label + ' ' + Math.round(w.pct) + '%') : null,
    ]);
  }

  const sections = [];
  // the week's dial, and beside it the time left today in plain words
  if (m.budget) {
    const w = m.meters && m.meters[0];
    const words = col([
      Text({ size: 'title', weight: 'bold', mono: true, color: color, children: m.budget.big }),
      Text({ weight: 'medium', children: m.budget.sub }),
      Text({ size: 'caption', color: LEVEL_TEXT[m.level] || 'success', children: '● ' + m.levelText }),
    ], { flexShrink: 1, justifyContent: 'center' });
    const dial = DIALS[o.dial] || DIALS[DIAL];
    sections.push(hasSvg && w
      ? row([t.Svg({ source: dial(w.pct, color, w.line ?? null), alt: w.label + ' ' + Math.round(w.pct) + '% used', width: 124, height: 124 }), words], { columnGap: 2, alignItems: 'center' })
      : words);
    if (hasSvg) sections.push(t.Svg({ source: rulerSvg(), alt: 'A divider' }));
  } else if (m.empty) sections.push(Text({ children: m.empty }));

  if (m.meters && m.meters.length) {
    sections.push(panel('week', [head('This week', ACCENTS.week), ...m.meters.map(x => col([
      between(Text({ weight: 'medium', children: x.label }), Text({ tabular: true, mono: true, weight: 'semibold', color: sweepAt(meterColor(x), x.pct / 100), children: Math.round(x.pct) + '%' })),
      bar([{ pct: x.pct, color: meterColor(x) }], x.line ?? null, x.label + ' ' + Math.round(x.pct) + '% used'
        + (x.loud && x.line != null ? ', budget line ' + Math.round(x.line) + '%' : ''), !!x.loud),
      // a loud line's words: in its colour, bold when over
      x.note ? (x.loud && x.over ? Text({ size: 'caption', weight: 'semibold', color: 'error', children: '▲ ' + x.note })
        : x.loud ? Text({ size: 'caption', color: 'warning', children: x.note }) : cap(x.note)) : null,
    ]))], { rowGap: 1 }));
  }

  if (m.running && m.running.length) {
    sections.push(panel('agents', [head('Agents at work', ACCENTS.agents), ...m.running.map((x, i) => (hasSvg
      ? row([t.Svg({ source: robotSvg(PALETTE[i % PALETTE.length], i), alt: 'An agent at work', width: 36, height: 36 }), Box({ flexDirection: 'column', flexShrink: 1, justifyContent: 'center', children: [Text({ children: x })] })], { columnGap: 1, alignItems: 'center' })
      : Text({ children: '🤖 ' + x })))], { rowGap: 1 }));
  }

  // the context: how full it is, one figure and one bar
  if (m.context) {
    const c = m.context;
    sections.push(panel('context', [head('Context', ACCENTS.context),
      between(Text({ weight: 'medium', children: c.used + (c.of ? ' of ' + c.of : '') }), c.pct != null ? Text({ tabular: true, mono: true, weight: 'semibold', color: ACCENTS.context, children: Math.round(c.pct) + '%' }) : null),
      c.pct != null ? bar([{ pct: c.pct, color: c.pct >= 50 ? LEVEL_COLORS.over : ACCENTS.context }], null, 'Context ' + Math.round(c.pct) + '% full') : null,
    ]));
  } else if (m.contextNote) sections.push(panel('context', [head('Context', ACCENTS.context), cap(m.contextNote)]));

  if (m.mix && m.mix.length) {
    const segs = m.mix.map((x, i) => ({ pct: x.share, color: PALETTE[i % PALETTE.length] }));
    sections.push(panel('models', [head('Models this session', ACCENTS.models),
      bar(segs, null, m.mix.map(x => x.name + ' ' + x.share + '%').join(', ')),
      ...m.mix.map((x, i) => legend(segs[i].color, x.name, x.share + '%'))]));
  }

  if (m.notes && m.notes.length) sections.push(col(m.notes.map(n => cap(n)), { rowGap: 1 }));

  // `onRefresh: null` draws no button (a second drawing of the pane in one tree)
  if (o.onRefresh !== null) sections.push(row([Button({ key: 'pacing-pane-refresh', label: 'Refresh', variant: 'secondary', onPress: o.onRefresh || (() => {}) })]));
  // framed, where there are drawings: an edge above and one below
  if (hasSvg && o.frame !== false) { sections.unshift(t.Svg({ source: edgeSvg(false), alt: 'The upper edge of the pane' })); sections.push(t.Svg({ source: edgeSvg(true), alt: 'The lower edge of the pane' })); }
  return col(sections, { rowGap: 1 });
};
