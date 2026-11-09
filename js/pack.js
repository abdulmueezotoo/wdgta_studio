// WDGTA Studio — the weekly pack: suggestions for clips, quotes and points, the captions
// prompt for Claude and its reply, and the files the pack writes (Captions.docx, carousel PDF).
// No libraries: the .docx and .pdf are written by hand below.

import { sentences, findHighlights } from './features.js';

export const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'LinkedIn'];
export const PACK_DEFAULTS = {
  hashtags: '#wedeygothrougham',
  ctas: 'Share this with a founder\nFollow for more',
  full: true, carousel: true,
  clipTarget: 8, clipLen: 45,
  folder: '', reply: '', captions: null, kit: null, kitAskedAt: '',
};
// what each kind of post is exported as, and where it goes
export const SIZES = {
  full: [{ fmt: '16x9', use: 'YouTube' }],
  clip: [{ fmt: '9x16', use: 'TikTok, Instagram Reels, YouTube Shorts, Facebook Reels' }, { fmt: '4x5', use: 'Instagram & Facebook feed, LinkedIn' }],
  still: [{ fmt: '4x5', use: 'Instagram, Facebook, LinkedIn feed' }, { fmt: '9x16', use: 'Instagram & Facebook Stories, WhatsApp Status' }],
  carousel: [{ fmt: '4x5', use: 'Instagram & Facebook carousel' }, { fmt: 'pdf', use: 'LinkedIn document post' }],
};
// which platforms get a caption for each kind of post
export const CAPTION_PLATFORMS = {
  full: ['YouTube title', 'YouTube description'],
  clip: ['Instagram', 'TikTok', 'YouTube Shorts title', 'Facebook', 'LinkedIn'],
  quote: ['Instagram', 'Facebook', 'LinkedIn'],
  point: ['Instagram', 'Facebook', 'LinkedIn'],
  carousel: ['Instagram', 'Facebook', 'LinkedIn'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
const fmtT = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };

/** A folder name every computer accepts: keeps spaces and dashes, drops characters Windows and Mac refuse. */
export function folderName(s) {
  return String(s || 'WDGTA episode').replace(/\s*\|\s*/g, ' – ').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'WDGTA episode';
}

// ---------------- suggestions (never replace what you made yourself) ----------------
/** Up to `count` more clips of about `len` seconds, skipping time already covered by clips. */
export function suggestPackClips(cards, clips, count, len = 45) {
  if (count <= 0) return [];
  const taken = clips.map((c) => [c.start, c.end]);
  const free = (a, b) => !taken.some(([s, e]) => a < e && b > s);
  const picks = findHighlights(cards, len, count * 3).filter((h) => free(h.start, h.end));
  return picks.slice(0, count).map((h) => ({ start: +h.start.toFixed(2), end: +h.end.toFixed(2), hook: h.hook }));
}

function keyWords(cards) {
  const set = new Set();
  cards.forEach((c) => (c.keys || []).forEach((i) => c.words[i] && set.add(c.words[i])));
  return set;
}
function scored(cards) {
  const keys = keyWords(cards);
  const words = cards.flatMap((c) => c.words.map((w) => ({ w, spk: c._spk })));
  const ss = sentences(cards);
  let wi = 0;
  return ss.map((s) => {
    const n = s.text.split(/\s+/).length;
    const ws = words.slice(wi, wi + n); wi += n;
    const yellow = ws.filter((x) => keys.has(x.w)).length;
    return { ...s, n, yellow, spk: ws[0]?.spk || 'host' };
  });
}
/** Sentences that stand on their own as quote cards. */
export function suggestQuotes(cards, existing, count) {
  if (count <= 0) return [];
  const have = new Set(existing.map((t) => norm(t)));
  return scored(cards)
    .filter((s) => s.n >= 7 && s.n <= 30 && !/^(and|but|so|because|or|um|uh|like)\b/i.test(s.text) && !have.has(norm(s.text)))
    .map((s) => ({ ...s, rank: s.score + s.yellow * 1.2 + (/\b(you|we|i)\b/i.test(s.text) ? 0.5 : 0) - (s.n > 24 ? 1 : 0) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, count)
    .sort((a, b) => a.s - b.s)
    .map((s) => ({ text: s.text.replace(/^[a-z]/, (c) => c.toUpperCase()), spk: s.spk }));
}
const ADVICE = /\b(you (need|have|should|must|can't|cannot|don't)|don't|never|always|make sure|start (with|by)|stop|the (key|lesson|problem|mistake|truth) (is|was)|first,|before you|if you)\b/i;
/** Takeaways: chapter names first (with their strongest sentence), then advice-like sentences. */
export function suggestPoints(cards, chapters, existing, count, duration) {
  if (count <= 0) return [];
  const have = new Set(existing.map((t) => norm(t)));
  const ss = scored(cards);
  const out = [];
  const chs = [...(chapters || [])].sort((a, b) => a.t - b.t);
  chs.forEach((ch, i) => {
    const end = chs[i + 1]?.t ?? duration ?? Infinity;
    const name = String(ch.name || '').trim();
    if (!name || /^(intro|introduction|outro|chapter \d+)$/i.test(name) || have.has(norm(name))) return;
    const best = ss.filter((s) => s.s >= ch.t && s.s < end && s.n >= 6 && s.n <= 28).sort((a, b) => (b.score + b.yellow) - (a.score + a.yellow))[0];
    out.push({ text: name, sub: best ? best.text : '' });
  });
  ss.filter((s) => ADVICE.test(s.text) && s.n >= 6 && s.n <= 22 && !have.has(norm(s.text)))
    .sort((a, b) => (b.score + b.yellow) - (a.score + a.yellow))
    .forEach((s) => out.push({ text: s.text.replace(/^[a-z]/, (c) => c.toUpperCase()), sub: '' }));
  const seen = new Set();
  return out.filter((p) => { const k = norm(p.text); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, count);
}

// ---------------- the posts in a pack ----------------
/** One entry per post, with a short id (C1, Q1, P1, CAR, FULL) Claude's reply refers back to. */
export function packPosts({ title, clips, slides, cards, cfg, chapters, duration, files }) {
  const posts = [];
  const textIn = (a, b) => cards.flatMap((c) => c.words).filter((w) => w.s >= a - 0.01 && w.e <= b + 0.01).map((w) => w.w).join(' ');
  if (cfg.full) posts.push({ id: 'FULL', kind: 'full', name: title, files: files.FULL || [], text: '', chapters: (chapters || []).map((c) => `${fmtT(c.t)} ${c.name}`) });
  clips.forEach((c, i) => posts.push({ id: `C${i + 1}`, kind: 'clip', name: c.title || c.name || `Clip ${i + 1}`, files: files[`C${i + 1}`] || [], text: textIn(c.start, c.end), at: fmtT(c.start), len: Math.round(c.end - c.start) }));
  slides.filter((s) => s.type === 'quote' && s.solo).forEach((s, i) => posts.push({ id: `Q${i + 1}`, kind: 'quote', name: `Quote ${i + 1}`, files: files[`Q${i + 1}`] || [], text: s.text.replace(/\*/g, ''), sub: s.sub }));
  slides.filter((s) => s.type === 'point' && s.solo).forEach((s, i) => posts.push({ id: `P${i + 1}`, kind: 'point', name: `Point ${i + 1}`, files: files[`P${i + 1}`] || [], text: s.text.replace(/\*/g, ''), sub: s.sub }));
  const car = slides.filter((s) => s.inCarousel !== false);
  if (cfg.carousel && car.length) posts.push({ id: 'CAR', kind: 'carousel', name: 'Carousel', files: files.CAR || [], text: car.map((s, i) => `${i + 1}. ${s.text.replace(/\*/g, '')}${s.sub ? ' (' + s.sub + ')' : ''}`).join('\n') });
  return posts;
}

// ---------------- captions: prompt for Claude, reading the reply, templates ----------------
export function captionsPrompt({ title, guest, host, posts, cfg }) {
  const ctas = String(cfg.ctas || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const blocks = posts.map((p) => {
    const want = CAPTION_PLATFORMS[p.kind].join(', ');
    const what = {
      full: `Full episode (16:9 on YouTube).${p.chapters?.length ? ' Chapters:\n' + p.chapters.join('\n') : ''}`,
      clip: `Video clip, ${p.len} s, starts at ${p.at} in the full episode. Transcript:\n"""${p.text}"""`,
      quote: `Quote card: "${p.text}"${p.sub ? ' — ' + p.sub : ''}`,
      point: `Point card: "${p.text}"${p.sub ? '\nExplanation on the card: ' + p.sub : ''}`,
      carousel: `Carousel, slides in order:\n${p.text}`,
    }[p.kind];
    return `### ${p.id}\n${what}\nWrite: ${want}`;
  }).join('\n\n');
  return `You are writing social media captions for "We Dey Go Through Am" (WDGTA), a Ghanaian entrepreneurship podcast hosted by ${host || 'Abdul Mueez Otoo'}. Tagline: "Beyond the Success Stories."

Episode: "${title}"${guest ? ` with ${guest}` : ''}.

Strategy: the full episode lives on YouTube. Every other post is a trailer for it and should make people want the full conversation. Instagram and Facebook captions end with "Full episode on YouTube (link in bio)". TikTok captions are short (under 40 words). LinkedIn posts are fuller (80 to 150 words) and draw out the decision or lesson. YouTube Shorts titles are under 60 characters.

Voice: clear English first, Pidgin only where it is natural, never forced. Honest, thoughtful, direct, warm. Focus on founders' decisions and reasoning. No generic motivation. Never invent facts, quotes, numbers, guest details or release dates: use only what is given below. Do not promise a publishing schedule.

Every caption ends with one of these calls to action: ${ctas.map((c) => `"${c}"`).join(' or ')}. Use the hashtag ${cfg.hashtags || '#wedeygothrougham'} on every post; you may add up to 4 relevant ones on Instagram and TikTok only. Where a YouTube link belongs, write [YouTube link].

Reply in exactly this format and nothing else. Keep each post's ### line, then one line per platform starting with the platform name and a colon (a caption may run over several lines):

### C1
Instagram: …
TikTok: …

Posts:

${blocks}`;
}

/** Read Claude's reply back into {POSTID: {Platform: caption}}. */
export function parseCaptions(reply, posts) {
  const out = {};
  const labels = [...new Set(Object.values(CAPTION_PLATFORMS).flat())].sort((a, b) => b.length - a.length);
  // tolerate markdown around the label: **Instagram:** …, *Instagram*: …, - Instagram: …
  const lab = new RegExp(`^\\s*[-•]?\\s*\\**\\s*(${labels.map((l) => l.replace(/ /g, '\\s+')).join('|')})\\s*\\**\\s*:\\s*\\**\\s*(.*)$`, 'i');
  const ids = new Set(posts.map((p) => p.id));
  let cur = null, field = null;
  for (const raw of String(reply || '').replace(/\r/g, '').split('\n')) {
    const h = raw.match(/^\s*#{2,4}\s*\**\s*([A-Z]+\d*)\b/i);
    if (h && ids.has(h[1].toUpperCase())) { cur = out[h[1].toUpperCase()] = {}; field = null; continue; }
    if (!cur) continue;
    const m = raw.match(lab);
    if (m) {
      field = labels.find((l) => l.toLowerCase() === m[1].replace(/\s+/g, ' ').toLowerCase());
      cur[field] = m[2].trim();
    } else if (field) cur[field] += (cur[field] ? '\n' : '') + raw;
  }
  for (const k of Object.keys(out)) for (const f of Object.keys(out[k])) out[k][f] = out[k][f].replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/** Plain captions used wherever Claude's reply has none. */
export function templateCaption(post, platform, { title, cfg, guest }) {
  const ctas = String(cfg.ctas || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const cta = ctas[0] || 'Follow for more';
  const tag = cfg.hashtags || '#wedeygothrougham';
  const ep = `"${title}"`;
  const yt = /instagram|facebook/i.test(platform) ? 'Full episode on YouTube (link in bio).' : 'Full episode on YouTube: [YouTube link]';
  const firstLine = (t, n = 18) => { const w = String(t || '').split(/\s+/); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };
  if (post.kind === 'full') {
    if (platform === 'YouTube title') return title;
    return `${title}${guest ? ` with ${guest}` : ''}.\n\n${post.chapters?.length ? 'Chapters\n' + post.chapters.join('\n') + '\n\n' : ''}${cta}.\n${tag}`;
  }
  if (platform === 'YouTube Shorts title') return firstLine(post.name !== `Clip ${post.id.slice(1)}` ? post.name : post.text, 9);
  const body = post.kind === 'clip' ? `“${firstLine(post.text)}”` : post.kind === 'carousel' ? `${post.name} from ${ep}. Swipe through.` : `“${post.text}”${post.sub && post.kind === 'quote' ? ` — ${post.sub}` : ''}`;
  if (platform === 'TikTok') return `${body}\n${cta}. ${tag}`;
  return `${body}\n\nFrom ${ep}. ${yt}\n\n${cta}.\n${tag}`;
}

export function fullCaptions(posts, parsed, ctx) {
  return posts.map((p) => ({
    ...p,
    captions: CAPTION_PLATFORMS[p.kind].map((pl) => ({ platform: pl, text: parsed?.[p.id]?.[pl] || templateCaption(p, pl, ctx), fromClaude: !!parsed?.[p.id]?.[pl] })),
  }));
}

// ---------------- Captions.docx ----------------
const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function para(text, { size = 22, bold = false, color = '', mono = false, space = 120, shade = '' } = {}) {
  const lines = String(text ?? '').split('\n');
  const rpr = `<w:rPr>${mono ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'}${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/></w:rPr>`;
  const runs = lines.map((l, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(l)}</w:t></w:r>`).join('');
  return `<w:p><w:pPr><w:spacing w:after="${space}"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:pPr>${runs}</w:p>`;
}
export function captionsDocx({ title, folder, posts, made }) {
  const body = [
    para('WE DEY GO THROUGH AM · WEEKLY PACK', { size: 18, mono: true, color: '6E6B64', space: 60 }),
    para(title, { size: 40, bold: true, space: 80 }),
    para(`Folder: ${folder}   ·   Made ${made}`, { size: 18, color: '6E6B64', space: 240 }),
    para('Post the full episode on YouTube first, then fill in [YouTube link] below and use the rest through the week.', { size: 20, space: 280 }),
  ];
  for (const p of posts) {
    body.push(para(`${p.id} · ${p.name}`, { size: 30, bold: true, space: 60 }));
    if (p.files.length) body.push(para(p.files.map((f) => `${f.path}   (${f.use})`).join('\n'), { size: 17, mono: true, color: '55524B', space: 140 }));
    for (const c of p.captions) {
      body.push(para(c.platform.toUpperCase(), { size: 17, bold: true, mono: true, color: '9A7400', space: 40 }));
      body.push(para(c.text, { size: 21, space: 200 }));
    }
    body.push(para('', { space: 200 }));
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': doc,
  };
  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
export function postingPlanCSV(posts) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Post', 'Name', 'Platform', 'Files', 'Caption'].map(q).join(',')];
  for (const p of posts) for (const c of p.captions) rows.push([p.id, p.name, c.platform, p.files.map((f) => f.path).join(' | '), c.text].map(q).join(','));
  return rows.join('\r\n');
}

// ---------------- zip (stored, no compression) for the .docx ----------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}

// ---------------- carousel PDF (one JPEG per page) ----------------
export async function imagesToPdf(jpegs, w = 1080, h = 1350) {
  const pw = 540, ph = Math.round(540 * h / w); // points; 1080 px wide at 144 dpi
  const enc = new TextEncoder();
  const chunks = []; const offsets = []; let pos = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpegs.length;
  // 1 catalog, 2 pages, then per page: page, content, image
  const pageIds = jpegs.map((_, i) => 3 + i * 3);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`));
  for (let i = 0; i < n; i++) {
    const id = pageIds[i];
    const bytes = new Uint8Array(await jpegs[i].arrayBuffer());
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`); push(bytes); push('\nendstream'); });
  }
  const total = 3 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
