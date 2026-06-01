import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { CacheService, CACHE } from '@/services/cacheService';

const CACHE_CFG = CACHE.storefront;

export interface StorefrontItemWithDetails {
  id: string;
  product_id: string;
  variant_id: string;
  model_id: string;
  display_name: string;
  slug: string;
  status: string;

  product_name: string;
  description: string | null;
  brand_id: string | null;
  has_variants: boolean;

  sku: string;
  barcode: string | null;
  color: string | null;
  option_1: string | null;
  option_2: string | null;
  option_3: string | null;

  base_wholesale_price: number;
  base_retail_price: number;

  wholesale_price: number;
  retail_price: number;
  has_store_price: boolean;

  category_ids: string[];
  category_names: string[];
  device_model_name: string;
}

interface StorefrontCacheData {
  data: StorefrontItemWithDetails[];
}

export const getStorefrontCache = (): { data: StorefrontItemWithDetails[]; dataVersion: string } | null => {
  const result = CacheService.get<StorefrontCacheData>(CACHE_CFG.key, CACHE_CFG.schema);
  if (result.exists && result.data) {
    return { data: result.data.data, dataVersion: result.dataVersion };
  }

  // Migrate from old cache
  try {
    const old = localStorage.getItem('storefront_cache_v1');
    if (old) {
      const parsed = JSON.parse(old);
      if (parsed.data) {
        const version = String(parsed.version || '0');
        CacheService.set(CACHE_CFG.key, { data: parsed.data }, version, CACHE_CFG.schema);
        localStorage.removeItem('storefront_cache_v1');
        return { data: parsed.data, dataVersion: version };
      }
    }
  } catch { /* ignore */ }
  return null;
};

export const setStorefrontCache = (cache: { data: StorefrontItemWithDetails[] }, version: string) => {
  CacheService.set(CACHE_CFG.key, { data: cache.data }, version, CACHE_CFG.schema);
};

export const useStorefrontCache = (storeId?: string | null) => {
  const [items, setItems] = useState<StorefrontItemWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState('0');

  const { data: storeProducts = [], isLoading: isStoreLoading } = useQuery({
    queryKey: ['store_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_products')
        .select('*');
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const syncStorefront = async (force = false) => {
    setIsLoading(true);
    try {
      const cached = getStorefrontCache();
      const localVersion = cached?.dataVersion || '0';

      const { data: versionData, error: verError } = await supabase
        .from('data_versions')
        .select('*')
        .eq('table_name', 'storefront_items')
        .maybeSingle();

      if (verError) throw verError;

      const serverVersion = String(versionData?.version || '1');

      if (force || CacheService.isStale(localVersion, serverVersion) || (cached?.data.length ?? 0) === 0) {
        const { data: rawItems, error: itemsError } = await supabase
          .from('storefront_items')
          .select(`
            *,
            products(name, description, brand_id, has_variants, product_category_links(category_id, categories(name))),
            product_variants(sku, barcode, color, option_1, option_2, option_3, wholesale_price, retail_price),
            device_models(name)
          `)
          .eq('status', 'active');

        if (itemsError) throw itemsError;

        const processed: StorefrontItemWithDetails[] = (rawItems || []).map((item: any) => {
          const product = item.products || {};
          const variant = item.product_variants || {};
          const model = item.device_models || {};
          const categoryLinks = product.product_category_links || [];

          return {
            id: item.id,
            product_id: item.product_id,
            variant_id: item.variant_id,
            model_id: item.model_id,
            display_name: item.display_name,
            slug: item.slug,
            status: item.status || 'active',

            product_name: product.name || '',
            description: product.description || null,
            brand_id: product.brand_id || null,
            has_variants: !!product.has_variants,

            sku: variant.sku || '',
            barcode: variant.barcode || null,
            color: variant.color || null,
            option_1: variant.option_1 || null,
            option_2: variant.option_2 || null,
            option_3: variant.option_3 || null,

            base_wholesale_price: variant.wholesale_price || 0,
            base_retail_price: variant.retail_price || 0,

            wholesale_price: variant.wholesale_price || 0,
            retail_price: variant.retail_price || 0,
            has_store_price: false,

            category_ids: categoryLinks.map((cl: any) => cl.category_id),
            category_names: categoryLinks.map((cl: any) => cl.categories?.name).filter(Boolean),
            device_model_name: model.name || '',
          };
        });

        setStorefrontCache({ data: processed }, serverVersion);
        setItems(processed);
        setVersion(serverVersion);
      } else if (cached) {
        setItems(cached.data);
        setVersion(localVersion);
      }

      // Stale-while-revalidate: even if we served cache, BG-check version
      if (cached && !force) {
        CacheService.fetchServerVersions().then(serverVersions => {
          const sv = serverVersions['storefront_items'] || '0';
          if (CacheService.isStale(localVersion, sv)) {
            syncStorefront(true);
          }
        });
      }
    } catch (error) {
      console.error('[StorefrontCache] 🔴 同步失敗:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncStorefront();
  }, []);

  const itemsWithPricing = useMemo<StorefrontItemWithDetails[]>(() => {
    return items.map(item => {
      const storeSettings = storeProducts.filter((sp: any) => sp.product_id === item.product_id);
      const variantStoreProduct = storeSettings.find((sp: any) => sp.variant_id === item.variant_id);
      const mainStoreProduct = storeSettings.find((sp: any) => !sp.variant_id);

      const effectiveWholesale = variantStoreProduct?.wholesale_price || mainStoreProduct?.wholesale_price || item.base_wholesale_price || 0;
      const effectiveRetail = variantStoreProduct?.retail_price || mainStoreProduct?.retail_price || item.base_retail_price || 0;

      return {
        ...item,
        wholesale_price: Number(effectiveWholesale),
        retail_price: Number(effectiveRetail),
        has_store_price: !!(variantStoreProduct || mainStoreProduct),
      };
    });
  }, [items, storeProducts]);

  return {
    items: itemsWithPricing,
    isLoading: isLoading || isStoreLoading,
    version,
    refresh: () => syncStorefront(true),
  };
};
