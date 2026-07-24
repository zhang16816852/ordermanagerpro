import { supabase } from '@/integrations/supabase/client';
import {
  idbGetAll,
  idbReplaceAll,
  idbPut,
  idbDelete,
  idbGetMeta,
  type DataStoreName,
} from './indexedDBAdapter';
import { memoryStorage, type CacheEnvelope } from './memoryStorage';
import { versionCache } from './versionCache';

// =============================================
// Cache configuration (keys + schema versions)
// =============================================
export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const CACHE = {
  products:      { key: 'ac_products_v1',       schema: 1, versionKey: 'products',       idbStore: 'products' as DataStoreName },
  specs:         { key: 'ac_specs_v1',          schema: 1, versionKey: 'specs',           idbStore: 'specs' as DataStoreName },
  categories:    { key: 'ac_categories_v1',     schema: 1, versionKey: 'categories',      idbStore: 'categories' as DataStoreName },
  deviceModels:  { key: 'ac_device_models_v1',  schema: 1, versionKey: 'device_models',   idbStore: 'device_models' as DataStoreName },
  storefront:    { key: 'ac_storefront_v1',     schema: 1, versionKey: 'storefront_items', idbStore: 'storefront' as DataStoreName },
  productImages: { key: 'ac_product_images_v1', schema: 1, versionKey: 'product_images',  idbStore: 'product_images' as DataStoreName },
  brandSeries:   { key: 'ac_brand_series_v1',   schema: 1, versionKey: 'brand_series',    idbStore: 'brand_series' as DataStoreName },
} as const;

// Cache key → IDB store name mapping (用於 set 時自動寫入對應 store)
const KEY_TO_STORE: Record<string, DataStoreName> = {};
Object.values(CACHE).forEach(c => {
  KEY_TO_STORE[c.key] = (c as { idbStore: DataStoreName }).idbStore;
});

const LEGACY_KEYS = [
  'products_cache_v3',
  'specs_cache_v2',
  'device_models_cache_v2',
  'storefront_cache_v1',
  'dictionary_cache_v1',
];

// =============================================
// Types
// =============================================
export interface CacheGetResult<T> {
  data: T | null;
  dataVersion: string;
  exists: boolean;
}

export interface FetchResult<T> {
  data: T;
  version: string;
}

// =============================================
// CacheService (Facade)
// =============================================
export class CacheService {
  private static initPromise: Promise<void> | null = null;
  private static initialized = false;
  private static pendingWrites = 0;
  private static pendingPromises = new Map<string, Promise<any>>();
  private static loadedStores = new Set<string>();

  // ---- Init (Promise Singleton) ----
  static async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // 1. 清理 legacy localStorage keys
      for (const key of LEGACY_KEYS) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      }

      // 2. 從 Supabase 預載入版本資訊
      await versionCache.preload();

      // 3. 預載所有 IDB stores → MemoryStorage (非 fire-and-forget)
      const stores = Object.values(CACHE).map(c => c.idbStore);
      await Promise.allSettled(
        stores.map(store => this.ensureStoreLoaded(store))
      );

      this.initialized = true;
    })();

    return this.initPromise;
  }

  // ---- Lazy load: IDB → Memory ----
  private static async ensureStoreLoaded(storeName: string): Promise<void> {
    if (this.loadedStores.has(storeName)) return;

    const entries = await idbGetAll(storeName as DataStoreName);
    entries.forEach((value, key) => {
      memoryStorage.set(key, value as CacheEnvelope<any>);
    });

    const meta = await idbGetMeta(storeName as DataStoreName);
    if (meta) {
      memoryStorage.setVersion(storeName, meta.version);
    }

    this.loadedStores.add(storeName);
  }

  // ---- Sync Read ----
  static get<T>(key: string, schemaVersion: number, ttlMs?: number): CacheGetResult<T> {
    const envelope = memoryStorage.get<T>(key);
    if (!envelope) return { data: null, dataVersion: '0', exists: false };

    if (envelope.schemaVersion !== schemaVersion) {
      memoryStorage.remove(key);
      this.safeIdbDelete(key);
      return { data: null, dataVersion: '0', exists: false };
    }

    if (ttlMs !== undefined && Date.now() - envelope.cachedAt > ttlMs) {
      memoryStorage.remove(key);
      this.safeIdbDelete(key);
      return { data: null, dataVersion: '0', exists: false };
    }

    return { data: envelope.data, dataVersion: envelope.dataVersion, exists: true };
  }

  // ---- Write (Memory sync + IDB async with error handling) ----
  static set<T>(key: string, data: T, dataVersion: string, schemaVersion: number): void {
    const envelope: CacheEnvelope<T> = {
      schemaVersion,
      dataVersion,
      cachedAt: Date.now(),
      data,
    };

    // 1. Memory (sync)
    memoryStorage.set(key, envelope);

    // 2. IDB (async, 非 fire-and-forget)
    const storeName = KEY_TO_STORE[key];
    if (storeName && Array.isArray(data)) {
      this.writeRecordsToIDB(storeName, data, dataVersion);
    } else if (storeName) {
      this.writeEnvelopeToIDB(storeName, key, envelope);
    }
  }

  private static async writeRecordsToIDB(
    storeName: DataStoreName,
    data: any[],
    dataVersion: string,
  ): Promise<void> {
    this.pendingWrites++;
    try {
      const entries: [string, any][] = data.map((item: any) => [
        item.id ?? item.slug ?? JSON.stringify(item),
        item,
      ]);
      const meta = { version: dataVersion, updatedAt: Date.now() };
      await idbReplaceAll(storeName, entries, meta);
      this.loadedStores.add(storeName);
    } catch (err) {
      console.error(`[CacheService] 🔴 IDB write failed for ${storeName}:`, err);
    } finally {
      this.pendingWrites--;
    }
  }

  private static async writeEnvelopeToIDB(
    storeName: DataStoreName,
    key: string,
    envelope: any,
  ): Promise<void> {
    this.pendingWrites++;
    try {
      await idbPut(storeName, key, envelope);
    } catch (err) {
      console.error(`[CacheService] 🔴 IDB envelope write failed for ${key}:`, err);
    } finally {
      this.pendingWrites--;
    }
  }

  // ---- Remove ----
  static remove(key: string): void {
    memoryStorage.remove(key);
    this.safeIdbDelete(key);
  }

  private static async safeIdbDelete(key: string): Promise<void> {
    this.pendingWrites++;
    try {
      const storeName = KEY_TO_STORE[key];
      if (storeName) {
        await idbDelete(storeName, key);
      }
      // product_images keys 不在 KEY_TO_STORE 裡，跳過 IDB 刪除
    } catch (err) {
      console.error(`[CacheService] 🔴 IDB remove failed for ${key}:`, err);
    } finally {
      this.pendingWrites--;
    }
  }

  // ---- Request Dedup ----
  static async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pendingPromises.get(key);
    if (existing) return existing as T;

    const promise = fn().finally(() => this.pendingPromises.delete(key));
    this.pendingPromises.set(key, promise);
    return promise;
  }

  // ---- Version Helpers ----

  /** 正確的版本比較 (YYMMDD-xxxx 字串比較) */
  static isStale(localVersion: string, serverVersion: string): boolean {
    if (!localVersion || localVersion === '0') return true;
    if (!serverVersion) return false;
    return serverVersion > localVersion;
  }

  static async fetchServerVersions(): Promise<Record<string, string>> {
    try {
      const { data } = await supabase
        .from('data_versions')
        .select('table_name, version');
      const versions: Record<string, string> = {};
      (data || []).forEach((v: any) => {
        versions[v.table_name] = String(v.version);
      });
      return versions;
    } catch {
      return {};
    }
  }

  // ---- Debug helpers ----
  static getPendingWrites(): number {
    return this.pendingWrites;
  }

  static isInitialized(): boolean {
    return this.initialized;
  }

  static async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.init();
  }
}
