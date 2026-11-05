// WDGTA OS — module 04: Calendar. One view of every date in Guests and Episodes, the locked
// milestones, and your own entries. Dates you move here are changed in Guests and Episodes too.

import { getRecord, putRecord, folderReadJSON, folderWriteJSON } from './library.js';
import { guestsData, updateGuest } from './guests.js';
import { episodesData, updateEpisode, createEpisode, episodeLabel, episodeTitle, episodeWarnings, sundays, MILESTONES, CAPSULE_FROM, CAPSULE_TO } from './episodes.js';

export const KINDS = [
  { id: 'release', name: 'Releases' },
  { id: 'capsule', name: 'Capsules' },
  { id: 'recording', name: 'Recordings' },
  { id: 'discovery', name: 'Discovery sessions' },
  { id: 'action', name: 'Next actions' },
  { id: 'own', name: 'My entries' },
  { id: 'milestone', name: 'Milestones' },
];
const OWN_TYPES = ['Social post', 'Meeting', 'Task', 'Event', 'Other'];
const KEY = 'calendar';
const FILE = 'wdgta-calendar.json';
const PREF = 'wdgta-os:calendar';

const $ = (id) => document.getElementById(id);
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const parse = (s) => new Date(s + 'T12:00:00');
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };

let own = [];
let guests = [], eps = [];
let loaded = false, bound = false;
let saveTimer = null;
let selId = null;
let pref = { view: window.innerWidth < 760 ? 'agenda' : 'month', month: today().slice(0, 7), hidden: [] };
try { pref = { ...pref, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch {}
let ctx = { getDir: () => null, notice: () => {}, openGuest: () => {}, openEpisode: () => {} };
const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch {} };

// ---------------- storage (own entries only; everything else lives in Guests / Episodes) ----------------
async function load() {
  let data = null;
  try { data = await getRecord(KEY); } catch {}
  if (!data || !data.length) {
    const dir = ctx.getDir();
    if (dir) { try { const f = await folderReadJSON(dir, FILE); if (f && Array.isArray(f.entries)) data = f.entries; } catch {} }
  }
  own = Array.isArray(data) ? data : [];
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  try { await putRecord(KEY, own); } catch (e) { console.warn('[Calendar] save failed', e); }
  const dir = ctx.getDir();
  if (dir) { try { await folderWriteJSON(dir, FILE, { app: 'wdgta-os', module: 'calendar', savedAt: new Date().toISOString(), entries: own }); } catch {} }
}
window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

// ---------------- items from every module ----------------
function items(all = false) {
  const t = today();
  const out = [];
  const epGuestRec = new Set(eps.filter((e) => e.guestId && e.recordingDate).map((e) => e.guestId));
  for (const g of guests) {
    if (g.discoveryDate) out.push({ key: `g:${g.id}:discoveryDate`, date: g.discoveryDate, kind: 'discovery', title: g.name, sub: [g.company, 'Discovery session'].filter(Boolean).join(' · '), src: 'guest', ref: g.id, field: 'discoveryDate' });
    if (g.recordingDate && !epGuestRec.has(g.id)) out.push({ key: `g:${g.id}:recordingDate`, date: g.recordingDate, kind: 'recording', title: g.name, sub: [g.company, 'Recording'].filter(Boolean).join(' · '), src: 'guest', ref: g.id, field: 'recordingDate' });
    if (g.nextAction && g.nextDate && !['published', 'parked'].includes(g.stage)) {
      const late = g.nextDate < t;
      out.push({ key: `g:${g.id}:nextDate`, date: g.nextDate, kind: 'action', title: g.nextAction, sub: g.name, src: 'guest', ref: g.id, field: 'nextDate', warn: late ? 'Overdue' : g.nextDate === t ? 'Due today' : '' });
    }
  }
  const capDates = new Set();
  for (const e of eps) {
    const g = guests.find((x) => x.id === e.guestId);
    const name = e.title || g?.name || 'Untitled';
    if (e.recordingDate) out.push({ key: `e:${e.id}:recordingDate`, date: e.recordingDate, kind: 'recording', title: name, sub: `${episodeLabel(e)} · Recording`, src: 'episode', ref: e.id, field: 'recordingDate' });
    if (e.releaseDate) {
      if (e.type === 'Capsule') capDates.add(e.releaseDate);
      const w = episodeWarnings(e);
      out.push({ key: `e:${e.id}:releaseDate`, date: e.releaseDate, kind: e.type === 'Capsule' ? 'capsule' : 'release', title: name, sub: `${episodeLabel(e)} · ${e.stage === 'published' ? 'Published' : 'Release'}`, badge: episodeLabel(e).toUpperCase(), src: 'episode', ref: e.id, field: 'releaseDate', warn: w[0] || '', done: e.stage === 'published' });
    }
  }
  for (const d of sundays(CAPSULE_FROM, CAPSULE_TO)) if (!capDates.has(d)) out.push({ key: `slot:${d}`, date: d, kind: 'capsule', slot: true, title: d < t ? 'No Capsule logged' : 'Open Capsule slot', sub: 'Capsule Sunday', src: 'slot', warn: '' });
  for (const m of MILESTONES) out.push({ key: `m:${m.date}`, date: m.date, kind: 'milestone', title: m.label, sub: 'Locked plan', src: 'milestone' });
  for (const o of own) out.push({ key: `o:${o.id}`, date: o.date, kind: 'own', title: o.title || 'Untitled', sub: [o.type, o.time].filter(Boolean).join(' · '), time: o.time, src: 'own', ref: o.id, field: 'date', done: o.done });
  const order = { milestone: 0, release: 1, capsule: 2, recording: 3, discovery: 4, action: 5, own: 6 };
  return out.filter((i) => i.date && (all || !pref.hidden.includes(i.kind)))
    .sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || String(a.time || '').localeCompare(String(b.time || '')));
}
const draggable = (i) => ['guest', 'episode', 'own'].includes(i.src);

function chip(i, compact) {
  const cls = ['cal-item', `k-${i.kind}`, i.slot ? 'is-slot' : '', i.warn ? 'is-warn' : '', i.done ? 'is-done' : '', i.key === selId ? 'is-sel' : ''].filter(Boolean).join(' ');
  const tip = [i.title, i.sub, i.warn].filter(Boolean).join(' — ');
  return `<button type="button" class="${cls}" data-key="${esc(i.key)}" ${draggable(i) ? 'draggable="true"' : ''} title="${esc(tip)}">
    ${i.badge ? `<span class="cal-badge mono">${esc(i.badge)}</span>` : ''}${i.time && compact ? `<span class="mono cal-time">${esc(i.time)}</span>` : ''}<span class="cal-t">${esc(i.title)}</span>
    ${compact ? '' : `<span class="cal-sub">${esc(i.sub || '')}${i.warn ? ` · <b>${esc(i.warn)}</b>` : ''}</span>`}
  </button>`;
}

// ---------------- rendering ----------------
function renderFilters() {
  $('calFilters').innerHTML = KINDS.map((k) => `<button type="button" class="cal-chip k-${k.id}" data-kind="${k.id}" aria-pressed="${!pref.hidden.includes(k.id)}"><span class="dot" aria-hidden="true"></span>${k.name}</button>`).join('');
}
function renderMonth(all) {
  const [y, m] = pref.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday first
  const last = new Date(y, m, 0);
  const end = new Date(last); end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7) - 1));
  const by = new Map();
  for (const i of all) { if (!by.has(i.date)) by.set(i.date, []); by.get(i.date).push(i); }
  const t = today();
  const cells = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const s = iso(d);
    const list = by.get(s) || [];
    const out = d.getMonth() !== m - 1;
    cells.push(`<div class="cal-day${out ? ' is-out' : ''}${s === t ? ' is-today' : ''}${s < t ? ' is-past' : ''}" data-date="${s}">
      <div class="cal-dhead"><span class="cal-dnum mono">${d.getDate()}</span><button type="button" class="cal-plus" data-new="${s}" aria-label="Add on ${s}">+</button></div>
      <div class="cal-items">${list.map((i) => chip(i, true)).join('')}</div>
    </div>`);
  }
  $('calTitle').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('calMonth').innerHTML = `<div class="cal-wk">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<span>${w}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>`;
}
function renderAgenda(all) {
  const t = today();
  const from = pref.agendaFrom || t;
  const to = addDays(from, 41);
  const overdue = all.filter((i) => i.date < t && i.warn && i.warn !== '');
  const list = all.filter((i) => i.date >= from && i.date <= to);
  const groups = new Map();
  for (const i of list) { if (!groups.has(i.date)) groups.set(i.date, []); groups.get(i.date).push(i); }
  $('calTitle').textContent = `${parse(from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${parse(to).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const day = (d, items) => `<li class="ag-day${d === t ? ' is-today' : ''}"><div class="ag-date"><span class="mono">${esc(parse(d).toLocaleDateString(undefined, { weekday: 'short' }))}</span><b>${parse(d).getDate()}</b><span class="mono">${esc(parse(d).toLocaleDateString(undefined, { month: 'short' }))}</span></div><div class="ag-items">${items.map((i) => chip(i, false)).join('')}</div><button type="button" class="cal-plus" data-new="${d}" aria-label="Add on ${d}">+</button></li>`;
  $('calAgenda').innerHTML = `
    ${overdue.length && from <= t ? `<h2 class="plan-sub ag-alert">Needs attention</h2><ol class="ag">${overdue.map((i) => `<li class="ag-day"><div class="ag-date"><span class="mono">${esc(parse(i.date).toLocaleDateString(undefined, { weekday: 'short' }))}</span><b>${parse(i.date).getDate()}</b><span class="mono">${esc(parse(i.date).toLocaleDateString(undefined, { month: 'short' }))}</span></div><div class="ag-items">${chip(i, false)}</div></li>`).join('')}</ol>` : ''}
    <ol class="ag">${[...groups].map(([d, items]) => day(d, items)).join('') || '<li class="clip-empty">Nothing in these six weeks.</li>'}</ol>`;
}
function renderDetail() {
  const box = $('calDetail');
  const o = own.find((x) => `o:${x.id}` === selId);
  box.hidden = !o;
  if (!o) return;
  box.innerHTML = `
    <div class="gd-head"><span class="cal-chip k-own is-static"><span class="dot"></span>My entry</span><span class="gd-spacer"></span><button class="x-btn" type="button" data-close aria-label="Close">×</button></div>
    <input class="gd-name" data-f="title" type="text" value="${esc(o.title)}" placeholder="What is it?" aria-label="Title">
    <div class="gd-grid">
      <label class="gf"><span>Date</span><input data-f="date" type="date" value="${esc(o.date)}"></label>
      <label class="gf"><span>Time (optional)</span><input data-f="time" type="time" value="${esc(o.time || '')}"></label>
    </div>
    <label class="gf"><span>Type</span><select data-f="type">${OWN_TYPES.map((t) => `<option ${t === o.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" data-f="done" ${o.done ? 'checked' : ''}> Done</label>
    <label class="gf"><span>Notes</span><textarea data-f="notes" rows="5">${esc(o.notes || '')}</textarea></label>
    <div class="gd-foot"><span></span><button class="btn small ghost danger" type="button" data-del>Delete</button></div>`;
}
function renderAll() {
  const all = items();
  $('calMonth').hidden = pref.view !== 'month';
  $('calAgenda').hidden = pref.view !== 'agenda';
  document.querySelectorAll('[data-cview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cview === pref.view)));
  if (pref.view === 'month') renderMonth(all); else renderAgenda(all);
  renderFilters();
}

// ---------------- actions ----------------
function openItem(key) {
  const i = items().find((x) => x.key === key) || null;
  if (!i) return;
  if (i.src === 'guest') ctx.openGuest(i.ref);
  else if (i.src === 'episode') ctx.openEpisode(i.ref);
  else if (i.src === 'slot') { const e = createEpisode('Capsule', { releaseDate: i.date }); ctx.openEpisode(e.id); }
  else if (i.src === 'own') { selId = key; renderAll(); renderDetail(); if (window.innerWidth <= 900) $('calDetail').scrollIntoView({ behavior: 'smooth' }); }
}
function moveItem(key, date) {
  const i = items().find((x) => x.key === key);
  if (!i || !draggable(i) || i.date === date) return;
  if (i.src === 'guest') updateGuest(i.ref, { [i.field]: date });
  else if (i.src === 'episode') updateEpisode(i.ref, { [i.field]: date });
  else if (i.src === 'own') { const o = own.find((x) => x.id === i.ref); o.date = date; save(); }
  renderAll(); renderDetail();
  ctx.notice(`Moved "${i.title}" to ${parse(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}.`, 3000);
}
function newMenu(anchor, date) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'cal-menu'; m.id = 'calMenu';
  m.innerHTML = `<span class="label">${esc(parse(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
    <button type="button" data-make="own">My entry</button>
    <button type="button" data-make="recording">Recording (new episode)</button>
    <button type="button" data-make="capsule">Capsule</button>`;
  m.dataset.date = date;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = 210;
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  m.style.top = `${Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4)}px`;
  m.querySelector('button').focus();
}
function closeMenu() { document.getElementById('calMenu')?.remove(); }
function make(kind, date) {
  closeMenu();
  if (kind === 'own') {
    const o = { id: uid(), date, title: '', type: 'Task', time: '', notes: '', done: false, createdAt: Date.now() };
    own.push(o); save(); selId = `o:${o.id}`; renderAll(); renderDetail();
    setTimeout(() => $('calDetail').querySelector('.gd-name')?.focus(), 30);
  } else if (kind === 'recording') {
    const e = createEpisode('Episode', { recordingDate: date }); ctx.openEpisode(e.id);
  } else if (kind === 'capsule') {
    const e = createEpisode('Capsule', { releaseDate: date }); ctx.openEpisode(e.id);
  }
}
function shift(n) {
  if (pref.view === 'month') { const [y, m] = pref.month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); pref.month = iso(d).slice(0, 7); }
  else pref.agendaFrom = addDays(pref.agendaFrom || today(), n * 42);
  savePref(); renderAll();
}
function goToday() { pref.month = today().slice(0, 7); pref.agendaFrom = today(); savePref(); renderAll(); }

// ---------------- .ics export for Google Calendar / Apple Calendar ----------------
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function fold(line) { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); }
function exportICS() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WDGTA//WDGTA OS//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:WDGTA'];
  const name = { release: 'Release', capsule: 'Capsule', recording: 'Recording', discovery: 'Discovery', action: 'To do', own: '', milestone: 'Milestone' };
  for (const i of items()) {
    if (i.slot) continue;
    const d = i.date.replace(/-/g, '');
    const summary = i.kind === 'own' ? i.title : i.kind === 'release' || i.kind === 'capsule' ? `${i.badge ? i.badge.replace(/^(\w)(\w+)/, (_, a, b) => a + b.toLowerCase()) : name[i.kind]}${i.title && i.badge && !i.title.startsWith('Untitled') ? ' | ' + i.title : ''}` : `${name[i.kind]}: ${i.title}`;
    lines.push('BEGIN:VEVENT', `UID:${i.key.replace(/[^a-z0-9:-]/gi, '')}@wdgta-os`, `DTSTAMP:${stamp}`);
    if (i.time) { const t = i.time.replace(':', '') + '00'; const endH = String(Math.min(23, Number(i.time.slice(0, 2)) + 1)).padStart(2, '0'); lines.push(`DTSTART:${d}T${t}`, `DTEND:${d}T${endH}${i.time.slice(3, 5)}00`); }
    else { lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(i.date, 1).replace(/-/g, '')}`); }
    lines.push(fold(`SUMMARY:${icsEscape(summary)}`), fold(`DESCRIPTION:${icsEscape([i.sub, i.warn].filter(Boolean).join(' — '))}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `wdgta-calendar-${today()}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  ctx.notice('Calendar file saved. In Google Calendar: Settings → Import & export → Import. Import it into its own "WDGTA" calendar, so when dates change you can clear that calendar and import a fresh export.', 10000);
}

// ---------------- wiring ----------------
export async function initCalendar(c) {
  ctx = { ...ctx, ...c };
  eps = await episodesData({ getDir: ctx.getDir, notice: ctx.notice });
  guests = await guestsData();
  if (!loaded) { await load(); loaded = true; }
  if (!bound) bind();
  renderAll(); renderDetail();
}
/** Every dated item, ignoring the filter chips. Used by Home. */
export async function calendarItems(c = {}) {
  ctx = { ...ctx, ...c };
  eps = await episodesData({ getDir: ctx.getDir, notice: ctx.notice });
  guests = await guestsData();
  if (!loaded) { await load(); loaded = true; }
  return items(true);
}
export function flushCalendar() { if (saveTimer) return flush(); }
function bind() {
  bound = true;
  $('calPrev').onclick = () => shift(-1);
  $('calNext').onclick = () => shift(1);
  $('calToday').onclick = goToday;
  $('calIcs').onclick = exportICS;
  document.querySelectorAll('[data-cview]').forEach((b) => b.onclick = () => { pref.view = b.dataset.cview; savePref(); renderAll(); });
  $('calFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    const k = b.dataset.kind;
    pref.hidden = pref.hidden.includes(k) ? pref.hidden.filter((x) => x !== k) : [...pref.hidden, k];
    savePref(); renderAll();
  });
  const main = $('calendarView');
  main.addEventListener('click', (e) => {
    const n = e.target.closest('[data-new]'); if (n) { e.stopPropagation(); newMenu(n, n.dataset.new); return; }
    const it = e.target.closest('.cal-item'); if (it) { openItem(it.dataset.key); return; }
    const day = e.target.closest('.cal-day'); if (day && window.innerWidth <= 760) { pref.view = 'agenda'; pref.agendaFrom = day.dataset.date; savePref(); renderAll(); return; }
    if (day && !e.target.closest('#calDetail')) { e.stopPropagation(); newMenu(day.querySelector('.cal-plus'), day.dataset.date); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#calMenu [data-make]');
    if (b) { make(b.dataset.make, b.closest('#calMenu').dataset.date); return; }
    if (!e.target.closest('#calMenu')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    if (document.body.dataset.module !== 'calendar' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowLeft' && !e.altKey) shift(-1);
    if (e.key === 'ArrowRight' && !e.altKey) shift(1);
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) goToday();
  });
  // drag items to another day
  main.addEventListener('dragstart', (e) => { const it = e.target.closest('.cal-item[draggable]'); if (!it) return; e.dataTransfer.setData('text/plain', it.dataset.key); e.dataTransfer.effectAllowed = 'move'; it.classList.add('is-drag'); });
  main.addEventListener('dragend', () => main.querySelectorAll('.is-drag, .is-over').forEach((x) => x.classList.remove('is-drag', 'is-over')));
  main.addEventListener('dragover', (e) => { const d = e.target.closest('.cal-day'); if (!d) return; e.preventDefault(); main.querySelectorAll('.cal-day.is-over').forEach((x) => x !== d && x.classList.remove('is-over')); d.classList.add('is-over'); });
  main.addEventListener('drop', (e) => { const d = e.target.closest('.cal-day'); if (!d) return; e.preventDefault(); d.classList.remove('is-over'); moveItem(e.dataTransfer.getData('text/plain'), d.dataset.date); });
  // own-entry panel
  const box = $('calDetail');
  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]'); if (!el) return;
    const o = own.find((x) => `o:${x.id}` === selId); if (!o) return;
    o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    save(); renderAll();
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { selId = null; renderAll(); renderDetail(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Confirm delete'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Delete'; }, 3000); return; }
      own = own.filter((x) => `o:${x.id}` !== selId); selId = null; save(); renderAll(); renderDetail();
    }
  });
}
