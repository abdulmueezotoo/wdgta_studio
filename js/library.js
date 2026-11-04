// WDGTA Studio — project library kept inside this browser (IndexedDB).
// Projects, their recordings and music stay on this computer; nothing is uploaded.

const DB_NAME = 'wdgta-studio';
const DB_VERSION = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('This browser cannot store projects.')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function saveProject(state) {
  if (!state.id) return;
  const rec = {
    id: state.id,
    title: state.title || state.audioName || 'Untitled project',
    updatedAt: Date.now(),
    duration: state.duration || 0,
    audioName: state.audioName || '',
    screens: state.cards.length,
    clips: state.clips.length,
    data: JSON.parse(JSON.stringify(state)),
  };
  await tx('projects', 'readwrite', (s) => s.put(rec));
}
export async function listProjects() {
  const all = await tx('projects', 'readonly', (s) => req2p(s.getAll()));
  const audioKeys = new Set(await tx('files', 'readonly', (s) => req2p(s.getAllKeys())));
  return (all || [])
    .map(({ data, ...meta }) => ({ ...meta, hasAudio: audioKeys.has(`${meta.id}:audio`), hasMusic: audioKeys.has(`${meta.id}:music`) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getProject(id) {
  const rec = await tx('projects', 'readonly', (s) => req2p(s.get(id)));
  return rec ? rec.data : null;
}
export async function deleteProject(id) {
  await tx('projects', 'readwrite', (s) => s.delete(id));
  await tx('files', 'readwrite', (s) => { s.delete(`${id}:audio`); s.delete(`${id}:music`); });
}
export async function putFile(key, file) {
  await tx('files', 'readwrite', (s) => s.put({ blob: file, name: file.name || 'file', type: file.type || '' }, key));
  // ask the browser not to clear our storage when space runs low (best effort)
  try { await navigator.storage?.persist?.(); } catch {}
}
export async function getFile(key) {
  const v = await tx('files', 'readonly', (s) => req2p(s.get(key)));
  return v ? new File([v.blob], v.name, { type: v.type || v.blob.type }) : null;
}
export async function deleteFile(key) {
  await tx('files', 'readwrite', (s) => s.delete(key));
}
export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

// ---------------- projects folder on disk (File System Access API, Chrome/Edge) ----------------
// A folder the user picks once (it can be inside Google Drive). Every project is also written there
// as a .wdgta.json file with its recording and music next to it, so nothing depends on browser storage alone.
export const folderSupported = () => 'showDirectoryPicker' in window;
export async function getDirHandle() {
  try { return await tx('files', 'readonly', (s) => req2p(s.get('__projects_dir'))); } catch { return null; }
}
export async function setDirHandle(h) {
  await tx('files', 'readwrite', (s) => (h ? s.put(h, '__projects_dir') : s.delete('__projects_dir')));
}
export async function dirPermission(h, ask = false) {
  if (!h) return 'none';
  try {
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p === 'prompt' && ask) p = await h.requestPermission({ mode: 'readwrite' });
    return p;
  } catch { return 'denied'; }
}
async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data); await w.close();
}
async function exists(dir, name) { try { await dir.getFileHandle(name); return true; } catch { return false; } }
const ext = (name) => (String(name).match(/\.[a-z0-9]{2,5}$/i) || ['.audio'])[0].toLowerCase();
const safe = (s) => String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

/** Write the project (and, once, its recording and music) into the folder. */
export async function saveToFolder(dir, state, { audio = null, music = null } = {}) {
  const base = `${safe(state.title || state.audioName)}--${state.id}`;
  // remove an older file for the same project if the title changed
  for await (const [name] of dir.entries()) {
    if (name.endsWith(`--${state.id}.wdgta.json`) && name !== `${base}.wdgta.json`) { try { await dir.removeEntry(name); } catch {} }
  }
  await writeFile(dir, `${base}.wdgta.json`, JSON.stringify({ app: 'wdgta-studio', version: 3, savedAt: new Date().toISOString(), ...state }));
  if (audio) { const n = `${state.id}--recording${ext(audio.name)}`; if (!(await exists(dir, n))) await writeFile(dir, n, audio); }
  if (music) { const n = `${state.id}--music${ext(music.name)}`; await writeFile(dir, n, music); }
}
/** Projects found in the folder: [{ id, title, savedAt, file, audioFile, musicFile }]. */
export async function scanFolder(dir) {
  const files = new Map();
  for await (const [name, h] of dir.entries()) if (h.kind === 'file') files.set(name, h);
  const out = [];
  for (const [name, h] of files) {
    if (!name.endsWith('.wdgta.json')) continue;
    try {
      const data = JSON.parse(await (await h.getFile()).text());
      if (!data || !Array.isArray(data.cards)) continue;
      const id = data.id || name;
      const audioName = [...files.keys()].find((n) => n.startsWith(`${id}--recording`));
      const musicName = [...files.keys()].find((n) => n.startsWith(`${id}--music`));
      out.push({ id, title: data.title || data.audioName || name, savedAt: Date.parse(data.savedAt) || 0, data, audioHandle: audioName ? files.get(audioName) : null, musicHandle: musicName ? files.get(musicName) : null, origAudioName: data.audioName, origMusicName: data.settings?.music?.name });
    } catch { /* not a project file */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export async function persistStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return !!(await navigator.storage?.persist?.());
  } catch { return false; }
}
