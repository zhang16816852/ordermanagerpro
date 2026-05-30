import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ProductWithDetails, ProductWithPricing, VariantWithPricing } from '@/types/product';

const ADMIN_PRODUCT_CACHE_KEY = 'admin_products_cache_v1';

interface AdminProductCacheData {
    version: number;
    data: ProductWithDetails[];
}

export const getAdminProductCache = (): AdminProductCacheData | null => {
    try {
        const cached = localStorage.getItem(ADMIN_PRODUCT_CACHE_KEY);
        if (!cached) return null;
        return JSON.parse(cached);
    } catch {
        localStorage.removeItem(ADMIN_PRODUCT_CACHE_KEY);
        return null;
    }
};

export const setAdminProductCache = (cache: AdminProductCacheData) => {
    localStorage.setItem(ADMIN_PRODUCT_CACHE_KEY, JSON.stringify(cache));
};

const ADMIN_PRODUCT_CACHE_UPDATED_EVENT = 'admin-product-cache-updated';

/**
 * 後台業務層產品同步核心
 */
export const syncAdminProducts = async (incomingData?: any, version?: number): Promise<ProductWithDetails[]> => {
    try {
        const cache = getAdminProductCache();
        let products = cache?.data || [];
        let newSequenceId = version ?? (cache?.version || 0);

        if (incomingData) {
            console.log(`[AdminProductCache] 收到增量更新訊號，準備執行全量拉取以涵蓋關聯資料`);
            newSequenceId = incomingData.serverSequenceId ?? newSequenceId;
        }

        console.log(`[AdminProductCache] 📡 執行更新...`);

        // 1. 基本資料抓取 (Products + Variants)
        const { data: productsData, error: productsError } = await supabase.from('products')
            .select(`
                *,
                variants:product_variants(*),
                product_category_links(category_id, categories(name))
            `);

        if (productsError) throw productsError;

        // 2. 關聯資料全量抓取 (優化效能：不使用嵌套 Select)
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
            supabase.from('entity_spec_values').select('*').eq('lifecycle_state', 'active'),
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
            const pathKey = `${sv.instance_uuid}:${sv.spec_id}${sv.parent_id ? `:${sv.parent_id}` : ''}`;
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
                image_url: coversMap.get(p.id) || null,
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
                        image_url: coversMap.get(v.id) || null,
                        effective_model_names: modelDataV._expanded_models,
                        effective_model_aliases: modelDataV._expanded_model_aliases,
                        spec_values: specsMap.get(v.id) || {}
                    };
                })
            };
        }) as unknown as ProductWithDetails[];

        setAdminProductCache({ version: newSequenceId, data: products });
        window.dispatchEvent(new CustomEvent(ADMIN_PRODUCT_CACHE_UPDATED_EVENT));
        return products;
    } catch (error) {
        console.error('[AdminProductCache] 🔴 同步失敗:', error);
        return [];
    }
};

/**
 * 後台 React Hook
 */
export const useAdminProductCache = () => {
    const [products, setProducts] = useState<ProductWithDetails[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [version, setVersion] = useState(0);

    const readFromCache = () => {
        const cache = getAdminProductCache();
        if (cache) {
            setProducts(cache.data);
            setVersion(cache.version);
        }
    };

    useEffect(() => {
        readFromCache();
        setIsLoading(false);

        const handleCacheUpdated = () => {
            console.log('[useAdminProductCache] 📬 收到後台快取更新通知，重新讀取');
            readFromCache();
        };
        window.addEventListener(ADMIN_PRODUCT_CACHE_UPDATED_EVENT, handleCacheUpdated);
        return () => window.removeEventListener(ADMIN_PRODUCT_CACHE_UPDATED_EVENT, handleCacheUpdated);
    }, []);

    const refresh = async () => {
        setIsLoading(true);
        const updated = await syncAdminProducts();
        setProducts(updated);
        const cache = getAdminProductCache();
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
