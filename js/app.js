// WDGTA Studio — app controller (upload → transcribe → edit → preview → export).
import { FORMATS, buildCards, autoKey, drawFrame, cardAt, cardStart, loadFonts } from './render.js';
import { renderMp4, exportSupported } from './exporter.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'wdgta-studio:last-project';

const state = {
  title: '',
  cards: [],            // [{words:[{w,s,e,edited?}], key}]
  settings: { upper: true, handle: true, progress: true, showTitle: true, logo: null },
  audioName: '',
  duration: 0,
  fmt: '9x16',
  exportFmts: { '9x16': true, '4x5': false, '1x1': false, '16x9': true },
};
let audioFile = null, audioURL = null, audioBuf48 = null;
let sel = null;            // {c, w}
let undoStack = [];
let logoImg = null;
const audio = new Audio();
audio.preload = 'auto';

// ---------------- helpers ----------------
const fmtTime = (s, ms = false) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), r = s - m * 60;
  return ms ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
};
const slug = (s) => (s || 'wdgta-video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'wdgta-video';
function show(el, on) { el.hidden = !on; }
function errorBox(el, msg) { el.textContent = msg || ''; show(el, !!msg); }
function styleObj() {
  return {
    upper: state.settings.upper,
    handle: state.settings.handle,
    progress: state.settings.progress,
    title: state.settings.showTitle ? state.title : '',
    logo: logoImg,
  };
}
function snapshot() {
  undoStack.push(JSON.stringify(state.cards));
  if (undoStack.length > 60) undoStack.shift();
  $('btnUndo').disabled = false;
}
function persist() {
  try {
    const { logo, ...rest } = state.settings;
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, settings: { ...rest, logo } }));
  } catch { /* storage full or blocked: fine */ }
}
function changed() { persist(); renderCards(); drawPreview(); $('btnSave').disabled = !state.cards.length; }

// ---------------- audio loading ----------------
async function setAudio(file) {
  audioFile = file;
  audioBuf48 = null;
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = URL.createObjectURL(file);
  audio.src = audioURL;
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
  if (audioBuf48) return audioBuf48;
  audioBuf48 = await decodeAll(audioFile, 48000);
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
  try {
    const buf = await getAudio48();
    mono = await to16kMono(buf);
  } catch (e) {
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
      state.cards = buildCards(m.words);
      if (!m.wordMode) console.info('[Studio] used phrase timing');
      enterWorkspace();
    }
  };
  worker.postMessage({ type: 'run', audio: mono, quality: $('quality').value }, [mono.buffer]);
}
function setJob(text, frac) {
  $('jobText').textContent = text;
  if (frac != null) { $('jobBar').style.width = `${Math.round(frac * 100)}%`; $('jobPct').textContent = `${Math.round(frac * 100)}%`; }
}

// ---------------- workspace ----------------
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
  const ol = $('cards');
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
      if (c.key === wi) b.classList.add('is-key');
      if (wd.edited) b.classList.add('is-edited');
      if (sel && sel.c === ci && sel.w === wi) b.classList.add('is-sel');
      b.textContent = wd.w;
      wrap.appendChild(b);
    });
    li.appendChild(wrap);
    frag.appendChild(li);
  });
  ol.replaceChildren(frag);
  const n = allWords().length;
  $('stats').textContent = `${state.cards.length} screens · ${n} words · ${fmtTime(state.duration || (n ? allWords()[n - 1].e : 0))}`;
  updateWordbar();
  lastNow = null;
}

function updateWordbar() {
  const on = !!(sel && state.cards[sel.c] && state.cards[sel.c].words[sel.w]);
  show($('wordbar'), on);
  if (!on) { sel = null; return; }
  const c = state.cards[sel.c], wd = c.words[sel.w];
  if (document.activeElement !== $('wordText')) $('wordText').value = wd.w;
  $('wKey').textContent = c.key === sel.w ? 'Remove highlight' : 'Yellow highlight';
  $('wSplit').disabled = sel.w === 0;
  $('wJoin').disabled = sel.c === 0;
  $('wTime').textContent = `${fmtTime(wd.s, true)} – ${fmtTime(wd.e, true)}`;
}

function selectWord(ci, wi, seek = true) {
  sel = { c: ci, w: wi };
  document.querySelectorAll('.w.is-sel').forEach((el) => el.classList.remove('is-sel'));
  const el = document.querySelector(`.w[data-c="${ci}"][data-w="${wi}"]`);
  el?.classList.add('is-sel');
  updateWordbar();
  if (seek) { audio.currentTime = state.cards[ci].words[wi].s; updateTime(); drawPreview(); }
  $('wordText').focus(); $('wordText').select();
}

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
  if (c.key != null && c.key > sel.w) c.key += repl.length - 1;
  changed();
  // move to the next word for fast proofreading
  const nx = sel.w + repl.length;
  if (nx < c.words.length) selectWord(sel.c, nx, false);
  else if (state.cards[sel.c + 1]) selectWord(sel.c + 1, 0, false);
}

function toggleKey() {
  if (!sel) return; snapshot();
  const c = state.cards[sel.c];
  c.key = c.key === sel.w ? null : sel.w;
  changed();
}
function splitHere() {
  if (!sel || sel.w === 0) return; snapshot();
  const c = state.cards[sel.c];
  const tail = c.words.splice(sel.w);
  const nc = { words: tail, key: null };
  if (c.key != null && c.key >= sel.w) { nc.key = c.key - sel.w; c.key = null; }
  if (c.key == null) c.key = autoKey(c.words);
  if (nc.key == null) nc.key = autoKey(nc.words);
  state.cards.splice(sel.c + 1, 0, nc);
  sel = { c: sel.c + 1, w: 0 };
  changed();
}
function joinPrev() {
  if (!sel || sel.c === 0) return; snapshot();
  const prev = state.cards[sel.c - 1], c = state.cards[sel.c];
  const off = prev.words.length;
  prev.words.push(...c.words);
  if (prev.key == null && c.key != null) prev.key = c.key + off;
  state.cards.splice(sel.c, 1);
  sel = { c: sel.c - 1, w: off + sel.w };
  changed();
}
function deleteWord() {
  if (!sel) return; snapshot();
  const c = state.cards[sel.c];
  c.words.splice(sel.w, 1);
  if (c.key === sel.w) c.key = autoKey(c.words);
  else if (c.key != null && c.key > sel.w) c.key -= 1;
  if (!c.words.length) { state.cards.splice(sel.c, 1); sel = null; }
  else if (sel.w >= c.words.length) sel.w = c.words.length - 1;
  changed();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return;
  state.cards = JSON.parse(s);
  sel = null;
  $('btnUndo').disabled = !undoStack.length;
  changed();
}
function regroup() {
  if (!state.cards.length) return; snapshot();
  const words = allWords().map(({ w, s, e, edited }) => ({ w, s, e, edited }));
  const cards = buildCards(words);
  // keep "edited" flags
  let k = 0; for (const c of cards) for (const wd of c.words) { if (words[k]?.edited) wd.edited = true; k++; }
  state.cards = cards; sel = null; changed();
}
function replaceAll() {
  const find = $('findText').value.trim().toLowerCase();
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
  $('replText').placeholder = n ? `Replaced ${n}` : 'No matches';
  changed();
}

// ---------------- preview ----------------
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
let pScale = 0.5;
function resizeCanvas() {
  const f = FORMATS[state.fmt];
  pScale = Math.min(1, 720 / Math.max(f.w, f.h)) * Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(f.w * pScale); canvas.height = Math.round(f.h * pScale);
  canvas.style.aspectRatio = `${f.w} / ${f.h}`;
  drawPreview();
}
function drawPreview() {
  if (!state.cards.length) return;
  const f = FORMATS[state.fmt];
  ctx.setTransform(pScale, 0, 0, pScale, 0, 0);
  drawFrame(ctx, state.cards, audio.currentTime || 0, f, styleObj(), state.duration);
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
  drawPreview(); updateTime(); markNow();
  if (!audio.paused) requestAnimationFrame(tick);
}
function updateTime() {
  const d = state.duration || audio.duration || 0;
  $('timeLbl').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(d)}`;
  if (d && document.activeElement !== $('scrub')) $('scrub').value = Math.round(audio.currentTime / d * 1000);
}
function togglePlay() {
  if (!audioFile) return;
  if (audio.paused) { audio.play(); $('btnPlay').textContent = 'Pause'; requestAnimationFrame(tick); }
  else { audio.pause(); $('btnPlay').textContent = 'Play'; }
}
audio.addEventListener('ended', () => { $('btnPlay').textContent = 'Play'; });

function buildTabs() {
  const tabs = $('fmtTabs');
  tabs.replaceChildren(...Object.values(FORMATS).map((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fmt-tab'; b.role = 'tab';
    b.textContent = f.label; b.title = f.use;
    b.setAttribute('aria-selected', String(f.id === state.fmt));
    b.onclick = () => { state.fmt = f.id; buildTabs(); resizeCanvas(); persist(); };
    return b;
  }));
  const list = $('fmtList');
  list.replaceChildren(...Object.values(FORMATS).map((f) => {
    const row = document.createElement('label');
    row.className = 'fmt-row';
    row.innerHTML = `<input type="checkbox" id="ex-${f.id}"><span class="fmt-ratio">${f.label}</span><span class="fmt-use">${f.name} · ${f.use}</span><span class="fmt-state" id="st-${f.id}">${f.w}×${f.h}</span>`;
    const cb = row.querySelector('input');
    cb.checked = !!state.exportFmts[f.id];
    cb.onchange = () => { state.exportFmts[f.id] = cb.checked; persist(); };
    return row;
  }));
}

// ---------------- export ----------------
let exportAbort = null;
async function doExport() {
  errorBox($('exportError'), '');
  if (!audioFile) { errorBox($('exportError'), 'Add the audio file first (Preview section).'); return; }
  if (!exportSupported()) { errorBox($('exportError'), 'This browser cannot make videos. Use the latest Chrome or Edge on a laptop or desktop.'); return; }
  const fmts = Object.values(FORMATS).filter((f) => state.exportFmts[f.id]);
  if (!fmts.length) { errorBox($('exportError'), 'Tick at least one format.'); return; }

  let dir = null;
  if (window.showDirectoryPicker) {
    try { dir = await window.showDirectoryPicker({ id: 'wdgta-exports', mode: 'readwrite' }); }
    catch (e) { if (e.name === 'AbortError') return; dir = null; }
  }
  audio.pause(); $('btnPlay').textContent = 'Play';
  $('btnExport').disabled = true; show($('btnCancel'), true);
  exportAbort = new AbortController();
  $('downloads').replaceChildren();
  const base = slug(state.title || state.audioName.replace(/\.[^.]+$/, ''));
  const t0 = performance.now();
  let compatNote = false;
  try {
    $('exportHint').textContent = 'Preparing audio…';
    const buf = await getAudio48();
    await loadFonts();
    for (const f of fmts) {
      const st = $(`st-${f.id}`);
      const name = `${base}_${f.label.replace(':', 'x')}.mp4`;
      let writable = null;
      if (dir) { const fh = await dir.getFileHandle(name, { create: true }); writable = await fh.createWritable(); }
      const start = performance.now();
      const res = await renderMp4({
        cards: state.cards, style: styleObj(), fmt: f, audioBuffer: buf, writable, signal: exportAbort.signal,
        onProgress: (p) => {
          const el = (performance.now() - start) / 1000;
          const left = p > 0.02 ? ` · ${fmtTime(el / p * (1 - p))} left` : '';
          st.textContent = `${Math.round(p * 100)}%`;
          $('exportHint').textContent = `Making ${f.label} (${f.name})${left}`;
        },
      });
      st.textContent = 'Done'; st.classList.add('done');
      if (res.blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(res.blob); a.download = name; a.textContent = `Download ${name}`;
        const li = document.createElement('li'); li.appendChild(a); $('downloads').appendChild(li);
      }
      if (res.audioCodec === 'opus' || res.videoCodec === 'vp9') compatNote = true;
    }
    const secs = (performance.now() - t0) / 1000;
    $('exportHint').textContent = (dir ? `Saved ${fmts.length} video${fmts.length > 1 ? 's' : ''} to the folder you chose · ${fmtTime(secs)}.` : `Finished in ${fmtTime(secs)}. Download below.`) +
      (compatNote ? ' This browser could not use the standard H.264/AAC formats, so some apps may reject these files. For best results export from Chrome or Edge on Windows or Mac.' : '');
  } catch (e) {
    if (e.name === 'AbortError') $('exportHint').textContent = 'Export cancelled.';
    else { console.error(e); errorBox($('exportError'), `Export failed: ${e.message || e}`); $('exportHint').textContent = ''; }
  } finally {
    $('btnExport').disabled = false; show($('btnCancel'), false); exportAbort = null;
  }
}

// ---------------- projects ----------------
function saveProject() {
  const data = { app: 'wdgta-studio', version: 1, savedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${slug(state.title || state.audioName)}.wdgta.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function loadState(data) {
  if (!data || !Array.isArray(data.cards)) throw new Error('Not a WDGTA Studio project file.');
  state.title = data.title || '';
  state.cards = data.cards;
  state.settings = { ...state.settings, ...(data.settings || {}) };
  state.audioName = data.audioName || '';
  state.duration = data.duration || 0;
  state.fmt = FORMATS[data.fmt] ? data.fmt : '9x16';
  state.exportFmts = { ...state.exportFmts, ...(data.exportFmts || {}) };
  undoStack = [];
  applySettingsUI();
  $('projTitle').value = state.title;
  buildTabs();
  enterWorkspace();
  if (!audioFile && state.audioName) {
    $('noAudio').firstChild.textContent = `Add the audio file (${state.audioName}) to preview and export: `;
  }
}
function applySettingsUI() {
  $('optUpper').checked = state.settings.upper;
  $('optHandle').checked = state.settings.handle;
  $('optProgress').checked = state.settings.progress;
  $('optTitle').checked = state.settings.showTitle;
  setLogo(state.settings.logo);
}
function setLogo(dataUrl) {
  state.settings.logo = dataUrl || null;
  show($('btnLogoClear'), !!dataUrl);
  $('logoName').textContent = dataUrl ? 'Logo added' : 'None';
  if (!dataUrl) { logoImg = null; drawPreview(); return; }
  const img = new Image();
  img.onload = () => { logoImg = img; drawPreview(); };
  img.src = dataUrl;
}
function newProject() {
  audio.pause();
  state.title = ''; state.cards = []; state.audioName = ''; state.duration = 0;
  audioFile = null; audioBuf48 = null; sel = null; undoStack = [];
  if (audioURL) URL.revokeObjectURL(audioURL); audioURL = null; audio.removeAttribute('src');
  $('projTitle').value = '';
  show($('dropFile'), false);
  $('btnTranscribe').disabled = true;
  show($('workspace'), false); show($('stepAudio'), true); show($('resume'), false);
  $('btnSave').disabled = true;
  try { localStorage.removeItem(STORE_KEY); } catch {}
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
    try { loadState(JSON.parse(await f.text())); } catch (err) { alertInline(`Could not open that file: ${err.message}`); }
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
  $('btnUndo').onclick = undo;
  $('btnRegroup').onclick = regroup;
  $('btnReplace').onclick = replaceAll;

  $('btnPlay').onclick = togglePlay;
  $('scrub').oninput = (e) => {
    const d = state.duration || audio.duration || 0;
    audio.currentTime = (+e.target.value / 1000) * d; drawPreview(); updateTime(); markNow();
  };

  for (const [id, key] of [['optUpper', 'upper'], ['optHandle', 'handle'], ['optProgress', 'progress'], ['optTitle', 'showTitle']]) {
    $(id).onchange = (e) => { state.settings[key] = e.target.checked; persist(); drawPreview(); };
  }
  $('logoFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { setLogo(r.result); persist(); }; r.readAsDataURL(f);
    e.target.value = '';
  };
  $('btnLogoClear').onclick = () => { setLogo(null); persist(); };

  $('btnExport').onclick = doExport;
  $('btnCancel').onclick = () => exportAbort?.abort();

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    if (e.code === 'Space' && !typing && !$('workspace').hidden) { e.preventDefault(); togglePlay(); }
  });
  window.addEventListener('resize', () => { if (!$('workspace').hidden) drawPreview(); });
}
function alertInline(msg) {
  const n = $('resume'); n.textContent = msg; show(n, true);
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

// boot
bind();
buildTabs();
applySettingsUI();
loadFonts().then(() => drawPreview());
offerResume();
if (!exportSupported()) $('exportHint').textContent = 'Video export needs the latest Chrome or Edge on a laptop or desktop.';

// test hook (used by automated checks; harmless for users)
window.__studio = { state, loadState, setAudio, renderMp4, FORMATS };
