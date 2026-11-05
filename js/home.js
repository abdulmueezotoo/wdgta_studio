// WDGTA OS — Home. The screen the app opens on: today's briefing, the road to launch,
// the January bank and doors into each module. Everything is read live from the other modules.

import { guestsData } from './guests.js';
import { episodesData, MILESTONES, sundays, CAPSULE_FROM, CAPSULE_TO, episodeLabel } from './episodes.js';
import { calendarItems } from './calendar.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(s + 'T12:00:00');
const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const short = (s) => parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase();
const EP1 = MILESTONES.find((m) => /Episode 1/.test(m.label))?.date || '2027-01-03';
const READY = MILESTONES.find((m) => /Readiness/.test(m.label))?.date || '2026-12-13';
const LAUNCH = MILESTONES.find((m) => /launch/i.test(m.label))?.date || '2027-01-10';
const RECORDED = ['recorded', 'editing', 'ready', 'published'];
const EP_IX = ['planned', 'recorded', 'editing', 'review', 'ready', 'scheduled', 'published'];

export async function renderHome(ctx) {
  const c = { getDir: ctx.getDir, notice: ctx.notice };
  const [guests, eps, items, projects] = await Promise.all([guestsData(c), episodesData(c), calendarItems(c), ctx.listStudioProjects()]);
  const now = new Date(); const t = iso(now);

  // ---------- briefing ----------
  const h = now.getHours();
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = (ctx.hostName || '').trim().split(/\s+/).slice(0, -1).join(' ') || (ctx.hostName || '').trim();
  $('hDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  $('hHello').innerHTML = `${hello}${name ? ',<br>' + esc(name) + '.' : '.'}`;

  const founderEps = eps.filter((e) => e.type === 'Episode');
  const recordedG = guests.filter((g) => RECORDED.includes(g.stage)).length;
  const recordedE = founderEps.filter((e) => EP_IX.indexOf(e.stage) >= 1).length;
  const recorded = Math.max(recordedG, recordedE);
  const edited = founderEps.filter((e) => EP_IX.indexOf(e.stage) >= EP_IX.indexOf('ready')).length;
  const toEp1 = days(t, EP1);
  const lead = toEp1 > 0 ? `<b>${toEp1} day${toEp1 === 1 ? '' : 's'}</b> to Episode 1.` : toEp1 === 0 ? '<b>Episode 1 is out today.</b>' : 'Episode 1 is out.';
  const bankLine = t <= READY
    ? ` ${recorded ? `${recorded} founder conversation${recorded === 1 ? ' is' : 's are'} recorded` : 'No founder conversations recorded yet'}; the 13 Dec check needs four edited${edited ? ` (${edited} so far)` : ''}.`
    : ` ${edited} founder episode${edited === 1 ? '' : 's'} edited and ready.`;
  $('hLead').innerHTML = lead + esc(bankLine).replace(/^ /, ' ');

  // ---------- next up ----------
  const need = items.filter((i) => i.warn && i.date < t && !i.slot);
  const soon = items.filter((i) => i.date >= t && i.date <= iso(new Date(now.getTime() + 7 * 864e5)) && i.kind !== 'milestone');
  const toBook = guests.filter((g) => g.stage === 'discovery').length;
  const rows = [...need, ...soon].slice(0, 5).map((i) => {
    const when = i.date < t ? short(i.date) : i.date === t ? 'TODAY' : `${parse(i.date).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${parse(i.date).getDate()}`;
    const what = i.kind === 'action' ? `${i.sub}: ${i.title.charAt(0).toLowerCase()}${i.title.slice(1)}` : i.slot ? 'Capsule slot is open' : i.kind === 'release' || i.kind === 'capsule' ? `${i.sub.split(' · ')[0]} releases${i.title && i.title !== 'Untitled' ? ': ' + i.title : ''}` : `${i.title}${i.sub ? ' · ' + i.sub : ''}`;
    const href = i.src === 'guest' ? '#guests' : i.src === 'episode' ? '#episodes' : '#calendar';
    return `<a class="h-next" href="${href}"><span class="mono ${i.warn ? 'is-warn' : i.date === t ? 'is-now' : ''}">${esc(when)}</span><span>${esc(what)}${i.warn ? ` <b>· ${esc(i.warn)}</b>` : ''}</span></a>`;
  });
  if (toBook) rows.push(`<a class="h-next" href="#guests"><span class="mono">BOOK</span><span>${toBook} founder${toBook === 1 ? '' : 's'} after discovery, waiting for a recording date</span></a>`);
  $('hNext').innerHTML = rows.join('') || '<p class="hint">Nothing due in the next seven days. Add “By” dates in Guests and release dates in Episodes to see them here.</p>';

  // ---------- road to launch ----------
  const caps = new Map(eps.filter((e) => e.type === 'Capsule' && e.releaseDate).map((e) => [e.releaseDate, e]));
  const pts = sundays(CAPSULE_FROM, CAPSULE_TO).map((d) => {
    const e = caps.get(d);
    const state = e ? (e.stage === 'published' ? 'Published' : 'Planned') : d < t ? 'Not logged' : 'Open';
    return { date: d, label: d === READY ? 'Readiness check' : 'Capsule', note: d === READY ? `Capsule · ${state.toLowerCase()}` : state, kind: d === READY ? 'key' : 'capsule', done: e?.stage === 'published', planned: !!e };
  });
  pts.push({ date: EP1, label: 'Episode 1', kind: 'gold' }, { date: LAUNCH, label: 'Launch session', kind: 'gold' });
  if (!pts.some((p) => p.date === t) && t >= CAPSULE_FROM && t <= LAUNCH) pts.push({ date: t, label: 'Today', kind: 'today' });
  pts.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'today' ? 1 : -1));
  $('hRoad').style.setProperty('--n', pts.length);
  $('hRoad').innerHTML = pts.map((p) => {
    const cls = ['road-pt', `is-${p.kind}`, p.date < t && p.kind !== 'today' ? 'is-past' : '', p.done ? 'is-done' : '', p.planned ? 'is-planned' : '', p.date === t ? 'is-now' : ''].filter(Boolean).join(' ');
    const head = p.kind === 'today' ? 'TODAY' : short(p.date);
    const sub = p.kind === 'today' ? short(p.date).replace(/ /, ' ') : p.note || '';
    return `<li class="${cls}"><span class="mono road-d">${esc(head)}</span><span class="road-l">${esc(p.kind === 'today' ? sub : p.label)}</span>${p.kind !== 'today' && sub ? `<span class="road-s">${esc(sub)}</span>` : ''}</li>`;
  }).join('');

  // ---------- bank ----------
  const capsLogged = eps.filter((e) => e.type === 'Capsule' && e.stage === 'published' && e.releaseDate >= CAPSULE_FROM && e.releaseDate <= CAPSULE_TO).length;
  const capsTotal = sundays(CAPSULE_FROM, CAPSULE_TO).length;
  const meter = (n, of, label) => `<div class="h-meter"><span class="mono h-num">${n}<small>/${of}</small></span><span class="h-ml">${label}</span><span class="gbar"><span style="width:${Math.max(n ? 0 : 2, Math.min(100, Math.round(n / of * 100)))}%"></span></span></div>`;
  $('hBank').innerHTML = meter(recorded, 6, 'Founder episodes recorded') + meter(edited, 4, 'Edited by the 13 Dec check') + meter(capsLogged, capsTotal, 'Capsule Sundays published');

  // ---------- doors ----------
  const after = guests.filter((g) => ['discovery', 'booked', ...RECORDED].includes(g.stage)).length;
  const nextRel = eps.filter((e) => e.releaseDate && e.releaseDate >= t && e.stage !== 'published').sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))[0];
  const nextItem = items.find((i) => i.date >= t && i.kind !== 'milestone');
  const lastProj = projects[0];
  const door = (n, href, title, line) => `<a class="h-door" href="${href}"><span class="mono h-dn">${n}</span><span class="h-dt">${title}</span><span class="h-dl">${esc(line)}</span></a>`;
  $('hDoors').innerHTML = [
    door('01', '#studio', 'Studio', lastProj ? `Last project: ${lastProj.title}` : 'Captioned videos, clips and carousels from a recording.'),
    door('02', '#guests', 'Guests', guests.length ? `${guests.length} founder${guests.length === 1 ? '' : 's'} · ${after} after discovery · ${recordedG} recorded` : 'Add the founders you are talking to.'),
    door('03', '#episodes', 'Episodes', nextRel ? `Next release: ${episodeLabel(nextRel)}, ${parse(nextRel.releaseDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : eps.length ? `${eps.length} on the board` : 'Plan episodes and Capsules.'),
    door('04', '#calendar', 'Calendar', nextItem ? `Next: ${nextItem.slot ? 'Capsule Sunday' : nextItem.title}, ${parse(nextItem.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Every date in one place.'),
  ].join('');
}
