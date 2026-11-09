// WDGTA Studio — the episode kit: one request out to Claude, one kit back.
// The request is a small JSON file Studio saves in the projects folder (which can sit inside Google Drive).
// Claude reads it there and saves a kit file next to it: titles, thumbnail words, descriptions, a caption
// for every post, the promo playbook and a posting plan. Studio picks the kit up from the same folder.
// The file formats are described in KIT.md. Nothing here touches the page, so it can be tested on its own.

export const KIT_VERSION = 1;
export const requestFileName = (projectId) => `${projectId}--kit-request.json`;
/** Kit files are named <projectId>--kit-<anything>.json, so a newer kit never has to overwrite an older one. */
export const isKitFileFor = (projectId) => (name) => name.startsWith(`${projectId}--kit-`) && name.endsWith('.json') && name !== requestFileName(projectId);

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
const fmtT = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };

/** A key that stays the same while the post's words stay the same, even if its number (C2, Q3…) moves. */
export function postKey(p) {
  if (p.kind === 'full') return 'full';
  if (p.kind === 'carousel') return 'carousel';
  return `${p.kind}:${norm(p.text || p.name).slice(0, 60)}`;
}

/** The transcript as short timed paragraphs: a new one at each speaker change, chapter, or about every 45 s. */
export function transcriptParagraphs(cards, chapters = []) {
  const marks = [...chapters].map((c) => c.t).sort((a, b) => a - b);
  const out = [];
  let cur = null, mi = 0;
  for (const c of cards || []) {
    const spk = c._spk || c.spk || 'host';
    for (const w of c.words || []) {
      let brk = !cur || cur.spk !== spk;
      while (mi < marks.length && w.s >= marks[mi] - 0.05) { brk = true; mi++; }
      if (cur && !brk && w.s - cur.s > 45 && /[.?!]["')\]]?$/.test(cur.last)) brk = true;
      if (brk) { cur = { s: w.s, spk, words: [], last: '' }; out.push(cur); }
      cur.words.push(w.w); cur.last = w.w;
    }
  }
  return out.map((p) => ({ t: fmtT(p.s), spk: p.spk, text: p.words.join(' ') }));
}

/** Everything Claude needs for one episode, and nothing it has to guess. */
export function buildKitRequest({ projectId, title, episode, guest, host, cards, chapters, duration, posts, cfg, wants }) {
  return {
    app: 'wdgta-os', kind: 'kit-request', version: KIT_VERSION,
    projectId,
    requestedAt: new Date().toISOString(),
    title,
    episode: episode ? { type: episode.type, number: episode.number || '', title: episode.title || '', releaseDate: episode.releaseDate || '', stage: episode.stage || '' } : null,
    host: host || 'Abdul Mueez Otoo',
    guest: guest || '',
    duration: fmtT(duration),
    hashtags: cfg.hashtags || '#wedeygothrougham',
    ctas: String(cfg.ctas || '').split('\n').map((s) => s.trim()).filter(Boolean),
    chapters: (chapters || []).map((c) => ({ t: fmtT(c.t), name: c.name })),
    transcript: transcriptParagraphs(cards, chapters),
    posts: posts.map((p) => ({
      id: p.id, key: postKey(p), kind: p.kind, name: p.name,
      ...(p.text ? { text: p.text } : {}), ...(p.sub ? { sub: p.sub } : {}),
      ...(p.at ? { at: p.at, seconds: p.len } : {}),
      captionsFor: wants[p.kind] || [],
    })),
  };
}

/** Problems that make a kit unusable; an empty list means it can be loaded. */
export function kitProblems(kit, projectId) {
  const out = [];
  if (!kit || typeof kit !== 'object' || kit.kind !== 'kit') return ['This is not a WDGTA kit file.'];
  if (projectId && kit.projectId && kit.projectId !== projectId) out.push('This kit was made for a different project.');
  if (kit.captions && typeof kit.captions !== 'object') out.push('The captions in this kit cannot be read.');
  for (const k of ['titles', 'thumbnails', 'promo', 'plan', 'questions']) if (kit[k] != null && !Array.isArray(kit[k])) out.push(`"${k}" in this kit cannot be read.`);
  return out;
}

/** The newest usable kit for this project among the files found in the folder. */
export function newestKit(list, projectId) {
  return (list || [])
    .filter((k) => !kitProblems(k, projectId).length && (!k.projectId || k.projectId === projectId))
    .sort((a, b) => String(b.madeAt || '').localeCompare(String(a.madeAt || '')))[0] || null;
}

/** The kit's captions lined up with today's posts: by the post's words first, then by its number. */
export function kitCaptions(kit, posts) {
  const out = {};
  if (!kit?.captions) return out;
  const keys = kit.postKeys || {};
  const byKey = {};
  for (const [id, k] of Object.entries(keys)) if (kit.captions[id]) byKey[k] = id;
  for (const p of posts) {
    const k = postKey(p);
    const from = byKey[k] || (kit.captions[p.id] && (!keys[p.id] || keys[p.id] === k) ? p.id : null);
    if (!from) continue;
    const caps = {};
    for (const [pl, text] of Object.entries(kit.captions[from])) if (typeof text === 'string' && text.trim()) caps[pl] = text.trim();
    if (Object.keys(caps).length) out[p.id] = caps;
  }
  return out;
}

const addDays = (isoDate, n) => { const d = new Date(isoDate + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * The kit's posting plan as calendar entries. `base` is the release day (day 0).
 * Each entry carries its caption and file names in the notes, so the calendar item is all you need to post.
 */
export function kitCalendarEntries(kit, { projectId, base, posts, epLabel }) {
  const byId = Object.fromEntries((posts || []).map((p) => [p.id, p]));
  return (kit?.plan || []).filter((x) => x && Number.isFinite(Number(x.day))).map((x, i) => {
    const p = x.post ? byId[x.post] : null;
    const platforms = Array.isArray(x.platforms) ? x.platforms : String(x.platforms || '').split(',').map((s) => s.trim()).filter(Boolean);
    const notes = [];
    if (x.note) notes.push(x.note);
    if (x.text) notes.push(x.text);
    if (p) {
      const caps = (p.captions || []).filter((c) => !platforms.length || platforms.some((pl) => c.platform.toLowerCase().startsWith(pl.toLowerCase())));
      for (const c of caps) notes.push(`${c.platform.toUpperCase()}\n${c.text}`);
      if (p.files?.length) notes.push('FILES\n' + p.files.map((f) => f.path).join('\n'));
    }
    const what = x.what || (p ? p.name : 'Post');
    return {
      ref: `kit:${projectId}:${x.post || 'x'}:${i}`,
      date: addDays(base, Number(x.day)),
      time: /^\d\d:\d\d$/.test(x.time || '') ? x.time : '',
      type: 'Social post',
      title: `${epLabel ? epLabel + ' · ' : ''}${what}${platforms.length ? ' → ' + platforms.join(', ') : ''}`,
      notes: notes.join('\n\n'),
    };
  });
}
