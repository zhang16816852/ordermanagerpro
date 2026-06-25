import { supabase } from '@/integrations/supabase/client';

// =============================================
// Cache configuration (keys + schema versions)
// =============================================
export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const CACHE = {
  products: { key: 'ac_products_v1', schema: 1, versionKey: 'products' },
  specs: { key: 'ac_specs_v1', schema: 1, versionKey: 'specs' },
  categories: { key: 'ac_categories_v1', schema: 1, versionKey: 'categories' },
  deviceModels: { key: 'ac_device_models_v1', schema: 1, versionKey: 'device_models' },
  storefront: { key: 'ac_storefront_v1', schema: 1, versionKey: 'storefront_items' },
  productImages: { key: 'ac_product_images_v1', schema: 1, versionKey: 'product_images' },
} as const;

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
export interface CacheEnvelope<T> {
  schemaVersion: number;
  dataVersion: string;
  cachedAt: number;
  data: T;
}

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
// CacheService
// =============================================
export class CacheService {
  private static initialized = false;

  /** Call once at app startup */
  static init() {
    if (this.initialized) return;
    for (const key of LEGACY_KEYS) {
      try {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
        }
      } catch { /* ignore */ }
    }
    this.initialized = true;
  }

  static get<T>(key: string, schemaVersion: number, ttlMs?: number): CacheGetResult<T> {
    this.init();
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { data: null, dataVersion: '0', exists: false };

      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      if (envelope.schemaVersion !== schemaVersion) {
        localStorage.removeItem(key);
        return { data: null, dataVersion: '0', exists: false };
      }

      if (ttlMs !== undefined && Date.now() - envelope.cachedAt > ttlMs) {
        localStorage.removeItem(key);
        return { data: null, dataVersion: '0', exists: false };
      }

      return { data: envelope.data, dataVersion: envelope.dataVersion, exists: true };
    } catch {
      localStorage.removeItem(key);
      return { data: null, dataVersion: '0', exists: false };
    }
  }

  static set<T>(key: string, data: T, dataVersion: string, schemaVersion: number): void {
    this.init();
    const envelope: CacheEnvelope<T> = {
      schemaVersion,
      dataVersion,
      cachedAt: Date.now(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  }

  static remove(key: string): void {
    localStorage.removeItem(key);
  }

  /** Lightweight: queries data_versions table for all server versions at once */
  static async fetchServerVersions(): Promise<Record<string, string>> {
    try {
      const { data } = await supabase
        .from('data_versions')
        .select('table_name, version');
      const versions: Record<string, string> = {};
      (data || []).forEach((v: any) => { versions[v.table_name] = String(v.version); });
      return versions;
    } catch {
      return {};
    }
  }

  static isStale(localVersion: string, serverVersion: string): boolean {
    if (!localVersion || localVersion === '0') return true;
    if (!serverVersion) return false;
    return parseInt(serverVersion, 10) > parseInt(localVersion, 10);
  }
}
