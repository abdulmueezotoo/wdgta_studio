// WDGTA Studio — kinetic typography renderer.
// Pure drawing code: given cards (groups of timed words) and a time, paint one frame.
// Used by both the live preview and the MP4 exporter, so what you see is what you export.

export const BRAND = {
  ink: '#0E0E0C',
  mist: '#E7ECF2',
  yellow: '#FFC710',
  graphite: '#5E5B55',
  stone: '#A8A398',
  white: '#FFFFFF',
};

export const FORMATS = {
  '9x16': { id: '9x16', label: '9:16', name: 'Vertical', use: 'TikTok, Reels, Shorts, Status', w: 1080, h: 1920 },
  '4x5': { id: '4x5', label: '4:5', name: 'Portrait', use: 'Instagram & Facebook feed, LinkedIn', w: 1080, h: 1350 },
  '1x1': { id: '1x1', label: '1:1', name: 'Square', use: 'Instagram, Facebook, LinkedIn', w: 1080, h: 1080 },
  '16x9': { id: '16x9', label: '16:9', name: 'Landscape', use: 'YouTube, Facebook, LinkedIn', w: 1920, h: 1080 },
};

export const ELEMENTS = { text: 'Words', logo: 'Logo', title: 'Title', handle: 'Handle', progress: 'Progress line', note: 'Marker note', chapter: 'Chapter label', badge: 'Capsule badge' };

/**
 * Background themes. Dark backgrounds: white words, yellow key words.
 * Light backgrounds follow the brand rules: Ink words; key words become Ink-on-yellow blocks
 * (or yellow-on-Ink blocks when the background itself is yellow).
 */
export const THEMES = {
  ink:      { name: 'Ink',      bg: '#0E0E0C', text: '#FFFFFF', dim: '#34322E', from: '#A8A398', key: '#FFC710', keyStyle: 'color', meta: '#A8A398', track: '#26251F', fill: '#A8A398', marker: '#E8512A', logo: 'white' },
  black:    { name: 'Black',    bg: '#000000', text: '#FFFFFF', dim: '#2B2A27', from: '#A8A398', key: '#FFC710', keyStyle: 'color', meta: '#A8A398', track: '#1C1B19', fill: '#A8A398', marker: '#E8512A', logo: 'white' },
  graphite: { name: 'Graphite', bg: '#5E5B55', text: '#FFFFFF', dim: '#7A766F', from: '#D9D5CC', key: '#FFC710', keyStyle: 'color', meta: '#E7ECF2', track: '#4E4B46', fill: '#E7ECF2', marker: '#FF8A63', logo: 'white' },
  mist:     { name: 'Mist',     bg: '#E7ECF2', text: '#0E0E0C', dim: '#C2C7CD', from: '#5E5B55', key: '#0E0E0C', keyBg: '#FFC710', keyStyle: 'block', meta: '#5E5B55', track: '#CDD3DA', fill: '#0E0E0C', marker: '#E8512A', logo: 'black' },
  stone:    { name: 'Stone',    bg: '#A8A398', text: '#0E0E0C', dim: '#8E897F', from: '#3A3833', key: '#0E0E0C', keyBg: '#FFC710', keyStyle: 'block', meta: '#22211D', track: '#959085', fill: '#0E0E0C', marker: '#B8300C', logo: 'black' },
  yellow:   { name: 'Yellow',   bg: '#FFC710', text: '#0E0E0C', dim: '#E0AA00', from: '#5E4A00', key: '#FFC710', keyBg: '#0E0E0C', keyStyle: 'block', meta: '#0E0E0C', track: '#E5B000', fill: '#0E0E0C', marker: '#0E0E0C', logo: 'black' },
};

const HEAD_FONT = '"Arial Black", "Archivo Black", "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const HAND_FONT = '"Kalam", "Comic Sans MS", "Segoe Print", cursive';

const STOP = new Set(('a an and are as at be been but by can could did do does doing for from had has have he her him his how i ' +
  'if in into is it its just like me my no not now of on or our out so some than that the their them then there these they ' +
  'this those to too up us very was we were what when where which who why will with would you your yours about also because ' +
  'really thing things get got going gonna want wanna dey go am im ive youre dont thats theres lets okay yeah right well ' +
  'one two all any more most much many even still only own same such each other over under again further once here').split(' '));

/** Text shown on screen for a word. */
export function displayWord(raw, upper = true) {
  let s = String(raw).trim();
  const q = /\?$/.test(s);
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
  if (q && s) s += '?';
  return upper ? s.toUpperCase() : s;
}

function bare(w) { return String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

/** Pick up to n meaningful words in a card to highlight in yellow (fewer on short screens). */
export function autoKeys(words, n = 1) {
  const limit = Math.max(1, Math.min(n, Math.ceil(words.length / 3)));
  const scored = [];
  words.forEach((wd, i) => {
    const b = bare(wd.w);
    if (b.length < 4 || STOP.has(b)) return;
    scored.push({ i, sc: b.length + (/\d/.test(b) ? 3 : 0) });
  });
  scored.sort((a, b) => b.sc - a.sc || a.i - b.i);
  return scored.slice(0, limit).map(x => x.i).sort((a, b) => a - b);
}

/** Bring older project data (single `key`) up to date. */
export function normalizeCard(c) {
  if (!Array.isArray(c.keys)) c.keys = c.key == null ? [] : [c.key];
  delete c.key;
  return c;
}

/**
 * Group a flat list of timed words into on-screen cards.
 * words: [{w, s, e}] (seconds). Returns [{words:[...], keys:[indices]}]
 */
export function buildCards(words, opts = {}) {
  const maxWords = opts.maxWords ?? 6;
  const maxDur = opts.maxDur ?? 3.2;
  const gap = opts.gap ?? 0.6;
  const cards = [];
  let cur = null;
  for (const wd of words) {
    if (!wd.w || !String(wd.w).trim()) continue;
    if (cur) {
      const prev = cur.words[cur.words.length - 1];
      const n = cur.words.length;
      const brk =
        wd.s - prev.e > gap ||
        /[.?!]["')\]]?$/.test(prev.w) ||
        (/[,;:]$/.test(prev.w) && n >= 3) ||
        n >= maxWords ||
        wd.e - cur.words[0].s > maxDur;
      if (brk) { cards.push(cur); cur = null; }
    }
    if (!cur) cur = { words: [] };
    const o = { w: String(wd.w).trim(), s: wd.s, e: wd.e };
    if (wd.edited) o.edited = true;
    cur.words.push(o);
  }
  if (cur) cards.push(cur);
  for (const c of cards) c.keys = autoKeys(c.words, opts.keys ?? 1);
  return cards;
}

export function cardStart(c) { return c.words.length ? c.words[0].s : 0; }
export function cardEnd(c) { return c.words.length ? c.words[c.words.length - 1].e : 0; }

/** Index of the card on screen at time t (or -1). */
export function cardAt(cards, t) {
  let lo = 0, hi = cards.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cardStart(cards[mid]) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Suggest clip boundaries of roughly `target` seconds, cutting at the longest pause near each target.
 * Returns [{start, end}].
 */
export function suggestClips(cards, target = 60, total = 0) {
  if (!cards.length) return [];
  const end = Math.max(total, cardEnd(cards[cards.length - 1]));
  const out = [];
  let i = 0;
  while (i < cards.length) {
    const s = Math.max(0, cardStart(cards[i]) - 0.25);
    let best = -1, bestScore = -Infinity;
    for (let j = i; j < cards.length; j++) {
      const len = cardEnd(cards[j]) - s;
      if (len > target * 1.35) break;
      if (len < target * 0.6) continue;
      const pause = (cards[j + 1] ? cardStart(cards[j + 1]) : end) - cardEnd(cards[j]);
      const sentence = /[.?!]["')\]]?$/.test(cards[j].words[cards[j].words.length - 1].w) ? 0.6 : 0;
      const score = pause + sentence - Math.abs(len - target) / target;
      if (score > bestScore) { bestScore = score; best = j; }
    }
    if (best < 0) {
      // not enough left for a full clip: extend to the end (or stop if the remainder is tiny)
      // a short remainder joins the previous clip; otherwise it becomes its own (shorter) clip
      const rest = cardEnd(cards[cards.length - 1]) - s;
      if (out.length && rest < target * 0.3) { out[out.length - 1].end = Math.min(end, cardEnd(cards[cards.length - 1]) + 0.6); break; }
      best = cards.length - 1;
      for (let j = i; j < cards.length; j++) if (cardEnd(cards[j]) - s > target * 1.35) { best = Math.max(i, j - 1); break; }
    }
    out.push({ start: s, end: Math.min(end, cardEnd(cards[best]) + 0.6) });
    i = best + 1;
  }
  return out;
}

// ---------- element positions ----------

/** Default positions (fractions of width/height) for each element in each format. */
export function defaultLayout(fmtId) {
  const v = fmtId === '9x16', l = fmtId === '16x9';
  if (v) return {
    text: { x: 0.085, y: 0.46, s: 1 },
    logo: { x: 0.085, y: 0.055, s: 1 },
    title: { x: 0.085, y: 0.145, s: 1 },
    handle: { x: 0.085, y: 0.168, s: 1 },
    progress: { x: 0.085, y: 0.184, w: 0.83, s: 1 },
    note: { rel: true, x: 0.13, y: 0.7, s: 1 },
    chapter: { x: 0.085, y: 0.205, s: 1 },
    badge: { x: 0.915, y: 0.079, s: 1 },
  };
  if (l) return {
    text: { x: 0.1, y: 0.5, s: 1 },
    logo: { x: 0.06, y: 0.07, s: 1 },
    title: { x: 0.06, y: 0.235, s: 1 },
    handle: { x: 0.06, y: 0.9, s: 1 },
    progress: { x: 0, y: 0.992, w: 1, s: 1 },
    note: { rel: true, x: 0.13, y: 0.75, s: 1 },
    chapter: { x: 0.06, y: 0.285, s: 1 },
    badge: { x: 0.94, y: 0.1, s: 1 },
  };
  return {
    text: { x: 0.085, y: 0.52, s: 1 },
    logo: { x: 0.085, y: 0.07, s: 1 },
    title: { x: 0.085, y: fmtId === '4x5' ? 0.175 : 0.2, s: 1 },
    handle: { x: 0.085, y: 0.91, s: 1 },
    progress: { x: 0, y: 0.992, w: 1, s: 1 },
    note: { rel: true, x: 0.13, y: 0.75, s: 1 },
    chapter: { x: 0.085, y: fmtId === '4x5' ? 0.205 : 0.235, s: 1 },
    badge: { x: 0.915, y: fmtId === '4x5' ? 0.098 : 0.105, s: 1 },
  };
}

export function resolveLayout(fmtId, overrides) {
  const d = defaultLayout(fmtId);
  const o = overrides?.[fmtId] || {};
  const out = {};
  for (const k of Object.keys(d)) out[k] = { ...d[k], ...(o[k] || {}) };
  return out;
}

// ---------- text layout ----------

const SCALE = { S: 1, M: 1.45, L: 2.15 };

function textGeometry(fmt, pos) {
  const { w: W, h: H } = fmt;
  let base, maxH;
  if (fmt.id === '16x9') { base = H * 0.062; maxH = H * 0.62; }
  else if (fmt.id === '9x16') { base = W * 0.056; maxH = H * 0.42; }
  else if (fmt.id === '4x5') { base = W * 0.052; maxH = H * 0.5; }
  else { base = W * 0.05; maxH = H * 0.55; }
  const left = pos.x * W;
  const maxW = Math.max(W * 0.2, Math.min(fmt.id === '16x9' ? W * 0.7 : W * 0.83, W - left - W * 0.05));
  return { W, H, left, maxW, base: base * (pos.s || 1), centerY: pos.y * H, maxH: maxH * Math.max(1, pos.s || 1) };
}

const layoutCache = new WeakMap();

function wordClass(card, i) {
  if (card.keys && card.keys.includes(i)) return 'L';
  const b = bare(card.words[i].w);
  if (b.length >= 7 && !STOP.has(b)) return 'M';
  return 'S';
}

/** Compute line layout for a card in a format. Cached per card object + format + style. */
export function layoutCard(ctx, card, fmt, style, pos) {
  const right = card._spk === 'guest' && style.align !== false;
  const ck = [fmt.id, style.upper ? 1 : 0, right ? 'R' : 'L', (card.keys || []).join(','), pos.x, pos.y, pos.s, card.words.map(w => w.w).join(' ')].join('|');
  const per = layoutCache.get(card);
  if (per && per.ck === ck) return per.lay;

  const g = textGeometry(fmt, pos);
  const upper = style.upper !== false;
  const items = card.words.map((wd, i) => ({ i, text: displayWord(wd.w, upper), cls: wordClass(card, i) })).filter(it => it.text);

  ctx.save();
  ctx.font = `900 100px ${HEAD_FONT}`;
  const spaceU = ctx.measureText(' ').width / 100;
  for (const it of items) it.wU = ctx.measureText(it.text).width / 100;
  ctx.restore();

  const groups = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.cls === it.cls) last.items.push(it); else groups.push({ cls: it.cls, items: [it] });
  }

  function build(base) {
    const lines = [];
    for (const gr of groups) {
      const size = base * SCALE[gr.cls];
      let line = null;
      for (const it of gr.items) {
        const w = it.wU * size, sp = spaceU * size;
        if (line && line.width + sp + w <= g.maxW) {
          line.items.push({ ...it, x: line.width + sp, w });
          line.width += sp + w;
        } else {
          line = { cls: gr.cls, size, items: [{ ...it, x: 0, w }], width: w };
          lines.push(line);
        }
      }
    }
    let y = 0;
    for (const ln of lines) { ln.top = y; ln.baseline = y + ln.size * 0.8; y += ln.size * 0.98; }
    return { lines, height: y, maxWidth: Math.max(0, ...lines.map(l => l.width)) };
  }

  let base = g.base;
  let lay = build(base);
  for (let k = 0; k < 6 && (lay.maxWidth > g.maxW || lay.height > g.maxH); k++) {
    const f = Math.min(g.maxW / Math.max(lay.maxWidth, 1), g.maxH / Math.max(lay.height, 1), 1);
    base *= Math.max(0.6, f * 0.98);
    lay = build(base);
  }
  lay.x = g.left;
  if (right) {
    // guest: mirror the margin and right-align every line
    lay.x = fmt.w - g.left - lay.maxWidth;
    for (const ln of lay.lines) { const off = lay.maxWidth - ln.width; ln.items.forEach((it) => { it.x += off; }); }
  }
  lay.right = right;
  lay.y = g.centerY - lay.height / 2;
  lay.maxW = g.maxW;
  layoutCache.set(card, { ck, lay });
  return lay;
}

// ---------- drawing ----------

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const r = Math.round(ch(pa, 16) + (ch(pb, 16) - ch(pa, 16)) * t);
  const gg = Math.round(ch(pa, 8) + (ch(pb, 8) - ch(pa, 8)) * t);
  const bb = Math.round(ch(pa, 0) + (ch(pb, 0) - ch(pa, 0)) * t);
  return `rgb(${r},${gg},${bb})`;
}
const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// small deterministic random generator so hand-drawn marks don't jitter between frames
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

/** Draw the first fraction p of a polyline. */
function strokePartial(ctx, pts, p) {
  if (p <= 0 || pts.length < 2) return;
  const n = Math.max(2, Math.floor(pts.length * Math.min(1, p)));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function markPath(kind, x, top, w, h, size, seed) {
  const r = rng(seed);
  const pts = [];
  if (kind === 'circle') {
    const cx = x + w / 2, cy = top + h / 2;
    const rx = w / 2 + size * 0.28, ry = h / 2 + size * 0.22;
    const a0 = -2.5 + r() * 0.4, span = Math.PI * 2 * (1.06 + r() * 0.06);
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const a = a0 + span * i / N;
      const grow = 1 + (i / N) * 0.07 + (r() - 0.5) * 0.015;
      pts.push([cx + Math.cos(a) * rx * grow, cy + Math.sin(a) * ry * grow]);
    }
  } else if (kind === 'underline') {
    const y = top + h + size * 0.14, N = 40, tilt = (r() - 0.5) * size * 0.12;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      pts.push([x - size * 0.08 + (w + size * 0.2) * f, y + Math.sin(f * Math.PI * 2.2 + r()) * size * 0.03 + tilt * f]);
    }
  } else if (kind === 'strike') {
    const y = top + h * 0.52, N = 30, tilt = -size * 0.1 - r() * size * 0.08;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      pts.push([x - size * 0.1 + (w + size * 0.2) * f, y + tilt * (f - 0.5) + (r() - 0.5) * size * 0.015]);
    }
  }
  return pts;
}

function monoSize(fmt) { return Math.round(Math.max(18, (fmt.id === '16x9' ? fmt.h : fmt.w) * 0.024)); }

function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawNote(ctx, fmt, theme, card, t, L, textBox, boxes, rangeStart) {
  const note = (card.note || '').trim();
  if (!note) return;
  const { w: W, h: H } = fmt;
  const p = L.note;
  const size = monoSize(fmt) * 2.1 * (p.s || 1);
  ctx.save();
  ctx.font = `700 ${size}px ${HAND_FONT}`;
  const maxW = fmt.id === '16x9' ? W * 0.4 : W * 0.66;
  const lines = wrapText(ctx, note, maxW);
  const lineH = size * 1.05;
  const width = Math.max(...lines.map(l => ctx.measureText(l).width));
  const height = lines.length * lineH;
  let x, y;
  if (p.rel !== false && textBox) {
    x = textBox[0] + W * 0.06;
    y = textBox[1] + textBox[3] + size * 0.9;
  } else { x = p.x * W; y = p.y * H; }
  x = Math.min(x, W - width - W * 0.03);
  y = Math.min(y, H - height - H * 0.03);

  const start = Math.max(cardStart(card), rangeStart) + 0.25;
  const k = ease((t - start) / 0.7);
  if (k <= 0) { ctx.restore(); boxes.note = [x, y, width, height]; return; }

  ctx.strokeStyle = theme.marker; ctx.fillStyle = theme.marker;
  ctx.lineWidth = Math.max(3, size * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // hand-drawn arrow from the note up towards the words
  const ax = x - size * 0.35, ay = y + size * 0.45;
  const bx = x - size * 0.55, by = y - size * 0.95;
  const arrow = [];
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    const cx = x - size * 1.15, cy = y - size * 0.05;
    arrow.push([(1 - f) * (1 - f) * ax + 2 * (1 - f) * f * cx + f * f * bx, (1 - f) * (1 - f) * ay + 2 * (1 - f) * f * cy + f * f * by]);
  }
  const ka = Math.min(1, k / 0.45);
  strokePartial(ctx, arrow, ka);
  if (ka >= 1) {
    const hl = size * 0.32;
    ctx.beginPath();
    ctx.moveTo(bx - hl * 0.7, by + hl * 0.55); ctx.lineTo(bx, by); ctx.lineTo(bx + hl * 0.75, by + hl * 0.35);
    ctx.stroke();
  }
  // handwriting "writes on" from left to right
  const kt = Math.max(0, (k - 0.25) / 0.75);
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4, y - size, (width + 8) * kt, height + size * 1.5); ctx.clip();
  ctx.translate(x, y); ctx.rotate(-0.035);
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lineH));
  ctx.restore();
  ctx.restore();
  boxes.note = [x, y, width, height];
}

function drawBrand(ctx, fmt, t, style, theme, L, boxes) {
  const { w: W, h: H } = fmt;
  ctx.textBaseline = 'top';

  const logo = style.logo || (theme.logo === 'black' ? style.logoDark : style.logoLight);
  if (logo && logo.complete && logo.naturalWidth && style.showLogo !== false) {
    const p = L.logo;
    const lw = (fmt.id === '16x9' ? W * 0.22 : fmt.id === '9x16' ? W * 0.5 : W * 0.42) * (p.s || 1);
    const lh = lw * logo.naturalHeight / logo.naturalWidth;
    const x = p.x * W, y = p.y * H;
    ctx.drawImage(logo, x, y, lw, lh);
    boxes.logo = [x, y, lw, lh];
  }
  if (style.badge) {
    const p = L.badge;
    boxes.badge = drawBadge(ctx, style.badge, p.x * W, p.y * H, (fmt.id === '16x9' ? H * 0.026 : fmt.id === '9x16' ? W * 0.03 : W * 0.026) * (p.s || 1), theme);
  }

  const setMono = (s) => {
    const px = Math.round(monoSize(fmt) * (s || 1));
    ctx.font = `500 ${px}px ${MONO_FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * 0.08)}px`;
    return px;
  };
  const title = (style.title || '').trim().toUpperCase();
  if (title) {
    const p = L.title; const px = setMono(p.s);
    ctx.fillStyle = theme.meta;
    const x = p.x * W, y = p.y * H;
    ctx.fillText(title, x, y);
    boxes.title = [x, y, ctx.measureText(title).width, px * 1.2];
  }
  if (style.handle !== false) {
    const p = L.handle; const px = setMono(p.s);
    ctx.fillStyle = theme.meta;
    const x = p.x * W, y = p.y * H, txt = '@WEDEYGOTHROUGHAM';
    ctx.fillText(txt, x, y);
    boxes.handle = [x, y, ctx.measureText(txt).width, px * 1.2];
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  const r = style.range;
  const dur = r ? r.end - r.start : 0;
  if (style.progress !== false && dur > 0) {
    const p = L.progress;
    const bh = Math.max(4, H * 0.004) * (p.s || 1);
    const bx = p.x * W, by = Math.min(H - bh, p.y * H), bw = Math.min(W - bx, p.w * W);
    ctx.fillStyle = theme.track;
    ctx.fillRect(bx, by, bw, bh);
    const frac = Math.min(1, Math.max(0, (t - r.start) / dur));
    ctx.fillStyle = theme.fill;
    ctx.fillRect(bx, by, bw * frac, bh);
    // chapter points: a dot on the line where each chapter begins (lit once passed)
    if (style.chapterMarks !== false && style.chapters && style.chapters.length) {
      const rad = Math.max(4, bh * 1.35);
      for (const c of style.chapters) {
        const f = (c.t - r.start) / dur;
        if (f <= 0.002 || f >= 0.998) continue;
        const cx = bx + bw * f, cy = by + bh / 2;
        ctx.fillStyle = theme.bg;
        ctx.beginPath(); ctx.arc(cx, cy, rad + Math.max(2, bh * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = f <= frac ? theme.text : theme.meta;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      }
    }
    boxes.progress = [bx, by - 8, bw, bh + 16];
  }
}

/**
 * Paint one frame.
 * ctx: 2D context already scaled so that 1 unit = 1 output pixel of fmt.
 * style: { bg, upper, handle, progress, title, logo (custom Image), logoLight, logoDark, showLogo,
 *          layout (overrides), range:{start,end} }
 * Returns hit boxes {text, logo, title, handle, progress, note} in output pixels (used for drag-to-move).
 */
export function drawFrame(ctx, cards, t, fmt, style = {}) {
  const { w: W, h: H } = fmt;
  const theme = THEMES[style.bg] || THEMES.ink;
  const L = resolveLayout(fmt.id, style.layout);
  const boxes = {};
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  const rangeStart = style.range ? style.range.start : 0;
  const ci = cardAt(cards, t);
  let drewText = false;
  if (ci >= 0) {
    const card = cards[ci];
    const next = cards[ci + 1];
    const start = Math.max(cardStart(card), rangeStart), end = cardEnd(card);
    let alpha = ease((t - start) / 0.12);
    const holdUntil = next ? Math.min(cardStart(next), end + 2.2) : end + 2.2;
    if (t > holdUntil) alpha *= 1 - ease((t - holdUntil) / 0.3);
    if (alpha > 0.002) {
      const lay = layoutCard(ctx, card, fmt, style, L.text);
      const rise = (1 - ease((t - start) / 0.18)) * H * 0.012;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textBaseline = 'alphabetic';
      const keys = card.keys || [];
      const marks = [];
      for (const ln of lay.lines) {
        ctx.font = `900 ${ln.size}px ${HEAD_FONT}`;
        for (const it of ln.items) {
          const wd = card.words[it.i];
          const anim = style.anim || 'fade';
          const t0 = Math.max(wd.s, rangeStart);
          const k = ease((t - t0) / (anim === 'slide' ? 0.18 : 0.1));
          const spoken = t >= wd.s;
          const isKey = keys.includes(it.i);
          // fade keeps upcoming words visible but dim; the other styles reveal words as they are spoken
          if (!spoken && anim !== 'fade') continue;
          let dy = 0, scale = 1, text = it.text, alphaW = 1;
          if (anim === 'fade') dy = spoken ? (1 - k) * ln.size * 0.06 : 0;
          else if (anim === 'pop') {
            // grow from 55% to a slight overshoot (108%) and settle at 100%
            const q = Math.min(1, (t - t0) / 0.16);
            scale = q < 0.7 ? 0.55 + 0.53 * (q / 0.7) : 1.08 - 0.08 * ((q - 0.7) / 0.3);
            alphaW = Math.min(1, q * 3);
          }
          else if (anim === 'slide') { dy = (1 - k) * ln.size * 0.45; alphaW = k; }
          else if (anim === 'type') {
            const dur = Math.max(0.12, Math.min(0.45, (wd.e - wd.s) * 0.9));
            const n = Math.max(1, Math.ceil(text.length * Math.min(1, (t - t0) / dur)));
            text = text.slice(0, n);
          }
          const bx = lay.x + it.x, by = lay.y + ln.baseline + rise + dy;
          ctx.save();
          ctx.globalAlpha = alpha * alphaW;
          if (scale !== 1) {
            const cx = bx + it.w / 2, cy = by - ln.size * 0.36;
            ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
          }
          const kc = anim === 'fade' ? k : 1; // colour: fade style glows from grey, others land in their final colour
          if (isKey && theme.keyStyle === 'block' && spoken) {
            const padX = ln.size * 0.09;
            ctx.fillStyle = theme.keyBg;
            const tw = anim === 'type' ? ctx.measureText(text).width : it.w;
            ctx.fillRect(bx - padX, by - ln.size * 0.8, (tw + padX * 2) * (anim === 'fade' ? k : 1), ln.size * 0.94);
            ctx.fillStyle = mix(theme.text, theme.key, kc);
          } else {
            const target = isKey ? theme.key : theme.text;
            ctx.fillStyle = spoken ? mix(theme.from, target, kc) : theme.dim;
          }
          ctx.fillText(text, bx, by);
          ctx.restore();
          if (wd.mark && spoken) marks.push({ kind: wd.mark, x: bx, top: by - ln.size * 0.74, w: it.w, h: ln.size * 0.74, size: ln.size, s: Math.max(wd.s, rangeStart), seed: wd.w + it.i + ci });
        }
      }
      // marker annotations draw themselves on, just after the word is spoken
      ctx.strokeStyle = theme.marker;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const m of marks) {
        ctx.lineWidth = Math.max(4, m.size * 0.075);
        strokePartial(ctx, markPath(m.kind, m.x, m.top, m.w, m.h, m.size, m.seed), ease((t - m.s - 0.05) / 0.45));
      }
      ctx.restore();
      boxes.text = [lay.x, lay.y, Math.max(lay.maxWidth, W * 0.1), lay.height];
      drewText = true;
      if (style.showNames && style.names) {
        const nm = (card._spk === 'guest' ? style.names.guest : style.names.host) || '';
        if (nm.trim()) {
          ctx.save(); ctx.globalAlpha = alpha;
          const px = monoSize(fmt);
          ctx.font = `500 ${px}px ${MONO_FONT}`; ctx.fillStyle = theme.meta; ctx.textBaseline = 'alphabetic';
          if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * 0.08)}px`;
          const label = nm.trim().toUpperCase();
          const lw = ctx.measureText(label).width;
          ctx.fillText(label, lay.right ? lay.x + lay.maxWidth - lw : lay.x, lay.y - px * 0.9);
          ctx.restore();
        }
      }
      ctx.save(); ctx.globalAlpha = alpha;
      drawNote(ctx, fmt, theme, card, t, L, boxes.text, boxes, rangeStart);
      ctx.restore();
    }
  }
  if (!drewText) {
    const g = textGeometry(fmt, L.text);
    boxes.text = [g.left, g.centerY - g.base * 1.5, g.maxW * 0.6, g.base * 3];
  }
  drawBrand(ctx, fmt, t, style, theme, L, boxes);
  drawChapterLabel(ctx, fmt, t, style, theme, L, boxes);
  return boxes;
}

function drawChapterLabel(ctx, fmt, t, style, theme, L, boxes) {
  if (!style.showChapter || !style.chapters || !style.chapters.length) return;
  let cur = null;
  for (const c of style.chapters) if (c.t <= t + 1e-3 && (!cur || c.t >= cur.t)) cur = c;
  if (!cur) return;
  const { w: W, h: H } = fmt;
  const p = L.chapter;
  const px = Math.round(monoSize(fmt) * 1.05 * (p.s || 1));
  const since = t - Math.max(cur.t, style.range ? style.range.start : 0);
  ctx.save();
  ctx.globalAlpha = ease(since / 0.35);
  ctx.font = `500 ${px}px ${MONO_FONT}`; ctx.textBaseline = 'top';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * 0.1)}px`;
  const x = p.x * W, y = p.y * H, label = String(cur.name).toUpperCase();
  const rule = px * 1.6;
  ctx.fillStyle = theme.meta; ctx.fillRect(x, y + px * 0.5, rule * ease(since / 0.5), Math.max(2, px * 0.1));
  ctx.fillStyle = theme.text; ctx.fillText(label, x + rule + px * 0.6, y);
  const w = rule + px * 0.6 + ctx.measureText(label).width;
  ctx.restore();
  boxes.chapter = [x, y, w, px * 1.2];
}

// ---------- intro / outro cards ----------
function wrapWords(ctx, words, maxW) {
  const lines = []; let cur = []; let width = 0;
  const sp = ctx.measureText(' ').width;
  for (const w of words) {
    const ww = ctx.measureText(w.t).width;
    if (cur.length && width + sp + ww > maxW) { lines.push({ items: cur, width }); cur = []; width = 0; }
    cur.push({ ...w, x: cur.length ? width + sp : 0, ww });
    width = cur.length > 1 ? width + sp + ww : ww;
  }
  if (cur.length) lines.push({ items: cur, width });
  return lines;
}
/**
 * Branded intro (kind 'intro') or closing card (kind 'outro'), t seconds into a card lasting dur seconds.
 * style.bookends: { kicker, headline, sub, outroHeadline, outroSub }
 */
export function drawBookend(ctx, fmt, kind, t, dur, style = {}) {
  const { w: W, h: H } = fmt;
  const theme = THEMES[style.bg] || THEMES.ink;
  const b = style.bookends || {};
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);
  const fadeOut = kind === 'intro' ? 1 - ease((t - (dur - 0.35)) / 0.35) : 1;
  const fadeIn = ease(t / 0.4);
  const unit = fmt.id === '16x9' ? H : W;
  const M = fmt.id === '16x9' ? W * 0.08 : W * 0.085;
  const maxW = fmt.id === '16x9' ? W * 0.62 : W - M * 2;
  ctx.save();
  ctx.globalAlpha = fadeIn * fadeOut;

  const logo = style.logo || (theme.logo === 'black' ? style.logoDark : style.logoLight);
  if (style.badge) drawBadge(ctx, style.badge, W - M, fmt.id === '16x9' ? H * 0.08 : W * 0.085, unit * 0.022, theme);
  const kicker = (kind === 'intro' ? b.kicker : '') || '';
  const headRaw = kind === 'intro' ? (b.headline || style.title || '') : (b.outroHeadline || 'Full episode on Spotify, Apple Podcasts & YouTube');
  const sub = (kind === 'intro' ? b.sub : b.outroSub) || '';
  const upper = style.upper !== false;
  const words = [];
  String(headRaw).split(/(\*[^*]+\*)/).forEach((part) => {
    const hi = /^\*[^*]+\*$/.test(part);
    (hi ? part.slice(1, -1) : part).split(/\s+/).filter(Boolean).forEach((w) => words.push({ t: upper ? w.toUpperCase() : w, hi }));
  });

  // size the headline to fit
  let size = unit * (kind === 'intro' ? 0.11 : 0.085), lines;
  for (let k = 0; k < 12; k++) {
    ctx.font = `900 ${size}px ${HEAD_FONT}`;
    lines = wrapWords(ctx, words, maxW);
    if (lines.length * size * 1.02 <= H * 0.42 && lines.every((l) => l.width <= maxW)) break;
    size *= 0.9;
  }
  const mono = Math.round(unit * 0.026);
  const logoW = kind === 'outro' ? Math.min(maxW, unit * 0.62) : unit * 0.36;
  const logoH = logo && logo.naturalWidth ? logoW * logo.naturalHeight / logo.naturalWidth : 0;
  const blockH = (logoH ? logoH + unit * 0.06 : 0) + (kicker ? mono * 2.2 : 0) + lines.length * size * 1.02 + (sub ? mono * 2.6 : 0);
  let y = (H - blockH) / 2;
  if (logo && logo.complete && logo.naturalWidth) {
    const ly = y + (1 - ease(t / 0.5)) * unit * 0.02;
    ctx.drawImage(logo, M, ly, logoW, logoH);
    y += logoH + unit * 0.06;
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(mono * 0.1)}px`;
  ctx.textBaseline = 'top';
  if (kicker) { ctx.font = `500 ${mono}px ${MONO_FONT}`; ctx.fillStyle = theme.meta; ctx.fillText(kicker.toUpperCase(), M, y); y += mono * 2.2; }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = `900 ${size}px ${HEAD_FONT}`; ctx.textBaseline = 'alphabetic';
  let n = 0;
  for (const ln of lines) {
    for (const it of ln.items) {
      const k = ease((t - 0.25 - n * 0.09) / 0.25); n++;
      if (k <= 0) continue;
      ctx.globalAlpha = fadeIn * fadeOut * k;
      const by = y + size * 0.8 + (1 - k) * size * 0.15;
      if (it.hi && theme.keyStyle === 'block') {
        const pad = size * 0.08;
        ctx.fillStyle = theme.keyBg; ctx.fillRect(M + it.x - pad, by - size * 0.8, it.ww + pad * 2, size * 0.94);
        ctx.fillStyle = theme.key;
      } else ctx.fillStyle = it.hi ? theme.key : theme.text;
      ctx.fillText(it.t, M + it.x, by);
    }
    y += size * 1.02;
  }
  ctx.globalAlpha = fadeIn * fadeOut * ease((t - 0.6 - n * 0.09) / 0.4);
  if (sub) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(mono * 0.1)}px`;
    ctx.font = `500 ${mono}px ${MONO_FONT}`; ctx.fillStyle = theme.meta; ctx.textBaseline = 'top';
    ctx.fillText(sub.toUpperCase(), M, y + mono * 1.2);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  ctx.restore();
}

/** Make sure brand fonts are ready before drawing (canvas silently falls back otherwise). */
export async function loadFonts() {
  if (!document.fonts) return;
  await Promise.allSettled([
    document.fonts.load(`900 64px "Archivo Black"`),
    document.fonts.load(`500 24px "IBM Plex Mono"`),
    document.fonts.load(`900 64px "Arial Black"`),
    document.fonts.load(`700 48px "Kalam"`),
  ]);
}

/**
 * The yellow capsule / episode badge from the WDGTA designs: a square-cornered yellow box,
 * Ink text in IBM Plex Mono semibold with wide tracking. `right` is the box's right edge.
 * On a yellow background it flips to Ink with yellow text (brand rule: yellow text only on Ink).
 * Returns its box [x, y, w, h].
 */
export function drawBadge(ctx, text, right, top, px, theme) {
  const label = String(text || '').trim().toUpperCase();
  if (!label) return null;
  ctx.save();
  ctx.font = `600 ${px}px ${MONO_FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(px * 0.12).toFixed(1)}px`;
  const tw = ctx.measureText(label).width;
  const w = Math.max(tw + px * 1.6, px * 8), h = px * 1.85;
  const x = right - w;
  const onYellow = theme && theme.bg.toUpperCase() === '#FFC710';
  ctx.fillStyle = onYellow ? '#0E0E0C' : '#FFC710';
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = onYellow ? '#FFC710' : '#0E0E0C';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // letter-spacing adds trailing space after the last letter; nudge to optically centre
  ctx.fillText(label, x + w / 2 + px * 0.06, top + h / 2 + px * 0.04);
  ctx.restore();
  return [x, top, w, h];
}

/**
 * Approximate areas where TikTok, Instagram Reels and YouTube Shorts draw their own buttons and captions
 * on a 9:16 video (union of the three). Preview only — never exported.
 */
export function drawSafeZones(ctx, fmt) {
  if (fmt.id !== '9x16') return;
  const { w: W, h: H } = fmt;
  const zones = [
    { x: 0, y: 0, w: W, h: H * 0.09, label: 'Top bar (tabs, search)' },
    { x: W * 0.855, y: H * 0.36, w: W * 0.145, h: H * 0.46, label: 'Like / comment / share' },
    { x: 0, y: H * 0.8, w: W, h: H * 0.2, label: 'Username, caption, sound' },
  ];
  ctx.save();
  for (const z of zones) {
    ctx.fillStyle = 'rgba(232, 81, 42, 0.18)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = 'rgba(232, 81, 42, 0.9)'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
    ctx.strokeRect(z.x + 1.5, z.y + 1.5, z.w - 3, z.h - 3);
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.round(W * 0.024)}px ${MONO_FONT}`; ctx.fillStyle = '#FFB39B'; ctx.textBaseline = 'top';
    if (z.w > W * 0.5) ctx.fillText(z.label.toUpperCase(), z.x + W * 0.03, z.y + H * 0.012);
    else {
      ctx.save(); ctx.translate(z.x + z.w / 2 + W * 0.012, z.y + z.h / 2); ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center'; ctx.fillText(z.label.toUpperCase(), 0, 0); ctx.restore();
    }
  }
  ctx.restore();
}
