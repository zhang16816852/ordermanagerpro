import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;

interface ProductCache {
  version: string;
  products: Product[];
  cachedAt: number;
}

const CACHE_KEY = 'products_cache';
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours fallback

function getLocalCache(): ProductCache | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const data = JSON.parse(cached) as ProductCache;
    // Check if cache is too old
    if (Date.now() - data.cachedAt > CACHE_MAX_AGE) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function setLocalCache(products: Product[], version: string) {
  const cache: ProductCache = {
    version,
    products,
    cachedAt: Date.now(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

async function fetchLatestVersion(): Promise<string | null> {
  // Get the most recent updated_at from products table
  const { data, error } = await supabase
    .from('products')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching product version:', error);
    return null;
  }
  
  return data?.updated_at || null;
}

async function fetchAllProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name');
  
  if (error) {
    throw error;
  }
  
  return data || [];
}

export function useProductCache() {
  const queryClient = useQueryClient();
  const [localProducts, setLocalProducts] = useState<Product[]>(() => {
    const cache = getLocalCache();
    return cache?.products || [];
  });

  // Query to check version and fetch if needed
  const { data: products, isLoading, error, refetch } = useQuery({
    queryKey: ['products-with-cache'],
    queryFn: async () => {
      const cache = getLocalCache();
      const latestVersion = await fetchLatestVersion();

      // If no version available (empty table or error), use cache or fetch fresh
      if (!latestVersion) {
        if (cache) return cache.products;
        return fetchAllProducts();
      }

      // If cache matches current version, use cache
      if (cache && cache.version === latestVersion) {
        console.log('[ProductCache] Using cached products');
        return cache.products;
      }

      // Otherwise fetch fresh data
      console.log('[ProductCache] Fetching fresh products');
      const freshProducts = await fetchAllProducts();
      setLocalCache(freshProducts, latestVersion);
      return freshProducts;
    },
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
  });

  // Update local state when query data changes
  useEffect(() => {
    if (products) {
      setLocalProducts(products);
    }
  }, [products]);

  // Force refresh function
  const forceRefresh = useCallback(async () => {
    localStorage.removeItem(CACHE_KEY);
    await queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
  }, [queryClient]);

  // Get active products only
  const activeProducts = localProducts.filter(p => p.status === 'active');

  // Get product by ID
  const getProductById = useCallback((id: string) => {
    return localProducts.find(p => p.id === id) || null;
  }, [localProducts]);

  // Get product by SKU
  const getProductBySku = useCallback((sku: string) => {
    return localProducts.find(p => p.sku === sku) || null;
  }, [localProducts]);

  return {
    products: localProducts,
    activeProducts,
    isLoading: isLoading && localProducts.length === 0,
    error,
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
