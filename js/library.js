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
