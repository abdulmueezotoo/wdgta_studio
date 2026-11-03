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
  // keep internal apostrophes/hyphens and a trailing question mark; drop other punctuation
  const q = /\?$/.test(s);
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
  if (q && s) s += '?';
  return upper ? s.toUpperCase() : s;
}

function bare(w) { return String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

/** Pick the most meaningful word in a card to highlight in yellow. */
export function autoKey(words) {
  let best = -1, score = 0;
  words.forEach((wd, i) => {
    const b = bare(wd.w);
    if (b.length < 4 || STOP.has(b) || /^\d+$/.test(b) && b.length < 3) return;
    const sc = b.length + (/\d/.test(b) ? 3 : 0);
    if (sc > score) { score = sc; best = i; }
  });
  return best >= 0 ? best : null;
}

/**
 * Group a flat list of timed words into on-screen cards.
 * words: [{w, s, e}] (seconds). Returns [{words:[...], key: index|null}]
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
    cur.words.push({ w: String(wd.w).trim(), s: wd.s, e: wd.e });
  }
  if (cur) cards.push(cur);
  for (const c of cards) c.key = autoKey(c.words);
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

// ---------- layout ----------

const SCALE = { S: 1, M: 1.45, L: 2.15 };

function geometry(fmt) {
  const { w: W, h: H } = fmt;
  if (fmt.id === '16x9') return { W, H, left: W * 0.1, maxW: W * 0.66, base: H * 0.062, centerY: H * 0.5, maxH: H * 0.62 };
  if (fmt.id === '9x16') return { W, H, left: W * 0.085, maxW: W * 0.8, base: W * 0.056, centerY: H * 0.43, maxH: H * 0.42 };
  if (fmt.id === '4x5') return { W, H, left: W * 0.085, maxW: W * 0.8, base: W * 0.052, centerY: H * 0.5, maxH: H * 0.55 };
  return { W, H, left: W * 0.085, maxW: W * 0.8, base: W * 0.05, centerY: H * 0.5, maxH: H * 0.58 };
}

const layoutCache = new WeakMap();

function wordClass(card, i, upper) {
  if (card.key === i) return 'L';
  const b = bare(card.words[i].w);
  if (b.length >= 7 && !STOP.has(b)) return 'M';
  return 'S';
}

/** Compute line layout for a card in a format. Cached per card object + format + style key. */
export function layoutCard(ctx, card, fmt, style) {
  const ck = fmt.id + '|' + (style.upper ? 1 : 0) + '|' + card.key + '|' + card.words.map(w => w.w).join(' ');
  let per = layoutCache.get(card);
  if (per && per.ck === ck) return per.lay;

  const g = geometry(fmt);
  const upper = style.upper !== false;
  const items = card.words.map((wd, i) => ({ i, text: displayWord(wd.w, upper), cls: wordClass(card, i, upper) }))
    .filter(it => it.text);

  // measure each word at unit size (100px) for speed
  ctx.save();
  ctx.font = `900 100px ${HEAD_FONT}`;
  const spaceU = ctx.measureText(' ').width / 100;
  for (const it of items) it.wU = ctx.measureText(it.text).width / 100;
  ctx.restore();

  // group consecutive words of the same class into lines
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
const UPCOMING = '#34322E'; // dim ink-grey for words not yet spoken

function drawBrand(ctx, fmt, t, duration, style) {
  const { w: W, h: H } = fmt;
  const vertical = fmt.id === '9x16';
  const pad = W * 0.085;
  const mono = Math.round(Math.max(18, (fmt.id === '16x9' ? H : W) * 0.024));
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${mono}px ${MONO_FONT}`;
  ctx.fillStyle = BRAND.stone;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(mono * 0.08)}px`;

  // Vertical video: brand sits at the top (platform buttons cover the bottom).
  const topY = vertical ? H * 0.085 : H * 0.085;
  const title = (style.title || '').trim().toUpperCase();
  if (title) ctx.fillText(title, pad, topY);
  if (style.handle !== false) {
    const hy = vertical ? topY + mono * 1.7 : H - H * 0.07;
    if (!vertical || title) ctx.fillText('@WEDEYGOTHROUGHAM', pad, hy);
    else ctx.fillText('@WEDEYGOTHROUGHAM', pad, topY);
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  if (style.logo && style.logo.complete && style.logo.naturalWidth) {
    const lh = (fmt.id === '16x9' ? H : W) * 0.075;
    const lw = lh * style.logo.naturalWidth / style.logo.naturalHeight;
    const lx = W - pad - lw;
    const ly = vertical ? topY - lh * 0.75 : H - H * 0.07 - lh * 0.8;
    ctx.drawImage(style.logo, lx, ly, lw, lh);
  }

  if (style.progress !== false && duration > 0) {
    const bh = Math.max(4, H * 0.004);
    const by = vertical ? topY + mono * (title ? 3.0 : 1.4) : H - bh;
    const bw = vertical ? W - pad * 2 : W;
    const bx = vertical ? pad : 0;
    ctx.fillStyle = '#26251F';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = BRAND.stone;
    ctx.fillRect(bx, by, bw * Math.min(1, t / duration), bh);
  }
}

/**
 * Paint one frame.
 * ctx: 2D context already scaled so that 1 unit = 1 output pixel of fmt.
 */
export function drawFrame(ctx, cards, t, fmt, style = {}, duration = 0) {
  const { w: W, h: H } = fmt;
  ctx.fillStyle = BRAND.ink;
  ctx.fillRect(0, 0, W, H);

  const ci = cardAt(cards, t);
  if (ci >= 0) {
    const card = cards[ci];
    const next = cards[ci + 1];
    const start = cardStart(card), end = cardEnd(card);
    // fade out if the speaker pauses for a long time before the next card
    let alpha = ease((t - start) / 0.12);
    const holdUntil = next ? Math.min(cardStart(next), end + 2.2) : end + 2.2;
    if (t > holdUntil) alpha *= 1 - ease((t - holdUntil) / 0.3);
    if (alpha > 0.002) {
      const lay = layoutCard(ctx, card, fmt, style);
      const rise = (1 - ease((t - start) / 0.18)) * H * 0.012;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textBaseline = 'alphabetic';
      for (const ln of lay.lines) {
        ctx.font = `900 ${ln.size}px ${HEAD_FONT}`;
        for (const it of ln.items) {
          const wd = card.words[it.i];
          const k = ease((t - wd.s) / 0.1);
          const spoken = t >= wd.s;
          const target = card.key === it.i ? BRAND.yellow : BRAND.white;
          ctx.fillStyle = spoken ? mix(BRAND.stone, target, k) : UPCOMING;
          const pop = spoken ? (1 - k) * ln.size * 0.06 : 0;
          ctx.fillText(it.text, lay.x + it.x, lay.y + ln.baseline + rise + pop);
        }
      }
      ctx.restore();
    }
  }
  drawBrand(ctx, fmt, t, duration, style);
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
