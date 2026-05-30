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
import { entityRelationService } from '@/services/entityRelationService';

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

    const { categories, categoryHierarchy } = useSpecStore();

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

        // 1. 商品主體：直連型號物件（含別名）
        product.device_models?.forEach(m => {
            if (m?.name) models.push({ name: m.name, aliases: (m as any).aliases || [] });
        });

        // 2. 商品主體：群組名稱（快取中為 string[]，直接使用字串值）
        (product.device_model_groups as any)?.forEach((g: any) => {
            const name = typeof g === 'string' ? g : g?.name;
            if (name) models.push({ name, aliases: [] });
        });

        // 3. 遍歷所有變體，將變體上綁定的型號與群組也納入搜尋範圍
        (product as any).variants?.forEach((v: any) => {
            v.device_models?.forEach((m: any) => {
                if (m?.name) models.push({ name: m.name, aliases: m.aliases || [] });
            });
            v.device_model_groups?.forEach((g: any) => {
                const name = typeof g === 'string' ? g : g?.name;
                if (name) models.push({ name, aliases: [] });
            });
        });

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
                    // 若 settingsRaw 已經是物件（快取結構），則直接使用
                    const flatSettings = typeof settingsRaw === 'object' ? settingsRaw : deserializeSpecs(settingsRaw);
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
    console.log("產品搜尋結果", filteredProducts);
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
                spec_values,
                ...productData
            } = values;

            // 1. 建立產品
            const { data: product, error: productError } = await supabase.from('products')
                .insert({ ...productData })
                .select().single();
            if (productError) throw productError;

            // 2. 建立分類關聯
            if (category_ids?.length > 0) {
                const { error } = await supabase.from('product_category_links').insert(
                    category_ids.map((catId: string) => ({ product_id: product.id, category_id: catId }))
                );
                if (error) throw error;
            }

            // 3. 使用統一服務建立型號關聯
            await entityRelationService.updateRelations('product', product.id, {
                modelIds: device_model_ids,
                groupIds: device_model_group_ids,
                exclusions: device_model_exclusion_ids.map((id: string) => ({ model_id: id }))
            });

            // 4. 同步產品規格
            if (spec_values && !values.has_variants && category_ids?.[0]) {
                const { error: specError } = await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: product.id,
                    p_entity_type: 'product',
                    p_category_id: category_ids[0],
                    p_new_data: spec_values
                });
                if (specError) throw specError;
            }

            // 5. 同步前台展示虛擬商品
            await supabase.rpc('sync_storefront_items', { p_product_id: product.id });

            return product;
        },
        onSuccess: async (product) => {
            await forceRefresh();
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            toast.success('產品已新增');
            // 從更新後的 cache 取得含 category_ids 的完整產品物件
            const cache = (await import('@/hooks/useProductCache')).getProductCache();
            const fullProduct = cache?.data?.find((p: any) => p.id === product.id);
            setEditingProduct((fullProduct || product) as any);
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: any }) => {
            const {
                category_ids,
                device_model_ids,
                device_model_group_ids = [],
                device_model_exclusion_ids = [],
                spec_values,
                ...productData
            } = values;

            // 1. 更新主資料
            const { error: productError } = await supabase.from('products')
                .update({ ...productData, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (productError) throw productError;

            // 2. 更新分類關聯
            await supabase.from('product_category_links').delete().eq('product_id', id);
            if (category_ids?.length > 0) {
                await supabase.from('product_category_links').insert(
                    category_ids.map((catId: string) => ({ product_id: id, category_id: catId }))
                );
            }

            // 3. 使用統一服務更新型號關聯
            await entityRelationService.updateRelations('product', id, {
                modelIds: device_model_ids,
                groupIds: device_model_group_ids,
                exclusions: device_model_exclusion_ids.map((id: string) => ({ model_id: id }))
            });

            // 4. 同步產品規格
            if (spec_values && !values.has_variants && category_ids?.[0]) {
                const { error: specError } = await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: id,
                    p_entity_type: 'product',
                    p_category_id: category_ids[0],
                    p_new_data: spec_values
                });
                if (specError) throw specError;
            }

            // 5. 同步前台展示虛擬商品
            await supabase.rpc('sync_storefront_items', { p_product_id: id });
        },
        onSuccess: async () => {
            await forceRefresh();
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
        onSuccess: async () => {
            await forceRefresh();
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
            await forceRefresh();
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
            setSelectedProductIds(new Set());
            toast.success('匯出成功');
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(`匯出失敗: ${error.message}`);
        }
    };

    const handleImportSuccess = useCallback(() => {
        setSelectedProductIds(new Set());
        forceRefresh();
        toast.success('產品資料匯入成功，已重置選擇狀態');
    }, [forceRefresh]);

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
        handleCopy, handleBatchExport, handleImportSuccess, getProductVariants, getProductModels,
        createMutation, updateMutation, deleteMutation, updateVariantPriceMutation,
        selectedCategory, setSelectedCategory,
        selectedSpecs, setSelectedSpecs,
        selectedBrands, setSelectedBrands,
        clearFilters
    };
}
