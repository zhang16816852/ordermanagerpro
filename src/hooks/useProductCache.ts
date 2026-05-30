import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Product, ProductWithDetails, ProductWithPricing, VariantWithPricing } from '@/types/product';
import { SyncManager } from '@/services/syncManager';

const PRODUCT_CACHE_KEY = 'products_cache_v3';

interface ProductCacheData {
    version: string;
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
                    product_category_links(category_id, categories(name))
                `);

            if (productsError) throw productsError;

            // 2. 關聯資料全量抓取 (優化效能：不再使用嵌套 Select)
            const [
                { data: allLinks },
                { data: allGroupLinks },
                { data: allExclusions },
                { data: allSpecs },
                { data: allCovers }   // 封面圖片
            ] = await Promise.all([
                supabase.from('device_model_links').select('entity_id, model_id, device_models(id, name, aliases)'),
                supabase.from('device_model_group_links').select('entity_id, group_id, device_model_groups(id, name, device_model_group_items(device_models(id, name, aliases)))'),
                supabase.from('device_model_exclusions').select('entity_id, model_id, device_models(id, name, aliases)'),
                supabase.from('entity_spec_values').select('*'),
                supabase.from('product_images').select('entity_type, entity_id, url').eq('is_cover', true)
            ]);

            // 3. 建立索引索引 Map
            const linksMap = new Map<string, any[]>();
            allLinks?.forEach(l => {
                if (!linksMap.has(l.entity_id)) linksMap.set(l.entity_id, []);
                linksMap.get(l.entity_id)!.push(l);
            });

            const groupsMap = new Map<string, any[]>();
            allGroupLinks?.forEach(l => {
                if (!groupsMap.has(l.entity_id)) groupsMap.set(l.entity_id, []);
                groupsMap.get(l.entity_id)!.push(l);
            });

            const exclusionsMap = new Map<string, any[]>();
            allExclusions?.forEach(l => {
                if (!exclusionsMap.has(l.entity_id)) exclusionsMap.set(l.entity_id, []);
                exclusionsMap.get(l.entity_id)!.push(l);
            });

            const specsMap = new Map<string, Record<string, any>>();
            allSpecs?.forEach((sv: any) => {
                if (!specsMap.has(sv.entity_id)) specsMap.set(sv.entity_id, {});
                const entitySpecs = specsMap.get(sv.entity_id)!;
                const parentId = sv.parent_id || 'root';
                const pathKey = `${parentId}:${sv.spec_id}:${sv.instance_uuid}`;
                entitySpecs[pathKey] = sv.value;
            });

            // 建立封面圖 Map (entity_id -> image_url)
            const coversMap = new Map<string, string>();
            allCovers?.forEach((img: any) => {
                coversMap.set(img.entity_id, img.url);
            });

            // 4. 資料對映處理
            products = (productsData || []).map((p: any) => {
                const processModels = (entityId: string) => {
                    const rules: string[] = [];
                    const directLinks = linksMap.get(entityId) || [];
                    const exclusionLinks = exclusionsMap.get(entityId) || [];
                    const groupLinks = groupsMap.get(entityId) || [];

                    const exclusions = new Set<string>();
                    exclusionLinks.forEach(l => {
                        if (l.device_models) {
                            exclusions.add(l.device_models.id);
                            rules.push(`exclude:${l.device_models.name}`);
                        }
                    });

                    const directModels = directLinks
                        .filter(l => l.device_models && !exclusions.has(l.device_models.id))
                        .map(l => {
                            rules.push(`model:${l.device_models.name}`);
                            return l.device_models;
                        });

                    const groups: any[] = [];
                    const expandedFromGroups: any[] = [];
                    groupLinks.forEach(link => {
                        const group = link.device_model_groups;
                        if (group) {
                            const groupItems = (group.device_model_group_items || [])
                                .map((item: any) => {
                                    if (item.device_models && !exclusions.has(item.device_models.id)) {
                                        expandedFromGroups.push(item.device_models);
                                        return { id: item.device_models.id, name: item.device_models.name };
                                    }
                                    return null;
                                })
                                .filter(Boolean);

                            groups.push({ id: group.id, name: group.name, items: groupItems });
                            rules.push(`group:${group.name}`);
                        }
                    });

                    return {
                        device_models: directModels,
                        device_model_groups: groups,
                        device_model_rules: rules,
                        _expanded_models: Array.from(new Set([...directModels, ...expandedFromGroups].map(m => m.name))),
                        _expanded_model_aliases: Array.from(new Set([...directModels, ...expandedFromGroups].flatMap(m => m.aliases || []))),
                        device_model_exclusions: Array.from(exclusions)
                    };
                };

                const modelDataP = processModels(p.id);

                return {
                    ...p,
                    ...modelDataP,
                    image_url: coversMap.get(p.id) || null,   // 注入主商品封面圖
                    category_ids: p.product_category_links?.map((l: any) => l.category_id) || [],
                    category_names: p.product_category_links?.map((l: any) => l.categories?.name).filter(Boolean) || [],
                    effective_model_names: modelDataP._expanded_models,
                    effective_model_aliases: modelDataP._expanded_model_aliases,
                    spec_values: specsMap.get(p.id) || {},
                    variants: p.variants?.map((v: any) => {
                        const modelDataV = processModels(v.id);
                        return {
                            ...v,
                            ...modelDataV,
                            image_url: coversMap.get(v.id) || null,   // 注入變體封面圖
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

/**
 * [V7.5] React Hook: 提供 UI 元件訂閱產品快取
 */
export const useProductCache = (storeId?: string | null) => {
    const [products, setProducts] = useState<ProductWithDetails[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [version, setVersion] = useState<string>('0');

    useEffect(() => {
        // 監聽來自 SyncManager 的樂觀更新事件，實現即時反應
        const handleOptimisticUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail) {
                setProducts(customEvent.detail.data);
                setVersion(customEvent.detail.version);
            }
        };
        window.addEventListener('optimistic-product-cache-update', handleOptimisticUpdate);

        const cache = getProductCache();
        if (cache) {
            setProducts(cache.data);
            setVersion(cache.version);

            // 如果快取中所有產品的 spec_values 都是空的，代表是舊版快取，強制重新 fetch
            const allEmpty = cache.data.every((p: any) => !p.spec_values || Object.keys(p.spec_values).length === 0);
            if (allEmpty && cache.data.length > 0) {
                setIsLoading(true);
                syncProducts().then(updated => {
                    setProducts(updated);
                    const newCache = getProductCache();
                    if (newCache) setVersion(newCache.version);
                    setIsLoading(false);
                });
            } else {
                setIsLoading(false);
            }
        } else {
            // 沒有快取，主動 fetch 一次
            setIsLoading(true);
            syncProducts().then(updated => {
                setProducts(updated);
                const newCache = getProductCache();
                if (newCache) setVersion(newCache.version);
                setIsLoading(false);
            });
        }

        return () => {
            window.removeEventListener('optimistic-product-cache-update', handleOptimisticUpdate);
        };
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
