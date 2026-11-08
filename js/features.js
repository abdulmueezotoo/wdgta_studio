// WDGTA Studio — content features that don't draw video frames:
// dictionary, subtitles, chapters, highlight finder, caption prompts, speakers, music ducking, carousel slides.
import { THEMES, cardStart, cardEnd, drawBadge } from './render.js';

const clean = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

// ---------------- custom dictionary ----------------
export const DEFAULT_DICTIONARY = [
  { from: 'we they go through am', to: 'We Dey Go Through Am' },
  { from: 'we day go through am', to: 'We Dey Go Through Am' },
  { from: 'w d g t a', to: 'WDGTA' },
];

/**
 * Replace misheard words/phrases. words: [{w,s,e,...}] → { words, count }.
 * Matching ignores case and punctuation; the replacement keeps the original timing span
 * and any trailing punctuation.
 */
export function applyDictionary(words, dict) {
  const entries = (dict || [])
    .map((d) => ({ from: String(d.from || '').trim().split(/\s+/).map(clean).filter(Boolean), to: String(d.to || '').trim() }))
    .filter((d) => d.from.length && d.to)
    .sort((a, b) => b.from.length - a.from.length);
  if (!entries.length) return { words, count: 0 };
  const out = [];
  let count = 0;
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const d of entries) {
      if (i + d.from.length > words.length) continue;
      let ok = true;
      for (let k = 0; k < d.from.length; k++) if (clean(words[i + k].w) !== d.from[k]) { ok = false; break; }
      if (ok) {
        const same = d.from.length === 1 && words[i].w.replace(/[^\p{L}\p{N}']+$/u, '') === d.to;
        if (!same) { hit = d; break; }
      }
    }
    if (!hit) { out.push(words[i]); i++; continue; }
    const span = words.slice(i, i + hit.from.length);
    const s = span[0].s, e = span[span.length - 1].e;
    const trail = (span[span.length - 1].w.match(/[^\p{L}\p{N}']+$/u) || [''])[0];
    const parts = hit.to.split(/\s+/);
    const total = parts.reduce((a, p) => a + p.length, 0) || 1;
    let t = s;
    parts.forEach((p, k) => {
      const d = (e - s) * p.length / total;
      const o = { w: p + (k === parts.length - 1 ? trail : ''), s: t, e: t + d, edited: true };
      if (span[0]._c !== undefined) o._c = span[0]._c;
      if (k === 0 && span[0].mark) o.mark = span[0].mark;
      out.push(o); t += d;
    });
    count++;
    i += hit.from.length;
  }
  return { words: out, count };
}

// ---------------- subtitles ----------------
function stamp(t, sep) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000) % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`;
}
function cueText(card) {
  const txt = card.words.map((w) => w.w).join(' ').replace(/\s+/g, ' ').trim();
  if (txt.length <= 42) return txt;
  // break into two balanced lines
  const ws = txt.split(' ');
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < ws.length; i++) {
    const d = Math.abs(ws.slice(0, i).join(' ').length - ws.slice(i).join(' ').length);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return ws.slice(0, best).join(' ') + '\n' + ws.slice(best).join(' ');
}
/** Cues for a time range, shifted so the range starts at `offset` seconds. */
export function subtitleCues(cards, start = 0, end = Infinity, offset = 0) {
  const cues = [];
  cards.forEach((c, i) => {
    const s = cardStart(c), next = cards[i + 1];
    const e = Math.min(cardEnd(c) + 0.6, next ? cardStart(next) : Infinity);
    if (e <= start || s >= end) return;
    cues.push({ s: Math.max(s, start) - start + offset, e: Math.min(e, end) - start + offset, text: cueText(c) });
  });
  return cues;
}
export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.s, ',')} --> ${stamp(c.e, ',')}\n${c.text}\n`).join('\n');
}
export function toVTT(cues) {
  return 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.s, '.')} --> ${stamp(c.e, '.')}\n${c.text}\n`).join('\n');
}

// ---------------- chapters ----------------
export const CHAPTER_PRESETS = {
  'Founder conversation': ["Founder's Case File", 'Founder Timeline', 'Reality Check', 'Whiteboard Moment', 'Founder Playbook', 'If I Were Starting Again Tomorrow', 'Quick Fire'],
  'Mini-episode': ['Hook', 'The problem', 'Why it matters', 'The insight', 'Breakdown', 'Takeaways', 'Your move'],
};
function ytTime(t) {
  t = Math.floor(Math.max(0, t));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
/** YouTube description chapters. Returns { text, warnings }. */
export function youtubeChapters(chapters, duration) {
  const list = [...chapters].sort((a, b) => a.t - b.t);
  if (!list.length || list[0].t > 0.5) list.unshift({ t: 0, name: 'Intro' });
  else list[0] = { ...list[0], t: 0 };
  const warnings = [];
  if (list.length < 3) warnings.push('YouTube needs at least 3 chapters.');
  list.forEach((c, i) => {
    const end = list[i + 1] ? list[i + 1].t : duration;
    if (end - c.t < 10) warnings.push(`"${c.name}" is shorter than 10 seconds; YouTube needs 10 s or more.`);
  });
  return { text: list.map((c) => `${ytTime(c.t)} ${c.name}`).join('\n'), warnings };
}
export function chapterAt(chapters, t) {
  let cur = null;
  for (const c of chapters || []) if (c.t <= t + 1e-3 && (!cur || c.t >= cur.t)) cur = c;
  return cur;
}

// ---------------- speakers ----------------
/** Work out who is speaking on every screen from turn markers (card.turn), default host. Sets card._spk. */
export function assignSpeakers(cards) {
  let cur = 'host';
  for (const c of cards) { if (c.turn) cur = c.turn; c._spk = cur; }
}

// ---------------- highlight finder ----------------
const CUES = [
  [/\b(mistake|mistakes|failed|failure|fail|lost|lose|wrong|regret)\b/i, 'Mistake'],
  [/\b(lesson|learned|learnt|realised|realized|understood|discovered)\b/i, 'Lesson'],
  [/\b(if i (were|was) starting|starting again|do differently|wish i)\b/i, 'Hindsight'],
  [/\b(the truth is|nobody tells|no one tells|honestly|the reality)\b/i, 'Honest take'],
  [/\b(never|always|must|stop|don't|do not)\b/i, 'Strong advice'],
  [/\b(decided|decision|chose|choose|bet)\b/i, 'Decision'],
  [/\b(customer|customers|market|price|pricing|money|cash|revenue|profit|funding|investor|grant)\b/i, 'Business'],
];
export function sentences(cards) {
  const words = cards.flatMap((c) => c.words);
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.?!]["')\]]?$/.test(w.w) || !next || next.s - w.e > 1.2) { out.push(cur); cur = []; }
  });
  return out.map((ws) => {
    const text = ws.map((w) => w.w).join(' ');
    let score = 0; const tags = new Set();
    if (/\?\s*$/.test(text)) { score += 2; tags.add('Question'); }
    for (const [re, tag] of CUES) if (re.test(text)) { score += 1.5; tags.add(tag); }
    if (/\d/.test(text)) { score += 1; tags.add('Numbers'); }
    const n = ws.length;
    if (n >= 6 && n <= 30) score += 0.5;
    if (n < 4) score -= 1;
    return { s: ws[0].s, e: ws[ws.length - 1].e, text, score, tags: [...tags] };
  });
}
/** Suggest the strongest moments as clip candidates of about `target` seconds. */
export function findHighlights(cards, target = 45, count = 6) {
  const ss = sentences(cards);
  const cands = [];
  for (let i = 0; i < ss.length; i++) {
    if (ss[i].score < 1.5) continue;
    let j = i, sum = 0; const tags = new Set();
    while (j < ss.length && ss[j].e - ss[i].s < target * 1.25) {
      sum += ss[j].score * (j === i ? 1.6 : 1); ss[j].tags.forEach((t) => tags.add(t)); j++;
      if (ss[j - 1].e - ss[i].s >= target * 0.8) break;
    }
    const end = ss[j - 1].e;
    const len = end - ss[i].s;
    if (len < target * 0.4) continue;
    cands.push({ start: Math.max(0, ss[i].s - 0.3), end: end + 0.5, score: sum / Math.max(1, j - i) + ss[i].score * 0.5, hook: ss[i].text, tags: [...tags].slice(0, 4) });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.some((p) => c.start < p.end && c.end > p.start)) continue;
    picked.push(c);
    if (picked.length >= count) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

// ---------------- caption prompt ----------------
export function captionPrompt({ title, kind, text, duration, guest }) {
  return `You are writing social media copy for "We Dey Go Through Am" (WDGTA), a Ghanaian entrepreneurship podcast hosted by Abdul Mueez Otoo. Tagline: "Beyond the Success Stories."

Voice: clear English first, Pidgin only where it is natural, never forced. Honest, thoughtful, direct, warm, occasionally humorous, analytical. Focus on founders' decisions and reasoning (what they believed, what happened, what they decided, why, what they would do differently). No generic motivation. Never invent facts, quotes, numbers, guest details or release dates: use only what is in the transcript below. Do not promise a publishing schedule.

Content: ${kind}${title ? ` titled "${title}"` : ''}${guest ? ` with ${guest}` : ''}, about ${Math.round(duration)} seconds long.

Write:
1. Five hook options for the first line (under 12 words each).
2. A caption for Instagram and TikTok (under 120 words) ending with one question for founders.
3. A LinkedIn post (120 to 200 words) that draws out the decision or lesson.
4. A YouTube title (under 70 characters) and a two-sentence description.
5. 8 to 12 relevant hashtags, including #WeDeyGoThroughAm and #WDGTA.

Transcript:
"""
${text}
"""`;
}

// ---------------- music ducking ----------------
/** Sorted, merged time ranges where someone is speaking (with a little padding). */
export function speechRanges(cards, padBefore = 0.15, padAfter = 0.35) {
  const r = [];
  for (const w of cards.flatMap((c) => c.words)) {
    const s = w.s - padBefore, e = w.e + padAfter;
    if (r.length && s <= r[r.length - 1][1] + 0.25) r[r.length - 1][1] = Math.max(r[r.length - 1][1], e);
    else r.push([s, e]);
  }
  return r;
}
export function isSpeaking(ranges, t) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ranges[m][1] < t) lo = m + 1; else if (ranges[m][0] > t) hi = m - 1; else return true;
  }
  return false;
}

// ---------------- carousel slides ----------------
const HEAD = '"Arial Black", "Archivo Black", "Helvetica Neue", Arial, sans-serif';
const BODY = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
export const SLIDE_TYPES = { cover: 'Cover', quote: 'Quote', point: 'Point', end: 'Closing' };
export const SERIES = ['Reality Check', 'Founder Playbook', "Founder's Case File", 'Whiteboard Moment', 'Quote'];

/** Split "text with *yellow* words" into tokens with a highlight flag. */
function tokens(text) {
  const out = [];
  String(text || '').split(/(\*[^*]+\*)/).forEach((part) => {
    const hi = /^\*[^*]+\*$/.test(part);
    const body = hi ? part.slice(1, -1) : part;
    body.split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, hi }));
  });
  return out;
}
function wrapTokens(ctx, toks, maxW) {
  const lines = []; let line = []; let width = 0;
  const sp = ctx.measureText(' ').width;
  for (const t of toks) {
    const w = ctx.measureText(t.w).width;
    if (line.length && width + sp + w > maxW) { lines.push({ items: line, width }); line = []; width = 0; }
    line.push({ ...t, x: line.length ? width + sp : 0, wd: w });
    width = line.length > 1 ? width + sp + w : w;
  }
  if (line.length) lines.push({ items: line, width });
  return lines;
}
function fitText(ctx, toks, font, maxW, maxH, start, min, lh) {
  let size = start, lines;
  for (; size > min; size -= 2) {
    ctx.font = font(size);
    lines = wrapTokens(ctx, toks, maxW);
    if (lines.length * size * lh <= maxH && lines.every((l) => l.width <= maxW)) break;
  }
  ctx.font = font(size);
  return { size, lines: lines || wrapTokens(ctx, toks, maxW) };
}
function paintLines(ctx, lines, x, y, size, lh, theme, baseColor) {
  ctx.textBaseline = 'alphabetic';
  lines.forEach((ln, i) => {
    const by = y + size * 0.82 + i * size * lh;
    for (const it of ln.items) {
      if (it.hi && theme.keyStyle === 'block') {
        const pad = size * 0.08;
        ctx.fillStyle = theme.keyBg; ctx.fillRect(x + it.x - pad, by - size * 0.8, it.wd + pad * 2, size * 0.96);
        ctx.fillStyle = theme.key;
      } else ctx.fillStyle = it.hi ? theme.key : baseColor;
      ctx.fillText(it.w, x + it.x, by);
    }
  });
  return y + lines.length * size * lh;
}

// Quotes, points and carousels sit on calm backgrounds; yellow is only an accent.
export const SLIDE_BGS = {
  ink: { ...THEMES.ink, accent: '#FFC710', name: 'Ink' },
  black: { ...THEMES.black, accent: '#FFC710', name: 'Black' },
  white: { name: 'White', bg: '#FFFFFF', text: '#0E0E0C', dim: '#E4E1DA', meta: '#55524B', track: '#E4E1DA', fill: '#0E0E0C', key: '#0E0E0C', keyBg: '#FFC710', keyStyle: 'block', marker: '#0E0E0C', accent: '#E0A800', logo: 'black' },
};
export const SLIDE_SIZES = { '4x5': { w: 1080, h: 1350 }, '9x16': { w: 1080, h: 1920 } };

/**
 * Draw one carousel slide or single post (4:5 1080×1350, or 9:16 1080×1920 with deck.size).
 * slide: {type, text, sub}; deck: {series, bg, logoLight, logoDark, logo, upper}
 */
export function drawSlide(ctx, slide, index, total, deck) {
  const W = 1080, H = (SLIDE_SIZES[deck.size] || SLIDE_SIZES['4x5']).h, M = 96;
  const theme = SLIDE_BGS[deck.slideBg] || SLIDE_BGS.ink;
  const accent = theme.accent || '#FFC710';
  // 9:16 posts are Stories/Status: keep clear of the app's top and bottom bars and centre the content
  const story = H > 1400, padT = story ? 150 : 0, padB = story ? 230 : 0, shift = story ? (H - padT - padB - 1350) / 2 + padT : 0;
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);
  const logo = deck.logo || (theme.logo === 'black' ? deck.logoDark : deck.logoLight);
  const up = (s) => (deck.upper !== false ? String(s || '').toUpperCase() : String(s || ''));
  const mono = (px, color) => { ctx.font = `500 ${px}px ${MONO}`; ctx.fillStyle = color; if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * 0.1)}px`; };
  const resetLS = () => { if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; };

  // header: logo + series
  if (logo && logo.complete && logo.naturalWidth) {
    const lw = 300, lh = lw * logo.naturalHeight / logo.naturalWidth;
    ctx.drawImage(logo, M, M - 10 + padT, lw, lh);
  }
  if (deck.badge) drawBadge(ctx, deck.badge, W - M, M - 6 + padT, 24, { ...theme, key: '#FFC710', bg: '#0E0E0C' });
  ctx.textBaseline = 'top';
  mono(24, theme.meta);
  const kicker = up(deck.series || '');
  if (kicker) ctx.fillText(kicker, M, M + 120 + padT);
  resetLS();

  // footer: handle + page / swipe (a single post shows its call to action instead of page numbers)
  const fy = H - M + 8 - padB;
  mono(24, theme.meta);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('@WEDEYGOTHROUGHAM', M, fy);
  if (deck.single) {
    if (deck.cta) { ctx.textAlign = 'right'; ctx.fillText(up(deck.cta), W - M, fy); ctx.textAlign = 'left'; }
    resetLS();
    ctx.fillStyle = theme.track; ctx.fillRect(M, fy - 48, W - M * 2, 3);
  } else {
    const right = index < total - 1 ? `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}  →` : `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    ctx.textAlign = 'right'; ctx.fillText(right, W - M, fy); ctx.textAlign = 'left';
    resetLS();
    ctx.fillStyle = theme.track; ctx.fillRect(M, fy - 48, W - M * 2, 3);
    ctx.fillStyle = theme.fill; ctx.fillRect(M, fy - 48, (W - M * 2) * (index + 1) / total, 3);
  }

  const top = M + 200 + shift, bottom = 1350 - M - 90 + shift, maxW = W - M * 2;
  const toks = tokens(up(slide.text));
  if (slide.type === 'cover') {
    const { size, lines } = fitText(ctx, toks, (s) => `900 ${s}px ${HEAD}`, maxW, (bottom - top) * 0.72, 150, 56, 1.0);
    const y = paintLines(ctx, lines, M, top + 40, size, 1.0, theme, theme.text);
    if (slide.sub) {
      ctx.font = `500 34px ${BODY}`; ctx.fillStyle = theme.meta; ctx.textBaseline = 'top';
      wrapTokens(ctx, tokens(slide.sub), maxW).forEach((l, i) => ctx.fillText(l.items.map((t) => t.w).join(' '), M, y + 40 + i * 46));
    }
  } else if (slide.type === 'quote') {
    ctx.font = `900 220px ${HEAD}`; ctx.fillStyle = accent; ctx.textBaseline = 'top';
    ctx.fillText('“', M - 10, top - 30);
    const { size, lines } = fitText(ctx, toks, (s) => `900 ${s}px ${HEAD}`, maxW, (bottom - top - 260), 92, 40, 1.08);
    const y = paintLines(ctx, lines, M, top + 170, size, 1.08, theme, theme.text);
    if (slide.sub) { mono(26, theme.meta); ctx.textBaseline = 'top'; ctx.fillText(up('— ' + slide.sub), M, y + 40); resetLS(); }
  } else if (slide.type === 'point') {
    const n = String(slide.num || index).padStart(2, '0');
    ctx.font = `900 150px ${HEAD}`; ctx.fillStyle = accent; ctx.textBaseline = 'top';
    ctx.fillText(n, M - 6, top - 20);
    const { size, lines } = fitText(ctx, toks, (s) => `900 ${s}px ${HEAD}`, maxW, 300, 84, 40, 1.04);
    const y = paintLines(ctx, lines, M, top + 170, size, 1.04, theme, theme.text);
    if (slide.sub) {
      const { size: bs, lines: bl } = fitText(ctx, tokens(slide.sub), (s) => `500 ${s}px ${BODY}`, maxW, bottom - y - 50, 40, 26, 1.35);
      paintLines(ctx, bl, M, y + 36, bs, 1.35, theme, theme.meta);
    }
  } else {
    const { size, lines } = fitText(ctx, toks.length ? toks : tokens(up('Full episode on Spotify, Apple Podcasts & YouTube')), (s) => `900 ${s}px ${HEAD}`, maxW, 420, 96, 44, 1.04);
    const y = paintLines(ctx, lines, M, top + 120, size, 1.04, theme, theme.text);
    ctx.font = `500 34px ${BODY}`; ctx.fillStyle = theme.meta; ctx.textBaseline = 'top';
    ctx.fillText(slide.sub || 'Follow @wedeygothrougham for more founder decisions.', M, y + 40);
  }
}
