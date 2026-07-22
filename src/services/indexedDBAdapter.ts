import { openDB, type IDBPDatabase } from 'idb';

// ---- Types ----
export interface MetaRecord {
  version: string;
  updatedAt: number;
}

// ---- ObjectStore names ----
const DATA_STORES = [
  'products',
  'categories',
  'specs',
  'device_models',
  'storefront',
  'brand_series',
  'product_images',
] as const;

type DataStoreName = (typeof DATA_STORES)[number];
type MetaStoreName = `${DataStoreName}_meta`;

const ALL_STORES: string[] = [
  ...DATA_STORES,
  ...DATA_STORES.map(s => `${s}_meta`),
];

// ---- DB singleton ----
const DB_NAME = 'omp-cache';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of ALL_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      },
    });
  }
  return dbPromise;
}

// ---- Public API ----

async function ensureDB(): Promise<IDBPDatabase> {
  return getDB();
}

// ---- Per-record CRUD ----

export async function idbGet<T>(store: DataStoreName, id: string): Promise<T | null> {
  const db = await ensureDB();
  return (await db.get(store, id)) ?? null;
}

export async function idbGetAll<T>(store: DataStoreName): Promise<Map<string, T>> {
  const db = await ensureDB();
  const map = new Map<string, T>();
  const tx = db.transaction(store);
  let cursor = await tx.store.openCursor();
  while (cursor) {
    map.set(cursor.key, cursor.value as T);
    cursor = await cursor.continue();
  }
  return map;
}

export async function idbPut(store: DataStoreName, id: string, value: any): Promise<void> {
  const db = await ensureDB();
  await db.put(store, value, id);
}

export async function idbPutMany(store: DataStoreName, entries: [string, any][]): Promise<void> {
  const db = await ensureDB();
  const tx = db.transaction(store, 'readwrite');
  for (const [id, value] of entries) {
    tx.store.put(value, id);
  }
  await tx.done;
}

export async function idbDelete(store: DataStoreName, id: string): Promise<void> {
  const db = await ensureDB();
  await db.delete(store, id);
}

export async function idbClear(store: DataStoreName): Promise<void> {
  const db = await ensureDB();
  await db.clear(store);
}

// ---- Metadata ----

export async function idbGetMeta(store: DataStoreName): Promise<MetaRecord | null> {
  const db = await ensureDB();
  const metaStore = `${store}_meta` as MetaStoreName;
  return (await db.get(metaStore, 'version')) ?? null;
}

export async function idbSetMeta(store: DataStoreName, meta: MetaRecord): Promise<void> {
  const db = await ensureDB();
  const metaStore = `${store}_meta` as MetaStoreName;
  await db.put(metaStore, meta, 'version');
}

// ---- Atomic replace: clear + putMany + setMeta ----

export async function idbReplaceAll(
  store: DataStoreName,
  entries: [string, any][],
  meta: MetaRecord,
): Promise<void> {
  const db = await ensureDB();

  // Transaction 1: clear + insert all records
  {
    const tx = db.transaction(store, 'readwrite');
    tx.store.clear();
    for (const [id, value] of entries) {
      tx.store.put(value, id);
    }
    await tx.done;
  }

  // Transaction 2: set metadata
  {
    const metaStore = `${store}_meta` as MetaStoreName;
    const tx = db.transaction(metaStore, 'readwrite');
    tx.store.put(meta, 'version');
    await tx.done;
  }
}

// ---- Clear all data (for logout / reset) ----

export async function idbClearAll(): Promise<void> {
  const db = await ensureDB();
  for (const name of ALL_STORES) {
    await db.clear(name);
  }
}

// Re-export types for consumers
export type { DataStoreName };
