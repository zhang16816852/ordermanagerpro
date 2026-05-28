import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const STOREFRONT_CACHE_KEY = 'storefront_cache_v1';

export interface StorefrontItemWithDetails {
  id: string; // storefront_items.id (Unique UUID)
  product_id: string;
  variant_id: string;
  model_id: string;
  display_name: string; // e.g. "IMOS S25+ 抗藍光玻璃貼" (Resolved name)
  slug: string;
  status: string;
  
  // Product details
  product_name: string;
  description: string | null;
  brand_id: string | null;
  has_variants: boolean;
  
  // Variant details
  sku: string;
  barcode: string | null;
  color: string | null;
  option_1: string | null;
  option_2: string | null;
  option_3: string | null;
  
  // Base Pricing
  base_wholesale_price: number;
  base_retail_price: number;
  
  // Storefront Specific Pricing (After override)
  wholesale_price: number;
  retail_price: number;
  has_store_price: boolean;

  // Category and model info
  category_ids: string[];
  category_names: string[];
  device_model_name: string;
}

interface StorefrontCacheData {
  version: number;
  updatedAt: string;
  data: StorefrontItemWithDetails[];
}

const defaultCache: StorefrontCacheData = {
  version: 0,
  updatedAt: '',
  data: [],
};

export const getStorefrontCache = (): StorefrontCacheData => {
  try {
    const cached = localStorage.getItem(STOREFRONT_CACHE_KEY);
    if (!cached) return defaultCache;
    return { ...defaultCache, ...JSON.parse(cached) };
  } catch {
    localStorage.removeItem(STOREFRONT_CACHE_KEY);
    return defaultCache;
  }
};

export const setStorefrontCache = (cache: StorefrontCacheData) => {
  localStorage.setItem(STOREFRONT_CACHE_KEY, JSON.stringify(cache));
};

export const useStorefrontCache = (storeId?: string | null) => {
  const [items, setItems] = useState<StorefrontItemWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState(0);

  // 門市覆蓋定價 (從 React Query 抓取)
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
      const local = getStorefrontCache();
      
      // 1. 從 data_versions 取得最新的 storefront_items 版號
      const { data: versionData, error: verError } = await supabase
        .from('data_versions')
        .select('*')
        .eq('table_name', 'storefront_items')
        .maybeSingle();

      if (verError) throw verError;

      const serverVer = versionData?.version || 1;
      const serverTime = versionData?.updated_at || new Date().toISOString();

      if (force || local.version < serverVer || local.data.length === 0) {
        const localTimeStr = local.updatedAt ? new Date(local.updatedAt).toISOString().slice(0, 10).replace(/-/g, '') : '無';
        const serverTimeStr = serverTime ? new Date(serverTime).toISOString().slice(0, 10).replace(/-/g, '') : '最新';
        console.log(`[商品前台快取] 發現【產品變化】 (目前版本: ${localTimeStr}-v${local.version} -> 最新版本: ${serverTimeStr}-v${serverVer})，正在拉取更新...`);

        // 2. 抓取完整的 storefront_items 以及關聯
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

        // 3. 展平 (Flatten) 關聯資料
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
            
            // 預設與 Base 相同，稍後由 useMemo 處理 Store Pricing 覆蓋
            wholesale_price: variant.wholesale_price || 0,
            retail_price: variant.retail_price || 0,
            has_store_price: false,

            category_ids: categoryLinks.map((cl: any) => cl.category_id),
            category_names: categoryLinks.map((cl: any) => cl.categories?.name).filter(Boolean),
            device_model_name: model.name || '',
          };
        });

        local.data = processed;
        local.version = serverVer;
        local.updatedAt = serverTime;
        setStorefrontCache(local);
      } else {
        console.log(`[商品前台快取] 檢查完畢，前台展示商品皆為最新狀態。`);
      }

      setItems(local.data);
      setVersion(local.version);
    } catch (error) {
      console.error('[StorefrontCache] 🔴 同步失敗:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncStorefront();
  }, []);

  // 4. 門市特定定價覆蓋
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
