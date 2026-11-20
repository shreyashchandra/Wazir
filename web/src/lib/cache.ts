// Small persistent cache on top of IndexedDB. Every call is wrapped so the app
// keeps working (memory-only) in private windows or when storage is blocked.
import { createStore, get, set, del, keys } from "idb-keyval";

type Entry<T> = { v: T; t: number; ttl: number | null };

const memory = new Map<string, Entry<unknown>>();
let store: ReturnType<typeof createStore> | null = null;
try {
  store = createStore("wazir", "cache");
} catch {
  store = null;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  let entry = memory.get(key) as Entry<T> | undefined;
  if (!entry && store) {
    try {
      entry = (await get(key, store)) as Entry<T> | undefined;
      if (entry) memory.set(key, entry);
    } catch {
      /* storage unavailable */
    }
  }
  if (!entry) return undefined;
  if (entry.ttl !== null && Date.now() - entry.t > entry.ttl) return undefined;
  return entry.v;
}

/** ttlMs = null means "never expires" (used for completed months and analyses). */
export async function cacheSet<T>(key: string, value: T, ttlMs: number | null): Promise<void> {
  const entry: Entry<T> = { v: value, t: Date.now(), ttl: ttlMs };
  memory.set(key, entry);
  if (!store) return;
  try {
    await set(key, entry, store);
  } catch {
    /* quota or blocked: memory copy still works for this session */
  }
}

export async function cacheDelete(key: string): Promise<void> {
  memory.delete(key);
  if (!store) return;
  try {
    await del(key, store);
  } catch {
    /* ignore */
  }
}

export async function cacheKeys(prefix: string): Promise<string[]> {
  const found = new Set([...memory.keys()].filter((k) => k.startsWith(prefix)));
  if (store) {
    try {
      for (const k of await keys(store)) if (String(k).startsWith(prefix)) found.add(String(k));
    } catch {
      /* ignore */
    }
  }
  return [...found];
}
