export interface CacheEnvelope<T> {
  schemaVersion: number;
  dataVersion: string;
  cachedAt: number;
  data: T;
}

/**
 * Memory-first 緩衝層。
 * 所有 sync read 都從這裡取。
 * 未來可擴充 LRU / maxSize / expiry / statistics。
 */
class MemoryStorage {
  private cache = new Map<string, CacheEnvelope<any>>();
  private versions = new Map<string, string>(); // store → version

  // ---- Envelope CRUD ----

  get<T>(key: string): CacheEnvelope<T> | undefined {
    return this.cache.get(key) as CacheEnvelope<T> | undefined;
  }

  set<T>(key: string, envelope: CacheEnvelope<T>): void {
    this.cache.set(key, envelope);
  }

  remove(key: string): void {
    this.cache.delete(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  // ---- Version shortcuts ----

  getVersion(store: string): string {
    return this.versions.get(store) || '0';
  }

  setVersion(store: string, version: string): void {
    this.versions.set(store, version);
  }

  // ---- Bulk operations ----

  clear(storePrefix?: string): void {
    if (!storePrefix) {
      this.cache.clear();
      this.versions.clear();
      return;
    }
    for (const [key] of this.cache) {
      if (key.startsWith(`ac_${storePrefix}`)) {
        this.cache.delete(key);
      }
    }
    this.versions.delete(storePrefix);
  }

  // ---- Future: maxSize, LRU, expiry, statistics ----
  // get stats() { return { size: this.cache.size, hitCount, missCount, ... } }
}

export const memoryStorage = new MemoryStorage();
