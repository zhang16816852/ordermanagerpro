import { useState, useCallback, useMemo } from 'react';
import { deserializeSpecs, formatSpecValue } from '@/utils/specLogic';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { useProductCache } from '@/hooks/useProductCache';
import { useSpecStore } from '@/store/useSpecStore';
import { toast } from 'sonner';
import { formatSpecsToCondensedString } from '@/utils/specLogic';
import { useBrands } from '@/hooks/useBrands';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { generateProductExcel } from '@/utils/excelUtils';

import { ProductWithPricing } from '@/types/product';

type Product = ProductWithPricing;

export function useProductsList() {
    const queryClient = useQueryClient();
    const { products, isLoading, version, forceRefresh } = useProductCache();
    const { specDefinitions: specDefs } = useSpecStore();
    const { brandMap } = useBrands();

    // --- UI States ---
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'list' | 'variants' | 'models' | 'colors'>('list');
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    // --- Filter States ---
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedSpecs, setSelectedSpecs] = useState<Record<string, string[]>>({});
    const [selectedBrands, setSelectedBrands] = useState<string[]>([]);

    // --- Dialog States ---
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

    // --- Queries ---
    const { data: categoryHierarchy = [] } = useQuery({
        queryKey: ['category_hierarchy'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    // Helper: Get all child category IDs (inclusive)
    const subCategoryIds = useMemo(() => {
        if (!selectedCategory) return new Set<string>();
        const ids = new Set<string>([selectedCategory]);
        const queue = [selectedCategory];
        while (queue.length > 0) {
            const parentId = queue.shift();
            categoryHierarchy
                .filter((h: any) => h.parent_id === parentId)
                .forEach((h: any) => {
                    if (!ids.has(h.child_id)) {
                        ids.add(h.child_id);
                        queue.push(h.child_id);
                    }
                });
        }
        return ids;
    }, [selectedCategory, categoryHierarchy]);

    // --- Helpers ---
    const toggleExpanded = (productId: string) => {
        setExpandedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            return next;
        });
    };

    const getProductVariants = useCallback((productId: string) => {
        const product = products?.find(p => p.id === productId);
        return product?.variants || [];
    }, [products]);

    const getProductModelsInfo = useCallback((productId: string) => {
        const product = products?.find(p => p.id === productId);
        if (!product) return [];

        const models: { name: string, aliases: string[] }[] = [];

        // 1. 直連
        product.device_models?.forEach(m => models.push({ name: m.name, aliases: (m as any).aliases || [] }));

        // 2. 群組名稱也納入搜尋
        product.device_model_groups?.forEach(g => models.push({ name: g.name, aliases: [] }));

        return models;
    }, [products]);

    const getProductModels = useCallback((productId: string) => {
        const product = products?.find(p => p.id === productId);
        if (!product) return [];
        
        // 彙整產品本身與所有變體的適用型號
        const pModels = product.effective_model_names || [];
        const vModels = (product as any).variants?.flatMap((v: any) => v.effective_model_names || []) || [];
        
        return Array.from(new Set([...pModels, ...vModels])).filter(Boolean) as string[];
    }, [products]);

    const getProductBadgeInfo = useCallback((productId: string) => {
        const product = products?.find(p => p.id === productId);
        if (!product) return [];

        const parts: string[] = [];

        // 1. 直連型號 (model:NAME)
        product.device_models?.forEach(m => parts.push(`model:${m.name}`));

        // 2. 群組 (group:NAME)
        product.device_model_groups?.forEach(g => parts.push(`group:${g.name}`));

        // 3. 排除 (exclude:NAME)
        product.device_model_exclusions?.forEach(e => parts.push(`exclude:${e.name}`));

        return parts;
    }, [products]);

    // v4.12 搜尋邏輯升級：支援分類、品牌、規格進階篩選
    const filteredProducts = useMemo(() => {
        if (!products) return [];
        return products.filter((p) => {
            // 1. Search Filter
            const brandName = (p.brand_id ? brandMap[p.brand_id] : p.brand_id) || '';
            const searchLower = search.toLowerCase();
            const productModels = getProductModelsInfo(p.id);
            const matchesSearch = !search ||
                p.name.toLowerCase().includes(searchLower) ||
                p.sku.toLowerCase().includes(searchLower) ||
                brandName.toLowerCase().includes(searchLower) ||
                (p.model && p.model.toLowerCase().includes(searchLower)) ||
                productModels.some(m =>
                    m.name.toLowerCase().includes(searchLower) ||
                    m.aliases.some((a: string) => a.toLowerCase().includes(searchLower))
                );

            if (!matchesSearch) return false;

            // 2. Category Filter
            if (selectedCategory) {
                const pCategoryIds = (p as any).category_ids || [];
                if (!pCategoryIds.some((id: string) => subCategoryIds.has(id))) {
                    return false;
                }
            }

            // 3. Brand Filter
            if (selectedBrands.length > 0) {
                if (!p.brand_id || !selectedBrands.includes(p.brand_id)) {
                    return false;
                }
            }

            // 4. Spec Filters
            const specKeys = Object.keys(selectedSpecs);
            if (specKeys.length > 0) {
                const matchesSpec = (settingsRaw: any) => {
                    if (!settingsRaw) return false;
                    const flatSettings = deserializeSpecs(settingsRaw);
                    return specKeys.every((key) => {
                        const allowedValues = selectedSpecs[key];
                        if (!allowedValues || allowedValues.length === 0) return true;
                        const val = flatSettings[key];
                        const actualValue = formatSpecValue(val);
                        return allowedValues.includes(actualValue);
                    });
                };

                const productMatches = matchesSpec((p as any).spec_values);
                const variants = getProductVariants(p.id);
                const anyVariantMatches = variants.some((v) => matchesSpec((v as any).spec_values));

                if (!productMatches && !anyVariantMatches) return false;
            }

            return true;
        });
    }, [products, search, brandMap, selectedCategory, subCategoryIds, selectedBrands, selectedSpecs, getProductVariants]);

    // --- Selection Logic ---
    const isAllSelected = filteredProducts && filteredProducts.length > 0 &&
        filteredProducts.every(p => selectedProductIds.has(p.id));

    const toggleSelectAll = (checked: boolean) => {
        if (checked) {
            const allIds = filteredProducts?.map(p => p.id) || [];
            setSelectedProductIds(prev => {
                const next = new Set(prev);
                allIds.forEach(id => next.add(id));
                return next;
            });
        } else {
            setSelectedProductIds(prev => {
                const next = new Set(prev);
                filteredProducts?.forEach(p => next.delete(p.id));
                return next;
            });
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedProductIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // --- Mutations ---
    const createMutation = useMutation({
        mutationFn: async (values: any) => {
            const {
                category_ids,
                device_model_ids,
                device_model_group_ids = [],
                device_model_exclusion_ids = [],
                category, category_id, device_models,
                spec_values, // 從主資料中拽出，不寫入 products 表
                ...productData
            } = values;

            // 建立產品 (v6 架構下，規格改為透過 RPC 寫入獨立資料表)
            const { data: product, error: productError } = await supabase.from('products')
                .insert({ ...productData })
                .select().single();
            if (productError) throw productError;

            const promises = [];
            if (category_ids?.length > 0) {
                promises.push(supabase.from('product_category_links').insert(
                    category_ids.map((catId: string) => ({ product_id: product.id, category_id: catId }))
                ));
            }
            if (device_model_ids?.length > 0) {
                promises.push(supabase.from('product_model_links').insert(
                    device_model_ids.map((mId: string) => ({ product_id: product.id, model_id: mId }))
                ));
            }
            if (device_model_group_ids.length > 0) {
                promises.push(supabase.from('product_model_group_links').insert(
                    device_model_group_ids.map((gId: string) => ({ product_id: product.id, group_id: gId }))
                ));
            }
            if (device_model_exclusion_ids.length > 0) {
                promises.push(supabase.from('product_model_exclusions').insert(
                    device_model_exclusion_ids.map((mId: string) => ({ product_id: product.id, model_id: mId }))
                ));
            }

            if (promises.length > 0) await Promise.all(promises);

            // v6 同步產品規格至新資料表
            if (spec_values && !values.has_variants && category_ids?.[0]) {
                const { error: specError } = await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: product.id,
                    p_entity_type: 'product',
                    p_category_id: category_ids[0],
                    p_new_data: spec_values
                });
                if (specError) console.error('產品規格同步失敗:', specError);
            }

            return product;
        },
        onSuccess: (product) => {
            forceRefresh();
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-model-links'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
            toast.success('產品已新增，您現在可以繼續設定變體與規格');
            setEditingProduct(product as any);
            // 不關閉彈窗，讓使用者繼續操作變體
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: any }) => {
            const {
                category_ids,
                device_model_ids,
                device_model_group_ids = [],
                device_model_exclusion_ids = [],
                category, category_id, device_models,
                spec_values, // 從主資料中拽出，不寫入 products 表
                ...productData
            } = values;

            // 先刪除所有舊關聯
            await Promise.all([
                supabase.from('product_category_links').delete().eq('product_id', id),
                supabase.from('product_model_links').delete().eq('product_id', id),
                supabase.from('product_model_group_links').delete().eq('product_id', id),
                supabase.from('product_model_exclusions').delete().eq('product_id', id),
            ]);

            const promises = [];
            if (category_ids?.length > 0) {
                promises.push(supabase.from('product_category_links').insert(
                    category_ids.map((catId: string) => ({ product_id: id, category_id: catId }))
                ));
            }
            if (device_model_ids?.length > 0) {
                promises.push(supabase.from('product_model_links').insert(
                    device_model_ids.map((mId: string) => ({ product_id: id, model_id: mId }))
                ));
            }
            if (device_model_group_ids.length > 0) {
                promises.push(supabase.from('product_model_group_links').insert(
                    device_model_group_ids.map((gId: string) => ({ product_id: id, group_id: gId }))
                ));
            }
            if (device_model_exclusion_ids.length > 0) {
                promises.push(supabase.from('product_model_exclusions').insert(
                    device_model_exclusion_ids.map((mId: string) => ({ product_id: id, model_id: mId }))
                ));
            }

            if (promises.length > 0) await Promise.all(promises);

            // 更新主資料
            const { error: productError } = await supabase.from('products')
                .update({ ...productData, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (productError) throw productError;

            // v6 同步產品規格至新資料表
            if (spec_values && !values.has_variants && category_ids?.[0]) {
                const { error: specError } = await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: id,
                    p_entity_type: 'product',
                    p_category_id: category_ids[0],
                    p_new_data: spec_values
                });
                if (specError) console.error('產品規格同步失敗:', specError);
            }
        },
        onSuccess: () => {
            forceRefresh();
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-model-links'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
            toast.success('產品已更新');
            setIsDialogOpen(false);
            setEditingProduct(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('products').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            toast.success('產品已刪除');
            setDeleteProduct(null);
        },
    });

    const updateVariantPriceMutation = useMutation({
        mutationFn: async ({ id, ...updates }: { id: string, wholesale_price?: number, retail_price?: number, status?: any }) => {
            const { error } = await supabase.from('product_variants').update(updates).eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
            toast.success('變體已更新');
        },
    });

    const handleCopy = async (product: Product) => {
        const newName = `${product.name} (複製)`;
        const newSku = `${product.sku}-COPY-${Math.floor(Math.random() * 1000)}`;
        try {
            const { data: newProductId, error } = await (supabase.rpc as any)('duplicate_product_with_variants', {
                target_product_id: product.id,
                new_name: newName,
                new_sku: newSku,
            });
            if (error) throw error;
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            toast.success('產品及其變體已完整複製');
            if (newProductId) {
                const { data: newProduct } = await supabase.from('products').select('*').eq('id', newProductId).single();
                if (newProduct) { setEditingProduct(newProduct as any); setIsDialogOpen(true); }
            }
        } catch (error: any) { toast.error(`複製失敗：${error.message}`); }
    };

    const handleBatchExport = async () => {
        const { data: categoriesData } = await supabase.from('categories').select('*');
        const { data: specLinks } = await supabase.from('category_spec_links').select('*');

        const selected = (products || []).filter(p => selectedProductIds.has(p.id)).map(p => ({
            ...p,
            variants: getProductVariants(p.id)
        }));
        console.log(selected);
        if (selected.length === 0) {
            toast.error('請先選取要匯出的產品');
            return;
        }

        try {
            const workbook = generateProductExcel(selected, categoriesData || [], specDefs || [], specLinks || [], brandMap);
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `產品匯出_${new Date().toISOString().slice(0, 10)}.xlsx`;
            link.click();
            URL.revokeObjectURL(url);
            toast.success('匯出成功');
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(`匯出失敗: ${error.message}`);
        }
    };

    const clearFilters = useCallback(() => {
        setSelectedCategory(null);
        setSelectedSpecs({});
        setSelectedBrands([]);
        setSearch('');
    }, []);

    return {
        products, isLoading, version, forceRefresh,
        brandMap,
        search, setSearch, activeTab, setActiveTab,
        selectedProductIds, toggleSelect, toggleSelectAll, isAllSelected,
        expandedProducts, toggleExpanded, filteredProducts,
        isDialogOpen, setIsDialogOpen, isImportOpen, setIsImportOpen,
        editingProduct, setEditingProduct, deleteProduct, setDeleteProduct,
        handleCopy, handleBatchExport, getProductVariants, getProductModels,
        createMutation, updateMutation, deleteMutation, updateVariantPriceMutation,
        selectedCategory, setSelectedCategory,
        selectedSpecs, setSelectedSpecs,
        selectedBrands, setSelectedBrands,
        clearFilters
    };
}
