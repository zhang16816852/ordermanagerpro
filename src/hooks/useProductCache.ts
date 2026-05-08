// src/hooks/useProductCache.ts
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import type { Tables } from '@/integrations/supabase/types';

import { Product, ProductVariant, ProductWithPricing, VariantWithPricing } from '@/types/product';

export type ProductWithCategories = Product & {
  category_ids: string[];
  category_names: string[];
  device_models?: { name: string, aliases: string[] | null }[];
  device_model_groups?: { id: string, name: string }[];
  device_model_exclusions?: { name: string }[];
  effective_model_names?: string[];
  variants?: any[];       // 注入的變體資料
  spec_values?: any;      // 注入的規格字典
};

interface ProductCache {
  version: number;
  products: ProductWithCategories[];
}

const CACHE_KEY = 'products_cache_v2';

function getLocalCache(): ProductCache | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached) as ProductCache;
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function setLocalCache(products: ProductWithCategories[], version: number) {
  const cache: ProductCache = { version, products };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function normalizeProduct(p: any, categoryMap?: Map<string, string>, groupItemsMap?: Map<string, string[]>, modelIdToName?: Map<string, string>): ProductWithCategories {
  // --- 1. 預處理所有規格 (v6) ---
  const allSpecRows = p.product_spec_values || [];
  
  // 分離產品規格與變體規格
  const productSpecs = allSpecRows.filter((r: any) => r.entity_type === 'product');
  const variantSpecsMap = new Map<string, any[]>();
  
  allSpecRows.filter((r: any) => r.entity_type === 'variant').forEach((r: any) => {
    const list = variantSpecsMap.get(r.entity_id) || [];
    variantSpecsMap.set(r.entity_id, [...list, r]);
  });

  const transformToDict = (rows: any[]) => {
    return (rows || []).reduce((acc: any, cur: any) => {
      // 統一使用三段式 Key: ParentID:SpecID:InstanceID
      const parentId = cur.parent_id || 'root';
      const specId = cur.spec_id;
      const instanceId = cur.instance_uuid || specId;
      const pathKey = `${parentId}:${specId}:${instanceId}`;
      acc[pathKey] = cur.value;
      return acc;
    }, {});
  };

  const spec_values = transformToDict(productSpecs);

  // --- 2. 處理變體並注入對應規格 ---
  const variants = (p.product_variants || []).map((v: any) => ({
    ...v,
    spec_values: transformToDict(variantSpecsMap.get(v.id) || [])
  }));

  // --- 3. 分類資訊扁平化 ---
  const hasLinksProperty = Object.prototype.hasOwnProperty.call(p, 'product_category_links');
  const links = p.product_category_links || [];
  let category_ids: string[] = [];

  if (hasLinksProperty) {
    category_ids = links.map((l: any) => l.category_id);
  } else if (Array.isArray(p.category_ids) && p.category_ids.length > 0) {
    category_ids = p.category_ids;
  } else if (p.category_id) {
    category_ids = [p.category_id];
  }

  let category_names: string[] = [];
  if (categoryMap && category_ids.length > 0) {
    category_names = category_ids.map(id => categoryMap.get(id)).filter(Boolean) as string[];
  } else if (links.length > 0) {
    category_names = links.map((l: any) => {
      const cat = l.categories || l.category;
      return Array.isArray(cat) ? cat[0]?.name : cat?.name;
    }).filter(Boolean);
  }

  // --- 4. 型號與連動邏輯 ---
  const modelLinks = p.product_model_links || [];
  const device_models = modelLinks.map((l: any) => ({
    name: l.device_models?.name,
    aliases: l.device_models?.aliases || []
  })).filter((m: any) => m.name);

  const groupLinks = p.product_model_group_links || [];
  const device_model_groups = groupLinks.map((l: any) => ({
    id: l.group_id,
    name: l.device_model_groups?.name
  })).filter((g: any) => g.name);

  const exclusions = p.product_model_exclusions || [];
  const exclusionNames = new Set(exclusions.map((l: any) => l.device_models?.name?.toLowerCase()).filter(Boolean));

  const effectiveModelNames = new Set<string>();
  device_models.forEach(m => effectiveModelNames.add(m.name));
  if (groupItemsMap && modelIdToName) {
    device_model_groups.forEach(g => {
      const modelIds = groupItemsMap.get(g.id) || [];
      modelIds.forEach(mid => {
        const name = modelIdToName.get(mid);
        if (name) effectiveModelNames.add(name);
      });
    });
  }
  const finalModelNames = Array.from(effectiveModelNames).filter(name => !exclusionNames.has(name.toLowerCase()));

  return {
    ...p,
    variants,           // 注入變體
    spec_values,        // 注入規格字典
    category_ids,
    category_names,
    device_models,
    device_model_groups,
    device_model_exclusions: exclusions.map((l: any) => ({ name: l.device_models?.name })),
    effective_model_names: finalModelNames
  };
}

async function checkVersionAndFetch(): Promise<{ products: ProductWithCategories[]; version: number }> {
  const cache = getLocalCache();
  const clientVersion = cache?.version ?? null;

  console.log('[ProductCache] 透過 Edge Function 校驗版本...');

  // 1. 呼叫 Edge Function 校驗版本（僅傳版本號，版本一致時不傳資料）
  const { data, error } = await supabase.functions.invoke('check-data-version', {
    body: { tableName: 'products', clientVersion },
  });

  /*if (error) {
    // Edge Function 失敗時直接查詢資料庫作為備援
    console.warn('[ProductCache] Edge Function 失敗，改用直接查詢');
    return await fetchProductsDirectly(clientVersion || 0);
  }*/

  const { needsUpdate, version, updatedAt, lastTriggeredBy } = data;

  // 2. 版本一致，使用本地快取
  if (!needsUpdate && cache) {
    console.log(
      `%c[ProductCache] ✅ 版本一致 (v${version})`,
      'color: #3498db; font-weight: bold',
      `更新於: ${updatedAt}`
    );

    // 若快取中分類名稱遺失，補抓
    const needsNameRefresh = cache.products.some(p => p.category_ids.length > 0 && p.category_names.length === 0);
    if (needsNameRefresh) {
      const { data: cats } = await supabase.from('categories').select('id, name');
      const catMap = new Map(cats?.map(c => [c.id, c.name]) || []);
      return { products: cache.products.map(p => normalizeProduct(p, catMap)), version };
    }

    return { products: cache.products, version };
  }

  // 3. 版本不同
  console.log(
    `%c[ProductCache] 🔄 版本不符 (v${version})`,
    'color: #9b59b6; font-weight: bold',
    `觸發來源: ${lastTriggeredBy}, 更新時間: ${updatedAt}`
  );
  console.log('[ProductCache] 重新抓取完整資料...');
  return await fetchProductsDirectly(version);
}

// 完整抓取產品資料（含所有關聯）並更新快取
async function fetchProductsDirectly(version: number): Promise<{ products: ProductWithCategories[]; version: number }> {
  const [
    { data: products, error: fetchError },
    { data: allSpecValues },
    { data: cats },
    { data: groupItems },
    { data: allModels }
  ] = await Promise.all([
    supabase.from('products').select(`
      *,
      product_category_links(category_id, categories(name)),
      product_model_links(device_models(name, aliases)),
      product_model_group_links(group_id, device_model_groups(name)),
      product_model_exclusions(device_models(name)),
      product_variants(*)
    `).order('name'),
    supabase.from('product_spec_values').select('*').is('deleted_at', null),
    supabase.from('categories').select('id, name'),
    supabase.from('device_model_group_items').select('group_id, model_id'),
    supabase.from('device_models').select('id, name')
  ]);

  if (fetchError) throw fetchError;

  // 將所有規格按 entity_id 分類
  const specMapByEntity = new Map<string, any[]>();
  allSpecValues?.forEach(row => {
    const list = specMapByEntity.get(row.entity_id) || [];
    specMapByEntity.set(row.entity_id, [...list, row]);
  });

  const catMap = new Map(cats?.map(c => [c.id, c.name]) || []);
  const groupItemsMap = new Map<string, string[]>();
  groupItems?.forEach(item => {
    const current = groupItemsMap.get(item.group_id) || [];
    groupItemsMap.set(item.group_id, [...current, item.model_id]);
  });
  const modelIdToName = new Map(allModels?.map(m => [m.id, m.name]) || []);

  const mappedProducts = (products || []).map(p => {
    // 為產品和它的變體注入對應的規格行，供 normalizeProduct 使用
    const productWithInjectedSpecs = {
      ...p,
      product_spec_values: specMapByEntity.get(p.id) || [],
      product_variants: (p.product_variants || []).map((v: any) => ({
        ...v,
        product_spec_values: specMapByEntity.get(v.id) || []
      }))
    };
    return normalizeProduct(productWithInjectedSpecs, catMap, groupItemsMap, modelIdToName);
  });
  setLocalCache(mappedProducts, version);
  console.log(`[ProductCache] 快取已更新 (v${version})，共 ${mappedProducts.length} 筆`);

  return { products: mappedProducts, version };
}


export function useProductCache() {
  const queryClient = useQueryClient();
  const [localProducts, setLocalProducts] = useState<ProductWithCategories[]>(() => {
    const cache = getLocalCache();
    // Default normalization without map (will rely on what was cached)
    return (cache?.products || []).map(p => normalizeProduct(p));
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products-with-cache'],
    queryFn: checkVersionAndFetch,
    staleTime: 1000 * 30, // 30 秒內不重複檢查
    gcTime: Infinity,
    refetchOnWindowFocus: true, // 切換回視窗時自動檢查
  });

  useEffect(() => {
    if (data?.products) {
      setLocalProducts(data.products);
    }
  }, [data]);

  const forceRefresh = useCallback(async () => {
    localStorage.removeItem(CACHE_KEY);
    await queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
  }, [queryClient]);

  const activeProducts = localProducts.filter(p => p.status !== 'discontinued');

  const getProductById = useCallback((id: string) => {
    return localProducts.find(p => p.id === id) || null;
  }, [localProducts]);

  const getProductBySku = useCallback((sku: string) => {
    return localProducts.find(p => p.sku === sku) || null;
  }, [localProducts]);

  return {
    products: localProducts,
    activeProducts,
    isLoading: isLoading && localProducts.length === 0,
    error,
    version: data?.version ?? getLocalCache()?.version ?? 0,
    refetch,
    forceRefresh,
    getProductById,
    getProductBySku,
  };
}


// Hook for store-specific products with caching (now uses brand-based pricing)
export function useStoreProductCache(storeId: string | null) {
  const { products: allProducts, activeProducts: globalActiveProducts, isLoading: productsLoading } = useProductCache();

  // 先取得店鋪的品牌資訊
  const { data: storeInfo } = useQuery({
    queryKey: ['store-brand', storeId],
    queryFn: async () => {
      if (!storeId) return null;
      const { data, error } = await supabase
        .from('stores')
        .select('brand')
        .eq('id', storeId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!storeId,
    staleTime: 1000 * 60 * 10, // 10 分鐘
  });

  const brand = storeInfo?.brand;

  // 使用品牌來取得價格（包括變體價格）
  const { data: brandPrices = [], isLoading: brandPricesLoading } = useQuery({
    queryKey: ['brand-products-prices', brand],
    queryFn: async () => {
      if (!brand) return [];

      const { data, error } = await supabase
        .from('store_products')
        .select('product_id, variant_id, wholesale_price, retail_price')
        .eq('brand', brand);

      if (error) throw error;
      return data || [];
    },
    enabled: !!brand,
    staleTime: 1000 * 60 * 5, // 5 分鐘
  });

  const { models: storeModels, groups: storeGroups, groupItems: storeGroupItems } = useDeviceModelStore();

  // Helper to resolve effective models from links locally
  const resolveEffectiveModels = (target: any, isVariant = false) => {
    const directLinksKey = isVariant ? 'variant_model_links' : 'product_model_links';
    const groupLinksKey = isVariant ? 'variant_model_group_links' : 'product_model_group_links';
    const exclusionsKey = isVariant ? 'variant_model_exclusions' : 'product_model_exclusions';

    const directModels = (target[directLinksKey] || []).map((l: any) => l.device_models?.name).filter(Boolean);
    const groupLinks = target[groupLinksKey] || [];
    const exclusions = new Set((target[exclusionsKey] || []).map((l: any) => l.device_models?.name?.toLowerCase()).filter(Boolean));

    const resolvedNames = new Set<string>(directModels);

    groupLinks.forEach((gl: any) => {
      const itemIds = storeGroupItems.filter(i => i.group_id === gl.group_id).map(i => i.model_id);
      itemIds.forEach(mid => {
        const m = storeModels.find(sm => sm.id === mid);
        if (m) resolvedNames.add(m.name);
      });
    });

    return Array.from(resolvedNames).filter(name => !exclusions.has(name.toLowerCase()));
  };

  const { data: allVariants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['all-product-variants-for-store'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select(`
          *,
          variant_model_links(device_models(name, aliases)),
          variant_model_group_links(group_id, device_model_groups(name)),
          variant_model_exclusions(device_models(name))
        `)
        .order('sku');
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 5,
  });

  // 合併產品與品牌價格
  const mergedProducts: ProductWithPricing[] = (storeId ? allProducts : globalActiveProducts).map(product => {
    const brandPrice = brandPrices.find(bp => bp.product_id === product.id && !bp.variant_id);

    // 取得此產品的變體並套用品牌價格
    const productVariants: VariantWithPricing[] = allVariants
      .filter(v => v.product_id === product.id)
      .filter(v => v.status !== 'discontinued')
      .map(variant => {
        const variantBrandPrice = brandPrices.find(
          bp => bp.product_id === product.id && bp.variant_id === variant.id
        );

        // Resolve variant-specific effective models
        const variantModels = resolveEffectiveModels(variant, true);
        // If variant has no specific models, it inherits from product
        const effective_model_names = variantModels.length > 0 ? variantModels : product.effective_model_names;

        return {
          ...variant,
          effective_wholesale_price: variantBrandPrice?.wholesale_price ?? variant.wholesale_price,
          effective_retail_price: variantBrandPrice?.retail_price ?? variant.retail_price,
          has_brand_price: !!variantBrandPrice,
          status: variant.status,
          effective_model_names
        };
      });

    return {
      ...product,
      wholesale_price: brandPrice?.wholesale_price ?? product.base_wholesale_price,
      retail_price: brandPrice?.retail_price ?? product.base_retail_price,
      has_store_price: !!brandPrice,
      variants: productVariants.length > 0 ? productVariants : undefined,
    };
  });
  // 如果沒有指定 storeId，我們不顯示已停售的產品
  const finalProducts = mergedProducts.filter(p => p.status !== 'discontinued');
  return {
    products: finalProducts,
    isLoading: productsLoading || (storeId ? brandPricesLoading || variantsLoading : false),
    brand,
  };


}

// Hook for getting variants with brand pricing for a specific product
export function useProductVariants(productId: string | null, brand: string | null) {
  const { data: variants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['product-variants', productId],
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', productId)
        .order('sku');
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
  });

  const { data: brandPrices = [], isLoading: pricesLoading } = useQuery({
    queryKey: ['variant-brand-prices', productId, brand],
    queryFn: async () => {
      if (!brand || !productId) return [];
      const { data, error } = await supabase
        .from('store_products')
        .select('variant_id, wholesale_price, retail_price')
        .eq('brand', brand)
        .eq('product_id', productId)
        .not('variant_id', 'is', null);
      if (error) throw error;
      return data || [];
    },
    enabled: !!brand && !!productId,
  });

  const variantsWithPricing: VariantWithPricing[] = variants.map(variant => {
    const brandPrice = brandPrices.find(bp => bp.variant_id === variant.id);
    return {
      ...variant,
      effective_wholesale_price: brandPrice?.wholesale_price ?? variant.wholesale_price,
      effective_retail_price: brandPrice?.retail_price ?? variant.retail_price,
      has_brand_price: !!brandPrice,
    };
  });

  return {
    variants: variantsWithPricing,
    isLoading: variantsLoading || pricesLoading,
  };
}
