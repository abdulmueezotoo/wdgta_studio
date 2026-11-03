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

export const ELEMENTS = { text: 'Words', logo: 'Logo', title: 'Title', handle: 'Handle', progress: 'Progress line' };

const HEAD_FONT = '"Arial Black", "Archivo Black", "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

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
  };
  if (l) return {
    text: { x: 0.1, y: 0.5, s: 1 },
    logo: { x: 0.06, y: 0.07, s: 1 },
    title: { x: 0.06, y: 0.235, s: 1 },
    handle: { x: 0.06, y: 0.9, s: 1 },
    progress: { x: 0, y: 0.992, w: 1, s: 1 },
  };
  return {
    text: { x: 0.085, y: 0.52, s: 1 },
    logo: { x: 0.085, y: 0.07, s: 1 },
    title: { x: 0.085, y: fmtId === '4x5' ? 0.175 : 0.2, s: 1 },
    handle: { x: 0.085, y: 0.91, s: 1 },
    progress: { x: 0, y: 0.992, w: 1, s: 1 },
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
  const ck = [fmt.id, style.upper ? 1 : 0, (card.keys || []).join(','), pos.x, pos.y, pos.s, card.words.map(w => w.w).join(' ')].join('|');
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
const UPCOMING = '#34322E';

function monoSize(fmt) { return Math.round(Math.max(18, (fmt.id === '16x9' ? fmt.h : fmt.w) * 0.024)); }

function drawBrand(ctx, fmt, t, style, L, boxes) {
  const { w: W, h: H } = fmt;
  ctx.textBaseline = 'top';

  // logo
  if (style.logo && style.logo.complete && style.logo.naturalWidth && style.showLogo !== false) {
    const p = L.logo;
    const lw = (fmt.id === '16x9' ? W * 0.22 : fmt.id === '9x16' ? W * 0.5 : W * 0.42) * (p.s || 1);
    const lh = lw * style.logo.naturalHeight / style.logo.naturalWidth;
    const x = p.x * W, y = p.y * H;
    ctx.drawImage(style.logo, x, y, lw, lh);
    boxes.logo = [x, y, lw, lh];
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
    ctx.fillStyle = BRAND.stone;
    const x = p.x * W, y = p.y * H;
    ctx.fillText(title, x, y);
    boxes.title = [x, y, ctx.measureText(title).width, px * 1.2];
  }
  if (style.handle !== false) {
    const p = L.handle; const px = setMono(p.s);
    ctx.fillStyle = BRAND.stone;
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
    ctx.fillStyle = '#26251F';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = BRAND.stone;
    ctx.fillRect(bx, by, bw * Math.min(1, Math.max(0, (t - r.start) / dur)), bh);
    boxes.progress = [bx, by - 8, bw, bh + 16];
  }
}

/**
 * Paint one frame.
 * ctx: 2D context already scaled so that 1 unit = 1 output pixel of fmt.
 * style: { upper, handle, progress, title, logo(Image), showLogo, layout(overrides), range:{start,end} }
 * Returns hit boxes {text, logo, title, handle, progress} in output pixels (used for drag-to-move).
 */
export function drawFrame(ctx, cards, t, fmt, style = {}) {
  const { w: W, h: H } = fmt;
  const L = resolveLayout(fmt.id, style.layout);
  const boxes = {};
  ctx.fillStyle = BRAND.ink;
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
      for (const ln of lay.lines) {
        ctx.font = `900 ${ln.size}px ${HEAD_FONT}`;
        for (const it of ln.items) {
          const wd = card.words[it.i];
          const k = ease((t - Math.max(wd.s, rangeStart)) / 0.1);
          const spoken = t >= wd.s;
          const target = keys.includes(it.i) ? BRAND.yellow : BRAND.white;
          ctx.fillStyle = spoken ? mix(BRAND.stone, target, k) : UPCOMING;
          const pop = spoken ? (1 - k) * ln.size * 0.06 : 0;
          ctx.fillText(it.text, lay.x + it.x, lay.y + ln.baseline + rise + pop);
        }
      }
      ctx.restore();
      boxes.text = [lay.x, lay.y, Math.max(lay.maxWidth, W * 0.1), lay.height];
      drewText = true;
    }
  }
  if (!drewText) {
    const g = textGeometry(fmt, L.text);
    boxes.text = [g.left, g.centerY - g.base * 1.5, g.maxW * 0.6, g.base * 3];
  }
  drawBrand(ctx, fmt, t, style, L, boxes);
  return boxes;
}

/** Make sure brand fonts are ready before drawing (canvas silently falls back otherwise). */
export async function loadFonts() {
  if (!document.fonts) return;
  await Promise.allSettled([
    document.fonts.load(`900 64px "Archivo Black"`),
    document.fonts.load(`500 24px "IBM Plex Mono"`),
    document.fonts.load(`900 64px "Arial Black"`),
  ]);
}
