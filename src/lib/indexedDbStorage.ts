/**
 * Account-scoped IndexedDB persistence for WyBuild's local workspace data.
 *
 * Hardening over a naive open-per-call wrapper:
 *  - one shared connection, transparently reopened after `close`/`versionchange`/InvalidStateError
 *  - writes are serialized per key and coalesced (the newest value always wins, never an older one finishing last)
 *  - every write also lands in a `backup` store inside the SAME transaction, so a missing/corrupt primary
 *    record can be recovered from the last good copy
 *  - structured-clone failures fall back to a JSON round-trip instead of losing the save
 *  - quota errors are reported with a dedicated error type so the UI can say what happened
 *  - if IndexedDB is unavailable (some private modes / locked-down WebViews) data is kept in memory and
 *    mirrored to localStorage when small enough, so the app keeps working
 *  - best-effort persistent storage request so the browser does not evict the data under pressure
 *  - cross-tab change notifications through BroadcastChannel
 */
const DB_NAME = 'wybuild-local';
const DB_VERSION = 2;
const STORE_NAME = 'workspace';
const BACKUP_STORE = 'backup';
const FALLBACK_PREFIX = 'wybuild:idb-fallback:';
const FALLBACK_MAX_CHARS = 400_000;
const CHANNEL_NAME = 'wybuild-local-storage';

export class StorageQuotaError extends Error {
  constructor(message = 'This device is out of storage space for WyBuild workspace data.') { super(message); this.name = 'StorageQuotaError'; }
}
export class StorageUnavailableError extends Error {
  constructor(message = 'IndexedDB is not available in this browser.') { super(message); this.name = 'StorageUnavailableError'; }
}

const isQuota = (e: unknown) => {
  const err = e as { name?: string; code?: number } | null;
  return !!err && (err.name === 'QuotaExceededError' || err.code === 22 || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
};
const asError = (e: unknown, fallback: string) => (e instanceof Error ? e : new Error((e as { message?: string } | null)?.message || fallback));

/* ------------------------------ connection ------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;
let idbBroken = false;

function openDb(): Promise<IDBDatabase> {
  if (idbBroken || typeof indexedDB === 'undefined' || !indexedDB) return Promise.reject(new StorageUnavailableError());
  if (dbPromise) return dbPromise;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(asError(e, 'Could not open local workspace storage.')); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab/app version wants to upgrade: release the connection so it is not blocked, reopen lazily.
      db.onversionchange = () => { db.close(); if (dbPromise === attempt) dbPromise = null; };
      db.onclose = () => { if (dbPromise === attempt) dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Could not open local workspace storage.'));
    request.onblocked = () => reject(new Error('Workspace storage upgrade is blocked by another open WyBuild tab. Close other WyBuild tabs and retry.'));
  });
  dbPromise = attempt;
  attempt.catch(() => { if (dbPromise === attempt) dbPromise = null; });
  return attempt;
}

/** Runs `fn` with a live connection; reopens once if the connection was closed underneath us. */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let db: IDBDatabase;
    try { db = await openDb(); } catch (e) { lastError = e; if (e instanceof StorageUnavailableError) throw e; continue; }
    try { return await fn(db); } catch (e) {
      lastError = e;
      const name = (e as { name?: string } | null)?.name;
      if (name === 'InvalidStateError' || name === 'TransactionInactiveError') { dbPromise = null; try { db.close(); } catch { /* already closed */ } continue; }
      throw e;
    }
  }
  throw asError(lastError, 'Local workspace storage is unavailable.');
}

/* ------------------------------ fallback store ------------------------------ */

const memory = new Map<string, unknown>();
function fallbackRead<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(FALLBACK_PREFIX + key);
    if (raw) { const v = JSON.parse(raw) as T; memory.set(key, v); return v; }
  } catch { /* storage blocked or corrupt */ }
  return undefined;
}
function fallbackWrite(key: string, value: unknown) {
  memory.set(key, value);
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= FALLBACK_MAX_CHARS) localStorage.setItem(FALLBACK_PREFIX + key, raw);
  } catch { /* in-memory copy still works for this session */ }
}
function fallbackDelete(key: string) {
  memory.delete(key);
  try { localStorage.removeItem(FALLBACK_PREFIX + key); } catch { /* ignore */ }
}

/* ------------------------------ cross-tab ------------------------------ */

type Listener = (key: string) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
function getChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => { const key = (e.data as { key?: string } | null)?.key; if (key) listeners.forEach((l) => { try { l(key); } catch { /* listener errors are isolated */ } }); };
  } catch { channel = null; }
  return channel;
}
const announce = (key: string) => { try { getChannel()?.postMessage({ key }); } catch { /* best effort */ } };
/** Be told when ANOTHER tab/window changes a key. Returns an unsubscribe function. */
export function onIdbChange(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/* ------------------------------ read ------------------------------ */

function getFrom<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error || new Error('Could not read local workspace data.'));
    tx.onabort = () => reject(tx.error || new Error('Workspace read was aborted.'));
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  // A write for this key may still be queued; the freshest in-flight value is the truth.
  if (pending.has(key)) return pending.get(key)!.value as T | undefined;
  try {
    return await withDb(async (db) => {
      const primary = await getFrom<T>(db, STORE_NAME, key).catch(() => undefined);
      if (primary !== undefined) return primary;
      // Primary missing/unreadable: recover the last good copy written in the same transaction as the primary.
      return getFrom<T>(db, BACKUP_STORE, key).catch(() => undefined);
    });
  } catch (e) {
    if (e instanceof StorageUnavailableError) { idbBroken = true; return fallbackRead<T>(key); }
    throw e;
  }
}

/* ------------------------------ write (serialized + coalesced) ------------------------------ */

type Waiter = { resolve: () => void; reject: (e: unknown) => void };
type Pending = { value: unknown; deleted: boolean; waiters: Waiter[] };
const pending = new Map<string, Pending>();
const running = new Set<string>();

function toCloneable(value: unknown): unknown {
  try { structuredClone(value); return value; } catch { /* functions, symbols, proxies... */ }
  return JSON.parse(JSON.stringify(value ?? null));
}

function putBoth(db: IDBDatabase, key: string, value: unknown, deleted: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE_NAME, BACKUP_STORE], 'readwrite', { durability: 'strict' } as IDBTransactionOptions);
    } catch {
      tx = db.transaction([STORE_NAME, BACKUP_STORE], 'readwrite');
    }
    const primary = tx.objectStore(STORE_NAME);
    const backup = tx.objectStore(BACKUP_STORE);
    if (deleted) { primary.delete(key); backup.delete(key); } else { primary.put(value, key); backup.put(value, key); }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save local workspace data.'));
    tx.onabort = () => reject(tx.error || new Error('Workspace save was aborted.'));
  });
}

async function drain(key: string) {
  if (running.has(key)) return;
  running.add(key);
  try {
    // Loop: values queued while a transaction is in flight are written next, oldest never overwrites newest.
    while (pending.has(key)) {
      const job = pending.get(key)!;
      pending.delete(key);
      try {
        const value = job.deleted ? undefined : toCloneable(job.value);
        try {
          await withDb((db) => putBoth(db, key, value, job.deleted));
          if (job.deleted) fallbackDelete(key);
        } catch (e) {
          if (e instanceof StorageUnavailableError) { idbBroken = true; job.deleted ? fallbackDelete(key) : fallbackWrite(key, value); }
          else throw e;
        }
        announce(key);
        job.waiters.forEach((w) => w.resolve());
      } catch (e) {
        const err = isQuota(e) ? new StorageQuotaError() : asError(e, 'Could not save local workspace data.');
        job.waiters.forEach((w) => w.reject(err));
      }
    }
  } finally { running.delete(key); }
}

function enqueue(key: string, value: unknown, deleted: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const existing = pending.get(key);
    if (existing) { existing.value = value; existing.deleted = deleted; existing.waiters.push({ resolve, reject }); }
    else pending.set(key, { value, deleted, waiters: [{ resolve, reject }] });
    void drain(key);
  });
}

export function idbSet(key: string, value: unknown): Promise<void> { return enqueue(key, value, false); }
export function idbDelete(key: string): Promise<void> { return enqueue(key, undefined, true); }

/** Resolves once every queued write has reached disk. Useful before sign-out or reload. */
export async function idbFlush(): Promise<void> {
  while (pending.size || running.size) await new Promise((r) => setTimeout(r, 15));
}

/* ------------------------------ housekeeping ------------------------------ */

/** Asks the browser not to evict WyBuild's data under storage pressure. Safe to call repeatedly. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage || 0, quota: e.quota || 0 } : null;
  } catch { return null; }
}

export function idbMode(): 'indexeddb' | 'fallback' { return idbBroken ? 'fallback' : 'indexeddb'; }

// Flush as the page is hidden/closed. Writes are already started immediately; this nudges the queue on mobile WebViews.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void idbFlush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void idbFlush(); });
}
