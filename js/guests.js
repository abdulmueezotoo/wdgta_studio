// WDGTA OS — module 02: Guests. A pipeline of founders from first contact to published episode.
// Local-first: kept in this browser (IndexedDB) and mirrored to the projects folder when one is connected.

import { getRecord, putRecord, folderReadJSON, folderWriteJSON } from './library.js';

export const STAGES = [
  { id: 'prospect', name: 'Prospect', hint: 'Someone worth inviting' },
  { id: 'contacted', name: 'Contacted', hint: 'Invitation sent' },
  { id: 'discovery', name: 'Discovery', hint: 'Founder Discovery Interaction' },
  { id: 'booked', name: 'Booked', hint: 'Recording date agreed' },
  { id: 'recorded', name: 'Recorded', hint: 'In the bank, not yet edited' },
  { id: 'editing', name: 'Editing', hint: 'Post-production and quality review' },
  { id: 'ready', name: 'Ready', hint: 'Edited and approved for release' },
  { id: 'published', name: 'Published', hint: 'Live' },
  { id: 'parked', name: 'On hold', hint: 'Paused or declined' },
];
const STAGE_IX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const KEY = 'guests';
const FILE = 'wdgta-guests.json';
const BANK_TARGET = 6;   // record 5–6 in Nov–Dec
const EDIT_TARGET = 4;   // at least 4 edited by the 13 Dec readiness check

const $ = (id) => document.getElementById(id);
const uid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

let guests = [];
let selId = null;
let view = 'board';
let query = '';
let saveTimer = null;
let ctx = { getDir: () => null, notice: () => {}, listStudioProjects: async () => [], openStudioProject: () => {} };

function blank(stage = 'prospect') {
  return {
    id: uid(), name: '', company: '', role: 'Founder', sector: '', location: '', founded: '',
    stage, phone: '', email: '', social: '', source: '',
    angle: '', discoveryDate: '', discoveryNotes: '', recordingDate: '', format: 'In person',
    consent: false, photo: false, bio: false,
    nextAction: '', nextDate: '', studioProject: '', notes: '',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// ---------------- storage ----------------
async function load() {
  let data = null;
  try { data = await getRecord(KEY); } catch {}
  if (!data || !data.length) {
    const dir = ctx.getDir();
    if (dir) { try { const f = await folderReadJSON(dir, FILE); if (f && Array.isArray(f.guests)) data = f.guests; } catch {} }
  }
  guests = Array.isArray(data) ? data : [];
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  try { await putRecord(KEY, guests); } catch (e) { console.warn('[Guests] save failed', e); }
  const dir = ctx.getDir();
  if (dir) { try { await folderWriteJSON(dir, FILE, { app: 'wdgta-os', module: 'guests', savedAt: new Date().toISOString(), guests }); } catch (e) { console.warn('[Guests] folder save failed', e); } }
  stamp();
}
function stamp() { $('gSaved').textContent = `Saved ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`; }
window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

// ---------------- derived ----------------
function dueState(g) {
  if (!g.nextDate || g.stage === 'published' || g.stage === 'parked') return '';
  const d = g.nextDate, t = today();
  if (d < t) return 'overdue';
  if (d === t) return 'today';
  const diff = (Date.parse(d) - Date.parse(t)) / 864e5;
  return diff <= 3 ? 'soon' : '';
}
function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d + 'T12:00:00');
  return x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function matches(g) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [g.name, g.company, g.sector, g.angle, g.notes, g.location].some((v) => String(v || '').toLowerCase().includes(q));
}
function stats() {
  const n = (ids) => guests.filter((g) => ids.includes(g.stage)).length;
  const recorded = n(['recorded', 'editing', 'ready', 'published']);
  const edited = n(['ready', 'published']);
  const pipeline = n(['prospect', 'contacted', 'discovery', 'booked']);
  const due = guests.filter((g) => ['overdue', 'today'].includes(dueState(g))).length;
  return { recorded, edited, pipeline, due };
}

// ---------------- rendering ----------------
function renderStats() {
  const s = stats();
  const pct = (a, b) => Math.min(100, Math.round(a / b * 100));
  $('gStats').innerHTML = `
    <div class="gstat"><span class="gstat-n mono">${s.recorded}<small>/${BANK_TARGET}</small></span><span class="gstat-l">Recorded for the January bank</span><span class="gbar"><span style="width:${pct(s.recorded, BANK_TARGET)}%"></span></span></div>
    <div class="gstat"><span class="gstat-n mono">${s.edited}<small>/${EDIT_TARGET}</small></span><span class="gstat-l">Edited and ready by 13 Dec</span><span class="gbar"><span style="width:${pct(s.edited, EDIT_TARGET)}%"></span></span></div>
    <div class="gstat"><span class="gstat-n mono">${s.pipeline}</span><span class="gstat-l">In the pipeline (not yet recorded)</span></div>
    <div class="gstat ${s.due ? 'is-alert' : ''}"><span class="gstat-n mono">${s.due}</span><span class="gstat-l">Next actions due today or overdue</span></div>`;
}
function cardHTML(g) {
  const due = dueState(g);
  const flags = [g.consent ? 'Consent' : '', g.photo ? 'Photo' : '', g.studioProject ? 'Studio' : ''].filter(Boolean);
  return `<li class="gcard${g.id === selId ? ' is-sel' : ''}" draggable="true" data-id="${g.id}" tabindex="0" aria-label="${esc(g.name || 'Unnamed guest')}">
    <span class="gname">${esc(g.name || 'Unnamed guest')}</span>
    ${g.company ? `<span class="gco">${esc(g.company)}${g.sector ? ' · ' + esc(g.sector) : ''}</span>` : ''}
    ${g.angle ? `<span class="gangle">${esc(g.angle)}</span>` : ''}
    ${g.nextAction ? `<span class="gnext ${due}"><span class="mono">${g.nextDate ? fmtDate(g.nextDate) : 'Next'}</span> ${esc(g.nextAction)}</span>` : ''}
    ${flags.length ? `<span class="gflags">${flags.map((f) => `<span class="tag">${f}</span>`).join('')}</span>` : ''}
  </li>`;
}
function renderBoard() {
  const cols = STAGES.map((st) => {
    const list = guests.filter((g) => g.stage === st.id && matches(g)).sort((a, b) => (a.nextDate || '9999') .localeCompare(b.nextDate || '9999'));
    return `<section class="gcol${st.id === 'parked' ? ' is-parked' : ''}" data-stage="${st.id}" aria-label="${st.name}">
      <header class="gcol-head"><span>${st.name}</span><span class="mono gcount">${list.length}</span></header>
      <p class="gcol-hint">${st.hint}</p>
      <ol class="gcards">${list.map(cardHTML).join('')}</ol>
      <button class="gadd" type="button" data-add="${st.id}">+ Add</button>
    </section>`;
  }).join('');
  $('gBoard').innerHTML = cols;
}
function renderList() {
  const list = guests.filter(matches).sort((a, b) => STAGE_IX[a.stage] - STAGE_IX[b.stage] || (a.nextDate || '9999').localeCompare(b.nextDate || '9999'));
  $('gList').innerHTML = `<table class="gtable"><thead><tr><th>Name</th><th>Company</th><th>Stage</th><th>Next action</th><th>Due</th><th>Recording</th><th>Consent</th><th>Photo</th></tr></thead><tbody>
    ${list.map((g) => `<tr data-id="${g.id}" class="${g.id === selId ? 'is-sel' : ''}" tabindex="0"><td>${esc(g.name || 'Unnamed guest')}</td><td>${esc(g.company)}</td><td>${STAGES[STAGE_IX[g.stage]]?.name || ''}</td><td>${esc(g.nextAction)}</td><td class="mono ${dueState(g)}">${fmtDate(g.nextDate)}</td><td class="mono">${fmtDate(g.recordingDate)}</td><td>${g.consent ? '✓' : ''}</td><td>${g.photo ? '✓' : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No guests match.</td></tr>'}
  </tbody></table>`;
}
async function renderDetail() {
  const g = guests.find((x) => x.id === selId);
  const box = $('gDetail');
  box.hidden = !g;
  if (!g) return;
  const projects = await ctx.listStudioProjects();
  const f = (id, label, val, type = 'text', extra = '') => `<label class="gf"><span>${label}</span><input id="gf-${id}" data-f="${id}" type="${type}" value="${esc(val)}" ${extra}></label>`;
  const ta = (id, label, val, rows = 3, ph = '') => `<label class="gf"><span>${label}</span><textarea data-f="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;
  box.innerHTML = `
    <div class="gd-head">
      <input class="gd-name" data-f="name" type="text" value="${esc(g.name)}" placeholder="Founder's name" aria-label="Name">
      <button class="x-btn" type="button" data-close aria-label="Close">×</button>
    </div>
    <label class="gf"><span>Stage</span><select data-f="stage">${STAGES.map((s) => `<option value="${s.id}" ${s.id === g.stage ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
    <div class="gd-grid">
      ${f('company', 'Company', g.company)}
      ${f('role', 'Role', g.role)}
      ${f('sector', 'Sector', g.sector, 'text', 'placeholder="e.g. Agri-food"')}
      ${f('founded', 'Started', g.founded, 'text', 'placeholder="Year"')}
      ${f('location', 'Location', g.location)}
      ${f('source', 'How we found them', g.source, 'text', 'placeholder="Referral, event…"')}
    </div>
    <fieldset class="gd-sec"><legend>Next action</legend>
      <div class="gd-grid">
        ${f('nextAction', 'What', g.nextAction, 'text', 'placeholder="e.g. Send discovery questions"')}
        ${f('nextDate', 'By', g.nextDate, 'date')}
      </div>
    </fieldset>
    <fieldset class="gd-sec"><legend>The story</legend>
      ${ta('angle', 'Episode angle: the decision at the heart of it', g.angle, 2, 'e.g. Understanding customers before scaling')}
      <div class="gd-grid">${f('discoveryDate', 'Discovery session', g.discoveryDate, 'date')}${f('recordingDate', 'Recording date', g.recordingDate, 'date')}</div>
      <label class="gf"><span>Format</span><select data-f="format">${['In person', 'Remote', 'Phone'].map((o) => `<option ${o === g.format ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      ${ta('discoveryNotes', 'Discovery notes', g.discoveryNotes, 5, 'What they believed, what happened, what they decided, why, what they would do differently…')}
    </fieldset>
    <fieldset class="gd-sec"><legend>Before release</legend>
      <label class="check"><input type="checkbox" data-f="consent" ${g.consent ? 'checked' : ''}> Release / consent agreed</label>
      <label class="check"><input type="checkbox" data-f="photo" ${g.photo ? 'checked' : ''}> Photo received</label>
      <label class="check"><input type="checkbox" data-f="bio" ${g.bio ? 'checked' : ''}> Bio and links confirmed</label>
      <label class="gf"><span>Studio project</span><select data-f="studioProject"><option value="">Not linked</option>${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === g.studioProject ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
      <div class="btn-row">${g.studioProject ? '<button class="btn small" type="button" data-open-studio>Open in Studio</button>' : ''}<button class="btn small ghost" type="button" data-plan-ep>Plan an episode</button></div>
    </fieldset>
    <fieldset class="gd-sec"><legend>Contact</legend>
      <div class="gd-grid">${f('phone', 'Phone / WhatsApp', g.phone, 'tel')}${f('email', 'Email', g.email, 'email')}</div>
      ${f('social', 'Social / website', g.social, 'text', 'placeholder="Instagram, LinkedIn or site"')}
    </fieldset>
    ${ta('notes', 'Notes', g.notes, 4)}
    <div class="gd-foot">
      <span class="hint mono">Added ${new Date(g.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <button class="btn small ghost danger" type="button" data-del>Delete</button>
    </div>`;
}
function renderAll() {
  renderStats();
  $('gBoard').hidden = view !== 'board';
  $('gList').hidden = view !== 'list';
  document.querySelectorAll('[data-gview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gview === view)));
  if (view === 'board') renderBoard(); else renderList();
  show($('gEmpty'), guests.length === 0);
}
const show = (el, on) => { el.hidden = !on; };

// ---------------- actions ----------------
async function select(id) {
  selId = id; renderAll(); await renderDetail();
  if (window.innerWidth <= 900) $('gDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function addGuest(stage = 'prospect') {
  const g = blank(stage);
  guests.push(g); save(); select(g.id);
  setTimeout(() => document.querySelector('#gDetail .gd-name')?.focus(), 30);
}
function updateField(field, value) {
  const g = guests.find((x) => x.id === selId);
  if (!g) return;
  g[field] = value; g.updatedAt = Date.now();
  // moving to a later stage fills in the obvious next step if none is set
  save();
  if (['stage', 'name', 'company', 'angle', 'nextAction', 'nextDate', 'consent', 'photo', 'studioProject', 'sector'].includes(field)) renderAll();
  if (field === 'studioProject' || field === 'stage') renderDetail();
}
function moveTo(id, stage) {
  const g = guests.find((x) => x.id === id);
  if (!g || g.stage === stage) return;
  g.stage = stage; g.updatedAt = Date.now();
  if (stage === 'recorded' && !g.recordingDate) g.recordingDate = today();
  save(); renderAll(); if (selId === id) renderDetail();
}
function exportCSV() {
  const cols = ['name', 'company', 'role', 'sector', 'founded', 'location', 'stage', 'nextAction', 'nextDate', 'angle', 'discoveryDate', 'recordingDate', 'format', 'consent', 'photo', 'bio', 'phone', 'email', 'social', 'source', 'notes'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...guests.map((g) => cols.map((c) => q(c === 'stage' ? STAGES[STAGE_IX[g.stage]]?.name : g[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `wdgta-guests-${today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
// ---------------- import (.json from WDGTA, or .csv with a header row) ----------------
const FIELD_KEYS = Object.keys(blank());
const HEADER_ALIASES = {
  'founder name': 'name', 'founder': 'name', 'guest': 'name', 'venture': 'company', 'business': 'company',
  'topic': 'angle', 'episode angle': 'angle', 'next steps': 'nextAction', 'next step': 'nextAction', 'next action': 'nextAction',
  'due': 'nextDate', 'by': 'nextDate', 'discovery date': 'discoveryDate', 'scheduled date': 'discoveryDate',
  'recording date': 'recordingDate', 'whatsapp': 'phone', 'website': 'social', 'how we found them': 'source',
};
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}
function toISODate(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(String(v).replace(/^[A-Za-z]+,\s*/, ''));
  return Number.isNaN(t) ? '' : new Date(t + 12 * 36e5).toISOString().slice(0, 10);
}
function stageFrom(v) {
  const x = String(v || '').trim().toLowerCase();
  const hit = STAGES.find((s) => s.id === x || s.name.toLowerCase() === x);
  return hit ? hit.id : '';
}
function clean(raw) {
  const g = blank();
  for (const [k, v] of Object.entries(raw || {})) {
    const key = FIELD_KEYS.includes(k) ? k : HEADER_ALIASES[String(k).trim().toLowerCase()] || FIELD_KEYS.find((f) => f.toLowerCase() === String(k).trim().toLowerCase());
    if (!key || key === 'id' || v == null || v === '') continue;
    if (['consent', 'photo', 'bio'].includes(key)) g[key] = v === true || /^(true|yes|y|✓|1)$/i.test(String(v));
    else if (key === 'stage') g.stage = stageFrom(v) || g.stage;
    else if (/Date$/.test(key)) g[key] = toISODate(v);
    else if (key === 'createdAt' || key === 'updatedAt') g[key] = Number(v) || g[key];
    else g[key] = String(v).trim();
  }
  if (raw && raw.replaces) g.replaces = String(raw.replaces);
  return g;
}
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
async function importFile(file) {
  const text = await file.text();
  let items = [];
  if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(text)) {
    const data = JSON.parse(text);
    items = Array.isArray(data) ? data : data.guests || [];
  } else {
    const [head, ...rows] = parseCSV(text);
    items = rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  let added = 0, updated = 0;
  for (const raw of items) {
    const g = clean(raw);
    if (!g.name) continue;
    const match = guests.find((x) => norm(x.name) === norm(g.name) && (!x.company || !g.company || norm(x.company) === norm(g.company)))
      || (g.replaces && guests.find((x) => norm(x.name) === norm(g.replaces)));
    delete g.replaces;
    if (match) {
      // fill in what the board doesn't have yet; never overwrite your own edits
      for (const k of FIELD_KEYS) {
        if (['id', 'createdAt', 'updatedAt'].includes(k)) continue;
        const empty = match[k] === '' || match[k] === false || match[k] == null || (k === 'name' && /^Founder \d+$/.test(match.name));
        if (k === 'stage') { if (STAGE_IX[g.stage] > STAGE_IX[match.stage] && match.stage !== 'parked') match.stage = g.stage; continue; }
        if (k === 'nextAction' && /^(Confirm who fills this recording slot)$/.test(match.nextAction) && g.nextAction) { match.nextAction = g.nextAction; continue; }
        if (empty && g[k] !== '' && g[k] !== false) match[k] = g[k];
      }
      match.updatedAt = Date.now(); updated++;
    } else { guests.push(g); added++; }
  }
  save(); renderAll(); renderDetail();
  ctx.notice(`Imported ${added} new guest${added === 1 ? '' : 's'}${updated ? ` and filled in ${updated} already on the board` : ''}.`);
}

function seedFromPlan() {
  // Matches the pre-launch production plan: founders are "Founder 1–6" until names are confirmed.
  const f1 = blank('recorded');
  Object.assign(f1, {
    name: 'Founder 1', angle: 'Understanding customers before building or scaling',
    discoveryNotes: 'Session plan spine: customer understanding before building/scaling. Supporting case: farmer sourcing. Secondary: "pitchpreneur" / grant dependence. Whiteboard Moment: "55 minutes understanding the problem, 5 building".',
    nextAction: 'Finish the audio edit',
  });
  const rest = [2, 3, 4, 5, 6].map((n) => Object.assign(blank('prospect'), { name: `Founder ${n}`, nextAction: 'Confirm who fills this recording slot' }));
  guests.push(f1, ...rest); save(); renderAll();
  ctx.notice('Added Founder 1–6 from the production plan. Rename them as you confirm each guest.');
}

// ---------------- wiring ----------------
let bound = false;
let loaded = false;
export async function initGuests(c) {
  ctx = { ...ctx, ...c };
  if (!loaded) { await load(); loaded = true; }
  if (!bound) bind();
  renderAll(); renderDetail();
}
function bind() {
  bound = true;
  $('gAdd').onclick = () => addGuest();
  $('gSeed').onclick = seedFromPlan;
  $('gCsv').onclick = exportCSV;
  $('gImport').onclick = () => $('gImportFile').click();
  $('gImportFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { await importFile(f); } catch (err) { ctx.notice(`Could not import that file: ${err.message || err}`); }
  };
  $('gSearch').oninput = (e) => { query = e.target.value.trim(); renderAll(); };
  document.querySelectorAll('[data-gview]').forEach((b) => b.onclick = () => { view = b.dataset.gview; renderAll(); });
  const main = $('guestsView');
  main.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'); if (add) { addGuest(add.dataset.add); return; }
    const card = e.target.closest('.gcard, .gtable tr[data-id]'); if (card) { select(card.dataset.id); return; }
  });
  main.addEventListener('keydown', (e) => {
    const card = e.target.closest('.gcard, .gtable tr[data-id]');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(card.dataset.id); }
  });
  // drag cards between stages
  main.addEventListener('dragstart', (e) => { const c = e.target.closest('.gcard'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('is-drag'); });
  main.addEventListener('dragend', (e) => { e.target.closest('.gcard')?.classList.remove('is-drag'); document.querySelectorAll('.gcol.is-over').forEach((c) => c.classList.remove('is-over')); });
  main.addEventListener('dragover', (e) => { const col = e.target.closest('.gcol'); if (!col) return; e.preventDefault(); document.querySelectorAll('.gcol.is-over').forEach((c) => c !== col && c.classList.remove('is-over')); col.classList.add('is-over'); });
  main.addEventListener('drop', (e) => { const col = e.target.closest('.gcol'); if (!col) return; e.preventDefault(); col.classList.remove('is-over'); moveTo(e.dataTransfer.getData('text/plain'), col.dataset.stage); });
  // detail form
  const d = $('gDetail');
  d.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]'); if (!el) return;
    updateField(el.dataset.f, el.type === 'checkbox' ? el.checked : el.value);
  });
  d.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-f], input[type=date][data-f]'); if (!el) return;
    updateField(el.dataset.f, el.value);
  });
  d.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { selId = null; renderAll(); renderDetail(); return; }
    if (e.target.closest('[data-plan-ep]')) { await flush(); ctx.planEpisode?.(selId); return; }
    if (e.target.closest('[data-open-studio]')) { const g = guests.find((x) => x.id === selId); if (g?.studioProject) ctx.openStudioProject(g.studioProject); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Confirm delete'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Delete'; }, 3000); return; }
      guests = guests.filter((x) => x.id !== selId); selId = null; save(); renderAll(); renderDetail();
    }
  });
}
/** Guests for other modules (Episodes, Calendar). Loads them if Guests hasn't been opened yet. */
export async function guestsData(c = {}) {
  ctx = { ...ctx, ...c };
  if (!loaded) { await load(); loaded = true; }
  return guests;
}
/** Move a guest forward to a later stage (never backwards); used when an episode progresses. */
export function bumpGuest(id, stage) {
  const g = guests.find((x) => x.id === id);
  if (!g || g.stage === 'parked' || !(stage in STAGE_IX) || STAGE_IX[stage] <= STAGE_IX[g.stage]) return false;
  g.stage = stage; g.updatedAt = Date.now();
  if (stage === 'recorded' && !g.recordingDate) g.recordingDate = today();
  save(); if (bound) renderAll();
  return true;
}
/** Change fields of a guest from another module (e.g. a date dragged on the Calendar). */
export function updateGuest(id, patch) {
  const g = guests.find((x) => x.id === id);
  if (!g) return false;
  Object.assign(g, patch, { updatedAt: Date.now() });
  save(); if (bound) renderAll();
  return true;
}
export async function focusGuest(id) { if (guests.some((g) => g.id === id)) await select(id); }
export async function refreshGuests() { renderAll(); await renderDetail(); }
export function flushGuests() { if (saveTimer) return flush(); }
