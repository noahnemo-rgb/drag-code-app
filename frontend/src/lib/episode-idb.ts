// Keystroke-level auto-save for Episode Mode. On web we use IndexedDB (per
// the spec); on native we degrade to AsyncStorage with the same API surface.
// Every write is enqueued so the UI thread never blocks.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const DB_NAME = "syntax-episode";
const DB_VERSION = 1;
const STORE_LATEST = "latest";       // key = fileId, value = { content, ts }
const STORE_LOG = "keystrokes";       // auto-inc log — bounded retention
const LOG_RETENTION = 500;             // keep last 500 keystrokes

export type LatestSnapshot = { fileId: string; content: string; ts: number };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (Platform.OS !== "web") return Promise.reject(new Error("IDB is web-only"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = (globalThis as { indexedDB?: IDBFactory }).indexedDB!.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LATEST)) db.createObjectStore(STORE_LATEST, { keyPath: "fileId" });
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        const s = db.createObjectStore(STORE_LOG, { keyPath: "id", autoIncrement: true });
        s.createIndex("by_ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Fire-and-forget: never awaits the write on the caller's side.
export function enqueueKeystroke(fileId: string, content: string): void {
  const ts = Date.now();
  // setTimeout(0) yields to the event loop before persisting so React updates flush first.
  setTimeout(() => {
    if (Platform.OS === "web") {
      void writeWeb(fileId, content, ts);
    } else {
      void writeNative(fileId, content, ts);
    }
  }, 0);
}

async function writeWeb(fileId: string, content: string, ts: number): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_LATEST, STORE_LOG], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_LATEST).put({ fileId, content, ts });
      tx.objectStore(STORE_LOG).add({ fileId, content, ts });
    });
    // Trim the log so it doesn't grow unbounded across long sessions.
    void trimLogWeb();
  } catch {
    // Silent — never break the editor.
  }
}

async function trimLogWeb(): Promise<void> {
  try {
    const db = await openDb();
    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_LOG, "readonly");
      const r = tx.objectStore(STORE_LOG).count();
      r.onsuccess = () => resolve(r.result as number);
      r.onerror = () => resolve(0);
    });
    if (count <= LOG_RETENTION) return;
    const toDelete = count - LOG_RETENTION;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_LOG, "readwrite");
      const s = tx.objectStore(STORE_LOG);
      const cursorReq = s.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= toDelete) return resolve();
        cursor.delete();
        removed++;
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
  } catch { /* noop */ }
}

async function writeNative(fileId: string, content: string, ts: number): Promise<void> {
  try {
    const key = `syntax.episode.latest.${fileId}`;
    await AsyncStorage.setItem(key, JSON.stringify({ fileId, content, ts }));
  } catch { /* noop */ }
}

export async function loadLatest(fileId: string): Promise<LatestSnapshot | null> {
  if (Platform.OS === "web") {
    try {
      const db = await openDb();
      return await new Promise<LatestSnapshot | null>((resolve) => {
        const tx = db.transaction(STORE_LATEST, "readonly");
        const r = tx.objectStore(STORE_LATEST).get(fileId);
        r.onsuccess = () => resolve((r.result as LatestSnapshot) ?? null);
        r.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  try {
    const raw = await AsyncStorage.getItem(`syntax.episode.latest.${fileId}`);
    return raw ? (JSON.parse(raw) as LatestSnapshot) : null;
  } catch { return null; }
}
