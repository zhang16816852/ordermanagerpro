import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CacheService, CACHE } from '@/services/cacheService';
import { SyncManager } from '@/services/syncManager';
import { useAuth } from '@/hooks/useAuth';

const CACHE_CFG = CACHE.brandSeries;

export interface BrandSeriesItem {
  id: string;
  brand_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BrandSeriesCacheData {
  items: BrandSeriesItem[];
}

export const getBrandSeriesCache = (): { items: BrandSeriesItem[]; dataVersion: string } | null => {
  const result = CacheService.get<BrandSeriesCacheData>(CACHE_CFG.key, CACHE_CFG.schema);
  if (result.exists && result.data) {
    return { items: result.data.items, dataVersion: result.dataVersion };
  }
  return null;
};

export const setBrandSeriesCache = (items: BrandSeriesItem[], version: string) => {
  CacheService.set(CACHE_CFG.key, { items }, version, CACHE_CFG.schema);
};

async function fetchAllBrandSeries(): Promise<BrandSeriesItem[]> {
  const { data, error } = await supabase
    .from('brand_series')
    .select('*')
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return (data || []) as BrandSeriesItem[];
}

/**
 * Global brand series cache with stale-while-revalidate pattern.
 * All components that need brand_series data should use this hook
 * instead of calling supabase directly.
 */
export const useBrandSeriesCache = () => {
  const { isAuthReady } = useAuth();
  const [items, setItems] = useState<BrandSeriesItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState('0');
  const mountedRef = useRef(true);

  const syncBrandSeries = useCallback(async (force = false, isRetry = false) => {
    if (!isAuthReady && !isRetry) return;
    setIsLoading(true);
    try {
      const cached = getBrandSeriesCache();
      const localVersion = cached?.dataVersion || '0';

      const { data: versionData, error: verError } = await supabase
        .from('data_versions')
        .select('version')
        .eq('table_name', 'brand_series')
        .maybeSingle();

      if (verError) throw verError;

      const serverVersion = String(versionData?.version || '0');

      if (force || CacheService.isStale(localVersion, serverVersion) || (cached?.items.length ?? 0) === 0) {
        const freshItems = await fetchAllBrandSeries();

        setBrandSeriesCache(freshItems, serverVersion);
        if (mountedRef.current) {
          setItems(freshItems);
          setVersion(serverVersion);
        }

        SyncManager.logTelemetry('🏷️ 品牌系列快取已更新', '#e67e22', {
          '同步模式': force ? '強制全量' : '版本異動',
          '本地版本': localVersion,
          '伺服器版本': serverVersion,
          '系列筆數': freshItems.length
        });
      } else if (cached) {
        if (mountedRef.current) {
          setItems(cached.items);
          setVersion(localVersion);
        }
      }

      // Stale-while-revalidate: background check
      if (cached && !force) {
        CacheService.fetchServerVersions().then(serverVersions => {
          const sv = serverVersions['brand_series'] || '0';
          if (CacheService.isStale(localVersion, sv)) {
            syncBrandSeries(true);
          }
        }).catch(() => {});
      }
    } catch (error) {
      console.error('[BrandSeriesCache] 同步失敗:', error);
      if (!isRetry) {
        await new Promise(r => setTimeout(r, 500));
        return syncBrandSeries(force, true);
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [isAuthReady]);

  useEffect(() => {
    mountedRef.current = true;
    if (isAuthReady) {
      const timer = setTimeout(() => syncBrandSeries(), 200);
      return () => { clearTimeout(timer); mountedRef.current = false; };
    }
    return () => { mountedRef.current = false; };
  }, [isAuthReady, syncBrandSeries]);

  const refresh = useCallback(() => syncBrandSeries(true), [syncBrandSeries]);

  return {
    allSeries: items,
    isLoading,
    version,
    refresh,
  };
};
