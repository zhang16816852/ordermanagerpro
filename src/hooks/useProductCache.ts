import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;

interface ProductCache {
  version: number;
  products: Product[];
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

function setLocalCache(products: Product[], version: number) {
  const cache: ProductCache = { version, products };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

async function checkVersionAndFetch(): Promise<{ products: Product[]; version: number }> {
  const cache = getLocalCache();
  const clientVersion = cache?.version ?? null;

  console.log('[ProductCache] Checking version with server, client version:', clientVersion);

  const { data, error } = await supabase.functions.invoke('check-data-version', {
    body: { tableName: 'products', clientVersion },
  });

  if (error) {
    console.error('[ProductCache] Error calling check-data-version:', error);
    // Fallback to direct fetch if edge function fails
    const { data: products, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .order('name');
    
    if (fetchError) throw fetchError;
    return { products: products || [], version: clientVersion || 0 };
  }

  const { needsUpdate, version, data: products } = data;

  if (!needsUpdate && cache) {
    console.log('[ProductCache] Using cached data, version:', version);
    return { products: cache.products, version };
  }

  console.log('[ProductCache] Updated data received, version:', version);
  setLocalCache(products, version);
  return { products, version };
}

export function useProductCache() {
  const queryClient = useQueryClient();
  const [localProducts, setLocalProducts] = useState<Product[]>(() => {
    const cache = getLocalCache();
    return cache?.products || [];
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products-with-cache'],
    queryFn: checkVersionAndFetch,
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
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

  const activeProducts = localProducts.filter(p => p.status === 'active');

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

// Hook for store-specific products with caching
export function useStoreProductCache(storeId: string | null) {
  const { products: allProducts, isLoading: productsLoading } = useProductCache();

  const { data: storeProducts, isLoading: storeProductsLoading } = useQuery({
    queryKey: ['store-products-cache', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      
      const { data, error } = await supabase
        .from('store_products')
        .select('product_id, wholesale_price, retail_price')
        .eq('store_id', storeId);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!storeId,
    staleTime: 1000 * 60 * 5,
  });

  // Merge product data with store-specific pricing
  const mergedProducts = allProducts
    .filter(p => p.status === 'active')
    .map(product => {
      const storeProduct = storeProducts?.find(sp => sp.product_id === product.id);
      return {
        ...product,
        wholesale_price: storeProduct?.wholesale_price ?? product.base_wholesale_price,
        retail_price: storeProduct?.retail_price ?? product.base_retail_price,
        has_store_price: !!storeProduct,
      };
    });

  return {
    products: mergedProducts,
    isLoading: productsLoading || storeProductsLoading,
  };
}
