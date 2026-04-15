// src/hooks/useProductCache.ts
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

import { Product, ProductVariant, ProductWithPricing, VariantWithPricing } from '@/types/product';

export type ProductWithCategories = Product & {
  category_ids: string[];
  category_names: string[];
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

function normalizeProduct(p: any, categoryMap?: Map<string, string>): ProductWithCategories {
  // Check if we are receiving the junction table data
  const hasLinksProperty = Object.prototype.hasOwnProperty.call(p, 'product_category_links');
  const links = p.product_category_links || [];

  // Priority: 
  // 1. Junction table (product_category_links)
  // 2. Legacy array field if exists
  // 3. Singular legacy field (category_id)
  let category_ids: string[] = [];

  if (hasLinksProperty) {
    category_ids = links.map((l: any) => l.category_id);
  } else if (Array.isArray(p.category_ids) && p.category_ids.length > 0) {
    category_ids = p.category_ids;
  } else if (p.category_id) {
    category_ids = [p.category_id];
  }
  
  // Extract category names
  // If we have a categoryMap (from the latest fetch), we prioritize resolving by ID for total reliability
  let category_names: string[] = [];
  
  if (categoryMap && category_ids.length > 0) {
    category_names = category_ids.map(id => categoryMap.get(id)).filter(Boolean) as string[];
  } else if (links.length > 0) {
    // Fallback to joined data if Map is not available
    category_names = links.map((l: any) => {
      const cat = l.categories || l.category;
      return Array.isArray(cat) ? cat[0]?.name : cat?.name;
    }).filter(Boolean);
  }

  return {
    ...p,
    category_ids,
    category_names: category_names
  };
}

async function checkVersionAndFetch(): Promise<{ products: ProductWithCategories[]; version: number }> {
  const cache = getLocalCache();
  const clientVersion = cache?.version ?? null;

  console.log('[ProductCache] Checking version with Edge Function...');
  
  // 1. First, call Edge Function to check version (this reduces data transfer if no update needed)
  const { data, error } = await supabase.functions.invoke('check-data-version', {
    body: { tableName: 'products', clientVersion },
  });

  if (error) {
    console.error('[ProductCache] Edge function error, falling back to direct fetch');
    // On error, we need both products and categories
    const [{ data: products, error: fetchError }, { data: cats }] = await Promise.all([
      supabase.from('products').select('*, product_category_links(category_id)').order('name'),
      supabase.from('categories').select('id, name')
    ]);

    if (fetchError) throw fetchError;
    const catMap = new Map(cats?.map(c => [c.id, c.name]) || []);
    const mappedProducts = (products || []).map(p => normalizeProduct(p, catMap));
    return { products: mappedProducts, version: clientVersion || 0 };
  }

  const { needsUpdate, version, data: rawData } = data;

  if (!needsUpdate && cache) {
    console.log('[ProductCache] Verions match. Using local cache.');
    // Check if cache needs a name refresh (e.g. if names were missing before)
    const needsNameRefresh = cache.products.some(p => p.category_ids.length > 0 && p.category_names.length === 0);
    
    if (needsNameRefresh) {
      console.log('[ProductCache] Detected empty category names in cache, fetching names...');
      const { data: cats } = await supabase.from('categories').select('id, name');
      const catMap = new Map(cats?.map(c => [c.id, c.name]) || []);
      const normalizedProducts = cache.products.map(p => normalizeProduct(p, catMap));
      return { products: normalizedProducts, version };
    }
    
    return { products: cache.products, version };
  }

  // 2. Data needs update! Fetch categories to ensure names are resolved correctly
  console.log('[ProductCache] Update needed. Fetching categories and mapping data...');
  const { data: cats } = await supabase.from('categories').select('id, name');
  const catMap = new Map(cats?.map(c => [c.id, c.name]) || []);

  // Map received data with names
  const products = (rawData || []).map(p => normalizeProduct(p, catMap));
  setLocalCache(products, version);
  return { products, version };
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
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    gcTime: Infinity, // 永久保存
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

  // 取得所有變體
  const { data: allVariants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['all-product-variants-for-store'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
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
        return {
          ...variant,
          effective_wholesale_price: variantBrandPrice?.wholesale_price ?? variant.wholesale_price,
          effective_retail_price: variantBrandPrice?.retail_price ?? variant.retail_price,
          has_brand_price: !!variantBrandPrice,
          status: variant.status,
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
