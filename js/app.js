// WDGTA Studio — app controller (upload → transcribe → edit → preview → clips → export).
import {
  FORMATS, ELEMENTS, THEMES, buildCards, autoKeys, normalizeCard, drawFrame, cardAt, cardStart, cardEnd,
  loadFonts, resolveLayout, defaultLayout, suggestClips,
} from './render.js';
import { renderMp4, renderStill, exportSupported } from './exporter.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'wdgta-studio:last-project';
const OFFICIAL_LOGO = 'assets/wdgta-logo-white.png';
const OFFICIAL_LOGO_DARK = 'assets/wdgta-logo-black.png';

const state = {
  title: '',
  cards: [],            // [{words:[{w,s,e,edited?}], keys:[i]}]
  clips: [],            // [{id, name, start, end, title}]
  settings: {
    bg: 'ink',
    upper: true, handle: true, progress: true, showTitle: true, showLogo: true,
    logo: null,          // custom logo data URL; null = official logo
    maxKeys: 1,
    layouts: {},         // per-format element position overrides
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
const audio = new Audio();
audio.preload = 'auto';

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
    progress: state.settings.progress,
    title: state.settings.showTitle ? state.title : '',
    showLogo: state.settings.showLogo,
    bg: state.settings.bg,
    logo: logoImg,
    logoLight, logoDark,
    layout: state.settings.layouts,
    range: { start: 0, end: totalDur() },
    ...extra,
  };
}
function snapshot() {
  undoStack.push(JSON.stringify({ cards: state.cards, clips: state.clips }));
  if (undoStack.length > 60) undoStack.shift();
  $('btnUndo').disabled = false;
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}
function changed() { persist(); renderCards(); renderClips(); drawPreview(); $('btnSave').disabled = !state.cards.length; }

// ---------------- audio loading ----------------
async function setAudio(file) {
  audioFile = file;
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
      state.cards = buildCards(m.words, { keys: state.settings.maxKeys });
      state.clips = [];
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
    li.className = 'card'; li.dataset.c = ci;
    const tb = document.createElement('button');
    tb.className = 'card-time'; tb.type = 'button'; tb.dataset.seek = cardStart(c);
    tb.textContent = fmtTime(cardStart(c), true);
    li.appendChild(tb);
    const wrap = document.createElement('div'); wrap.className = 'card-words';
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
  $('replText').value = '';
  $('replText').placeholder = n ? `Replaced ${n}` : 'No matches';
  changed();
}

// ---------------- preview ----------------
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
let pScale = 0.5, lastBoxes = {};
function isFull() { return document.fullscreenElement === $('stage'); }
function resizeCanvas() {
  const f = FORMATS[state.fmt];
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
  const f = FORMATS[state.fmt];
  ctx.setTransform(pScale, 0, 0, pScale, 0, 0);
  lastBoxes = drawFrame(ctx, state.cards, audio.currentTime || 0, f, previewStyle());
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
  drawPreview(); updateTime(); markNow();
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
  $('btnPlay').textContent = l; $('fsPlay').textContent = l;
}
function togglePlay() {
  if (!audioFile) return;
  if (audio.paused) { audio.play(); requestAnimationFrame(tick); } else audio.pause();
}
audio.addEventListener('play', setPlayLabels);
audio.addEventListener('pause', setPlayLabels);
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
  const order = ['note', 'logo', 'title', 'handle', 'progress', 'text'];
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
  if (!state.cards.length || isFull()) return;
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
  drawPreview();
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
  if (!selEl) return;
  const cur = resolveLayout(state.fmt, state.settings.layouts)[selEl];
  $('elName').textContent = `${ELEMENTS[selEl]} · ${FORMATS[state.fmt].label}`;
  $('elSize').value = Math.round((cur.s || 1) * 100);
}

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
      li.className = 'clip' + (playClip && playClip.id === c.id ? ' is-playing' : '');
      li.innerHTML = `
        <input type="text" aria-label="Clip name" value="">
        <button class="btn small" data-act="play" type="button">${playClip && playClip.id === c.id ? 'Stop' : 'Play'}</button>
        <p class="clip-text"></p>
        <div class="clip-meta">
          <span class="mono">${fmtTime(c.start, true)} → ${fmtTime(c.end, true)} · ${Math.round(c.end - c.start)} s</span>
          <button class="btn small ghost" data-act="start" type="button">Start here</button>
          <button class="btn small ghost" data-act="end" type="button">End here</button>
          <input type="text" class="clip-title" aria-label="Title shown on this clip" placeholder="On-screen title (optional)">
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
async function doExport() {
  errorBox($('exportError'), '');
  if (!audioFile) { errorBox($('exportError'), 'Add the audio file first (under the preview).'); return; }
  if (!exportSupported()) { errorBox($('exportError'), 'This browser cannot make videos. Use the latest Chrome or Edge on a laptop or desktop.'); return; }
  const fmts = Object.values(FORMATS).filter((f) => state.exportFmts[f.id]);
  const base = slug(state.title || state.audioName.replace(/\.[^.]+$/, ''));
  const jobs = [];
  const targets = [];
  if (state.exportWhat.full) targets.push({ key: 'full', start: 0, end: totalDur(), title: state.title });
  for (const c of state.clips) if (state.exportWhat[c.id]) targets.push({ key: slug(c.name || 'clip'), start: c.start, end: c.end, title: c.title || state.title });
  for (const tg of targets) for (const f of fmts) jobs.push({ tg, f });
  if (!jobs.length) { errorBox($('exportError'), 'Tick at least one item under "What" and one size.'); return; }

  let dir = null;
  try { dir = await pickFolder(); } catch (e) { if (e.name === 'AbortError') return; }
  audio.pause();
  $('btnExport').disabled = true; $('btnStill').disabled = true; show($('btnCancel'), true); show($('exBarWrap'), true);
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
      const res = await renderMp4({
        cards: state.cards, style: styleObj({ title: state.settings.showTitle ? tg.title : '' }), fmt: f, audioBuffer: buf,
        start: tg.start, end: tg.end, writable, signal: exportAbort.signal,
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
    const secs = (performance.now() - t0) / 1000;
    $('exportHint').textContent = (dir ? `Saved ${jobs.length} video${jobs.length > 1 ? 's' : ''} to the folder you chose in ${fmtTime(secs)}.` : `Made ${jobs.length} video${jobs.length > 1 ? 's' : ''} in ${fmtTime(secs)}. Check your Downloads folder.`) +
      (compat ? ' This browser could not use the standard H.264/AAC formats, so some apps may reject these files. For best results export from Chrome or Edge on Windows or Mac.' : '');
  } catch (e) {
    if (e.name === 'AbortError') $('exportHint').textContent = 'Export cancelled.';
    else { console.error(e); errorBox($('exportError'), `Export failed: ${e.message || e}`); $('exportHint').textContent = ''; }
  } finally {
    $('btnExport').disabled = false; $('btnStill').disabled = false; show($('btnCancel'), false); show($('exBarWrap'), false); exportAbort = null;
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
  state.title = data.title || '';
  state.cards = data.cards.map(normalizeCard);
  state.clips = Array.isArray(data.clips) ? data.clips : [];
  state.settings = { ...state.settings, ...(data.settings || {}) };
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
  $('optProgress').checked = state.settings.progress;
  $('optTitle').checked = state.settings.showTitle;
  $('optLogo').checked = state.settings.showLogo !== false;
  $('optKeys').value = String(state.settings.maxKeys || 1);
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
  state.title = ''; state.cards = []; state.clips = []; state.audioName = ''; state.duration = 0;
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
    const dot = document.createElement('i'); dot.style.background = th.bg;
    b.append(dot, document.createTextNode(th.name));
    b.onclick = () => { state.settings.bg = id; buildSwatches(); persist(); drawPreview(); };
    return b;
  }));
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

  $('elSize').oninput = (e) => { if (!selEl) return; setEl(selEl, { s: +e.target.value / 100 }); drawPreview(); persist(); };
  $('elReset').onclick = () => {
    if (!selEl) return;
    const lay = layoutFor(state.fmt); delete lay[selEl];
    updateElbar(); drawPreview(); persist();
  };
  $('elDone').onclick = () => { selEl = null; updateElbar(); drawPreview(); };

  $('btnSplit').onclick = splitAuto;
  $('btnAddClip').onclick = addClipAtPlayhead;

  $('destFolder').onchange = () => { state.dest = 'folder'; persist(); };
  $('destDownload').onchange = () => { state.dest = 'download'; persist(); };
  $('btnExport').onclick = doExport;
  $('btnStill').onclick = saveStill;
  $('btnCancel').onclick = () => exportAbort?.abort();

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    if (e.code === 'Space' && !typing && !$('workspace').hidden) { e.preventDefault(); togglePlay(); }
    if (!typing && (e.key === '>' || e.key === '<')) {
      const i = SPEEDS.indexOf(speed) + (e.key === '>' ? 1 : -1);
      if (SPEEDS[i]) setSpeed(SPEEDS[i]);
    }
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
function notice(msg) { const n = $('resume'); n.textContent = msg; show(n, true); }

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

// boot
bind();
buildTabs();
buildSpeed();
applySettingsUI();
loadFonts().then(() => drawPreview());
offerResume();
if (!exportSupported()) $('exportHint').textContent = 'Video export needs the latest Chrome or Edge on a laptop or desktop.';
if (!window.showDirectoryPicker) $('destHint').textContent = 'This browser can only download files. Chrome or Edge can also save straight into a folder, including your Google Drive folder.';

// test hook (used by automated checks; harmless for users)
window.__studio = { state, loadState, setAudio, FORMATS, defaultLayout, audio };
