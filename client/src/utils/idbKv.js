// Chave-valor mínimo em cima do IndexedDB (estilo idb-keyval, sem
// dependência). Tudo devolve Promise e NUNCA rejeita: sem IndexedDB (aba
// anônima de alguns navegadores, cota cheia, bloqueado) vira "não tem nada"
// e o app segue normal, só sem o cache.

const DB_NAME = 'pc-cache';
const STORE = 'kv';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => {
        const db = req.result;
        // Outra aba apagou/atualizou o banco: solta a conexão.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      const req = fn(store);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const idbGet = (key) => withStore('readonly', (s) => s.get(key));
export const idbSet = (key, value) => withStore('readwrite', (s) => s.put(value, key));
export const idbDel = (key) => withStore('readwrite', (s) => s.delete(key));
export const idbKeys = async () => (await withStore('readonly', (s) => s.getAllKeys())) || [];
export const idbClear = () => withStore('readwrite', (s) => s.clear());
