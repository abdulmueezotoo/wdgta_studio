// WDGTA OS — module 03: Episodes. Every episode and Capsule from plan to published, plus the release plan.
// Local-first like Guests: kept in this browser and mirrored to the projects folder when one is connected.

import { getRecord, putRecord, folderReadJSON, folderWriteJSON } from './library.js';
import { guestsData, bumpGuest } from './guests.js';

export const EP_STAGES = [
  { id: 'planned', name: 'Planned', hint: 'Topic or guest chosen' },
  { id: 'recorded', name: 'Recorded', hint: 'Raw recording in hand' },
  { id: 'editing', name: 'Editing', hint: 'Audio and video edit' },
  { id: 'review', name: 'Review', hint: 'Quality and brand check' },
  { id: 'ready', name: 'Ready', hint: 'Approved, waiting for a slot' },
  { id: 'scheduled', name: 'Scheduled', hint: 'Release date set' },
  { id: 'published', name: 'Published', hint: 'Live' },
];
const IX = Object.fromEntries(EP_STAGES.map((s, i) => [s.id, i]));
const TYPES = ['Episode', 'Capsule', 'Trailer'];
const CHECKS = [
  { id: 'audio', label: 'Audio edited' },
  { id: 'video', label: 'Video edited' },
  { id: 'thumb', label: 'Thumbnail' },
  { id: 'notes', label: 'Show notes and chapters' },
  { id: 'captions', label: 'Captions / subtitles' },
  { id: 'clips', label: 'Social clips and carousel' },
  { id: 'approval', label: 'Guest has seen it', only: 'Episode' },
];
// how an episode's progress moves its guest along the Guests board
const GUEST_STAGE = { recorded: 'recorded', editing: 'editing', review: 'editing', ready: 'ready', scheduled: 'ready', published: 'published' };

// Locked plan (Source of Truth, 25 Oct 2026)
const MILESTONES = [
  { date: '2026-12-13', label: 'Readiness check: at least 4 edited founder episodes' },
  { date: '2027-01-03', label: 'Episode 1 release' },
  { date: '2027-01-10', label: 'Virtual launch session' },
];
const CAPSULE_FROM = '2026-11-01', CAPSULE_TO = '2026-12-27';
const BANK_EDITED = 4, BANK_RECORDED = 6;

const KEY = 'episodes';
const FILE = 'wdgta-episodes.json';
const $ = (id) => document.getElementById(id);
const uid = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d, long) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }) : '';

let eps = [];
let guests = [];
let selId = null;
let view = 'board';
let query = '';
let saveTimer = null;
let loaded = false, bound = false;
let ctx = { getDir: () => null, notice: () => {}, listStudioProjects: async () => [], openStudioProject: () => {}, openGuest: () => {} };

function blank(type = 'Episode', extra = {}) {
  return {
    id: uid(), type, number: type === 'Capsule' ? nextNumber(type) : '', title: '', guestId: '', stage: 'planned',
    recordingDate: '', releaseDate: '', checks: {}, studioProject: '',
    summary: '', links: '', notes: '', createdAt: Date.now(), updatedAt: Date.now(), ...extra,
  };
}
function nextNumber(type) {
  if (type === 'Trailer') return '';
  const nums = eps.filter((e) => e.type === type).map((e) => parseInt(e.number, 10)).filter((n) => !Number.isNaN(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

// ---------------- storage ----------------
async function load() {
  let data = null;
  try { data = await getRecord(KEY); } catch {}
  if (!data || !data.length) {
    const dir = ctx.getDir();
    if (dir) { try { const f = await folderReadJSON(dir, FILE); if (f && Array.isArray(f.episodes)) data = f.episodes; } catch {} }
  }
  eps = Array.isArray(data) ? data : [];
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  try { await putRecord(KEY, eps); } catch (e) { console.warn('[Episodes] save failed', e); }
  const dir = ctx.getDir();
  if (dir) { try { await folderWriteJSON(dir, FILE, { app: 'wdgta-os', module: 'episodes', savedAt: new Date().toISOString(), episodes: eps }); } catch (e) { console.warn('[Episodes] folder save failed', e); } }
  $('eSaved').textContent = `Saved ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

// ---------------- derived ----------------
const guestOf = (e) => guests.find((g) => g.id === e.guestId);
function label(e) {
  if (e.type === 'Trailer') return 'Trailer';
  return `${e.type === 'Capsule' ? 'Capsule' : 'Episode'}${e.number ? ' ' + e.number : ''}`;
}
function fullTitle(e) { return e.title ? `${label(e)} | ${e.title}` : label(e); }
function checksFor(e) { return CHECKS.filter((c) => !c.only || c.only === e.type); }
function progress(e) { const list = checksFor(e); return { done: list.filter((c) => e.checks?.[c.id]).length, total: list.length }; }
function matches(e) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [fullTitle(e), guestOf(e)?.name, guestOf(e)?.company, e.summary, e.notes].some((v) => String(v || '').toLowerCase().includes(q));
}
function warnings(e) {
  const w = [];
  if (e.releaseDate && e.stage !== 'published') {
    if (e.releaseDate < today()) w.push('Release date has passed');
    else if (IX[e.stage] < IX.ready && (Date.parse(e.releaseDate) - Date.parse(today())) / 864e5 <= 7) w.push('Releases within a week but not ready');
  }
  return w;
}
function stats() {
  const founder = eps.filter((e) => e.type === 'Episode');
  const recorded = founder.filter((e) => IX[e.stage] >= IX.recorded).length;
  const edited = founder.filter((e) => IX[e.stage] >= IX.ready).length;
  const upcoming = eps.filter((e) => e.releaseDate && e.releaseDate >= today() && e.stage !== 'published').sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))[0];
  const flagged = eps.filter((e) => warnings(e).length).length;
  return { recorded, edited, upcoming, flagged };
}
function sundays(from, to) {
  const out = []; const d = new Date(from + 'T12:00:00');
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  for (; d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// ---------------- rendering ----------------
function renderStats() {
  const s = stats();
  const pct = (a, b) => Math.min(100, Math.round(a / b * 100));
  $('eStats').innerHTML = `
    <div class="gstat"><span class="gstat-n mono">${s.edited}<small>/${BANK_EDITED}</small></span><span class="gstat-l">Founder episodes edited for 13 Dec</span><span class="gbar"><span style="width:${pct(s.edited, BANK_EDITED)}%"></span></span></div>
    <div class="gstat"><span class="gstat-n mono">${s.recorded}<small>/${BANK_RECORDED}</small></span><span class="gstat-l">Founder episodes recorded</span><span class="gbar"><span style="width:${pct(s.recorded, BANK_RECORDED)}%"></span></span></div>
    <div class="gstat"><span class="gstat-n mono gstat-sm">${s.upcoming ? esc(fmtDate(s.upcoming.releaseDate)) : '—'}</span><span class="gstat-l">${s.upcoming ? 'Next release: ' + esc(fullTitle(s.upcoming)) : 'Nothing scheduled yet'}</span></div>
    <div class="gstat ${s.flagged ? 'is-alert' : ''}"><span class="gstat-n mono">${s.flagged}</span><span class="gstat-l">Releases at risk</span></div>`;
}
function cardHTML(e) {
  const g = guestOf(e); const p = progress(e); const w = warnings(e);
  return `<li class="gcard ecard${e.id === selId ? ' is-sel' : ''}" draggable="true" data-id="${e.id}" tabindex="0" aria-label="${esc(fullTitle(e))}">
    <span class="ebadge t-${e.type.toLowerCase()}">${esc(label(e).toUpperCase())}</span>
    <span class="gname">${esc(e.title || (g ? g.name : 'Untitled'))}</span>
    ${g && e.title ? `<span class="gco">${esc(g.name)}${g.company ? ' · ' + esc(g.company) : ''}</span>` : ''}
    <span class="eprog"><span class="gbar"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></span><span class="mono">${p.done}/${p.total}</span></span>
    ${e.releaseDate ? `<span class="gnext ${w.length ? 'overdue' : ''}"><span class="mono">${fmtDate(e.releaseDate)}</span> ${w.length ? esc(w[0]) : 'Release'}</span>` : ''}
  </li>`;
}
function renderBoard() {
  $('eBoard').innerHTML = EP_STAGES.map((st) => {
    const list = eps.filter((e) => e.stage === st.id && matches(e)).sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999') || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
    return `<section class="gcol" data-stage="${st.id}" aria-label="${st.name}">
      <header class="gcol-head"><span>${st.name}</span><span class="mono gcount">${list.length}</span></header>
      <p class="gcol-hint">${st.hint}</p>
      <ol class="gcards">${list.map(cardHTML).join('')}</ol>
      ${st.id === 'planned' ? '<button class="gadd" type="button" data-add="Episode">+ Episode</button><button class="gadd" type="button" data-add="Capsule">+ Capsule</button>' : ''}
    </section>`;
  }).join('');
}
function renderPlan() {
  // dated episodes + Capsule Sundays + locked milestones, in date order
  const rows = [];
  const capsuleDates = new Set(eps.filter((e) => e.type === 'Capsule' && e.releaseDate).map((e) => e.releaseDate));
  for (const d of sundays(CAPSULE_FROM, CAPSULE_TO)) if (!capsuleDates.has(d)) rows.push({ date: d, kind: 'slot' });
  for (const m of MILESTONES) rows.push({ date: m.date, kind: 'milestone', label: m.label });
  for (const e of eps.filter((x) => x.releaseDate && matches(x))) rows.push({ date: e.releaseDate, kind: 'ep', e });
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'milestone' ? -1 : 1));
  const t = today();
  let month = '';
  const html = [];
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (m !== month) { month = m; html.push(`<li class="plan-month">${new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</li>`); }
    const past = r.date < t ? ' is-past' : '';
    const date = `<span class="plan-date mono">${esc(fmtDate(r.date, true))}</span>`;
    if (r.kind === 'milestone') html.push(`<li class="plan-row is-milestone${past}">${date}<span class="plan-what">${esc(r.label)}</span></li>`);
    else if (r.kind === 'slot') html.push(`<li class="plan-row is-slot${past}">${date}<span class="plan-what">${r.date < t ? 'Capsule slot (no Capsule logged)' : 'Open Capsule slot'}</span><button class="btn small ghost" type="button" data-slot="${r.date}">+ Capsule</button></li>`);
    else {
      const e = r.e; const g = guestOf(e); const w = warnings(e);
      html.push(`<li class="plan-row is-ep${past}${e.id === selId ? ' is-sel' : ''}" data-id="${e.id}" tabindex="0">${date}<span class="ebadge t-${e.type.toLowerCase()}">${esc(label(e).toUpperCase())}</span><span class="plan-what">${esc(e.title || (g ? g.name : 'Untitled'))}${g && e.title ? ` <span class="gco">· ${esc(g.name)}</span>` : ''}</span><span class="plan-stage ${w.length ? 'overdue' : ''}">${w.length ? esc(w[0]) : EP_STAGES[IX[e.stage]].name}</span></li>`);
    }
  }
  const undated = eps.filter((e) => !e.releaseDate && matches(e) && e.stage !== 'published');
  $('ePlan').innerHTML = `<ol class="plan">${html.join('')}</ol>
    ${undated.length ? `<h2 class="plan-sub">No release date yet</h2><ol class="plan">${undated.map((e) => `<li class="plan-row is-ep${e.id === selId ? ' is-sel' : ''}" data-id="${e.id}" tabindex="0"><span class="plan-date mono">—</span><span class="ebadge t-${e.type.toLowerCase()}">${esc(label(e).toUpperCase())}</span><span class="plan-what">${esc(e.title || guestOf(e)?.name || 'Untitled')}</span><span class="plan-stage">${EP_STAGES[IX[e.stage]].name}</span></li>`).join('')}</ol>` : ''}`;
}
async function renderDetail() {
  const e = eps.find((x) => x.id === selId);
  const box = $('eDetail');
  box.hidden = !e;
  if (!e) return;
  const projects = await ctx.listStudioProjects();
  const f = (id, lab, val, type = 'text', extra = '') => `<label class="gf"><span>${lab}</span><input data-f="${id}" type="${type}" value="${esc(val)}" ${extra}></label>`;
  const ta = (id, lab, val, rows = 3, ph = '') => `<label class="gf"><span>${lab}</span><textarea data-f="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;
  const g = guestOf(e);
  box.innerHTML = `
    <div class="gd-head">
      <span class="ebadge t-${e.type.toLowerCase()}">${esc(label(e).toUpperCase())}</span>
      <span class="gd-spacer"></span>
      <button class="x-btn" type="button" data-close aria-label="Close">×</button>
    </div>
    <input class="gd-name" data-f="title" type="text" value="${esc(e.title)}" placeholder="Title" aria-label="Title">
    <div class="gd-grid">
      <label class="gf"><span>Type</span><select data-f="type">${TYPES.map((t) => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${e.type === 'Trailer' ? '<span></span>' : f('number', 'Number', e.number, 'text', 'inputmode="numeric"')}
    </div>
    <label class="gf"><span>Stage</span><select data-f="stage">${EP_STAGES.map((s) => `<option value="${s.id}" ${s.id === e.stage ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
    ${e.type === 'Episode' ? `<label class="gf"><span>Guest</span><select data-f="guestId"><option value="">No guest linked</option>${guests.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${esc(x.id)}" ${x.id === e.guestId ? 'selected' : ''}>${esc(x.name)}${x.company ? ' · ' + esc(x.company) : ''}</option>`).join('')}</select></label>
      ${g ? `<button class="btn small ghost" type="button" data-open-guest>Open ${esc(g.name)} in Guests</button>` : ''}` : ''}
    <div class="gd-grid">${f('recordingDate', 'Recorded', e.recordingDate, 'date')}${f('releaseDate', 'Release date', e.releaseDate, 'date')}</div>
    ${warnings(e).map((w) => `<p class="e-warn">${esc(w)}</p>`).join('')}
    <fieldset class="gd-sec"><legend>Before release</legend>
      ${checksFor(e).map((c) => `<label class="check"><input type="checkbox" data-check="${c.id}" ${e.checks?.[c.id] ? 'checked' : ''}> ${c.label}</label>`).join('')}
    </fieldset>
    <fieldset class="gd-sec"><legend>Studio</legend>
      <label class="gf"><span>Studio project</span><select data-f="studioProject"><option value="">Not linked</option>${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === e.studioProject ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
      ${e.studioProject ? '<button class="btn small" type="button" data-open-studio>Open in Studio</button>' : '<p class="hint">Link the Studio project once the recording is transcribed.</p>'}
    </fieldset>
    ${ta('summary', 'Summary / show notes', e.summary, 4, 'What the listener will take away')}
    ${ta('links', 'Published links', e.links, 2, 'YouTube, Spotify, Apple Podcasts, Instagram…')}
    ${ta('notes', 'Notes', e.notes, 3)}
    <div class="gd-foot">
      <span class="hint mono">Added ${new Date(e.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <button class="btn small ghost danger" type="button" data-del>Delete</button>
    </div>`;
}
function renderAll() {
  renderStats();
  $('eBoard').hidden = view !== 'board';
  $('ePlan').hidden = view !== 'plan';
  document.querySelectorAll('[data-eview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.eview === view)));
  if (view === 'board') renderBoard(); else renderPlan();
  $('eEmpty').hidden = eps.length > 0;
}

// ---------------- actions ----------------
async function select(id) {
  selId = id; renderAll(); await renderDetail();
  if (window.innerWidth <= 900) $('eDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function add(type, extra = {}) {
  const e = blank(type, extra);
  eps.push(e); save(); select(e.id);
  setTimeout(() => document.querySelector('#eDetail .gd-name')?.focus(), 30);
  return e;
}
function syncGuest(e) {
  if (e.type === 'Episode' && e.guestId && GUEST_STAGE[e.stage]) bumpGuest(e.guestId, GUEST_STAGE[e.stage]);
}
function setStage(e, stage) {
  e.stage = stage; e.updatedAt = Date.now();
  if (stage === 'recorded' && !e.recordingDate) e.recordingDate = today();
  if (stage === 'published' && !e.releaseDate) e.releaseDate = today();
  syncGuest(e);
}
function updateField(field, value) {
  const e = eps.find((x) => x.id === selId);
  if (!e) return;
  if (field === 'stage') setStage(e, value);
  else {
    e[field] = value; e.updatedAt = Date.now();
    if (field === 'type') e.number = value === 'Capsule' ? nextNumber(value) : '';
    if (field === 'guestId') syncGuest(e);
  }
  save();
  if (['title', 'number', 'type', 'stage', 'guestId', 'releaseDate'].includes(field)) renderAll();
  if (['type', 'stage', 'guestId', 'studioProject', 'releaseDate'].includes(field)) renderDetail();
}
function seed() {
  // Only what the plan and the Recordings sheet already say. Nothing is guessed.
  if (!eps.some((e) => e.type === 'Trailer')) eps.push(blank('Trailer', { title: 'Introducing WDGTA', stage: 'published', checks: { audio: true } , notes: 'Recordings sheet: recorded, audio edited, published.' }));
  if (!eps.some((e) => e.type === 'Episode' && String(e.number) === '1')) eps.push(blank('Episode', { number: '1', releaseDate: '2027-01-03', notes: 'Release date locked 25 Oct 2026. Guest not yet chosen.' }));
  const prince = guests.find((g) => /^prince\b/i.test(g.name) && g.stage !== 'parked') || guests.find((g) => g.name === 'Founder 1');
  if (prince && !eps.some((e) => e.guestId === prince.id)) eps.push(blank('Episode', { number: '', guestId: prince.id, stage: 'recorded', recordingDate: prince.recordingDate || '', notes: 'Audio edit outstanding.' }));
  save(); renderAll();
  ctx.notice('Added the trailer, Episode 1 (3 Jan release) and the recorded founder conversation. Add Capsules from the release plan.');
}

// ---------------- wiring ----------------
export async function initEpisodes(c) {
  ctx = { ...ctx, ...c };
  guests = await guestsData({ getDir: ctx.getDir, notice: ctx.notice });
  if (!loaded) { await load(); loaded = true; }
  if (!bound) bind();
  renderAll(); await renderDetail();
}
/** Called from Guests: create an episode for this guest and open it. */
export async function planEpisodeFor(guestId, c) {
  await initEpisodes(c);
  const existing = eps.find((e) => e.guestId === guestId);
  if (existing) { select(existing.id); return; }
  const g = guests.find((x) => x.id === guestId);
  add('Episode', { guestId, stage: g && ['recorded', 'editing', 'ready', 'published'].includes(g.stage) ? 'recorded' : 'planned', recordingDate: g?.recordingDate || '' });
}
export function flushEpisodes() { if (saveTimer) return flush(); }
function bind() {
  bound = true;
  $('eAddEp').onclick = () => add('Episode');
  $('eAddCap').onclick = () => add('Capsule');
  $('eSeed').onclick = seed;
  $('eSearch').oninput = (ev) => { query = ev.target.value.trim(); renderAll(); };
  document.querySelectorAll('[data-eview]').forEach((b) => b.onclick = () => { view = b.dataset.eview; renderAll(); });
  const main = $('episodesView');
  main.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-add]'); if (a) { add(a.dataset.add); return; }
    const sl = ev.target.closest('[data-slot]'); if (sl) { add('Capsule', { releaseDate: sl.dataset.slot }); return; }
    const card = ev.target.closest('.ecard, .plan-row[data-id]'); if (card && !ev.target.closest('#eDetail')) select(card.dataset.id);
  });
  main.addEventListener('keydown', (ev) => {
    const card = ev.target.closest('.ecard, .plan-row[data-id]');
    if (card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(card.dataset.id); }
  });
  main.addEventListener('dragstart', (ev) => { const c = ev.target.closest('.ecard'); if (!c) return; ev.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('is-drag'); });
  main.addEventListener('dragend', (ev) => { ev.target.closest('.ecard')?.classList.remove('is-drag'); main.querySelectorAll('.gcol.is-over').forEach((c) => c.classList.remove('is-over')); });
  main.addEventListener('dragover', (ev) => { const col = ev.target.closest('#eBoard .gcol'); if (!col) return; ev.preventDefault(); main.querySelectorAll('.gcol.is-over').forEach((c) => c !== col && c.classList.remove('is-over')); col.classList.add('is-over'); });
  main.addEventListener('drop', (ev) => {
    const col = ev.target.closest('#eBoard .gcol'); if (!col) return; ev.preventDefault(); col.classList.remove('is-over');
    const e = eps.find((x) => x.id === ev.dataTransfer.getData('text/plain'));
    if (!e || e.stage === col.dataset.stage) return;
    setStage(e, col.dataset.stage); save(); renderAll(); if (selId === e.id) renderDetail();
  });
  const d = $('eDetail');
  d.addEventListener('input', (ev) => {
    const ck = ev.target.closest('[data-check]');
    if (ck) { const e = eps.find((x) => x.id === selId); e.checks = { ...e.checks, [ck.dataset.check]: ck.checked }; e.updatedAt = Date.now(); save(); renderAll(); return; }
    const el = ev.target.closest('input[data-f]:not([type=date]), textarea[data-f]'); if (el) updateField(el.dataset.f, el.value);
  });
  d.addEventListener('change', (ev) => { const el = ev.target.closest('select[data-f], input[type=date][data-f]'); if (el) updateField(el.dataset.f, el.value); });
  d.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-close]')) { selId = null; renderAll(); renderDetail(); return; }
    const e = eps.find((x) => x.id === selId);
    if (ev.target.closest('[data-open-studio]') && e?.studioProject) { ctx.openStudioProject(e.studioProject); return; }
    if (ev.target.closest('[data-open-guest]') && e?.guestId) { await flush(); ctx.openGuest(e.guestId); return; }
    const del = ev.target.closest('[data-del]');
    if (del) {
      if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Confirm delete'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Delete'; }, 3000); return; }
      eps = eps.filter((x) => x.id !== selId); selId = null; save(); renderAll(); renderDetail();
    }
  });
}
