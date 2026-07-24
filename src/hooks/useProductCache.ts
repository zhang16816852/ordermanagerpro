import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Product, ProductWithDetails, ProductWithPricing, VariantWithPricing } from '@/types/product';
import { SyncManager } from '@/services/syncManager';
import { CacheService, CACHE, type FetchResult } from '@/services/cacheService';
import { useCache } from '@/hooks/useCache';
import { buildModelMaps, processEntityModels, fetchReferencedModels } from '@/utils/productModelResolver';
import type { OrderGridTemplateWithProducts } from '@/types/order-grid';

const PRODUCT_CACHE_CFG = CACHE.products;
const PAGE_SIZE = 1000;

/**
 * 分頁抓取 Supabase 資料，突破預設 1000 筆限制
 */
async function fetchAllPages(
  table: string,
  select: string,
  options?: { filters?: Record<string, any>; order?: { column: string; ascending?: boolean } },
): Promise<any[]> {
  let from = 0;
  const allData: any[] = [];
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (options?.filters) {
      Object.entries(options.filters).forEach(([col, val]) => {
        query = query.eq(col, val);
      });
    }
    if (options?.order) {
      query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
    }
    const { data, error } = await query;
    if (error) {
      console.error(`[ProductCache] fetchAllPages error on ${table}:`, error);
      break;
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allData;
}

export const getProductCache = () => {
  const result = CacheService.get<ProductWithDetails[]>(PRODUCT_CACHE_CFG.key, PRODUCT_CACHE_CFG.schema);
  return result.exists ? { version: result.dataVersion, data: result.data! } : null;
};

export const setProductCache = (cache: { version: string; data: ProductWithDetails[] }) => {
  CacheService.set(PRODUCT_CACHE_CFG.key, cache.data, cache.version, PRODUCT_CACHE_CFG.schema);
};

// 自訂事件名稱：當 syncProducts 完成後通知所有已掛載的 useProductCache 實例
const PRODUCT_CACHE_UPDATED_EVENT = 'product-cache-updated';

/**
 * [V7.5] 產品同步核心邏輯
 */
export const syncProducts = async (incomingData?: any, version?: string): Promise<ProductWithDetails[]> => {
  try {
    const cache = getProductCache();
    let products = cache?.data || [];
    let newSequenceId = version ?? (cache?.version || '0');

    if (incomingData) {
      SyncManager.logTelemetry('📡 產品快取收到增量更新訊號', '#3498db', {
        '同步模式': incomingData.syncMode,
        '伺服器版本': incomingData.serverSequenceId ?? newSequenceId,
        '動作': '準備全量拉取以涵蓋關聯資料'
      });
      newSequenceId = incomingData.serverSequenceId ?? newSequenceId;
    }

    // 1. 基本資料抓取 (Products + Variants)
    const { data: productsData, error: productsError } = await supabase.from('products')
      .select(`
                    *,
                    variants:product_variants(*),
                    product_category_links(category_id, categories(name)),
                    product_series_links(brand_series_id),
                    product_brands(brand_id, is_primary)
                `);

    if (productsError) throw productsError;

    // 2. 關聯資料全量抓取（分頁突破 1000 筆限制）
    const [
      allRelations,
      allGroupsWithItems,
      allSpecs,
      allCovers,
    ] = await Promise.all([
      fetchAllPages('entity_model_relations', 'product_id, variant_id, model_id, group_id, relation_type, reason'),
      fetchAllPages('device_model_groups', 'id, name, device_model_group_items(device_models(id, name, aliases))'),
      fetchAllPages('entity_spec_values', '*'),
      fetchAllPages('product_images', 'entity_type, entity_id, url', { filters: { is_cover: true } }),
    ]);

    // 3. 建立索引 Map
    const devModelsMap = await fetchReferencedModels(supabase, allRelations, PAGE_SIZE);
    const devGroupsMap = new Map<string, any>();
    allGroupsWithItems?.forEach(g => devGroupsMap.set(g.id, g));
    const { linksMap, groupsMap, exclusionsMap } = buildModelMaps(allRelations, devModelsMap, devGroupsMap);
    const modelMaps = { linksMap, groupsMap, exclusionsMap };

    const specsMap = new Map<string, Record<string, any>>();
    allSpecs?.forEach((sv: any) => {
      if (!specsMap.has(sv.entity_id)) specsMap.set(sv.entity_id, {});
      const entitySpecs = specsMap.get(sv.entity_id)!;
      const parentId = sv.parent_id || 'root';
      const pathKey = `${parentId}:${sv.spec_id}:${sv.instance_uuid}`;
      entitySpecs[pathKey] = sv.value;
    });

    const coversMap = new Map<string, string>();
    allCovers?.forEach((img: any) => {
      coversMap.set(img.entity_id, img.url);
    });

    // 4. 資料對映處理
    products = (productsData || []).map((p: any) => {
      const modelDataP = processEntityModels(p.id, modelMaps);

      return {
        ...p,
        ...modelDataP,
        image_url: coversMap.get(p.id) || null,
        category_ids: p.product_category_links?.map((l: any) => l.category_id) || [],
        category_names: p.product_category_links?.map((l: any) => l.categories?.name).filter(Boolean) || [],
        brand_series_ids: p.product_series_links?.map((l: any) => l.brand_series_id) || [],
        brand_ids: p.product_brands?.map((b: any) => b.brand_id) || [],
        primary_brand_id: p.product_brands?.find((b: any) => b.is_primary)?.brand_id || p.product_brands?.[0]?.brand_id || null,
        effective_model_names: modelDataP._expanded_models,
        effective_model_aliases: modelDataP._expanded_model_aliases,
        spec_values: specsMap.get(p.id) || {},
        variants: p.variants?.map((v: any) => {
          const modelDataV = processEntityModels(v.id, modelMaps);
          return {
            ...v,
            ...modelDataV,
            image_url: coversMap.get(v.id) || null,
            effective_model_names: modelDataV._expanded_models,
            effective_model_aliases: modelDataV._expanded_model_aliases,
            spec_values: specsMap.get(v.id) || {}
          };
        })
      };
    }) as unknown as ProductWithDetails[];

    setProductCache({ version: newSequenceId, data: products });
    SyncManager.logTelemetry('✅ 產品快取同步完成', '#2ecc71', {
      '快取版本': newSequenceId,
      '產品筆數': products.length
    });
    return products;
  } catch (error) {
    console.error('[ProductCache] 🔴 同步失敗:', error);
    return [];
  }
};

async function fetchProductsWithVersion(): Promise<FetchResult<ProductWithDetails[]>> {
  // 先從 data_versions 取得伺服器版本，避免 syncProducts() 以 '0' 為預設版本
  const { data: versionRow } = await supabase
    .from('data_versions')
    .select('version')
    .eq('table_name', 'products')
    .maybeSingle();
  const serverVersion = String(versionRow?.version || '0');

  const data = await syncProducts(undefined, serverVersion);
  const cache = getProductCache();
  return { data, version: cache?.version || serverVersion };
}

/**
 * [V7.5] React Hook: 提供 UI 元件訂閱產品快取
 * 采用 stale-while-revalidate 策略：
 * 1. 立即顯示快取資料
 * 2. 背景驗證版本
 * 3. 僅在伺服器版本更新時才重新抓取
 */
export const useProductCache = (storeId?: string | null) => {
  const { data: products, isLoading, isRevalidating, dataVersion, refresh } = useCache({
    cacheKey: PRODUCT_CACHE_CFG.key,
    schemaVersion: PRODUCT_CACHE_CFG.schema,
    versionTableName: PRODUCT_CACHE_CFG.versionKey,
    fetchFn: fetchProductsWithVersion,
    staleWhileRevalidate: true,
  });

  const { data: templates = [] } = useQuery<OrderGridTemplateWithProducts[]>({
    queryKey: ['table_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('table_templates')
        .select('*, template_variants:table_template_variants(*)')
        .order('name');
      if (error) throw error;
      return (data || []) as OrderGridTemplateWithProducts[];
    },
    staleTime: 30000,
  });

  const [optimisticBump, setOptimisticBump] = useState(0);
  const [optimisticProducts, setOptimisticProducts] = useState<ProductWithDetails[] | null>(null);

  // 監聽來自 SyncManager 的樂觀更新事件
  useEffect(() => {
    const handleOptimisticUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.data) {
        setOptimisticProducts(customEvent.detail.data);
        if (customEvent.detail.version) {
          setOptimisticBump(v => v + 1);
        }
      }
    };
    window.addEventListener('optimistic-product-cache-update', handleOptimisticUpdate);
    return () => {
      window.removeEventListener('optimistic-product-cache-update', handleOptimisticUpdate);
    };
  }, []);

  const effectiveProducts = optimisticProducts ?? products ?? [];

  return {
    products: effectiveProducts,
    templates,
    isLoading,
    isRevalidating,
    version: dataVersion,
    refresh,
    forceRefresh: refresh,
  };
};

/**
 * [V7.5] 提供門市使用的產品快取，整合定價資訊
 */
export const useStoreProductCache = (storeId?: string | null) => {
  const { products: rawProducts, templates, isLoading: isCacheLoading, version, refresh } = useProductCache();

  // 抓取門市特定價格 (目前 store_products 表尚無 store_id 欄位，採全量抓取後於前端過濾)
  const { data: storeProducts = [], isLoading: isStoreLoading } = useQuery({
    queryKey: ['store_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_products')
        .select('*');
      if (error) throw error;
      return data;
    },
    enabled: true,
  });

  // 將基礎資料轉換為前台需要的定價格式 (ProductWithDetails -> ProductWithPricing)
  const productsWithPricing = useMemo<ProductWithPricing[]>(() => {
    if (!rawProducts) return [];

    return rawProducts.map(p => {
      const storeSettings = storeProducts.filter((sp: any) => sp.product_id === p.id);
      const mainStoreProduct = storeSettings.find((sp: any) => !sp.variant_id);

      return {
        ...p,
        wholesale_price: mainStoreProduct?.wholesale_price || p.base_wholesale_price || 0,
        retail_price: p.base_retail_price || 0,
        has_store_price: !!mainStoreProduct,
        variants: (p.variants || []).map((v: any) => {
          const variantStoreProduct = storeSettings.find((sp: any) => sp.variant_id === v.id);
          return {
            ...v,
            effective_wholesale_price: variantStoreProduct?.wholesale_price || v.wholesale_price || p.base_wholesale_price || 0,
            effective_retail_price: v.retail_price || p.base_retail_price || 0,
            has_brand_price: !!variantStoreProduct,
            spec_values: v.spec_values
          } as VariantWithPricing;
        })
      } as ProductWithPricing;
    });
  }, [rawProducts, storeProducts]);

  return {
    products: productsWithPricing,
    templates,
    isLoading: isCacheLoading || isStoreLoading,
    version,
    refresh,
    forceRefresh: refresh
  };
};
