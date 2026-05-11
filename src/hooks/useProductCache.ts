import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Product, ProductWithDetails, ProductWithPricing, VariantWithPricing } from '@/types/product';

const PRODUCT_CACHE_KEY = 'products_cache_v2';

interface ProductCacheData {
    version: number;
    data: ProductWithDetails[];
}

export const getProductCache = (): ProductCacheData | null => {
    try {
        const cached = localStorage.getItem(PRODUCT_CACHE_KEY);
        if (!cached) return null;
        return JSON.parse(cached);
    } catch {
        localStorage.removeItem(PRODUCT_CACHE_KEY);
        return null;
    }
};

export const setProductCache = (cache: ProductCacheData) => {
    localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(cache));
};

/**
 * [V7.5] 產品同步核心邏輯
 */
export const syncProducts = async (incomingData?: any, version?: number): Promise<ProductWithDetails[]> => {
    try {
        const cache = getProductCache();
        let products = cache?.data || [];
        let newSequenceId = version ?? (cache?.version || 0);

        if (incomingData) {
            const { syncMode, snapshot, changes, deletedIds, serverSequenceId } = incomingData;
            newSequenceId = serverSequenceId;

            if (syncMode === 'full' && snapshot) {
                products = snapshot;
            }

            const prodMap = new Map<string, ProductWithDetails>(products.map(p => [p.id, p]));
            if (deletedIds) deletedIds.forEach((id: string) => prodMap.delete(id));
            if (changes) {
                changes.forEach((change: any) => {
                    const oldData = prodMap.get(change.id) || {} as ProductWithDetails;
                    const newData = { ...oldData, ...change.data };
                    prodMap.set(change.id, newData as ProductWithDetails);
                });
            }
            products = Array.from(prodMap.values());
        } else {
            console.log(`[ProductCache] 📡 執行全量更新...`);

            // [V7.5] 修正查詢語法，改用聯集表 (Junction Tables) 抓取型號資料
            const { data: productsData, error: productsError } = await supabase.from('products')
                .select(`
                    *,
                    variants:product_variants(
                        *,
                        variant_model_links(model_id, device_models(name)),
                        variant_model_group_links(group_id, device_model_groups(name)),
                        variant_model_exclusions(model_id, device_models(name))
                    ),
                    product_model_links(model_id, device_models(name)),
                    product_model_group_links(group_id, device_model_groups(name)),
                    product_model_exclusions(model_id, device_models(name)),
                    product_category_links(category_id, categories(name))
                `);

            if (productsError) throw productsError;

            // [V7.5] 額外抓取所有規格值
            const { data: specsData, error: specsError } = await supabase.from('product_spec_values')
                .select('*')
                .eq('lifecycle_state', 'active');

            if (specsError) throw specsError;

            // 建立規格值索引：entity_id -> { [pathKey]: value }
            const specsMap = new Map<string, Record<string, any>>();
            (specsData || []).forEach((sv: any) => {
                if (!specsMap.has(sv.entity_id)) {
                    specsMap.set(sv.entity_id, {});
                }
                const entitySpecs = specsMap.get(sv.entity_id)!;
                // 構造路徑 Key (A:B:C 格式，此處簡化為 InstanceUUID:SpecID:ParentID)
                const pathKey = `${sv.instance_uuid}:${sv.spec_id}${sv.parent_id ? `:${sv.parent_id}` : ''}`;
                entitySpecs[pathKey] = sv.value;
            });

            products = (productsData || []).map((p: any) => {
                // 輔助函式：從聯集表中提取型號名稱
                const getModelNames = (target: any) => {
                    const direct = (target.product_model_links || target.variant_model_links)?.map((l: any) => l.device_models?.name) || [];
                    const group = (target.product_model_group_links || target.variant_model_group_links)?.map((l: any) => l.device_model_groups?.name) || [];
                    return Array.from(new Set([...direct, ...group])).filter(Boolean) as string[];
                };

                return {
                    ...p,
                    category_ids: p.product_category_links?.map((l: any) => l.category_id) || [],
                    category_names: p.product_category_links?.map((l: any) => l.categories?.name).filter(Boolean) || [],
                    effective_model_names: getModelNames(p),
                    spec_values: specsMap.get(p.id) || {},
                    variants: p.variants?.map((v: any) => ({
                        ...v,
                        effective_model_names: getModelNames(v),
                        spec_values: specsMap.get(v.id) || {}
                    }))
                };
            }) as unknown as ProductWithDetails[];
        }

        setProductCache({ version: newSequenceId, data: products });
        return products;
    } catch (error) {
        console.error('[ProductCache] 🔴 同步失敗:', error);
        return [];
    }
};

/**
 * [V7.5] React Hook: 提供 UI 元件訂閱產品快取
 */
export const useProductCache = (storeId?: string | null) => {
    const [products, setProducts] = useState<ProductWithDetails[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const cache = getProductCache();
        if (cache) {
            setProducts(cache.data);
            setVersion(cache.version);
        }
        setIsLoading(false);
    }, []);

    const refresh = async () => {
        setIsLoading(true);
        const updated = await syncProducts();
        setProducts(updated);
        const cache = getProductCache();
        if (cache) setVersion(cache.version);
        setIsLoading(false);
    };

    return {
        products,
        isLoading,
        version,
        refresh,
        forceRefresh: refresh
    };
};

/**
 * [V7.5] 提供門市使用的產品快取，整合定價資訊
 */
export const useStoreProductCache = (storeId?: string | null) => {
    const { products: rawProducts, isLoading: isCacheLoading, version, refresh } = useProductCache();

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
        enabled: true, // 即使沒有 storeId 也抓取，作為全域定價覆蓋
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
                retail_price: mainStoreProduct?.retail_price || p.base_retail_price || 0,
                has_store_price: !!mainStoreProduct,
                variants: (p.variants || []).map((v: any) => {
                    const variantStoreProduct = storeSettings.find((sp: any) => sp.variant_id === v.id);
                    return {
                        ...v,
                        effective_wholesale_price: variantStoreProduct?.wholesale_price || v.wholesale_price || p.base_wholesale_price || 0,
                        effective_retail_price: variantStoreProduct?.retail_price || v.retail_price || p.base_retail_price || 0,
                        has_brand_price: !!variantStoreProduct,
                        spec_values: v.spec_values
                    } as VariantWithPricing;
                })
            } as ProductWithPricing;
        });
    }, [rawProducts, storeProducts]);

    return { 
        products: productsWithPricing, 
        isLoading: isCacheLoading || isStoreLoading, 
        version, 
        refresh, 
        forceRefresh: refresh 
    };
};
