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
  // --- 1. 規格轉換工具 (v6: 三段式 PathKey) ---
  const transformToDict = (rows: any[]) => {
    const dict: Record<string, any> = {};
    (rows || []).forEach((cur: any) => {
      const parentId = cur.parent_id || 'root';
      const specId = cur.spec_id;
      const instanceId = cur.instance_uuid || specId;
      const pathKey = `${parentId}:${specId}:${instanceId}`;
      dict[pathKey] = cur.value;
    });
    return dict;
  };

  // --- 2. 處理主產品規格 ---
  const spec_values = transformToDict(p.product_spec_values);

  // --- 3. 處理變體規格與型號連動 ---
  const variants = (p.product_variants || []).map((v: any) => {
    const v_spec_values = transformToDict(v.product_spec_values || []);
    
    // 變體型號連動邏輯
    const vModelLinks = v.variant_model_links || [];
    const vGroupLinks = v.variant_model_group_links || [];
    const vExclusions = v.variant_model_exclusions || [];
    
    const vExclusionNames = new Set(vExclusions.map((l: any) => l.device_models?.name?.toLowerCase()).filter(Boolean));
    const vResolvedNames = new Set<string>(vModelLinks.map((l: any) => l.device_models?.name).filter(Boolean));
    
    if (groupItemsMap && modelIdToName) {
      vGroupLinks.forEach((gl: any) => {
        const itemIds = groupItemsMap.get(gl.group_id) || [];
        itemIds.forEach(mid => {
          const name = modelIdToName.get(mid);
          if (name) vResolvedNames.add(name);
        });
      });
    }
    
    const vFinalModels = Array.from(vResolvedNames).filter(name => !vExclusionNames.has(name.toLowerCase()));

    return {
      ...v,
      spec_values: v_spec_values,
      effective_model_names: vFinalModels.length > 0 ? vFinalModels : [],
      product_spec_values: undefined,
      variant_model_links: undefined,
      variant_model_group_links: undefined,
      variant_model_exclusions: undefined
    };
  });

  // --- 4. 分類資訊扁平化 ---
  const links = p.product_category_links || [];
  const category_ids = links.map((l: any) => l.category_id);
  
  let category_names: string[] = [];
  if (categoryMap && category_ids.length > 0) {
    category_names = category_ids.map(id => categoryMap.get(id)).filter(Boolean) as string[];
  } else {
    category_names = links.map((l: any) => (l.categories || l.category)?.name).filter(Boolean);
  }

  // --- 5. 主產品型號與連動邏輯 ---
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

  const exclusionLinks = p.product_model_exclusions || [];
  const exclusionNames = new Set(exclusionLinks.map((l: any) => l.device_models?.name?.toLowerCase()).filter(Boolean));

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

  // --- 6. 組裝最終物件並移除原始屬性 ---
  const cleanProduct = {
    ...p,
    variants,           
    spec_values,        
    category_ids,
    category_names,
    device_models,
    device_model_groups,
    device_model_exclusions: exclusionLinks.map((l: any) => ({ name: l.device_models?.name })),
    effective_model_names: finalModelNames
  };

  delete (cleanProduct as any).product_variants;
  delete (cleanProduct as any).product_spec_values;
  delete (cleanProduct as any).product_category_links;
  delete (cleanProduct as any).product_model_links;
  delete (cleanProduct as any).product_model_group_links;
  delete (cleanProduct as any).product_model_exclusions;

  return cleanProduct;
}

async function checkVersionAndFetch(): Promise<{ products: ProductWithCategories[]; version: number }> {
  const cache = getLocalCache();
  const clientVersion = cache?.version ?? null;
  const { data, error } = await supabase.functions.invoke('check-data-version', {
    body: { tableName: 'products', clientVersion },
  });
  const { needsUpdate, version, updatedAt, lastTriggeredBy } = data;
  if (!needsUpdate && cache) {
    const needsNameRefresh = cache.products.some(p => p.category_ids.length > 0 && p.category_names.length === 0);
    if (needsNameRefresh) {
      const { data: cats } = await supabase.from('categories').select('id, name');
      const catMap = new Map(cats?.map(c => [c.id, c.name]) || []);
      return { products: cache.products.map(p => normalizeProduct(p, catMap)), version };
    }
    return { products: cache.products, version };
  }
  return await fetchProductsDirectly(version);
}

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
      product_variants(
        *,
        variant_model_links(device_models(name, aliases)),
        variant_model_group_links(group_id, device_model_groups(name)),
        variant_model_exclusions(device_models(name))
      )
    `).order('name'),
    supabase.from('product_spec_values').select('*').is('deleted_at', null),
    supabase.from('categories').select('id, name'),
    supabase.from('device_model_group_items').select('group_id, model_id'),
    supabase.from('device_models').select('id, name')
  ]);

  if (fetchError) throw fetchError;

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
    staleTime: 1000 * 60 * 10,
  });

  const brand = storeInfo?.brand;

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
    staleTime: 1000 * 60 * 5,
  });

  const mergedProducts: ProductWithPricing[] = (storeId ? allProducts : globalActiveProducts).map(product => {
    const brandPrice = brandPrices.find(bp => bp.product_id === product.id && !bp.variant_id);

    const productVariants: VariantWithPricing[] = (product.variants || [])
      .filter(v => v.status !== 'discontinued')
      .map(variant => {
        const variantBrandPrice = brandPrices.find(
          bp => bp.product_id === product.id && bp.variant_id === variant.id
        );

        return {
          ...variant,
          effective_wholesale_price: variantBrandPrice?.wholesale_price ?? variant.wholesale_price,
          effective_retail_price: variantBrandPrice?.retail_price ?? variant.retail_price,
          has_brand_price: !!variantBrandPrice,
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

  const finalProducts = mergedProducts.filter(p => p.status !== 'discontinued');
  return {
    products: finalProducts,
    isLoading: productsLoading || (storeId ? brandPricesLoading : false),
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
    
    // 補回 transformToDict 邏輯
    const transformToDict = (rows: any[]) => {
      const dict: Record<string, any> = {};
      (rows || []).forEach((cur: any) => {
        const parentId = cur.parent_id || 'root';
        const specId = cur.spec_id;
        const instanceId = cur.instance_uuid || specId;
        const pathKey = `${parentId}:${specId}:${instanceId}`;
        dict[pathKey] = cur.value;
      });
      return dict;
    };

    return {
      ...variant,
      effective_wholesale_price: brandPrice?.wholesale_price ?? variant.wholesale_price,
      effective_retail_price: brandPrice?.retail_price ?? variant.retail_price,
      has_brand_price: !!brandPrice,
      spec_values: transformToDict((variant as any).product_spec_values || []),
      product_spec_values: undefined
    };
  });

  return {
    variants: variantsWithPricing,
    isLoading: variantsLoading || pricesLoading,
  };
}
