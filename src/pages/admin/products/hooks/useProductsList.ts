import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductCache } from '@/hooks/useProductCache';
import { useSpecStore } from '@/store/useSpecStore';
import { getSubCategoryIds, productMatchesSpecFilters } from '@/utils/treeUtils';
import { useBrands } from '@/hooks/useBrands';
import { useProductMutations } from './useProductMutations';
import { handleBatchExport } from './useProductExport';

import { ProductWithPricing } from '@/types/product';

type Product = ProductWithPricing;

function parseSpecsFromUrl(raw: string | null): Record<string, string[]> {
    if (!raw) return {};
    try {
        return JSON.parse(decodeURIComponent(raw));
    } catch { return {}; }
}

function parseSetFromUrl(raw: string | null): Set<string> {
    if (!raw) return new Set();
    return new Set(raw.split(',').filter(Boolean));
}

export function useProductsList() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { products, isLoading, version, forceRefresh } = useProductCache();
    const { brandMap } = useBrands();

    // --- UI States ---
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [activeTab, setActiveTab] = useState<'list' | 'variants' | 'models' | 'colors'>(
        (['list', 'variants', 'models', 'colors'].includes(searchParams.get('tab') || '') ? searchParams.get('tab') : 'list') as 'list' | 'variants' | 'models' | 'colors'
    );
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(parseSetFromUrl(searchParams.get('expanded')));

    // --- Filter States ---
    const [selectedCategory, setSelectedCategory] = useState<string | null>(searchParams.get('category') || null);
    const [selectedSpecs, setSelectedSpecs] = useState<Record<string, string[]>>(parseSpecsFromUrl(searchParams.get('specs')));
    const [selectedBrands, setSelectedBrands] = useState<string[]>(searchParams.get('brands')?.split(',').filter(Boolean) || []);

    // --- Dialog States ---
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

    const { categoryHierarchy } = useSpecStore();

    const subCategoryIds = useMemo(() => {
        return getSubCategoryIds(selectedCategory, categoryHierarchy);
    }, [selectedCategory, categoryHierarchy]);

    // --- Mutations ---
    const mutations = useProductMutations(forceRefresh);

    // --- Helpers ---
    const toggleExpanded = (productId: string) => {
        setExpandedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            const str = Array.from(next).join(',');
            updateUrl(str ? { expanded: str } : { expanded: null });
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

        product.device_models?.forEach(m => {
            if (m?.name) models.push({ name: m.name, aliases: (m as any).aliases || [] });
        });

        (product.device_model_groups as any)?.forEach((g: any) => {
            const name = typeof g === 'string' ? g : g?.name;
            if (name) models.push({ name, aliases: [] });
        });

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

        const pModels = product.effective_model_names || [];
        const vModels = (product as any).variants?.flatMap((v: any) => v.effective_model_names || []) || [];

        return Array.from(new Set([...pModels, ...vModels])).filter(Boolean) as string[];
    }, [products]);

    const getProductModelGroups = useCallback((productId: string) => {
        const product = products?.find(p => p.id === productId);
        if (!product) return [];

        const pGroups = (product.device_model_groups || []).map((g: any) => g.name).filter(Boolean);
        const vGroups = (product as any).variants?.flatMap((v: any) =>
            (v.device_model_groups || []).map((g: any) => g.name).filter(Boolean)
        ) || [];

        return Array.from(new Set([...pGroups, ...vGroups])) as string[];
    }, [products]);

    // --- Filter Logic ---
    const filteredProducts = useMemo(() => {
        if (!products) return [];
        return products.filter((p) => {
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

            if (selectedCategory) {
                const pCategoryIds = (p as any).category_ids || [];
                if (!pCategoryIds.some((id: string) => subCategoryIds.has(id))) {
                    return false;
                }
            }

            if (selectedBrands.length > 0) {
                if (!p.brand_id || !selectedBrands.includes(p.brand_id)) {
                    return false;
                }
            }

            if (!productMatchesSpecFilters(p, selectedSpecs, getProductVariants)) return false;

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

    // --- Event Handlers ---
    const handleCopy = (product: Product) => mutations.handleCopy(product, setEditingProduct, setIsDialogOpen);

    const handleBatchExportWrapper = () => handleBatchExport(
        products, selectedProductIds, getProductVariants, brandMap,
        () => setSelectedProductIds(new Set())
    );

    const handleImportSuccess = useCallback(() => {
        setSelectedProductIds(new Set());
        forceRefresh();
    }, [forceRefresh]);

    const updateUrl = (overrides: Record<string, string | null>) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            for (const [key, val] of Object.entries(overrides)) {
                if (val) next.set(key, val);
                else next.delete(key);
            }
            return next;
        }, { replace: true });
    };

    const updateSearch = (val: string) => {
        setSearch(val);
        updateUrl(val ? { search: val } : { search: null });
    };

    const updateActiveTab = (val: 'list' | 'variants' | 'models' | 'colors') => {
        setActiveTab(val);
        updateUrl({ tab: val });
    };

    const updateExpanded = (val: Set<string>) => {
        setExpandedProducts(val);
        const str = Array.from(val).join(',');
        updateUrl(str ? { expanded: str } : { expanded: null });
    };

    const updateCategory = (val: string | null) => {
        setSelectedCategory(val);
        updateUrl(val ? { category: val } : { category: null });
    };

    const updateBrands = (val: string[]) => {
        setSelectedBrands(val);
        const str = val.join(',');
        updateUrl(str ? { brands: str } : { brands: null });
    };

    const updateSpecs = (val: Record<string, string[]>) => {
        setSelectedSpecs(val);
        const keys = Object.keys(val);
        if (keys.length > 0) {
            updateUrl({ specs: encodeURIComponent(JSON.stringify(val)) });
        } else {
            updateUrl({ specs: null });
        }
    };

    const clearFilters = useCallback(() => {
        setSelectedCategory(null);
        setSelectedSpecs({});
        setSelectedBrands([]);
        setSearch('');
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('search');
            next.delete('category');
            next.delete('brands');
            next.delete('specs');
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    return {
        products, isLoading, version, forceRefresh,
        brandMap,
        search, setSearch: updateSearch, activeTab, setActiveTab: updateActiveTab,
        selectedProductIds, toggleSelect, toggleSelectAll, isAllSelected,
        expandedProducts, toggleExpanded, filteredProducts,
        isDialogOpen, setIsDialogOpen, isImportOpen, setIsImportOpen,
        editingProduct, setEditingProduct, deleteProduct, setDeleteProduct,
        handleCopy, handleBatchExport: handleBatchExportWrapper, handleImportSuccess, getProductVariants, getProductModels, getProductModelGroups,
        createMutation: mutations.createMutation, updateMutation: mutations.updateMutation,
        deleteMutation: mutations.deleteMutation, updateVariantPriceMutation: mutations.updateVariantPriceMutation,
        selectedCategory, setSelectedCategory: updateCategory,
        selectedSpecs, setSelectedSpecs: updateSpecs,
        selectedBrands, setSelectedBrands: updateBrands,
        clearFilters
    };
}
