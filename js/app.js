// WDGTA Studio — app controller (upload → transcribe → edit → preview → clips → export).
import {
  FORMATS, ELEMENTS, THEMES, buildCards, autoKeys, normalizeCard, drawFrame, drawSafeZones, cardAt, cardStart, cardEnd,
  loadFonts, resolveLayout, defaultLayout, setUserLayouts, suggestClips, drawBookend,
} from './render.js';
import { renderMp4, renderStill, renderSlide, exportSupported } from './exporter.js';
import { initGuests, refreshGuests, flushGuests, focusGuest } from './guests.js';
import { initEpisodes, planEpisodeFor, flushEpisodes, focusEpisode } from './episodes.js';
import { initCalendar, flushCalendar } from './calendar.js';
import { renderHome } from './home.js';
import {
  saveProject as libSave, listProjects, getProject, deleteProject, putFile, getFile, deleteFile, storageEstimate,
  folderSupported, getDirHandle, setDirHandle, dirPermission, saveToFolder, scanFolder, persistStorage,
} from './library.js';
import {
  DEFAULT_DICTIONARY, applyDictionary, subtitleCues, toSRT, toVTT, CHAPTER_PRESETS, youtubeChapters,
  assignSpeakers, findHighlights, captionPrompt, speechRanges, isSpeaking, SLIDE_TYPES, SERIES, drawSlide,
} from './features.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'wdgta-studio:last-project';
const OFFICIAL_LOGO = 'assets/wdgta-logo-white.png';
const OFFICIAL_LOGO_DARK = 'assets/wdgta-logo-black.png';

const state = {
  id: null,             // project id in this browser's library
  title: '',
  cards: [],            // [{words:[{w,s,e,edited?}], keys:[i]}]
  clips: [],            // [{id, name, start, end, title}]
  chapters: [],         // [{id, name, t}]
  slides: [],           // carousel: [{id, type, text, sub}]
  series: 'Reality Check',
  settings: {
    bg: 'ink',
    upper: true, handle: true, progress: true, showTitle: true, showLogo: true,
    logo: null,          // custom logo data URL; null = official logo
    maxKeys: 1,
    layouts: {},         // per-format element position overrides
    showChapter: false,
    badge: { show: true, kind: 'Capsule', num: '1', custom: '' },
    names: { host: 'Abdul Mueez Otoo', guest: '' },
    showNames: false,
    bookends: { introOn: false, introSec: 3, kicker: '', headline: '', sub: '', outroOn: false, outroSec: 4, outroHeadline: '', outroSub: '' },
    music: { vol: 0.25, duck: 0.3, name: '' },
    exportSubs: true,
    exportLevel: true,
    anim: 'fade',
  },
  audioName: '',
  duration: 0,
  fmt: '9x16',
  exportFmts: { '9x16': true, '4x5': false, '1x1': false, '16x9': true },
  exportWhat: { full: true },
  dest: 'folder',
};
let audioFile = null, audioURL = null, audioBuf48 = null;
let sel = null;            // selected word {c, w}
let selEl = null;          // selected design element name
let undoStack = [];
let logoImg = null;  // custom logo (if any)
const logoLight = new Image(), logoDark = new Image();
logoLight.onload = logoDark.onload = () => drawPreview();
logoLight.src = OFFICIAL_LOGO; logoDark.src = OFFICIAL_LOGO_DARK;
let playClip = null;       // clip being played (stop at its end)
let selClip = null;        // clip selected on the timeline
const audio = new Audio();
audio.preload = 'auto';
let previewMode = null;    // null | {kind:'intro'|'outro', t0} | {kind:'slide', id}
let musicBuf = null, musicURL = null;
const musicEl = new Audio(); musicEl.loop = true; musicEl.preload = 'auto';
let speech = [];           // speaking ranges, for music ducking
let highlights = [];

// ---- custom dictionary (shared by all projects in this browser) ----
const DICT_KEY = 'wdgta-studio:dictionary';
let dict = (() => { try { const d = JSON.parse(localStorage.getItem(DICT_KEY) || 'null'); return Array.isArray(d) ? d : DEFAULT_DICTIONARY.map((x) => ({ ...x })); } catch { return DEFAULT_DICTIONARY.map((x) => ({ ...x })); } })();
function saveDict() { try { localStorage.setItem(DICT_KEY, JSON.stringify(dict)); } catch {} }

// ---------------- helpers ----------------
const fmtTime = (s, ms = false) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), r = s - m * 60;
  return ms ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
};
const slug = (s) => (s || 'wdgta').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'wdgta';
const uid = () => Math.random().toString(36).slice(2, 9);
function show(el, on) { el.hidden = !on; }
function errorBox(el, msg) { el.textContent = msg || ''; show(el, !!msg); }
const totalDur = () => state.duration || audio.duration || (state.cards.length ? cardEnd(state.cards[state.cards.length - 1]) + 1 : 0);

function styleObj(extra = {}) {
  return {
    upper: state.settings.upper,
    handle: state.settings.handle,
    cta: state.settings.cta || 'Follow @wedeygothrougham for more',
    progress: state.settings.progress,
    title: state.settings.showTitle ? state.title : '',
    showLogo: state.settings.showLogo,
    bg: state.settings.bg,
    logo: logoImg,
    logoLight, logoDark,
    layout: state.settings.layouts,
    range: { start: 0, end: totalDur() },
    showChapter: state.settings.showChapter,
    chapters: state.chapters,
    names: state.settings.names,
    showNames: state.settings.showNames,
    bookends: state.settings.bookends,
    badge: badgeText(),
    chapterMarks: state.settings.chapterMarks !== false,
    anim: state.settings.anim || 'fade',
    ...extra,
  };
}
function badgeText() {
  const b = state.settings.badge || {};
  if (b.show === false) return '';
  return b.kind === 'Custom' ? (b.custom || '') : `${b.kind || 'Capsule'} ${b.num || ''}`.trim();
}
function snapshot() {
  undoStack.push(JSON.stringify({ cards: state.cards, clips: state.clips }));
  if (undoStack.length > 60) undoStack.shift();
  $('btnUndo').disabled = false;
}
let libTimer = null;
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  if (state.id && state.cards.length) {
    clearTimeout(libTimer);
    libTimer = setTimeout(flushSave, 700);
  }
}
/** Save now: to this browser's library and, if connected, to the projects folder. */
async function flushSave(extra = {}) {
  clearTimeout(libTimer); libTimer = null;
  if (!state.id || !state.cards.length) return;
  try { await libSave(state); } catch (e) { console.warn('[Studio] library save failed', e); }
  if (dirHandle && folderPerm === 'granted') {
    try { await saveToFolder(dirHandle, state, extra); setFolderStatus(); }
    catch (e) { console.warn('[Studio] folder save failed', e); folderPerm = await dirPermission(dirHandle); setFolderStatus(`Could not save to the folder (${e.message || e}).`); }
  }
}
// make sure the last edits are written when the window closes or is hidden
window.addEventListener('pagehide', () => { if (libTimer) flushSave(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && libTimer) flushSave(); });
function ensureId() { if (!state.id) state.id = 'p' + Date.now().toString(36) + uid(); return state.id; }
function changed() {
  assignSpeakers(state.cards);
  speech = speechRanges(state.cards);
  persist(); renderCards(); renderChapters(); renderSlides(); renderClips(); drawPreview(); tlInvalidate();
  $('btnSave').disabled = !state.cards.length; $('btnExportTop').disabled = !state.cards.length;
}

// ---------------- audio loading ----------------
async function setAudio(file, { store = true } = {}) {
  audioFile = file;
  if (store && state.id) {
    putFile(`${state.id}:audio`, file).catch(() => notice('This browser could not keep a copy of the recording; you may need to add it again next time.'));
    if (state.cards.length) flushSave({ audio: file });
  }
  audioBuf48 = null;
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = URL.createObjectURL(file);
  audio.src = audioURL;
  audio.playbackRate = speed;
  state.audioName = file.name;
  $('dropFile').textContent = file.name;
  show($('dropFile'), true);
  $('btnTranscribe').disabled = false;
  await new Promise((r) => { audio.onloadedmetadata = r; audio.onerror = r; });
  if (isFinite(audio.duration)) state.duration = audio.duration;
  $('dropFile').textContent = `${file.name} · ${fmtTime(state.duration)}`;
  show($('noAudio'), false);
  show($('resume'), false);
  updateTime();
  drawPreview();
  peaks = null; tlInvalidate();
  getAudio48().then(computePeaks).catch(() => {});
}

async function decodeAll(file, sampleRate) {
  const buf = await file.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  try { return await ac.decodeAudioData(buf); } finally { ac.close?.(); }
}
async function getAudio48() {
  if (!audioBuf48) audioBuf48 = await decodeAll(audioFile, 48000);
  return audioBuf48;
}
async function to16kMono(buffer) {
  const len = Math.ceil(buffer.duration * 16000);
  const off = new OfflineAudioContext(1, len, 16000);
  const src = off.createBufferSource();
  src.buffer = buffer; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

// ---------------- transcription ----------------
let worker = null;
async function transcribe() {
  if (!audioFile) return;
  errorBox($('audioError'), '');
  show($('job'), true);
  $('btnTranscribe').disabled = true;
  setJob('Reading audio…', 0);
  let mono;
  try { mono = await to16kMono(await getAudio48()); }
  catch {
    errorBox($('audioError'), 'This file could not be read as audio. Try exporting it as MP3 or WAV and upload again.');
    $('btnTranscribe').disabled = false; show($('job'), false);
    return;
  }
  if (!worker) worker = new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
  const started = performance.now();
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'status') setJob(m.text, null);
    else if (m.type === 'download') setJob(`Downloading speech model · ${(m.loaded / 1e6).toFixed(0)} / ${(m.total / 1e6).toFixed(0)} MB`, m.loaded / m.total);
    else if (m.type === 'progress') {
      const el = (performance.now() - started) / 1000;
      const left = m.done < m.total ? ` · about ${fmtTime(el / m.done * (m.total - m.done))} left` : '';
      setJob(`Listening · part ${m.done} of ${m.total} · ${m.words} words${left}`, m.done / m.total);
    }
    else if (m.type === 'log') console.info('[Studio]', m.text);
    else if (m.type === 'error') {
      errorBox($('audioError'), `Transcription stopped: ${m.text}. Check your internet connection for the first model download, then try again.`);
      $('btnTranscribe').disabled = false; show($('job'), false);
    }
    else if (m.type === 'done') {
      show($('job'), false);
      $('btnTranscribe').disabled = false;
      if (!m.words.length) { errorBox($('audioError'), 'No speech was found in this file.'); return; }
      undoStack = [];
      const fixed = applyDictionary(m.words, dict);
      state.cards = buildCards(fixed.words, { keys: state.settings.maxKeys });
      state.clips = []; state.chapters = []; state.slides = [];
      state.id = null; ensureId();
      if (audioFile) putFile(`${state.id}:audio`, audioFile).catch(() => {});
      if (musicBuf && $('musicFile').files[0]) putFile(`${state.id}:music`, $('musicFile').files[0]).catch(() => {});
      setTimeout(() => flushSave({ audio: audioFile }), 0);
      if (fixed.count) notice(`Dictionary fixed ${fixed.count} word${fixed.count > 1 ? 's' : ''} automatically.`);
      enterWorkspace();
    }
  };
  worker.postMessage({ type: 'run', audio: mono, quality: $('quality').value }, [mono.buffer]);
}
function setJob(text, frac) {
  $('jobText').textContent = text;
  if (frac != null) { $('jobBar').style.width = `${Math.round(frac * 100)}%`; $('jobPct').textContent = `${Math.round(frac * 100)}%`; }
}

// ---------------- workspace / words ----------------
function enterWorkspace() {
  show($('stepAudio'), false);
  show($('workspace'), true);
  show($('noAudio'), !audioFile);
  sel = null;
  changed();
  resizeCanvas();
}
function allWords() { return state.cards.flatMap((c) => c.words); }

function renderCards() {
  const frag = document.createDocumentFragment();
  state.cards.forEach((c, ci) => {
    const li = document.createElement('li');
    li.className = 'card' + (c._spk === 'guest' ? ' spk-guest' : '') + (c.turn === 'guest' ? ' turn-guest' : '');
    li.dataset.c = ci;
    const tb = document.createElement('button');
    tb.className = 'card-time'; tb.type = 'button'; tb.dataset.seek = cardStart(c);
    tb.textContent = fmtTime(cardStart(c), true);
    li.appendChild(tb);
    const wrap = document.createElement('div'); wrap.className = 'card-words';
    if (c.turn) {
      const chip = document.createElement('span');
      chip.className = 'turn-chip ' + c.turn;
      chip.textContent = (c.turn === 'guest' ? (state.settings.names.guest || 'Guest') : (state.settings.names.host || 'Host')) + ' speaks';
      wrap.appendChild(chip);
    }
    c.words.forEach((wd, wi) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'w'; b.dataset.c = ci; b.dataset.w = wi;
      if (c.keys.includes(wi)) b.classList.add('is-key');
      if (wd.edited) b.classList.add('is-edited');
      if (wd.mark) b.classList.add('has-mark');
      if (sel && sel.c === ci && sel.w === wi) b.classList.add('is-sel');
      b.textContent = wd.w;
      wrap.appendChild(b);
    });
    if (c.note) { const n = document.createElement('p'); n.className = 'card-note'; n.textContent = '↳ ' + c.note; wrap.appendChild(n); }
    li.appendChild(wrap);
    frag.appendChild(li);
  });
  $('cards').replaceChildren(frag);
  const n = allWords().length;
  $('stats').textContent = `${state.cards.length} screens · ${n} words · ${fmtTime(totalDur())}`;
  updateWordbar();
  lastNow = null;
}
function updateWordbar() {
  const on = !!(sel && state.cards[sel.c] && state.cards[sel.c].words[sel.w]);
  show($('wordbar'), on);
  show($('markerBody'), on); show($('markerEmpty'), !on);
  if (!on) { sel = null; return; }
  const c = state.cards[sel.c], wd = c.words[sel.w];
  if (document.activeElement !== $('wordText')) $('wordText').value = wd.w;
  $('wKey').textContent = c.keys.includes(sel.w) ? 'Remove yellow' : 'Make yellow';
  $('wSplit').disabled = sel.w === 0;
  $('wJoin').disabled = sel.c === 0;
  $('wTime').textContent = `${fmtTime(wd.s, true)} – ${fmtTime(wd.e, true)}`;
  $('wMark').value = wd.mark || '';
  if (document.activeElement !== $('wNote')) $('wNote').value = c.note || '';
}
function selectWord(ci, wi, seek = true) {
  sel = { c: ci, w: wi };
  document.querySelectorAll('.w.is-sel').forEach((el) => el.classList.remove('is-sel'));
  document.querySelector(`.w[data-c="${ci}"][data-w="${wi}"]`)?.classList.add('is-sel');
  updateWordbar();
  if (seek) { audio.currentTime = state.cards[ci].words[wi].s; updateTime(); drawPreview(); }
  $('wordText').focus(); $('wordText').select();
}
function shiftKeys(c, from, delta) { c.keys = c.keys.map((k) => (k > from ? k + delta : k)); }
function applyWordEdit() {
  if (!sel) return;
  const c = state.cards[sel.c], wd = c.words[sel.w];
  const parts = $('wordText').value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return deleteWord();
  if (parts.length === 1 && parts[0] === wd.w) return;
  snapshot();
  const total = parts.reduce((a, p) => a + p.length, 0);
  let t = wd.s; const span = wd.e - wd.s;
  const repl = parts.map((p) => { const d = span * p.length / total; const o = { w: p, s: t, e: t + d, edited: true }; t += d; return o; });
  c.words.splice(sel.w, 1, ...repl);
  shiftKeys(c, sel.w, repl.length - 1);
  changed();
  const nx = sel.w + repl.length;
  if (nx < c.words.length) selectWord(sel.c, nx, false);
  else if (state.cards[sel.c + 1]) selectWord(sel.c + 1, 0, false);
}
function toggleKey() {
  if (!sel) return; snapshot();
  const c = state.cards[sel.c];
  c.keys = c.keys.includes(sel.w) ? c.keys.filter((k) => k !== sel.w) : [...c.keys, sel.w].sort((a, b) => a - b);
  changed();
}
function splitHere() {
  if (!sel || sel.w === 0) return; snapshot();
  const c = state.cards[sel.c];
  const tail = c.words.splice(sel.w);
  const nc = { words: tail, keys: c.keys.filter((k) => k >= sel.w).map((k) => k - sel.w) };
  c.keys = c.keys.filter((k) => k < sel.w);
  if (!c.keys.length) c.keys = autoKeys(c.words, state.settings.maxKeys);
  if (!nc.keys.length) nc.keys = autoKeys(nc.words, state.settings.maxKeys);
  state.cards.splice(sel.c + 1, 0, nc);
  sel = { c: sel.c + 1, w: 0 };
  changed();
}
function joinPrev() {
  if (!sel || sel.c === 0) return; snapshot();
  const prev = state.cards[sel.c - 1], c = state.cards[sel.c];
  const off = prev.words.length;
  prev.words.push(...c.words);
  prev.keys = [...prev.keys, ...c.keys.map((k) => k + off)];
  state.cards.splice(sel.c, 1);
  sel = { c: sel.c - 1, w: off + sel.w };
  changed();
}
function deleteWord() {
  if (!sel) return; snapshot();
  const c = state.cards[sel.c];
  c.words.splice(sel.w, 1);
  c.keys = c.keys.filter((k) => k !== sel.w);
  shiftKeys(c, sel.w, -1);
  if (!c.words.length) { state.cards.splice(sel.c, 1); sel = null; }
  else if (sel.w >= c.words.length) sel.w = c.words.length - 1;
  changed();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return;
  const d = JSON.parse(s);
  state.cards = d.cards; state.clips = d.clips || state.clips;
  sel = null;
  $('btnUndo').disabled = !undoStack.length;
  changed();
}
function regroup() {
  if (!state.cards.length) return; snapshot();
  state.cards = buildCards(allWords(), { keys: state.settings.maxKeys });
  sel = null; changed();
}
function repickKeys() {
  if (!state.cards.length) return; snapshot();
  for (const c of state.cards) c.keys = autoKeys(c.words, state.settings.maxKeys);
  changed();
}
function replaceAll() {
  const find = $('findText').value.trim();
  const repl = $('replText').value.trim();
  if (!find) return;
  const clean = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  let n = 0;
  snapshot();
  for (const c of state.cards) for (const wd of c.words) {
    if (clean(wd.w) === clean(find)) {
      const trail = (wd.w.match(/[^\p{L}\p{N}']+$/u) || [''])[0];
      wd.w = repl + trail; wd.edited = true; n++;
    }
  }
  if (!n) undoStack.pop();
  if (n && repl && $('replRemember').checked && !dict.some((d) => d.from.toLowerCase() === find.toLowerCase())) {
    dict.push({ from: find, to: repl }); saveDict(); renderDict();
  }
  $('replText').value = '';
  $('replText').placeholder = n ? `Replaced ${n}` : 'No matches';
  changed();
}

// ---------------- preview ----------------
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
let pScale = 0.5, lastBoxes = {};
function isFull() { return document.fullscreenElement === $('stage'); }
function previewFmt() { return previewMode && previewMode.kind === 'slide' ? { id: 'slide', w: 1080, h: 1350 } : FORMATS[state.fmt]; }
function resizeCanvas() {
  const f = previewFmt();
  const cap = isFull() ? Math.max(screen.width, screen.height) : 720;
  pScale = Math.min(1, cap / Math.max(f.w, f.h)) * Math.min(2, window.devicePixelRatio || 1);
  pScale = Math.min(pScale, 1);
  canvas.width = Math.round(f.w * pScale); canvas.height = Math.round(f.h * pScale);
  canvas.style.aspectRatio = `${f.w} / ${f.h}`;
  drawPreview();
}
function previewStyle() {
  if (playClip) return styleObj({ range: { start: playClip.start, end: playClip.end }, title: state.settings.showTitle ? (playClip.title || state.title) : '' });
  return styleObj();
}
function drawPreview() {
  if (!state.cards.length) return;
  if (previewMode) return drawPreviewMode();
  const f = FORMATS[state.fmt];
  ctx.setTransform(pScale, 0, 0, pScale, 0, 0);
  lastBoxes = drawFrame(ctx, state.cards, audio.currentTime || 0, f, previewStyle());
  if (ui.safe && !isFull()) drawSafeZones(ctx, f);
  if (selEl && lastBoxes[selEl] && !isFull()) {
    const [x, y, w, h] = lastBoxes[selEl];
    const pad = 10;
    ctx.save();
    ctx.strokeStyle = '#FFC710'; ctx.lineWidth = 3 / pScale * 0.5; ctx.setLineDash([12, 8]);
    ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
    ctx.restore();
  }
}
let lastNow = null;
function markNow() {
  const t = audio.currentTime;
  const ci = cardAt(state.cards, t);
  let wi = -1;
  if (ci >= 0) { const ws = state.cards[ci].words; for (let i = 0; i < ws.length; i++) if (ws[i].s <= t) wi = i; }
  const key = ci + ':' + wi;
  if (key === lastNow) return;
  lastNow = key;
  document.querySelectorAll('.card.is-now, .w.is-now').forEach((el) => el.classList.remove('is-now'));
  if (ci < 0) return;
  const li = document.querySelector(`.card[data-c="${ci}"]`);
  li?.classList.add('is-now');
  document.querySelector(`.w[data-c="${ci}"][data-w="${wi}"]`)?.classList.add('is-now');
  if (!audio.paused && li) {
    const box = $('cards'); const r = li.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
  }
}
function tick() {
  if (playClip && audio.currentTime >= playClip.end) { audio.pause(); stopClipPlayback(); }
  syncMusic();
  drawPreview(); updateTime(); markNow(); drawTimeline(true);
  if (!audio.paused) requestAnimationFrame(tick);
}
function updateTime() {
  const d = totalDur();
  $('timeLbl').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(d)}`;
  $('fsTime').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(d)}`;
  if (d && document.activeElement !== $('scrub')) $('scrub').value = Math.round(audio.currentTime / d * 1000);
}
function setPlayLabels() {
  const l = audio.paused ? 'Play' : 'Pause';
  $('btnPlay').classList.toggle('is-playing', !audio.paused);
  $('btnPlay').setAttribute('aria-label', l);
  $('fsPlay').textContent = l;
}
function togglePlay() {
  if (!audioFile) return;
  if (previewMode) exitPreviewMode();
  if (audio.paused) { audio.play(); requestAnimationFrame(tick); } else audio.pause();
}
audio.addEventListener('play', setPlayLabels);
audio.addEventListener('pause', () => { setPlayLabels(); musicEl.pause(); });
audio.addEventListener('seeked', () => { if (musicBuf) musicEl.currentTime = (audio.currentTime || 0) % (musicBuf.duration || 1); });
audio.addEventListener('ended', setPlayLabels);

function buildTabs() {
  $('fmtTabs').replaceChildren(...Object.values(FORMATS).map((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fmt-tab'; b.role = 'tab';
    b.textContent = f.label; b.title = `${f.name} · ${f.use}`;
    b.setAttribute('aria-selected', String(f.id === state.fmt));
    b.onclick = () => { state.fmt = f.id; buildTabs(); resizeCanvas(); updateElbar(); persist(); };
    return b;
  }));
  $('fmtList').replaceChildren(...Object.values(FORMATS).map((f) => {
    const row = document.createElement('label');
    row.className = 'fmt-row';
    row.innerHTML = `<input type="checkbox"><span class="fmt-ratio">${f.label}</span><span class="fmt-use">${f.name} · ${f.use}</span><span class="fmt-state">${f.w}×${f.h}</span>`;
    const cb = row.querySelector('input');
    cb.checked = !!state.exportFmts[f.id];
    cb.onchange = () => { state.exportFmts[f.id] = cb.checked; persist(); };
    return row;
  }));
}

// ---------------- move & resize design elements ----------------
function toOut(e) {
  const r = canvas.getBoundingClientRect(), f = FORMATS[state.fmt];
  return { x: (e.clientX - r.left) / r.width * f.w, y: (e.clientY - r.top) / r.height * f.h };
}
function hitTest(p) {
  const order = ['note', 'badge', 'chapter', 'logo', 'title', 'handle', 'progress', 'text'];
  for (const k of order) {
    const b = lastBoxes[k]; if (!b) continue;
    const pad = 14;
    if (p.x >= b[0] - pad && p.x <= b[0] + b[2] + pad && p.y >= b[1] - pad && p.y <= b[1] + b[3] + pad) return k;
  }
  return null;
}
function layoutFor(fmtId) { return (state.settings.layouts[fmtId] ||= {}); }
function setEl(name, patch) {
  const cur = resolveLayout(state.fmt, state.settings.layouts)[name];
  layoutFor(state.fmt)[name] = { ...cur, ...patch };
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!state.cards.length || isFull() || previewMode) return;
  const p = toOut(e);
  const hit = hitTest(p);
  selEl = hit; updateElbar(); drawPreview();
  if (!hit) return;
  const cur = resolveLayout(state.fmt, state.settings.layouts)[hit];
  const f0 = FORMATS[state.fmt];
  const x0 = hit === 'note' ? lastBoxes.note[0] / f0.w : cur.x, y0 = hit === 'note' ? lastBoxes.note[1] / f0.h : cur.y;
  drag = { name: hit, p0: p, x0, y0, moved: false };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('is-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (!isFull() && state.cards.length) canvas.style.cursor = hitTest(toOut(e)) ? 'grab' : 'default';
    return;
  }
  const f = FORMATS[state.fmt], p = toOut(e);
  const nx = Math.min(0.97, Math.max(-0.2, drag.x0 + (p.x - drag.p0.x) / f.w));
  const ny = Math.min(0.99, Math.max(0, drag.y0 + (p.y - drag.p0.y) / f.h));
  if (!drag.moved) { snapshotLayout(); drag.moved = true; }
  setEl(drag.name, { x: +nx.toFixed(4), y: +ny.toFixed(4), rel: false });
  drawPreview(); updateElbar();
});
function endDrag() { if (drag) { drag = null; canvas.classList.remove('is-dragging'); persist(); } }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  if (!selEl || isFull()) return;
  e.preventDefault();
  const cur = resolveLayout(state.fmt, state.settings.layouts)[selEl];
  const s = Math.min(2.5, Math.max(0.4, (cur.s || 1) * (e.deltaY < 0 ? 1.05 : 0.95)));
  setEl(selEl, { s: +s.toFixed(3) }); updateElbar(); drawPreview(); persist();
}, { passive: false });
function snapshotLayout() { /* positions are cheap to reset; no undo entry needed */ }
function updateElbar() {
  show($('elbar'), !!selEl);
  show($('elHint'), !selEl);
  document.querySelectorAll('.layers li').forEach((li) => li.classList.toggle('is-sel', li.querySelector('[data-el]')?.dataset.el === selEl));
  if (!selEl) return;
  const f = FORMATS[state.fmt];
  const cur = resolveLayout(state.fmt, state.settings.layouts)[selEl];
  $('elName').textContent = `${ELEMENTS[selEl]} · ${f.label}`;
  $('elSize').value = Math.round((cur.s || 1) * 100);
  $('elSizeOut').textContent = `${Math.round((cur.s || 1) * 100)}%`;
  let x = cur.x * f.w, y = cur.y * f.h;
  if (selEl === 'note' && cur.rel !== false && lastBoxes.note) { x = lastBoxes.note[0]; y = lastBoxes.note[1]; }
  if (document.activeElement !== $('elX')) $('elX').value = Math.round(x);
  if (document.activeElement !== $('elY')) $('elY').value = Math.round(y);
}

// ---------------- your default layout ----------------
const MY_LAYOUT_KEY = 'wdgta-studio:myLayout';
try { setUserLayouts(JSON.parse(localStorage.getItem(MY_LAYOUT_KEY) || '{}')); } catch { setUserLayouts({}); }
function saveMyLayout() {
  // every element's current position in every format, as this project shows them
  const mine = {};
  for (const fid of Object.keys(FORMATS)) {
    const r = resolveLayout(fid, state.settings.layouts);
    mine[fid] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v }]));
  }
  try { localStorage.setItem(MY_LAYOUT_KEY, JSON.stringify(mine)); } catch {}
  setUserLayouts(mine);
  notice('Saved. Every project now starts with this layout. Elements you have moved in a project stay where you put them; use "Reset to my default" there to bring them in line.', 8000);
}
function useMyLayout() {
  state.settings.layouts = {};
  persist(); drawPreview(); updateElbar();
  notice('This project now uses your default layout.', 4000);
}

// ---------------- edit the words right on the video (double-click) ----------------
let wordEditor = null;
function openWordEditor() {
  if (!state.cards.length || previewMode) return;
  const ci = cardAt(state.cards, audio.currentTime || 0);
  if (ci < 0 || !lastBoxes.text) return;
  audio.pause();
  closeWordEditor(false);
  const card = state.cards[ci];
  const r = canvas.getBoundingClientRect(), st = $('stage').getBoundingClientRect(), f = FORMATS[state.fmt];
  const [bx, by, bw, bh] = lastBoxes.text;
  const k = r.width / f.w;
  const ta = document.createElement('textarea');
  ta.className = 'word-editor';
  ta.setAttribute('aria-label', 'Edit the words on this screen');
  ta.value = card.words.map((w) => w.w).join(' ');
  const left = Math.max(r.left, r.left + bx * k - 8) - st.left;
  const width = Math.min(r.width - (left - (r.left - st.left)) - 8, Math.max(220, bw * k + 16));
  ta.style.left = `${left}px`;
  ta.style.top = `${Math.max(r.top, r.top + by * k - 8) - st.top}px`;
  ta.style.width = `${width}px`;
  ta.style.minHeight = `${Math.max(64, bh * k + 16)}px`;
  if (state.settings.upper === false) ta.style.textTransform = 'none';
  $('stage').appendChild(ta);
  const hint = document.createElement('span');
  hint.className = 'word-editor-hint mono';
  hint.textContent = 'Enter to save · Esc to cancel';
  hint.style.left = ta.style.left;
  $('stage').appendChild(hint);
  wordEditor = { ta, hint, ci, original: ta.value };
  const placeHint = () => { hint.style.top = `${ta.offsetTop + ta.offsetHeight + 6}px`; };
  placeHint();
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; placeHint(); });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeWordEditor(false); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeWordEditor(true); }
  });
  ta.addEventListener('blur', () => setTimeout(() => closeWordEditor(true), 0));
  ta.focus(); ta.select();
}
function closeWordEditor(commit) {
  if (!wordEditor) return;
  const { ta, hint, ci, original } = wordEditor;
  wordEditor = null;
  ta.remove(); hint.remove();
  const text = ta.value.replace(/\s+/g, ' ').trim();
  if (!commit || text === original.replace(/\s+/g, ' ').trim()) return;
  if (!text) { notice('A screen needs at least one word. Nothing changed.', 3500); return; }
  const card = state.cards[ci];
  if (!card) return;
  snapshot();
  const tokens = text.split(' ');
  if (tokens.length === card.words.length) {
    tokens.forEach((t, i) => { card.words[i].w = t; });
  } else {
    // re-time the screen's words across the same span, weighted by length
    const s0 = cardStart(card), e0 = cardEnd(card);
    const weights = tokens.map((t) => Math.max(2, t.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = s0;
    const old = card.words;
    card.words = tokens.map((t, i) => {
      const d = (e0 - s0) * weights[i] / total;
      const w = { w: t, s: +acc.toFixed(3), e: +(acc + d).toFixed(3) };
      if (old[i]?.mark && i < old.length) w.mark = old[i].mark;
      acc += d;
      return w;
    });
    card.keys = (card.keys || []).filter((i) => i < tokens.length);
  }
  renderCards(); persist(); drawPreview(); tlInvalidate();
}
canvas.addEventListener('dblclick', (e) => {
  if (!state.cards.length || previewMode) return;
  if (hitTest(toOut(e)) === 'text') { e.preventDefault(); openWordEditor(); }
});

// ---------------- full screen ----------------
async function enterFull() {
  try { await $('stage').requestFullscreen(); } catch { /* not allowed: ignore */ }
}
document.addEventListener('fullscreenchange', () => { resizeCanvas(); });

// ---------------- clips ----------------
function clipText(c) {
  const ws = allWords().filter((w) => w.s >= c.start && w.e <= c.end).slice(0, 14).map((w) => w.w).join(' ');
  return ws ? ws + '…' : '';
}
function renderClips() {
  const ol = $('clipList');
  if (!state.clips.length) {
    ol.innerHTML = '<li class="clip-empty">No clips yet.</li>';
  } else {
    ol.replaceChildren(...state.clips.map((c, i) => {
      const li = document.createElement('li');
      li.className = 'clip' + (playClip && playClip.id === c.id ? ' is-playing' : '') + (selClip === c.id ? ' is-sel' : '');
      li.dataset.id = c.id;
      li.innerHTML = `
        <input type="text" aria-label="Clip name" value="">
        <button class="btn small" data-act="play" type="button">${playClip && playClip.id === c.id ? 'Stop' : 'Play'}</button>
        <p class="clip-text"></p>
        <div class="clip-meta">
          <span class="mono">${fmtTime(c.start, true)} → ${fmtTime(c.end, true)} · ${Math.round(c.end - c.start)} s</span>
          <button class="btn small ghost" data-act="start" type="button">Start here</button>
          <button class="btn small ghost" data-act="end" type="button">End here</button>
          <input type="text" class="clip-title" aria-label="Title shown on this clip" placeholder="On-screen title (optional)">
          <button class="btn small ghost" data-act="prompt" type="button" title="Copy a caption-writing prompt for this clip">Caption prompt</button>
          <button class="btn small ghost danger" data-act="del" type="button">Remove</button>
        </div>`;
      const name = li.querySelector('input');
      name.value = c.name;
      name.oninput = () => { c.name = name.value; persist(); renderWhat(); };
      const ttl = li.querySelector('.clip-title');
      ttl.value = c.title || '';
      ttl.oninput = () => { c.title = ttl.value; persist(); drawPreview(); };
      li.querySelector('.clip-text').textContent = clipText(c);
      li.querySelectorAll('button[data-act]').forEach((b) => b.onclick = () => clipAction(b.dataset.act, i));
      return li;
    }));
  }
  renderWhat();
}
function clipAction(act, i) {
  const c = state.clips[i];
  const t = audio.currentTime;
  if (act === 'play') {
    if (playClip && playClip.id === c.id) { audio.pause(); stopClipPlayback(); return; }
    if (!audioFile) return;
    playClip = c; audio.currentTime = c.start; audio.play(); requestAnimationFrame(tick); renderClips();
  } else if (act === 'start') {
    if (t >= c.end - 1) return; snapshot(); c.start = +t.toFixed(2); changed();
  } else if (act === 'end') {
    if (t <= c.start + 1) return; snapshot(); c.end = +t.toFixed(2); changed();
  } else if (act === 'del') {
    snapshot(); state.clips.splice(i, 1); delete state.exportWhat[c.id]; changed();
  } else if (act === 'prompt') {
    copyPrompt('a short clip', c.title || c.name, c.start, c.end, $('capOut'), $('capHint'), true);
  }
}
function stopClipPlayback() { playClip = null; renderClips(); drawPreview(); }
function addClipAtPlayhead() {
  if (!state.cards.length) return;
  const target = +$('clipLen').value;
  const t = audio.currentTime || 0;
  let ci = cardAt(state.cards, t); if (ci < 0) ci = 0;
  const start = Math.max(0, cardStart(state.cards[ci]) - 0.25);
  let end = Math.min(totalDur(), start + target);
  const ce = cardAt(state.cards, end);
  if (ce >= 0) end = Math.min(totalDur(), cardEnd(state.cards[ce]) + 0.5);
  snapshot();
  const c = { id: uid(), name: `Clip ${state.clips.length + 1}`, start: +start.toFixed(2), end: +end.toFixed(2), title: '' };
  state.clips.push(c); state.clips.sort((a, b) => a.start - b.start);
  state.exportWhat[c.id] = true;
  changed();
}
function splitAuto() {
  if (!state.cards.length) return;
  const parts = suggestClips(state.cards, +$('clipLen').value, totalDur());
  snapshot();
  state.clips = parts.map((p, i) => ({ id: uid(), name: `Part ${i + 1}`, start: +p.start.toFixed(2), end: +p.end.toFixed(2), title: '' }));
  state.exportWhat = { full: state.exportWhat.full };
  for (const c of state.clips) state.exportWhat[c.id] = true;
  changed();
}
function renderWhat() {
  const box = $('exWhat');
  const items = [{ id: 'full', name: `Full recording (${fmtTime(totalDur())})` }, ...state.clips.map((c) => ({ id: c.id, name: c.name || 'Clip' }))];
  box.replaceChildren(...items.map((it) => {
    const l = document.createElement('label');
    l.className = 'chip';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!state.exportWhat[it.id];
    cb.onchange = () => { state.exportWhat[it.id] = cb.checked; persist(); };
    l.append(cb, document.createTextNode(it.name));
    return l;
  }));
}

// ---------------- export ----------------
let exportAbort = null;
function triggerDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  const li = document.createElement('li');
  const link = document.createElement('a'); link.href = a.href; link.download = name; link.textContent = `Download ${name} again`;
  li.appendChild(link); $('downloads').appendChild(li);
}
async function pickFolder() {
  if (state.dest !== 'folder') return null;
  if (!window.showDirectoryPicker) { $('exportHint').textContent = 'This browser cannot save into a folder, so files will download instead.'; return null; }
  return window.showDirectoryPicker({ id: 'wdgta-exports', mode: 'readwrite' });
}
async function doExport(preset = null) {
  errorBox($('exportError'), '');
  if (!audioFile) { errorBox($('exportError'), 'Add the audio file first (under the preview).'); return; }
  if (!exportSupported()) { errorBox($('exportError'), 'This browser cannot make videos. Use the latest Chrome or Edge on a laptop or desktop.'); return; }
  const weekly = preset === 'weekly';
  const fmts = Object.values(FORMATS).filter((f) => state.exportFmts[f.id]);
  const base = slug(state.title || state.audioName.replace(/\.[^.]+$/, ''));
  const jobs = [];
  const targets = [];
  const full = { key: 'full', start: 0, end: totalDur(), title: state.title, fmts: weekly ? [FORMATS['16x9']] : fmts };
  if (weekly || state.exportWhat.full) targets.push(full);
  for (const c of state.clips) if (weekly || state.exportWhat[c.id]) targets.push({ key: slug(c.name || 'clip'), start: c.start, end: c.end, title: c.title || state.title, fmts: weekly ? [FORMATS['9x16']] : fmts });
  for (const tg of targets) for (const f of tg.fmts) jobs.push({ tg, f });
  if (!jobs.length) { errorBox($('exportError'), 'Tick at least one item under "What" and one size.'); return; }
  const doSubs = weekly || state.settings.exportSubs;
  const doSlides = weekly && state.slides.length > 0;

  let dir = null;
  try { dir = await pickFolder(); } catch (e) { if (e.name === 'AbortError') return; }
  audio.pause();
  $('btnExport').disabled = true; $('btnPack').disabled = true; $('btnStill').disabled = true; show($('btnCancel'), true); show($('exBarWrap'), true);
  exportAbort = new AbortController();
  $('downloads').replaceChildren();
  const t0 = performance.now();
  let compat = false;
  try {
    $('exportHint').textContent = 'Preparing audio…';
    const buf = await getAudio48();
    await loadFonts();
    for (let j = 0; j < jobs.length; j++) {
      const { tg, f } = jobs[j];
      const name = `${base}${tg.key === 'full' ? '' : '_' + tg.key}_${f.label.replace(':', 'x')}.mp4`;
      let writable = null;
      if (dir) writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      const start = performance.now();
      const bk = state.settings.bookends;
      const intro = bk.introOn ? +bk.introSec || 3 : 0, outro = bk.outroOn ? +bk.outroSec || 4 : 0;
      const res = await renderMp4({
        cards: state.cards, style: styleObj({ title: state.settings.showTitle ? tg.title : '', bookends: { ...bk, headline: bk.headline || (tg.key === 'full' ? '' : tg.title) } }), fmt: f, audioBuffer: buf,
        start: tg.start, end: tg.end, intro, outro, speech, level: state.settings.exportLevel !== false ? -14 : null,
        music: musicBuf ? { buffer: musicBuf, vol: state.settings.music.vol, duck: state.settings.music.duck } : null,
        writable, signal: exportAbort.signal,
        onProgress: (p) => {
          const el = (performance.now() - start) / 1000;
          const left = p > 0.03 ? ` · about ${fmtTime(el / p * (1 - p))} left on this one` : '';
          $('exBar').style.width = `${((j + p) / jobs.length * 100).toFixed(1)}%`;
          $('exportHint').textContent = `Video ${j + 1} of ${jobs.length}: ${name}${left}`;
        },
      });
      if (res.blob) triggerDownload(res.blob, name);
      if (res.audioCodec === 'opus' || res.videoCodec === 'vp9') compat = true;
    }
    if (doSlides) {
      $('exportHint').textContent = 'Saving carousel slides…';
      let pointNo = 0; state.slides.forEach((sl) => { if (sl.type === 'point') sl.num = ++pointNo; });
      const sbase = slug((state.series || 'carousel') + ' ' + (state.title || ''));
      for (let i = 0; i < state.slides.length; i++) {
        const blob = await renderSlide(state.slides[i], i, state.slides.length, deck());
        const name = `${sbase}_${String(i + 1).padStart(2, '0')}.png`;
        if (dir) { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(blob); await w.close(); }
        else triggerDownload(blob, name);
      }
    }
    if (doSubs) {
      const bk = state.settings.bookends;
      const intro = bk.introOn ? +bk.introSec || 3 : 0;
      for (const tg of targets) {
        const cues = subtitleCues(state.cards, tg.start, tg.end, intro);
        const nm = `${base}${tg.key === 'full' ? '' : '_' + tg.key}`;
        await saveText(dir, `${nm}.srt`, toSRT(cues), 'application/x-subrip');
        await saveText(dir, `${nm}.vtt`, toVTT(cues), 'text/vtt');
      }
    }
    const secs = (performance.now() - t0) / 1000;
    const extras = [doSlides ? `${state.slides.length} slide${state.slides.length > 1 ? 's' : ''}` : '', doSubs ? 'subtitles' : ''].filter(Boolean).join(' and ');
    $('exportHint').textContent = (dir ? `Saved ${jobs.length} video${jobs.length > 1 ? 's' : ''}${extras ? ' plus ' + extras : ''} to the folder you chose in ${fmtTime(secs)}.` : `Made ${jobs.length} video${jobs.length > 1 ? 's' : ''}${extras ? ' plus ' + extras : ''} in ${fmtTime(secs)}. Check your Downloads folder.`) +
      (weekly && !state.slides.length ? ' (No carousel slides yet, so none were included.)' : '') +
      (compat ? ' This browser could not use the standard H.264/AAC formats, so some apps may reject these files. For best results export from Chrome or Edge on Windows or Mac.' : '');
  } catch (e) {
    if (e.name === 'AbortError') $('exportHint').textContent = 'Export cancelled.';
    else { console.error(e); errorBox($('exportError'), `Export failed: ${e.message || e}`); $('exportHint').textContent = ''; }
  } finally {
    $('btnExport').disabled = false; $('btnPack').disabled = false; $('btnStill').disabled = false; show($('btnCancel'), false); show($('exBarWrap'), false); exportAbort = null;
  }
}
async function saveStill() {
  if (!state.cards.length) return;
  await loadFonts();
  const f = FORMATS[state.fmt];
  let t = audio.currentTime || 0;
  // show the whole screen lit up: jump to the end of the current screen
  const ci = cardAt(state.cards, t);
  if (ci >= 0) t = Math.max(t, cardEnd(state.cards[ci]) - 0.01);
  const blob = await renderStill({ cards: state.cards, style: previewStyle(), fmt: f, t, range: previewStyle().range });
  const name = `${slug(state.title || 'wdgta')}_${fmtTime(audio.currentTime).replace(':', 'm')}s_${f.label.replace(':', 'x')}.png`;
  let dir = null;
  try { dir = await pickFolder(); } catch (e) { if (e.name === 'AbortError') return; }
  if (dir) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob); await w.close();
    $('exportHint').textContent = `Saved ${name} to the folder you chose.`;
  } else { triggerDownload(blob, name); $('exportHint').textContent = `Saved ${name}.`; }
}

// ---------------- projects ----------------
function saveProject() {
  const data = { app: 'wdgta-studio', version: 2, savedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${slug(state.title || state.audioName)}.wdgta.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function loadState(data) {
  if (!data || !Array.isArray(data.cards)) throw new Error('Not a WDGTA Studio project file.');
  state.id = data.id || null; ensureId();
  state.title = data.title || '';
  state.cards = data.cards.map(normalizeCard);
  state.clips = Array.isArray(data.clips) ? data.clips : [];
  state.chapters = Array.isArray(data.chapters) ? data.chapters : [];
  state.slides = Array.isArray(data.slides) ? data.slides : [];
  state.series = data.series || 'Reality Check';
  const base = { names: state.settings.names, bookends: state.settings.bookends, music: state.settings.music, badge: state.settings.badge };
  state.settings = { ...state.settings, ...(data.settings || {}) };
  state.settings.names = { ...base.names, ...(data.settings?.names || {}) };
  state.settings.bookends = { ...base.bookends, ...(data.settings?.bookends || {}) };
  state.settings.music = { ...base.music, ...(data.settings?.music || {}), name: '' };
  state.settings.badge = { ...base.badge, ...(data.settings?.badge || {}) };
  state.settings.layouts ||= {};
  state.audioName = data.audioName || '';
  state.duration = data.duration || 0;
  state.fmt = FORMATS[data.fmt] ? data.fmt : '9x16';
  state.exportFmts = { ...state.exportFmts, ...(data.exportFmts || {}) };
  state.exportWhat = { full: true, ...(data.exportWhat || {}) };
  state.dest = data.dest === 'download' ? 'download' : 'folder';
  undoStack = [];
  applySettingsUI();
  $('projTitle').value = state.title;
  buildTabs();
  enterWorkspace();
  if (!audioFile && state.audioName) $('noAudio').firstChild.textContent = `Add the audio file (${state.audioName}) to preview and export: `;
}
function applySettingsUI() {
  $('optUpper').checked = state.settings.upper;
  $('optHandle').checked = state.settings.handle;
  $('ctaText').value = state.settings.cta || 'Follow @wedeygothrougham for more';
  $('optProgress').checked = state.settings.progress;
  $('optTitle').checked = state.settings.showTitle;
  $('optLogo').checked = state.settings.showLogo !== false;
  $('optKeys').value = String(state.settings.maxKeys || 1);
  $('optAnim').value = state.settings.anim || 'fade';
  $('exLevel').checked = state.settings.exportLevel !== false;
  $('optChapter').checked = !!state.settings.showChapter;
  $('optChapMarks').checked = state.settings.chapterMarks !== false;
  const bd = state.settings.badge;
  $('optBadge').checked = bd.show !== false; $('badgeKind').value = bd.kind || 'Capsule';
  $('badgeNum').value = bd.num || ''; $('badgeCustom').value = bd.custom || '';
  show($('badgeNum'), bd.kind !== 'Custom'); show($('badgeCustom'), bd.kind === 'Custom');
  $('optNames').checked = !!state.settings.showNames;
  $('nameHost').value = state.settings.names.host || '';
  $('nameGuest').value = state.settings.names.guest || '';
  const bk = state.settings.bookends;
  $('bkIntro').checked = !!bk.introOn; $('bkIntroSec').value = String(bk.introSec || 3);
  $('bkKicker').value = bk.kicker || ''; $('bkHead').value = bk.headline || ''; $('bkSub').value = bk.sub || '';
  $('bkOutro').checked = !!bk.outroOn; $('bkOutroSec').value = String(bk.outroSec || 4);
  $('bkOHead').value = bk.outroHeadline || ''; $('bkOSub').value = bk.outroSub || '';
  $('musicVol').value = Math.round(state.settings.music.vol * 100); $('musicVolOut').textContent = `${$('musicVol').value}%`;
  $('musicDuck').value = Math.round(state.settings.music.duck * 100); $('musicDuckOut').textContent = `${$('musicDuck').value}%`;
  $('exSubs').checked = state.settings.exportSubs !== false;
  $('cSeries').value = state.series;
  buildSwatches();
  $(state.dest === 'download' ? 'destDownload' : 'destFolder').checked = true;
  setLogo(state.settings.logo);
}
function setLogo(dataUrl) {
  state.settings.logo = dataUrl || null;
  show($('btnLogoClear'), !!dataUrl);
  $('logoName').textContent = dataUrl ? 'Custom logo' : 'Official WDGTA logo';
  if (!dataUrl) { logoImg = null; drawPreview(); return; }
  const img = new Image();
  img.onload = () => { logoImg = img; drawPreview(); };
  img.src = dataUrl;
}
function newProject() {
  audio.pause();
  state.title = ''; state.cards = []; state.clips = []; state.chapters = []; state.slides = []; state.audioName = ''; state.duration = 0;
  previewMode = null; highlights = []; state.id = null;
  if (musicBuf) clearMusicLocal();
  renderRecent();
  state.exportWhat = { full: true };
  audioFile = null; audioBuf48 = null; sel = null; selEl = null; undoStack = [];
  if (audioURL) URL.revokeObjectURL(audioURL); audioURL = null; audio.removeAttribute('src');
  $('projTitle').value = '';
  show($('dropFile'), false);
  $('btnTranscribe').disabled = true;
  show($('workspace'), false); show($('stepAudio'), true); show($('resume'), false);
  $('btnSave').disabled = true;
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

function buildSwatches() {
  $('bgSwatches').replaceChildren(...Object.entries(THEMES).map(([id, th]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.settings.bg === id));
    b.style.background = th.bg;
    b.title = th.name; b.setAttribute('aria-label', th.name);
    b.onclick = () => { state.settings.bg = id; buildSwatches(); persist(); drawPreview(); };
    return b;
  }));
}

// ---------------- inspector tabs ----------------
function setTab(name) {
  if (name !== 'carousel' && previewMode && previewMode.kind === 'slide') exitPreviewMode();
  document.querySelectorAll('#insTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}

// ---------------- timeline ----------------
const tl = $('tl');
const tlScroll = $('tlScroll');
let peaks = null, tlStatic = null, tlZoomLevel = 1, tlW = 0, tlDrag = null, tlGain = 1;
const MAX_TL_PX = 30000; // browsers cap canvas size; keep the timeline under it
const TL = { ruler: [0, 20], clips: [26, 26], screens: [58, 30], audio: [94, 50], h: 150 };
function computePeaks(buf) {
  const ch = buf.getChannelData(0), n = 4000, step = Math.max(1, Math.floor(ch.length / n));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0; const a = i * step, b = Math.min(ch.length, a + step);
    for (let j = a; j < b; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; }
    out[i] = m;
  }
  let max = 0; for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  peaks = out; tlInvalidate();
}
function setGain(g) {
  tlGain = Math.min(4, Math.max(0.5, g));
  $('tlGain').value = String(Math.round(tlGain * 100));
  tlStatic = null; drawTimeline();
}
const tX = (t) => (t / Math.max(0.1, totalDur())) * tlW;
const xT = (x) => Math.min(totalDur(), Math.max(0, x / Math.max(1, tlW) * totalDur()));
function tlInvalidate() { tlStatic = null; drawTimeline(); }
function buildTimelineStatic() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  tlW = tlWidthFor(tlZoomLevel);
  const dprW = Math.min(dpr, MAX_TL_PX / tlW);
  tl.style.width = tlW + 'px';
  tl.width = Math.round(tlW * dprW); tl.height = Math.round(TL.h * dpr);
  const off = document.createElement('canvas'); off.width = tl.width; off.height = tl.height;
  const c = off.getContext('2d'); c.scale(dprW, dpr);
  const dur = totalDur();
  // ruler
  const pps = tlW / Math.max(1, dur);
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((st) => st * pps >= 70) || 600;
  c.font = '400 10px "IBM Plex Mono", monospace'; c.textBaseline = 'top';
  for (let t = 0; t <= dur; t += step) {
    const x = Math.round(tX(t)) + 0.5;
    c.fillStyle = '#3A3833'; c.fillRect(x, 12, 1, 8);
    c.fillStyle = '#8C887F'; c.fillText(fmtTime(t), x + 3, 1);
  }
  // chapters on the ruler
  c.font = '600 10px "Archivo", sans-serif';
  for (const ch of state.chapters) {
    const x = Math.round(tX(ch.t)) + 0.5;
    c.fillStyle = '#E8512A'; c.fillRect(x, 0, 2, 20);
    c.fillStyle = '#E7ECF2'; c.fillText(ch.name, x + 5, 9);
  }
  c.font = '400 10px "IBM Plex Mono", monospace';
  // clips
  const [cy, ch] = TL.clips;
  c.font = '500 11px "Archivo", sans-serif'; c.textBaseline = 'middle';
  for (const cl of state.clips) {
    const x0 = tX(cl.start), x1 = tX(cl.end);
    const sel = cl.id === selClip;
    c.fillStyle = sel ? '#FFC71033' : '#FFC7101A'; c.fillRect(x0, cy, x1 - x0, ch);
    c.strokeStyle = '#FFC710'; c.lineWidth = sel ? 2 : 1; c.strokeRect(x0 + 0.5, cy + 0.5, x1 - x0 - 1, ch - 1);
    c.fillStyle = '#FFC710'; c.fillRect(x0, cy, 3, ch); c.fillRect(x1 - 3, cy, 3, ch);
    c.save(); c.beginPath(); c.rect(x0 + 6, cy, Math.max(0, x1 - x0 - 12), ch); c.clip();
    c.fillText(cl.name || 'Clip', x0 + 8, cy + ch / 2); c.restore();
  }
  // screens
  const [sy, sh] = TL.screens;
  c.font = '500 10px "IBM Plex Mono", monospace';
  state.cards.forEach((cd, i) => {
    const nx = state.cards[i + 1];
    const x0 = tX(cardStart(cd)), x1 = Math.max(x0 + 2, tX(nx ? cardStart(nx) : cardEnd(cd))) - 1;
    c.fillStyle = cd.note || cd.words.some((w) => w.mark) ? '#3B2A22' : cd._spk === 'guest' ? '#26303B' : '#2C2A26';
    c.fillRect(x0, sy, x1 - x0, sh);
    if (x1 - x0 > 24) {
      c.save(); c.beginPath(); c.rect(x0 + 4, sy, x1 - x0 - 8, sh); c.clip();
      c.fillStyle = '#BFBAB0'; c.fillText(cd.words.map((w) => w.w).join(' ').toUpperCase(), x0 + 5, sy + sh / 2); c.restore();
    }
  });
  // audio
  const [ay, ah] = TL.audio; const mid = ay + ah / 2;
  c.fillStyle = '#5E5B55';
  if (peaks) {
    const n = peaks.length, bw = Math.max(1, tlW / n);
    const stride = Math.max(1, Math.floor(n / tlW));
    for (let i = 0; i < n; i += stride) {
      let m = 0; for (let j = i; j < i + stride && j < n; j++) m = Math.max(m, peaks[j]);
      const hh = Math.max(1, Math.min(ah, m * ah * 0.95 * tlGain));
      c.fillRect(i / n * tlW, mid - hh / 2, Math.max(1, bw * stride - (bw * stride > 2 ? 1 : 0)), hh);
    }
  } else { c.fillRect(0, mid, tlW, 1); }
  tlStatic = off;
}
function drawTimeline(follow = false) {
  if ($('workspace').hidden || !state.cards.length) return;
  if (!tlStatic || Math.abs(tlW - tlWidthFor(tlZoomLevel)) > 2) buildTimelineStatic();
  const sx = tl.width / tlW, sy = tl.height / TL.h;
  const c = tl.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, tl.width, tl.height); // the static layer is transparent between bars: clear the old playhead
  c.drawImage(tlStatic, 0, 0);
  c.setTransform(sx, 0, 0, sy, 0, 0);
  const t = audio.currentTime || 0;
  const ci = cardAt(state.cards, t);
  if (ci >= 0) {
    const cd = state.cards[ci], nx = state.cards[ci + 1];
    const x0 = tX(cardStart(cd)), x1 = tX(nx ? cardStart(nx) : cardEnd(cd)) - 1;
    c.strokeStyle = '#E7ECF2'; c.lineWidth = 1; c.strokeRect(x0 + 0.5, TL.screens[0] + 0.5, Math.max(1, x1 - x0 - 1), TL.screens[1] - 1);
  }
  const px = Math.round(tX(t));
  c.fillStyle = '#E7ECF2'; c.fillRect(px - 1, 0, 2, TL.h);
  c.beginPath(); c.moveTo(px - 5, 0); c.lineTo(px + 5, 0); c.lineTo(px, 7); c.fill();
  if (follow && !audio.paused) {
    const L = tlScroll.scrollLeft, W = tlScroll.clientWidth;
    if (px < L || px > L + W - 30) tlScroll.scrollLeft = px - 40;
  }
  updateNav();
}
function tlHit(x, y) {
  if (y >= TL.clips[0] && y <= TL.clips[0] + TL.clips[1]) {
    for (let i = state.clips.length - 1; i >= 0; i--) {
      const cl = state.clips[i], x0 = tX(cl.start), x1 = tX(cl.end);
      if (Math.abs(x - x0) <= 6) return { kind: 'start', i };
      if (Math.abs(x - x1) <= 6) return { kind: 'end', i };
      if (x > x0 && x < x1) return { kind: 'clip', i };
    }
  }
  return { kind: 'seek' };
}
function seekTo(t) {
  if (playClip) stopClipPlayback();
  if (previewMode) exitPreviewMode();
  audio.currentTime = Math.max(0, Math.min(totalDur(), t));
  updateTime(); drawPreview(); markNow(); drawTimeline();
}
tl.addEventListener('pointerdown', (e) => {
  if (!state.cards.length) return;
  const h = tlHit(e.offsetX, e.offsetY);
  tl.setPointerCapture(e.pointerId);
  if (h.kind === 'start' || h.kind === 'end') { tlDrag = { ...h, moved: false }; return; }
  if (h.kind === 'clip') {
    const cl = state.clips[h.i];
    selClip = cl.id; setTab('clips'); renderClips(); tlInvalidate();
    seekTo(cl.start);
    document.querySelector(`.clip[data-id="${cl.id}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  tlDrag = { kind: 'seek' };
  seekTo(xT(e.offsetX));
});
tl.addEventListener('pointermove', (e) => {
  if (!tlDrag) {
    const h = tlHit(e.offsetX, e.offsetY);
    tl.style.cursor = h.kind === 'start' || h.kind === 'end' ? 'ew-resize' : 'pointer';
    return;
  }
  const t = xT(e.offsetX);
  if (tlDrag.kind === 'seek') { seekTo(t); return; }
  const cl = state.clips[tlDrag.i];
  if (!tlDrag.moved) { snapshot(); tlDrag.moved = true; }
  if (tlDrag.kind === 'start') cl.start = +Math.min(t, cl.end - 1).toFixed(2);
  else cl.end = +Math.max(t, cl.start + 1).toFixed(2);
  tlInvalidate();
});
function tlEnd() {
  if (tlDrag && tlDrag.moved) { state.clips.sort((a, b) => a.start - b.start); persist(); renderClips(); }
  tlDrag = null;
}
tl.addEventListener('pointerup', tlEnd);
tl.addEventListener('pointercancel', tlEnd);
function maxZoom() { return Math.max(1, Math.min(40, MAX_TL_PX / Math.max(1, tlScroll.clientWidth))); }
function tlWidthFor(z) { return Math.max(200, Math.round(tlScroll.clientWidth * Math.min(z, maxZoom()))); }
function setZoom(z, anchorT = audio.currentTime || 0, anchorX = null) {
  tlZoomLevel = Math.min(maxZoom(), Math.max(1, z));
  $('tlZoom').value = String(Math.round(tlZoomLevel));
  tlStatic = null; drawTimeline();
  tlScroll.scrollLeft = tX(anchorT) - (anchorX ?? tlScroll.clientWidth / 2);
  updateNav();
}

// navigator: a mini map of the whole recording; the window shows what the timeline is showing
const navC = $('tlNavC'), navWin = $('tlWin'), nav = $('tlNav');
let navPeaksDrawn = null, navDrag = null;
function drawNav() {
  const r = nav.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  navC.width = Math.max(1, Math.round(r.width * dpr)); navC.height = Math.max(1, Math.round(r.height * dpr));
  const c = navC.getContext('2d'); c.scale(dpr, dpr);
  c.clearRect(0, 0, r.width, r.height);
  c.fillStyle = '#3A3833';
  const mid = r.height / 2;
  if (peaks) {
    const n = peaks.length, per = n / Math.max(1, r.width);
    for (let x = 0; x < r.width; x++) {
      let m = 0; for (let j = Math.floor(x * per); j < Math.floor((x + 1) * per) && j < n; j++) m = Math.max(m, peaks[j]);
      const h = Math.max(1, m * (r.height - 6));
      c.fillRect(x, mid - h / 2, 1, h);
    }
  }
  navPeaksDrawn = peaks;
}
function updateNav() {
  if (!tlW) return;
  if (navPeaksDrawn !== peaks || navC.width < 2) drawNav();
  const f0 = tlScroll.scrollLeft / tlW, fw = Math.min(1, tlScroll.clientWidth / tlW);
  navWin.style.left = `${f0 * 100}%`;
  navWin.style.width = `${fw * 100}%`;
}
nav.addEventListener('pointerdown', (e) => {
  const r = nav.getBoundingClientRect();
  const handle = e.target.closest('.tl-h')?.dataset.h || null;
  const f0 = tlScroll.scrollLeft / tlW, fw = Math.min(1, tlScroll.clientWidth / tlW);
  if (!handle && !e.target.closest('.tl-win')) {
    // click outside the window: centre the view there
    const fc = (e.clientX - r.left) / r.width;
    tlScroll.scrollLeft = (fc - fw / 2) * tlW; updateNav();
  }
  navDrag = { handle, x0: e.clientX, f0: tlScroll.scrollLeft / tlW, fw, w: r.width };
  nav.setPointerCapture(e.pointerId);
  e.preventDefault();
});
nav.addEventListener('pointermove', (e) => {
  if (!navDrag) return;
  const d = (e.clientX - navDrag.x0) / navDrag.w;
  if (!navDrag.handle) { tlScroll.scrollLeft = (navDrag.f0 + d) * tlW; updateNav(); return; }
  // stretch/squeeze: move one edge, keep the other fixed
  let left = navDrag.f0, right = navDrag.f0 + navDrag.fw;
  if (navDrag.handle === 'l') left = Math.min(right - 0.01, Math.max(0, left + d));
  else right = Math.max(left + 0.01, Math.min(1, right + d));
  const span = Math.max(1 / maxZoom(), right - left);
  const dur = totalDur();
  tlZoomLevel = Math.min(maxZoom(), Math.max(1, 1 / span));
  $('tlZoom').value = String(Math.round(tlZoomLevel));
  tlStatic = null; drawTimeline();
  const anchor = navDrag.handle === 'l' ? right - span : left;
  tlScroll.scrollLeft = tX(anchor * dur);
  updateNav();
});
nav.addEventListener('pointerup', () => { navDrag = null; });
nav.addEventListener('pointercancel', () => { navDrag = null; });
tlScroll.addEventListener('scroll', updateNav);
new ResizeObserver(() => { navPeaksDrawn = null; updateNav(); }).observe(nav);
tlScroll.addEventListener('wheel', (e) => {
  if (e.altKey) { // Alt + wheel: taller/shorter waveform
    e.preventDefault();
    setGain(tlGain * (e.deltaY < 0 ? 1.12 : 0.89));
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return; // Ctrl/⌘ + wheel or trackpad pinch: stretch/squeeze
  e.preventDefault();
  const anchorX = e.offsetX - tlScroll.scrollLeft;
  setZoom(tlZoomLevel * (e.deltaY < 0 ? 1.15 : 0.87), xT(e.offsetX), anchorX);
}, { passive: false });
new ResizeObserver(() => { tlStatic = null; drawTimeline(); }).observe(tlScroll);

// ---------------- dictionary ----------------
function renderDict() {
  $('dictCount').textContent = `(${dict.length})`;
  $('dictList').replaceChildren(...dict.map((d, i) => {
    const li = document.createElement('li');
    const a = document.createElement('input'); a.type = 'text'; a.value = d.from; a.placeholder = 'Heard as'; a.setAttribute('aria-label', 'Heard as');
    const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
    const b = document.createElement('input'); b.type = 'text'; b.value = d.to; b.placeholder = 'Write as'; b.setAttribute('aria-label', 'Write as');
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x-btn'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove this fix');
    a.onchange = () => { d.from = a.value; saveDict(); };
    b.onchange = () => { d.to = b.value; saveDict(); };
    x.onclick = () => { dict.splice(i, 1); saveDict(); renderDict(); };
    li.append(a, arrow, b, x);
    return li;
  }));
}
function applyDictToProject() {
  if (!state.cards.length) return;
  // work on the whole transcript so phrases that run across two screens are caught too
  const flat = state.cards.flatMap((c, ci) => c.words.map((w, wi) => ({ ...w, _c: ci, _key: c.keys.includes(wi) })));
  const r = applyDictionary(flat, dict);
  if (!r.count) { notice('Nothing to fix: no dictionary words found.'); return; }
  snapshot();
  const cards = state.cards.map((c) => ({ ...c, words: [], keys: [] }));
  for (const w of r.words) {
    const c = cards[w._c];
    if (w._key) c.keys.push(c.words.length);
    const { _c, _key, ...clean } = w;
    c.words.push(clean);
  }
  state.cards = cards.filter((c) => c.words.length);
  for (const c of state.cards) if (!c.keys.length) c.keys = autoKeys(c.words, state.settings.maxKeys);
  notice(`Dictionary fixed ${r.count} word${r.count > 1 ? 's' : ''}.`);
  changed();
}

// ---------------- speakers ----------------
function setTurn(who) {
  if (!sel) return; snapshot();
  const c = state.cards[sel.c];
  assignSpeakers(state.cards);
  const prev = sel.c > 0 ? state.cards[sel.c - 1]._spk : 'host';
  if (who === prev) delete c.turn; else c.turn = who;
  // a later identical marker is now redundant
  changed();
}

// ---------------- preview modes: intro / closing card / carousel slide ----------------
function startBookendPreview(kind) {
  if (!state.cards.length) return;
  audio.pause();
  previewMode = { kind, t0: performance.now() };
  resizeCanvas();
  const dur = kind === 'intro' ? +state.settings.bookends.introSec || 3 : +state.settings.bookends.outroSec || 4;
  const loop = () => {
    if (!previewMode || previewMode.kind !== kind) return;
    drawPreviewMode();
    if ((performance.now() - previewMode.t0) / 1000 < dur + 0.6) requestAnimationFrame(loop);
    else exitPreviewMode();
  };
  requestAnimationFrame(loop);
}
function drawPreviewMode() {
  const m = previewMode;
  if (m.kind === 'slide') {
    const i = state.slides.findIndex((x) => x.id === m.id);
    if (i < 0) return exitPreviewMode();
    ctx.setTransform(canvas.width / 1080, 0, 0, canvas.height / 1350, 0, 0);
    drawSlide(ctx, state.slides[i], i, state.slides.length, deck());
    return;
  }
  const f = FORMATS[state.fmt];
  const dur = m.kind === 'intro' ? +state.settings.bookends.introSec || 3 : +state.settings.bookends.outroSec || 4;
  ctx.setTransform(pScale, 0, 0, pScale, 0, 0);
  drawBookend(ctx, f, m.kind, Math.min(dur, (performance.now() - m.t0) / 1000), dur, styleObj());
}
function exitPreviewMode() {
  previewMode = null;
  show($('cPrevExit'), false);
  document.querySelectorAll('.slide-list li.is-sel').forEach((li) => li.classList.remove('is-sel'));
  resizeCanvas();
}

// ---------------- chapters ----------------
function buildChapterPresets() {
  const sel = $('chapPreset');
  sel.replaceChildren();
  for (const [group, names] of Object.entries(CHAPTER_PRESETS)) {
    const og = document.createElement('optgroup'); og.label = group;
    names.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; og.appendChild(o); });
    sel.appendChild(og);
  }
  const o = document.createElement('option'); o.value = ''; o.textContent = 'Custom name…'; sel.appendChild(o);
}
function renderChapters() {
  const list = [...state.chapters].sort((a, b) => a.t - b.t);
  state.chapters = list;
  $('chapList').replaceChildren(...list.map((ch, i) => {
    const li = document.createElement('li');
    const t = document.createElement('button'); t.type = 'button'; t.className = 't'; t.textContent = fmtTime(ch.t); t.title = 'Jump here';
    t.onclick = () => seekTo(ch.t);
    const name = document.createElement('input'); name.type = 'text'; name.value = ch.name; name.setAttribute('aria-label', 'Chapter name');
    name.onchange = () => { ch.name = name.value || 'Chapter'; persist(); tlInvalidate(); drawPreview(); };
    const here = document.createElement('button'); here.type = 'button'; here.className = 'btn small ghost'; here.textContent = 'Move here';
    here.onclick = () => { ch.t = +(audio.currentTime || 0).toFixed(2); changed(); };
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x-btn'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove chapter');
    x.onclick = () => { state.chapters.splice(i, 1); changed(); };
    li.append(t, name, here, x);
    return li;
  }));
  if (!list.length) $('chapList').innerHTML = '<li class="clip-empty">No chapters yet.</li>';
}
function addChapter() {
  let name = $('chapPreset').value;
  if (!name) name = 'New chapter';
  state.chapters.push({ id: uid(), name, t: +(audio.currentTime || 0).toFixed(2) });
  // move the picker on to the next preset in the blueprint
  const opts = [...$('chapPreset').querySelectorAll('option')];
  const i = opts.findIndex((o) => o.value === $('chapPreset').value);
  if (i >= 0 && i < opts.length - 2) $('chapPreset').value = opts[i + 1].value;
  changed();
}
async function copyText(text, out, hint, okMsg) {
  out.value = text; show(out, true);
  try { await navigator.clipboard.writeText(text); hint.textContent = okMsg; }
  catch { out.select(); hint.textContent = 'Select the text below and copy it (Ctrl+C).'; }
}
function copyYouTube() {
  if (!state.chapters.length) { $('chapWarn').textContent = 'Add some chapters first.'; return; }
  const { text, warnings } = youtubeChapters(state.chapters, totalDur());
  copyText(text, $('chapOut'), $('chapWarn'), 'Copied. Paste it into the YouTube description.').then(() => {
    if (warnings.length) $('chapWarn').textContent += ' ' + warnings.join(' ');
  });
}

// ---------------- highlights ----------------
function renderHighlights() {
  if (!highlights.length) { $('hlList').innerHTML = '<li class="clip-empty">No strong moments found. Try a different length.</li>'; return; }
  $('hlList').replaceChildren(...highlights.map((h, i) => {
    const li = document.createElement('li');
    const hook = document.createElement('p'); hook.className = 'hl-hook'; hook.textContent = `“${h.hook}”`;
    const meta = document.createElement('div'); meta.className = 'hl-meta';
    const tm = document.createElement('span'); tm.className = 'mono tag'; tm.textContent = `${fmtTime(h.start)}–${fmtTime(h.end)} · ${Math.round(h.end - h.start)} s`;
    meta.appendChild(tm);
    h.tags.forEach((t) => { const g = document.createElement('span'); g.className = 'tag'; g.textContent = t; meta.appendChild(g); });
    const row = document.createElement('div'); row.className = 'btn-row';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'btn small'; play.textContent = 'Play';
    play.onclick = () => { if (!audioFile) return; playClip = { id: 'hl' + i, start: h.start, end: h.end, title: '' }; audio.currentTime = h.start; audio.play(); requestAnimationFrame(tick); };
    const add = document.createElement('button'); add.type = 'button'; add.className = 'btn small ghost'; add.textContent = 'Add as clip';
    add.onclick = () => {
      snapshot();
      const c = { id: uid(), name: `Highlight ${state.clips.length + 1}`, start: +h.start.toFixed(2), end: +h.end.toFixed(2), title: '' };
      state.clips.push(c); state.clips.sort((a, b) => a.start - b.start); state.exportWhat[c.id] = true;
      add.textContent = 'Added'; add.disabled = true; changed();
    };
    row.append(play, add);
    li.append(hook, meta, row);
    return li;
  }));
}

// ---------------- carousel ----------------
function deck() {
  return { series: state.series === 'Quote' ? '' : state.series, bg: state.settings.bg, logo: logoImg, logoLight, logoDark, upper: state.settings.upper, badge: badgeText() };
}
function sentenceAt(ci, wi) {
  const words = allWords();
  let idx = 0; for (let k = 0; k < ci; k++) idx += state.cards[k].words.length; idx += wi;
  let a = idx, b = idx;
  while (a > 0 && !/[.?!]["')\]]?$/.test(words[a - 1].w)) a--;
  while (b < words.length - 1 && !/[.?!]["')\]]?$/.test(words[b].w)) b++;
  return words.slice(a, b + 1).map((w) => w.w).join(' ');
}
function addSlide(type, text = '', sub = '') {
  const defaults = { cover: ['Are you solving the *right* problem?', ''], quote: ['', state.settings.names.guest || state.settings.names.host], point: ['', ''], end: ['', ''] };
  const [dt, ds] = defaults[type] || ['', ''];
  const s = { id: uid(), type, text: text || dt, sub: sub || ds };
  if (type === 'cover') state.slides.unshift(s); else if (type !== 'end' && state.slides.length && state.slides[state.slides.length - 1].type === 'end') state.slides.splice(state.slides.length - 1, 0, s); else state.slides.push(s);
  persist(); renderSlides(); previewSlide(s.id);
}
function previewSlide(id) {
  previewMode = { kind: 'slide', id };
  show($('cPrevExit'), true);
  audio.pause();
  resizeCanvas();
  document.querySelectorAll('.slide-list li').forEach((li) => li.classList.toggle('is-sel', li.dataset.id === id));
}
function renderSlides() {
  const ol = $('slideList');
  if (!state.slides.length) { ol.innerHTML = '<li class="clip-empty">No slides yet. Start with a cover, or click a word in the transcript and press "Add to carousel".</li>'; return; }
  let pointNo = 0;
  ol.replaceChildren(...state.slides.map((sl, i) => {
    if (sl.type === 'point') sl.num = ++pointNo;
    const li = document.createElement('li'); li.dataset.id = sl.id;
    if (previewMode && previewMode.kind === 'slide' && previewMode.id === sl.id) li.classList.add('is-sel');
    const head = document.createElement('div'); head.className = 'slide-head';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1).padStart(2, '0');
    const type = document.createElement('select'); type.setAttribute('aria-label', 'Slide type');
    Object.entries(SLIDE_TYPES).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v; type.appendChild(o); });
    type.value = sl.type;
    type.onchange = () => { sl.type = type.value; persist(); renderSlides(); previewSlide(sl.id); };
    const sp = document.createElement('span'); sp.className = 'sp';
    const mk = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'x-btn'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    head.append(n, type, sp,
      mk('↑', 'Move up', () => { if (i > 0) { [state.slides[i - 1], state.slides[i]] = [state.slides[i], state.slides[i - 1]]; persist(); renderSlides(); previewSlide(sl.id); } }),
      mk('↓', 'Move down', () => { if (i < state.slides.length - 1) { [state.slides[i + 1], state.slides[i]] = [state.slides[i], state.slides[i + 1]]; persist(); renderSlides(); previewSlide(sl.id); } }),
      mk('×', 'Remove slide', () => { state.slides.splice(i, 1); persist(); if (previewMode?.id === sl.id) exitPreviewMode(); renderSlides(); }));
    const txt = document.createElement('textarea'); txt.rows = 2; txt.value = sl.text;
    txt.placeholder = { cover: 'Big headline', quote: 'The quote', point: 'The point, in a few words', end: 'Full episode on Spotify, Apple Podcasts & YouTube' }[sl.type];
    txt.oninput = () => { sl.text = txt.value; persist(); if (previewMode?.id === sl.id) drawPreview(); };
    const sub = document.createElement('input'); sub.type = 'text'; sub.value = sl.sub || '';
    sub.placeholder = { cover: 'Line under the headline (optional)', quote: 'Who said it', point: 'Explanation (optional)', end: 'Follow @wedeygothrougham for more founder decisions.' }[sl.type];
    sub.oninput = () => { sl.sub = sub.value; persist(); if (previewMode?.id === sl.id) drawPreview(); };
    li.addEventListener('focusin', () => { if (!(previewMode && previewMode.id === sl.id)) previewSlide(sl.id); });
    li.addEventListener('click', () => { if (!(previewMode && previewMode.id === sl.id)) previewSlide(sl.id); });
    li.append(head, txt, sub);
    return li;
  }));
}
async function exportSlides() {
  if (!state.slides.length) { $('cHint').textContent = 'Add some slides first.'; return; }
  await loadFonts();
  let dir = null;
  try { dir = await pickFolder(); } catch (e) { if (e.name === 'AbortError') return; }
  const base = slug((state.series || 'carousel') + ' ' + (state.title || ''));
  for (let i = 0; i < state.slides.length; i++) {
    let pointNo = 0; state.slides.forEach((s) => { if (s.type === 'point') s.num = ++pointNo; });
    const blob = await renderSlide(state.slides[i], i, state.slides.length, deck());
    const name = `${base}_${String(i + 1).padStart(2, '0')}.png`;
    if (dir) { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(blob); await w.close(); }
    else triggerDownload(blob, name);
  }
  $('cHint').textContent = `Saved ${state.slides.length} slides${dir ? ' to the folder you chose' : ''}. Post them in order as one carousel.`;
}

// ---------------- captions ----------------
function copyPrompt(kind, title, start, end, out, hint, switchTab = false) {
  const text = allWords().filter((w) => w.s >= start - 0.01 && w.e <= end + 0.01).map((w) => w.w).join(' ');
  if (!text) { hint.textContent = 'No words in that part of the recording.'; return; }
  const guest = state.settings.names.guest ? state.settings.names.guest : '';
  const prompt = captionPrompt({ title, kind, text, duration: end - start, guest });
  if (switchTab) setTab('export');
  $('capOut').closest('details').open = true;
  copyText(prompt, out, hint, 'Copied. Paste it into a chat with Claude.');
}

// ---------------- subtitles / text files ----------------
async function saveText(dir, name, text, type) {
  const blob = new Blob([text], { type });
  if (dir) { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(blob); await w.close(); }
  else triggerDownload(blob, name);
}

// ---------------- music bed ----------------
async function setMusic(file, { store = true } = {}) {
  if (store && state.id) { putFile(`${state.id}:music`, file).catch(() => {}); if (state.cards.length) setTimeout(() => flushSave({ music: file }), 0); }
  try {
    musicBuf = await decodeAll(file, 48000);
  } catch { notice('That music file could not be read. Try an MP3 or WAV.'); return; }
  if (musicURL) URL.revokeObjectURL(musicURL);
  musicURL = URL.createObjectURL(file);
  musicEl.src = musicURL;
  state.settings.music.name = file.name;
  $('musicName').textContent = `${file.name} · ${fmtTime(musicBuf.duration)}`;
  show($('musicClear'), true);
  persist();
}
function clearMusic() {
  if (state.id) deleteFile(`${state.id}:music`).catch(() => {});
  musicBuf = null; musicEl.pause(); musicEl.removeAttribute('src');
  if (musicURL) URL.revokeObjectURL(musicURL); musicURL = null;
  state.settings.music.name = '';
  $('musicName').textContent = 'No music'; show($('musicClear'), false); persist();
}
let musicGain = 0;
function syncMusic() {
  if (!musicBuf || audio.paused) { if (!musicEl.paused) musicEl.pause(); return; }
  const t = audio.currentTime || 0;
  if (musicEl.paused) { musicEl.currentTime = t % musicBuf.duration; musicEl.play().catch(() => {}); }
  const target = state.settings.music.vol * (isSpeaking(speech, t) ? state.settings.music.duck : 1);
  musicGain += (target - musicGain) * (target < musicGain ? 0.35 : 0.08);
  musicEl.volume = Math.max(0, Math.min(1, musicGain * (player.muted ? 0 : player.vol)));
}

// ---------------- player volume (preview only; exports are unaffected) ----------------
const player = (() => { try { return { vol: 1, muted: false, ...JSON.parse(localStorage.getItem('wdgta-studio:player') || '{}') }; } catch { return { vol: 1, muted: false }; } })();
function applyVolume(save = true) {
  audio.volume = player.vol; audio.muted = player.muted;
  document.querySelectorAll('[data-vol-group]').forEach((g) => {
    g.classList.toggle('is-muted', player.muted || player.vol === 0);
    g.querySelector('[data-vol]').value = Math.round(player.vol * 100);
    const b = g.querySelector('[data-mute]'); b.setAttribute('aria-label', player.muted ? 'Unmute' : 'Mute');
  });
  if (save) { try { localStorage.setItem('wdgta-studio:player', JSON.stringify(player)); } catch {} }
}
function toggleMute() { if (player.vol === 0) { player.vol = 0.8; player.muted = false; } else player.muted = !player.muted; applyVolume(); }

// ---------------- resizable / hideable panels ----------------
const LAYOUT_KEY = 'wdgta-studio:layout';
const LAYOUT_DEFAULT = { tr: 340, ins: 320, tl: 150, safe: false, hide: { tr: false, ins: false, tl: false } };
let ui = (() => {
  try { const d = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); if (d) return { ...LAYOUT_DEFAULT, ...d, hide: { ...LAYOUT_DEFAULT.hide, ...(d.hide || {}) } }; } catch {}
  return structuredClone(LAYOUT_DEFAULT);
})();
function saveUI() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(ui)); } catch {} }
const suite = $('workspace');
let layoutRAF = 0;
function applyLayout(save = true) {
  suite.style.setProperty('--tr-w', `${ui.tr}px`);
  suite.style.setProperty('--ins-w', `${ui.ins}px`);
  suite.style.setProperty('--tl-canvas', `${ui.tl}px`);
  suite.style.setProperty('--tl-audio', `${ui.tl - 100}px`);
  TL.h = ui.tl; TL.audio[1] = ui.tl - 100;
  $('btnSafe').setAttribute('aria-pressed', String(!!ui.safe));
  for (const k of ['tr', 'ins', 'tl']) {
    suite.classList.toggle(`no-${k}`, !!ui.hide[k]);
    document.querySelectorAll(`[data-panel-toggle="${k}"]`).forEach((b) => b.setAttribute('aria-pressed', String(!ui.hide[k])));
  }
  if (save) saveUI();
  cancelAnimationFrame(layoutRAF);
  layoutRAF = requestAnimationFrame(() => { resizeCanvas(); tlStatic = null; drawTimeline(); });
}
function togglePanel(k, force) {
  ui.hide[k] = force ?? !ui.hide[k];
  applyLayout();
}
function clampSizes() {
  const W = suite.clientWidth || window.innerWidth;
  const room = W - 300 - 10; // keep the viewer at least ~300px wide
  ui.tr = Math.round(Math.max(200, Math.min(640, ui.tr)));
  ui.ins = Math.round(Math.max(260, Math.min(560, ui.ins)));
  const used = (ui.hide.tr ? 0 : ui.tr) + (ui.hide.ins ? 0 : ui.ins);
  if (used > room) {
    const over = used - room;
    if (!ui.hide.tr) ui.tr = Math.max(200, ui.tr - over);
  }
  ui.tl = Math.round(Math.max(120, Math.min(Math.max(160, window.innerHeight * 0.55), ui.tl)));
}
function bindSplitter(el, kind) {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    st = { x: e.clientX, y: e.clientY, tr: ui.tr, ins: ui.ins, tl: ui.tl };
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    document.body.classList.add('is-resizing', kind === 'b' ? 'row' : 'col');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!st) return;
    if (kind === 'l') ui.tr = st.tr + (e.clientX - st.x);
    if (kind === 'r') ui.ins = st.ins - (e.clientX - st.x);
    if (kind === 'b') ui.tl = st.tl - (e.clientY - st.y);
    clampSizes(); applyLayout(false);
  });
  const end = () => {
    if (!st) return;
    st = null; el.classList.remove('is-drag');
    document.body.classList.remove('is-resizing', 'row', 'col');
    saveUI();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => {
    if (kind === 'l') ui.tr = LAYOUT_DEFAULT.tr;
    if (kind === 'r') ui.ins = LAYOUT_DEFAULT.ins;
    if (kind === 'b') ui.tl = LAYOUT_DEFAULT.tl;
    clampSizes(); applyLayout();
  });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16;
    const d = { ArrowLeft: -step, ArrowRight: step, ArrowUp: -step, ArrowDown: step }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    if (kind === 'l') ui.tr += d;
    if (kind === 'r') ui.ins -= d;
    if (kind === 'b') ui.tl -= d;
    clampSizes(); applyLayout();
  });
}

// ---------------- projects folder (backup on disk / Google Drive) ----------------
let dirHandle = null, folderPerm = 'none';
function setFolderStatus(msg) {
  const st = $('folderStatus'), btn = $('folderBtn'), stop = $('folderStop');
  if (!folderSupported()) { st.textContent = 'This browser cannot save to a folder. Use Chrome or Edge on a computer.'; btn.hidden = true; stop.hidden = true; return; }
  if (!dirHandle) { st.textContent = 'Not set up. Projects are only kept inside this browser.'; btn.textContent = 'Choose projects folder'; stop.hidden = true; }
  else if (folderPerm === 'granted') { st.textContent = `Saving every project to "${dirHandle.name}".`; btn.textContent = 'Change folder'; stop.hidden = false; }
  else { st.textContent = `"${dirHandle.name}" needs your permission again.`; btn.textContent = 'Reconnect folder'; stop.hidden = false; }
  if (msg) st.textContent = msg;
  const need = dirHandle && folderPerm !== 'granted';
  show($('reconnectBox'), !!need);
  if (need) $('reconnectName').textContent = dirHandle.name;
}
async function chooseFolder() {
  if (!folderSupported()) return;
  if (dirHandle && folderPerm !== 'granted') {
    folderPerm = await dirPermission(dirHandle, true);
    setFolderStatus();
    if (folderPerm === 'granted') { await flushSave({ audio: audioFile }); renderProjects(); renderRecent(); }
    return;
  }
  try {
    const h = await window.showDirectoryPicker({ id: 'wdgta-projects', mode: 'readwrite' });
    dirHandle = h; await setDirHandle(h);
    folderPerm = await dirPermission(h, true);
    setFolderStatus();
    if (state.id) await flushSave({ audio: audioFile, music: musicBuf ? $('musicFile').files[0] || null : null });
    // also copy every project already in this browser into the folder
    await backupAllToFolder();
    renderProjects(); renderRecent();
  } catch (e) { if (e.name !== 'AbortError') setFolderStatus(`Could not use that folder: ${e.message || e}`); }
}
async function backupAllToFolder() {
  if (!dirHandle || folderPerm !== 'granted') return;
  let n = 0;
  for (const p of await listProjects()) {
    if (p.id === state.id) continue;
    const data = await getProject(p.id);
    if (!data) continue;
    const [a, m] = await Promise.all([getFile(`${p.id}:audio`).catch(() => null), getFile(`${p.id}:music`).catch(() => null)]);
    try { await saveToFolder(dirHandle, data, { audio: a, music: m }); n++; } catch {}
  }
  if (n) notice(`Copied ${n} project${n > 1 ? 's' : ''} into "${dirHandle.name}".`);
}
async function stopFolder() {
  dirHandle = null; folderPerm = 'none'; await setDirHandle(null); setFolderStatus();
}
async function folderOnlyProjects(knownIds) {
  if (!dirHandle || folderPerm !== 'granted') return [];
  try { return (await scanFolder(dirHandle)).filter((p) => !knownIds.has(p.id)); } catch { return []; }
}
async function importFromFolder(fp) {
  if ($('projDialog').open) $('projDialog').close();
  audio.pause();
  audioFile = null; audioBuf48 = null; sel = null; selEl = null; previewMode = null;
  if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  audio.removeAttribute('src');
  clearMusicLocal();
  loadState(fp.data);
  if (fp.audioHandle) {
    const f = await fp.audioHandle.getFile();
    await setAudio(new File([f], fp.origAudioName || f.name, { type: f.type }), { store: true });
  } else notice(`Add the recording (${fp.origAudioName || 'audio file'}) to preview and export.`);
  if (fp.musicHandle) {
    const f = await fp.musicHandle.getFile();
    await setMusic(new File([f], fp.origMusicName || f.name, { type: f.type }), { store: true });
  }
  await flushSave();
  renderRecent();
}
function folderRow(fp) {
  const li = document.createElement('li');
  const t = document.createElement('span'); t.className = 'pl-title'; t.textContent = fp.title;
  const m = document.createElement('span'); m.className = 'proj-meta mono';
  m.textContent = `In your folder · ${fp.audioHandle ? 'recording saved' : 'no recording'} · ${fp.savedAt ? new Date(fp.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}`;
  const a = document.createElement('div'); a.className = 'proj-actions';
  const open = document.createElement('button'); open.type = 'button'; open.className = 'btn small'; open.textContent = 'Open';
  open.onclick = () => importFromFolder(fp);
  a.appendChild(open);
  li.append(t, m, a);
  return li;
}

// ---------------- keyboard editing at the playhead ----------------
function wordAtPlayhead() {
  const t = audio.currentTime || 0;
  const ci = cardAt(state.cards, t);
  if (ci < 0) return null;
  const ws = state.cards[ci].words;
  let wi = 0;
  for (let i = 0; i < ws.length; i++) if (ws[i].s <= t + 0.02) wi = i;
  return { ci, wi, t };
}
function splitAtPlayhead() {
  const p = wordAtPlayhead();
  if (!p) return;
  const ws = state.cards[p.ci].words;
  // the new screen starts with the first word that begins at or after the playhead
  const wi = ws.findIndex((w) => w.s >= p.t - 0.05);
  if (wi < 0) { notice('The playhead is after the last word of this screen.', 2500); return; }
  if (wi === 0) { notice('A screen already starts here.', 2500); return; }
  sel = { c: p.ci, w: wi };
  splitHere();
  notice(`New screen starts at "${state.cards[p.ci + 1].words[0].w}".`, 2500);
}
function yellowAtPlayhead() {
  const p = wordAtPlayhead();
  if (!p) return;
  sel = { c: p.ci, w: p.wi };
  toggleKey();
  const on = state.cards[p.ci].keys.includes(p.wi);
  notice(`"${state.cards[p.ci].words[p.wi].w}" ${on ? 'is now yellow' : 'is no longer yellow'}.`, 2000);
}

// ---------------- project library ----------------
function projMeta(p) {
  const d = new Date(p.updatedAt);
  const when = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${fmtTime(p.duration)} · ${p.screens} screens${p.clips ? ` · ${p.clips} clips` : ''} · ${p.hasAudio ? 'recording saved' : 'no recording'} · ${when}`;
}
function projRow(p, { compact = false } = {}) {
  const li = document.createElement('li');
  if (p.id === state.id) li.classList.add('is-current');
  const t = document.createElement('span'); t.className = 'pl-title'; t.textContent = p.title;
  const m = document.createElement('span'); m.className = 'proj-meta mono'; m.textContent = projMeta(p);
  const a = document.createElement('div'); a.className = 'proj-actions';
  const open = document.createElement('button'); open.type = 'button'; open.className = 'btn small'; open.textContent = p.id === state.id ? 'Open (current)' : 'Open';
  open.onclick = () => openProject(p.id);
  a.appendChild(open);
  if (!compact) {
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small ghost danger'; del.textContent = 'Delete';
    del.onclick = async () => {
      if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Confirm delete'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Delete'; }, 3000); return; }
      await deleteProject(p.id);
      if (p.id === state.id) state.id = null;
      renderProjects(); renderRecent();
    };
    a.appendChild(del);
  }
  li.append(t, m, a);
  return li;
}
async function renderProjects() {
  let list = [];
  try { list = await listProjects(); } catch { $('projList').innerHTML = '<li class="clip-empty">This browser cannot store projects.</li>'; return; }
  const extra = await folderOnlyProjects(new Set(list.map((p) => p.id)));
  const rows = [...list.map((p) => projRow(p)), ...extra.map(folderRow)];
  $('projList').replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('li'), { className: 'clip-empty', textContent: 'No projects yet. Transcribe a recording to start one.' })]));
  setFolderStatus();
  const est = await storageEstimate();
  const sz = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
  $('projStorage').textContent = est && est.quota ? `Using ${sz(est.usage || 0)} of about ${sz(est.quota)} this browser allows for Studio.` : '';
}
async function renderRecent() {
  let list = [];
  try { list = await listProjects(); } catch { show($('recentBox'), false); return; }
  const extra = await folderOnlyProjects(new Set(list.map((p) => p.id)));
  show($('recentBox'), list.length + extra.length > 0);
  $('recentList').replaceChildren(...list.slice(0, 5).map((p) => projRow(p, { compact: true })), ...extra.slice(0, 5).map(folderRow));
  if (list.length) show($('resume'), false);
}
async function openProject(id) {
  const data = await getProject(id);
  if (!data) { notice('That project could not be found.'); return; }
  if ($('projDialog').open) $('projDialog').close();
  audio.pause();
  audioFile = null; audioBuf48 = null; sel = null; selEl = null; previewMode = null;
  if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  audio.removeAttribute('src');
  clearMusicLocal();
  loadState(data);
  const [rec, mus] = await Promise.all([getFile(`${id}:audio`).catch(() => null), getFile(`${id}:music`).catch(() => null)]);
  if (rec) await setAudio(rec, { store: false });
  else notice(`Add the recording (${data.audioName || 'audio file'}) to preview and export.`);
  if (mus) await setMusic(mus, { store: false });
}
function clearMusicLocal() {
  musicBuf = null; musicEl.pause(); musicEl.removeAttribute('src');
  if (musicURL) URL.revokeObjectURL(musicURL); musicURL = null;
  state.settings.music.name = '';
  $('musicName').textContent = 'No music'; show($('musicClear'), false);
}

const SPEEDS = [0.5, 1, 1.5, 2];
let speed = 1;
function buildSpeed() {
  document.querySelectorAll('[data-speed-group]').forEach((g) => {
    g.replaceChildren(...SPEEDS.map((v) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `${v}×`;
      b.title = `Play at ${v}× speed (preview only; exported videos play at normal speed)`;
      b.setAttribute('aria-pressed', String(v === speed));
      b.onclick = () => setSpeed(v);
      return b;
    }));
  });
}
function setSpeed(v) {
  speed = v;
  audio.defaultPlaybackRate = v;
  audio.playbackRate = v;
  audio.preservesPitch = true;
  buildSpeed();
}

// ---------------- wiring ----------------
function bind() {
  const drop = $('drop');
  $('audioFile').onchange = (e) => e.target.files[0] && setAudio(e.target.files[0]);
  $('audioFile2').onchange = (e) => e.target.files[0] && setAudio(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) setAudio(f); });
  $('btnTranscribe').onclick = transcribe;

  $('projTitle').oninput = (e) => { state.title = e.target.value; persist(); drawPreview(); };
  $('btnSave').onclick = saveProject;
  $('btnOpen').onclick = () => $('openFile').click();
  $('openFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { loadState(JSON.parse(await f.text())); } catch (err) { notice(`Could not open that file: ${err.message}`); }
    e.target.value = '';
  };
  $('btnNew').onclick = newProject;

  $('cards').addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (w) return selectWord(+w.dataset.c, +w.dataset.w);
    const t = e.target.closest('.card-time');
    if (t) { audio.currentTime = +t.dataset.seek; updateTime(); drawPreview(); markNow(); }
  });
  $('wordText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyWordEdit(); }
    if (e.key === 'Escape') { sel = null; renderCards(); }
  });
  $('wApply').onclick = applyWordEdit;
  $('wKey').onclick = toggleKey;
  $('wSplit').onclick = splitHere;
  $('wJoin').onclick = joinPrev;
  $('wDel').onclick = deleteWord;
  $('wMark').onchange = (e) => {
    if (!sel) return; snapshot();
    const wd = state.cards[sel.c].words[sel.w];
    if (e.target.value) wd.mark = e.target.value; else delete wd.mark;
    changed();
  };
  let noteSnap = false;
  $('wNote').addEventListener('focus', () => { noteSnap = false; });
  $('wNote').addEventListener('input', (e) => {
    if (!sel) return;
    if (!noteSnap) { snapshot(); noteSnap = true; }
    const c = state.cards[sel.c];
    if (e.target.value.trim()) c.note = e.target.value; else delete c.note;
    persist(); drawPreview();
  });
  $('wNote').addEventListener('change', () => renderCards());
  $('wNote').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); renderCards(); } });
  $('btnUndo').onclick = undo;
  $('btnRegroup').onclick = regroup;
  $('btnReplace').onclick = replaceAll;

  $('btnPlay').onclick = togglePlay;
  $('fsPlay').onclick = togglePlay;
  $('btnFull').onclick = enterFull;
  $('fsExit').onclick = () => document.exitFullscreen?.();
  $('scrub').oninput = (e) => {
    if (playClip) stopClipPlayback();
    audio.currentTime = (+e.target.value / 1000) * totalDur(); drawPreview(); updateTime(); markNow();
  };

  for (const [id, key] of [['optUpper', 'upper'], ['optHandle', 'handle'], ['optProgress', 'progress'], ['optTitle', 'showTitle'], ['optLogo', 'showLogo']]) {
    $(id).onchange = (e) => { state.settings[key] = e.target.checked; persist(); drawPreview(); };
  }
  $('optKeys').onchange = (e) => { state.settings.maxKeys = +e.target.value; persist(); };
  $('btnRepick').onclick = repickKeys;
  $('logoFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { setLogo(r.result); persist(); }; r.readAsDataURL(f);
    e.target.value = '';
  };
  $('btnLogoClear').onclick = () => { setLogo(null); persist(); };
  $('btnLayoutReset').onclick = () => { delete state.settings.layouts[state.fmt]; selEl = null; updateElbar(); persist(); drawPreview(); };

  $('elSize').oninput = (e) => { if (!selEl) return; setEl(selEl, { s: +e.target.value / 100 }); $('elSizeOut').textContent = `${e.target.value}%`; drawPreview(); persist(); };
  $('elReset').onclick = () => {
    if (!selEl) return;
    const lay = layoutFor(state.fmt); delete lay[selEl];
    updateElbar(); drawPreview(); persist();
  };
  $('elDone').onclick = () => { selEl = null; updateElbar(); drawPreview(); };

  $('btnSplit').onclick = splitAuto;
  // panels
  bindSplitter($('splitL'), 'l'); bindSplitter($('splitR'), 'r'); bindSplitter($('splitB'), 'b');
  document.querySelectorAll('[data-panel-toggle]').forEach((b) => b.onclick = () => togglePanel(b.dataset.panelToggle));
  document.querySelectorAll('[data-panel-hide]').forEach((b) => b.onclick = () => togglePanel(b.dataset.panelHide, true));
  $('btnMyLayout').onclick = saveMyLayout;
  $('btnUseMyLayout').onclick = useMyLayout;
  $('ctaText').addEventListener('input', (e) => { state.settings.cta = e.target.value; persist(); drawPreview(); });
  $('btnLayoutDefault').onclick = () => { ui = structuredClone(LAYOUT_DEFAULT); clampSizes(); applyLayout(); };
  window.addEventListener('resize', () => { clampSizes(); applyLayout(false); });
  // dictionary
  $('dictAdd').onclick = () => { dict.push({ from: '', to: '' }); renderDict(); $('dictList').lastElementChild?.querySelector('input')?.focus(); };
  $('dictApply').onclick = applyDictToProject;
  // speakers
  $('wHost').onclick = () => setTurn('host');
  $('wGuest').onclick = () => setTurn('guest');
  $('nameHost').oninput = (e) => { state.settings.names.host = e.target.value; persist(); drawPreview(); };
  $('nameGuest').oninput = (e) => { state.settings.names.guest = e.target.value; persist(); drawPreview(); };
  $('nameHost').onchange = $('nameGuest').onchange = () => renderCards();
  $('optNames').onchange = (e) => { state.settings.showNames = e.target.checked; persist(); drawPreview(); };
  $('optChapter').onchange = (e) => { state.settings.showChapter = e.target.checked; persist(); drawPreview(); };
  // capsule / episode badge
  const bdUpdate = () => { persist(); if (previewMode) drawPreviewMode(); else drawPreview(); };
  $('optBadge').onchange = (e) => { state.settings.badge.show = e.target.checked; bdUpdate(); };
  $('badgeKind').onchange = (e) => {
    state.settings.badge.kind = e.target.value;
    show($('badgeNum'), e.target.value !== 'Custom'); show($('badgeCustom'), e.target.value === 'Custom');
    bdUpdate();
  };
  $('badgeNum').oninput = (e) => { state.settings.badge.num = e.target.value; bdUpdate(); };
  $('badgeCustom').oninput = (e) => { state.settings.badge.custom = e.target.value; bdUpdate(); };
  // intro / closing cards
  const bk = () => state.settings.bookends;
  const bkBind = (id, key, fn = (v) => v) => { $(id).addEventListener(id.endsWith('Sec') || $(id).type === 'checkbox' ? 'change' : 'input', (e) => { bk()[key] = fn($(id).type === 'checkbox' ? e.target.checked : e.target.value); persist(); }); };
  bkBind('bkIntro', 'introOn'); bkBind('bkIntroSec', 'introSec', Number); bkBind('bkKicker', 'kicker'); bkBind('bkHead', 'headline'); bkBind('bkSub', 'sub');
  bkBind('bkOutro', 'outroOn'); bkBind('bkOutroSec', 'outroSec', Number); bkBind('bkOHead', 'outroHeadline'); bkBind('bkOSub', 'outroSub');
  $('bkPrevIntro').onclick = () => startBookendPreview('intro');
  $('bkPrevOutro').onclick = () => startBookendPreview('outro');
  // music
  $('musicFile').onchange = (e) => { const f = e.target.files[0]; if (f) setMusic(f); e.target.value = ''; };
  $('musicClear').onclick = clearMusic;
  $('musicVol').oninput = (e) => { state.settings.music.vol = +e.target.value / 100; $('musicVolOut').textContent = `${e.target.value}%`; persist(); };
  $('musicDuck').oninput = (e) => { state.settings.music.duck = +e.target.value / 100; $('musicDuckOut').textContent = `${e.target.value}%`; persist(); };
  // chapters & highlights
  $('chapAdd').onclick = addChapter;
  $('chapCopy').onclick = copyYouTube;
  $('hlFind').onclick = () => { highlights = findHighlights(state.cards, +$('clipLen').value, 6); renderHighlights(); };
  // carousel
  SERIES.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; $('cSeries').appendChild(o); });
  $('cSeries').onchange = (e) => { state.series = e.target.value; persist(); if (previewMode?.kind === 'slide') drawPreview(); };
  document.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => addSlide(b.dataset.add));
  $('wSlide').onclick = () => {
    if (!sel) return;
    addSlide('quote', sentenceAt(sel.c, sel.w), state.cards[sel.c]._spk === 'guest' ? state.settings.names.guest : state.settings.names.host);
    setTab('carousel');
  };
  $('cExport').onclick = exportSlides;
  $('cPrevExit').onclick = exitPreviewMode;
  // export extras
  $('exSubs').onchange = (e) => { state.settings.exportSubs = e.target.checked; persist(); };
  $('exLevel').onchange = (e) => { state.settings.exportLevel = e.target.checked; persist(); };
  $('btnPack').onclick = () => doExport('weekly');
  $('optAnim').onchange = (e) => { state.settings.anim = e.target.value; persist(); drawPreview(); };
  $('btnSafe').onclick = () => { ui.safe = !ui.safe; applyLayout(); drawPreview(); };
  $('btnProjects').onclick = () => { renderProjects(); $('projDialog').showModal(); };
  $('folderBtn').onclick = chooseFolder;
  $('folderStop').onclick = stopFolder;
  $('reconnectBtn').onclick = chooseFolder;
  $('btnKeys').onclick = () => $('keysDialog').showModal();
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('optChapMarks').onchange = (e) => { state.settings.chapterMarks = e.target.checked; persist(); drawPreview(); };
  document.querySelectorAll('[data-vol-group]').forEach((g) => {
    g.querySelector('[data-mute]').onclick = toggleMute;
    g.querySelector('[data-vol]').oninput = (e) => { player.vol = +e.target.value / 100; player.muted = false; applyVolume(); };
  });
  $('capFull').onclick = () => copyPrompt('a full mini-episode or founder conversation', state.title, 0, totalDur(), $('capOut'), $('capHint'));
  $('insTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('btnExportTop').onclick = () => setTab('export');
  $('btnOpen2').onclick = () => $('openFile').click();
  $('btnBack').onclick = () => seekTo((audio.currentTime || 0) - 5);
  $('btnFwd').onclick = () => seekTo((audio.currentTime || 0) + 5);
  $('tlZoom').oninput = (e) => setZoom(+e.target.value);
  $('tlFit').onclick = () => setZoom(1);
  $('tlGain').oninput = (e) => setGain(+e.target.value / 100);
  document.querySelectorAll('.layer-name').forEach((b) => b.onclick = () => { selEl = b.dataset.el; updateElbar(); drawPreview(); });
  const applyXY = () => {
    if (!selEl) return;
    const f = FORMATS[state.fmt];
    setEl(selEl, { x: +(+$('elX').value / f.w).toFixed(4), y: +(+$('elY').value / f.h).toFixed(4), rel: false });
    drawPreview(); persist();
  };
  $('elX').onchange = applyXY; $('elY').onchange = applyXY;
  $('btnAddClip').onclick = addClipAtPlayhead;

  $('destFolder').onchange = () => { state.dest = 'folder'; persist(); };
  $('destDownload').onchange = () => { state.dest = 'download'; persist(); };
  $('btnExport').onclick = () => doExport();
  $('btnStill').onclick = saveStill;
  $('btnCancel').onclick = () => exportAbort?.abort();

  document.addEventListener('keydown', (e) => {
    if (currentModule !== 'studio') return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    if (e.code === 'Space' && !typing && !$('workspace').hidden) { e.preventDefault(); togglePlay(); }
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'm' && !$('workspace').hidden) { e.preventDefault(); toggleMute(); return; }
    if (e.altKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { e.preventDefault(); togglePanel({ Digit1: 'tr', Digit2: 'tl', Digit3: 'ins' }[e.code]); return; }
    if (!typing && !$('workspace').hidden && (e.key === '=' || e.key === '+' || e.key === '-')) {
      e.preventDefault(); setZoom(tlZoomLevel * (e.key === '-' ? 0.8 : 1.25));
    }
    if (!typing && (e.key === '>' || e.key === '<')) {
      const i = SPEEDS.indexOf(speed) + (e.key === '>' ? 1 : -1);
      if (SPEEDS[i]) setSpeed(SPEEDS[i]);
    }
    if (!typing && !$('workspace').hidden && !selEl && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo((audio.currentTime || 0) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 5));
        return;
      }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); splitAtPlayhead(); return; }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); yellowAtPlayhead(); return; }
    }
    if (!typing && e.key === '?') { e.preventDefault(); $('keysDialog').showModal(); return; }
    if (selEl && !typing && /^Arrow/.test(e.key)) {
      e.preventDefault();
      const cur = resolveLayout(state.fmt, state.settings.layouts)[selEl];
      const step = e.shiftKey ? 0.02 : 0.004;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setEl(selEl, { x: +(cur.x + dx).toFixed(4), y: +(cur.y + dy).toFixed(4) }); drawPreview(); persist();
    }
  });
  window.addEventListener('resize', () => { if (!$('workspace').hidden) drawPreview(); });
}
let noticeTimer = null;
function notice(msg, ms = 5000) {
  const n = $('resume'); n.textContent = msg; show(n, true);
  clearTimeout(noticeTimer);
  if (ms) noticeTimer = setTimeout(() => { if (n.textContent === msg) show(n, false); }, ms);
}

function offerResume() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
  if (!data || !data.cards?.length) return;
  const n = $('resume');
  n.replaceChildren();
  const span = document.createElement('span');
  span.textContent = `Unfinished project: ${data.title || data.audioName || 'untitled'} (${data.cards.length} screens).`;
  const b = document.createElement('button');
  b.className = 'btn small'; b.type = 'button'; b.textContent = 'Continue it';
  b.onclick = () => { show(n, false); loadState(data); };
  n.append(span, b); show(n, true);
}

// ---------------- modules (Studio, Guests, …) ----------------
let currentModule = 'studio';
let guestsReady = false;
const MODULES = ['home', 'studio', 'guests', 'episodes', 'calendar'];
let pendingGuest = null, pendingEpisodeFor = null, pendingEpisode = null;
async function route() {
  const m = (location.hash.replace('#', '') || 'home').toLowerCase();
  const next = MODULES.includes(m) ? m : 'home';
  if (currentModule === 'studio' && next !== 'studio') { audio.pause(); flushSave(); }
  if (currentModule === 'guests' && next !== 'guests') flushGuests();
  if (currentModule === 'episodes' && next !== 'episodes') flushEpisodes();
  if (currentModule === 'calendar' && next !== 'calendar') flushCalendar();
  currentModule = next;
  document.body.dataset.module = next;
  document.title = next === 'studio' ? 'WDGTA Studio' : next === 'home' ? 'WDGTA' : `${next[0].toUpperCase()}${next.slice(1)} · WDGTA`;
  document.querySelectorAll('.modules a.module').forEach((a) => {
    const on = a.getAttribute('href') === `#${next}`;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const ctx = {
    getDir: () => (dirHandle && folderPerm === 'granted' ? dirHandle : null),
    notice,
    listStudioProjects: () => listProjects().catch(() => []),
    openStudioProject: (id) => { location.hash = '#studio'; openProject(id); },
    openGuest: (id) => { pendingGuest = id; location.hash = '#guests'; },
    planEpisode: (id) => { pendingEpisodeFor = id; location.hash = '#episodes'; },
    openEpisode: (id) => { pendingEpisode = id; location.hash = '#episodes'; },
  };
  if (next === 'guests') {
    if (!guestsReady) { guestsReady = true; await initGuests(ctx); } else await refreshGuests();
    if (pendingGuest) { const id = pendingGuest; pendingGuest = null; await focusGuest(id); }
  } else if (next === 'episodes') {
    await initEpisodes(ctx);
    if (pendingEpisodeFor) { const id = pendingEpisodeFor; pendingEpisodeFor = null; await planEpisodeFor(id, ctx); }
    if (pendingEpisode) { const id = pendingEpisode; pendingEpisode = null; await focusEpisode(id); }
  } else if (next === 'calendar') {
    await initCalendar(ctx);
  } else if (next === 'home') {
    await renderHome({ ...ctx, hostName: state.settings.names?.host || 'Abdul Mueez Otoo' });
  } else if (!$('workspace').hidden) requestAnimationFrame(() => { drawPreview(); tlInvalidate(); });
}
window.addEventListener('hashchange', route);

// boot
bind();
buildTabs();
clampSizes(); applyLayout(false);
applyVolume(false);
buildChapterPresets();
renderDict();
buildSpeed();
applySettingsUI();
loadFonts().then(() => drawPreview());
(async () => {
  persistStorage();
  try { dirHandle = await getDirHandle(); folderPerm = await dirPermission(dirHandle); } catch { dirHandle = null; }
  setFolderStatus();
  await route();
  await renderRecent();
  if ($('recentBox').hidden && currentModule === 'studio') offerResume();
})();
if (!exportSupported()) $('exportHint').textContent = 'Video export needs the latest Chrome or Edge on a laptop or desktop.';
if (!window.showDirectoryPicker) $('destHint').textContent = 'This browser can only download files. Chrome or Edge can also save straight into a folder, including your Google Drive folder.';

// test hook (used by automated checks; harmless for users)
window.__studio = {
  state, loadState, setAudio, FORMATS, defaultLayout, audio,
  _useFolder: async (h) => { dirHandle = h; await setDirHandle(h); folderPerm = await dirPermission(h, true); setFolderStatus(); await flushSave({ audio: audioFile }); },
};
