import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { useProductCache } from '@/hooks/useProductCache';
import { toast } from 'sonner';
import Papa from 'papaparse';

type Product = Tables<'products'>;

export function useProductsList() {
    const queryClient = useQueryClient();
    const { products, isLoading, version, forceRefresh } = useProductCache();

    // --- UI States ---
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'list' | 'variants' | 'models'>('list');
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    // --- Dialog States ---
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

    // --- Queries ---

    // v4.9 獲取品牌庫並建立對照表
    const { data: brands = [] } = useQuery({
        queryKey: ['all-brands'],
        queryFn: async () => {
            const { data, error } = await supabase.from('brands').select('*').order('sort_order');
            if (error) throw error;
            return data || [];
        }
    });

    const brandMap = useMemo(() => {
        const map: Record<string, string> = {};
        brands.forEach(b => { map[b.id] = b.name; });
        return map;
    }, [brands]);

    const { data: allVariants = [], isLoading: variantsLoading } = useQuery({
        queryKey: ['all-product-variants'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_variants')
                .select('*, variant_model_links(model_id, device_models(name))')
                .order('sku');
            if (error) throw error;
            return data || [];
        },
    });

    const { data: allModelLinks = [], isLoading: modelsLoading } = useQuery({
        queryKey: ['all-product-model-links'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_model_links')
                .select('product_id, model_id, device_models(name)')
            if (error) throw error;
            return (data as any) || [];
        },
    });

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
        return allVariants.filter(v => v.product_id === productId);
    }, [allVariants]);

    const getProductModels = useCallback((productId: string) => {
        return allModelLinks
            .filter((l: any) => l.product_id === productId)
            .map((l: any) => l.device_models?.name)
            .filter(Boolean);
    }, [allModelLinks]);

    // v4.9 搜尋邏輯升級：支援 brand_id 對照名稱搜尋
    const filteredProducts = products?.filter(
        (p) => {
            const brandName = (p.brand_id ? brandMap[p.brand_id] : p.brand_id) || '';
            const searchLower = search.toLowerCase();
            return p.name.toLowerCase().includes(searchLower) ||
                p.sku.toLowerCase().includes(searchLower) ||
                brandName.toLowerCase().includes(searchLower) ||
                (p.model && p.model.toLowerCase().includes(searchLower));
        }
    );

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
            const { category_ids, device_model_ids, category, category_id, device_models, ...productData } = values;
            const { data: product, error: productError } = await supabase.from('products').insert(productData).select().single();
            if (productError) throw productError;
            if (category_ids?.length > 0) {
                const links = category_ids.map((catId: string) => ({ product_id: product.id, category_id: catId }));
                await (supabase.from('product_category_links' as any) as any).insert(links);
            }
            if (device_model_ids?.length > 0) {
                const links = device_model_ids.map((modelId: string) => ({ product_id: product.id, model_id: modelId }));
                await (supabase.from('product_model_links' as any) as any).insert(links);
            }
            return product;
        },
        onSuccess: () => {
            forceRefresh();
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-model-links'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
            toast.success('產品已新增');
            setIsDialogOpen(false);
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: any }) => {
            const { category_ids, device_model_ids, category, category_id, device_models, ...productData } = values;
            await (supabase.from('product_category_links' as any) as any).delete().eq('product_id', id);
            if (category_ids?.length > 0) {
                const links = category_ids.map((catId: string) => ({ product_id: id, category_id: catId }));
                await (supabase.from('product_category_links' as any) as any).insert(links);
            }

            await (supabase.from('product_model_links' as any) as any).delete().eq('product_id', id);
            if (device_model_ids?.length > 0) {
                const links = device_model_ids.map((modelId: string) => ({ product_id: id, model_id: modelId }));
                await (supabase.from('product_model_links' as any) as any).insert(links);
            }

            const { error: productError } = await supabase.from('products').update({ ...productData, updated_at: new Date().toISOString() }).eq('id', id);
            if (productError) throw productError;
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
                if (newProduct) { setEditingProduct(newProduct); setIsDialogOpen(true); }
            }
        } catch (error: any) { toast.error(`複製失敗：${error.message}`); }
    };

    const handleBatchExport = async () => {
        const STATUS_LABELS: Record<string, string> = {
            active: '上架中',
            discontinued: '已停售',
            preorder: '預購中',
            sold_out: '售完停產',
        };

        // 1. Get all specification definitions to map IDs to names
        const { data: specDefs } = await supabase.from('specification_definitions').select('id, name');
        const specNameMap: Record<string, string> = {};
        specDefs?.forEach(d => { specNameMap[d.id] = d.name; });

        const selected = products?.filter(p => selectedProductIds.has(p.id)) || [];
        const exportData: any[] = [];

        // 2. Identify all spec keys present in selected products/variants to create columns
        const allSpecKeys = new Set<string>();
        selected.forEach(p => {
            if (p.table_settings) Object.keys(p.table_settings).forEach(k => allSpecKeys.add(k));
            const variants = getProductVariants(p.id);
            variants.forEach(v => {
                if (v.table_settings) Object.keys(v.table_settings).forEach(k => allSpecKeys.add(k));
            });
        });

        selected.forEach(p => {
            const variants = getProductVariants(p.id);
            const productModels = getProductModels(p.id).join(',');
            const categoryStr = p.category_names?.join(',') || '';

            // v4.9 品牌處理
            const displayBrand = (p.brand_id ? brandMap[p.brand_id] : p.brand_id) || '';

            // 3. Build condensed spec string for product
            const formatSpecs = (settings: any) => {
                if (!settings) return '';
                return Object.entries(settings)
                    .map(([id, val]) => {
                        const name = specNameMap[id] || id;
                        let valueStr = '';

                        if (Array.isArray(val)) {
                            valueStr = val.join('/');
                        } else if (typeof val === 'object' && val !== null) {
                            // Handle Quantity Details JSON: {"Type-C": 1} -> Type-C*1/USB-A*2
                            valueStr = Object.entries(val)
                                .map(([opt, qty]) => `${opt}*${qty}`)
                                .join('/');
                        } else {
                            valueStr = String(val);
                        }

                        return `${name}:${valueStr}`;
                    })
                    .join(', ');
            };

            const productBase = {
                product_sku: p.sku,
                product_name: p.name,
                description: p.description || '',
                brand: displayBrand,
                model: p.model || '',
                series: p.series || '',
                category: categoryStr,
                base_wholesale_price: p.base_wholesale_price,
                base_retail_price: p.base_retail_price,
                product_status: STATUS_LABELS[p.status] || p.status || '上架中',
                device_models: productModels,
                規格: formatSpecs(p.table_settings)
            };

            if (variants.length > 0) {
                variants.forEach(v => {
                    const variantModels = v.variant_model_links?.map((l: any) => l.device_models?.name).filter(Boolean).join(',') || '';

                    exportData.push({
                        ...productBase,
                        變體規格: formatSpecs(v.table_settings),
                        variant_sku: v.sku,
                        variant_name: v.name,
                        option_1: v.option_1 || '',
                        option_2: v.option_2 || '',
                        option_3: v.option_3 || '',
                        variant_wholesale_price: v.wholesale_price,
                        variant_retail_price: v.retail_price,
                        variant_status: STATUS_LABELS[v.status] || v.status || '上架中',
                        barcode: v.barcode ? `'${v.barcode}` : '',
                        variant_device_models: variantModels,
                    });
                });
            } else {
                exportData.push({
                    ...productBase,
                    變體規格: '',
                    variant_sku: '',
                    variant_name: '',
                    option_1: '',
                    option_2: '',
                    option_3: '',
                    variant_wholesale_price: '',
                    variant_retail_price: '',
                    variant_status: '',
                    barcode: (p as any).barcode ? `'${(p as any).barcode}` : '',
                    variant_device_models: '',
                });
            }
        });
        const csv = Papa.unparse(exportData);
        console.log("匯出資料", exportData);
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `products_export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    };

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
    };
}
