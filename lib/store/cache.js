// The signed-in person's copy of their issues in this browser (IndexedDB), used for the quick reload in
// lib/store/supabase.js. One entry per person; everything is wiped on sign-out, so a shared PC keeps
// nothing after the person logs out. Any storage error just means a full download instead.
const DB = 'brembo-cache';
const STORE = 'tasks';
const VERSION = 1; // bump when the cached row shape changes; old entries are then ignored

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readCache(userId) {
  try {
    const entry = await run('readonly', (s) => s.get(userId));
    return entry && entry.v === VERSION && Array.isArray(entry.rows) ? entry.rows : null;
  } catch {
    return null;
  }
}

export async function writeCache(userId, rows) {
  try {
    await run('readwrite', (s) => s.put({ v: VERSION, rows, savedAt: Date.now() }, userId));
  } catch { /* full download next time */ }
}

export async function clearCache() {
  try {
    await run('readwrite', (s) => s.clear());
  } catch { /* nothing kept */ }
}
