import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { entityRelationService } from '@/services/entityRelationService';
import { ProductWithPricing } from '@/types/product';

type Product = ProductWithPricing;

export function useProductMutations(forceRefresh: () => Promise<void>) {
    const queryClient = useQueryClient();

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

            const { data: product, error: productError } = await supabase.from('products')
                .insert({ ...productData })
                .select().single();
            if (productError) throw productError;

            if (category_ids?.length > 0) {
                const { error } = await supabase.from('product_category_links').insert(
                    category_ids.map((catId: string) => ({ product_id: product.id, category_id: catId }))
                );
                if (error) throw error;
            }

            await entityRelationService.updateRelations('product', product.id, {
                modelIds: device_model_ids,
                groupIds: device_model_group_ids,
                exclusions: device_model_exclusion_ids.map((id: string) => ({ model_id: id }))
            });

            if (spec_values && !values.has_variants && category_ids?.[0]) {
                const { error: specError } = await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: product.id,
                    p_entity_type: 'product',
                    p_category_id: category_ids[0],
                    p_new_data: spec_values
                });
                if (specError) throw specError;
            }

            await supabase.rpc('sync_storefront_items', { p_product_id: product.id });

            return product;
        },
        onSuccess: async (product) => {
            await forceRefresh();
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            toast.success('產品已新增');
            const cache = (await import('@/hooks/useProductCache')).getProductCache();
            const fullProduct = cache?.data?.find((p: any) => p.id === product.id);
            return (fullProduct || product) as any;
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

            const { error: productError } = await supabase.from('products')
                .update({ ...productData, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (productError) throw productError;

            await supabase.from('product_category_links').delete().eq('product_id', id);
            if (category_ids?.length > 0) {
                await supabase.from('product_category_links').insert(
                    category_ids.map((catId: string) => ({ product_id: id, category_id: catId }))
                );
            }

            await entityRelationService.updateRelations('product', id, {
                modelIds: device_model_ids,
                groupIds: device_model_group_ids,
                exclusions: device_model_exclusion_ids.map((id: string) => ({ model_id: id }))
            });

            if (spec_values && !values.has_variants && category_ids?.[0]) {
                const { error: specError } = await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: id,
                    p_entity_type: 'product',
                    p_category_id: category_ids[0],
                    p_new_data: spec_values
                });
                if (specError) throw specError;
            }

            await supabase.rpc('sync_storefront_items', { p_product_id: id });
        },
        onSuccess: async () => {
            await forceRefresh();
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-model-links'] });
            queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
            toast.success('產品已更新');
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

    const handleCopy = async (product: Product, setEditingProduct: (p: any) => void, setIsDialogOpen: (v: boolean) => void) => {
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

    const handleImportSuccess = () => {
        forceRefresh();
        toast.success('產品資料匯入成功，已重置選擇狀態');
    };

    return {
        createMutation,
        updateMutation,
        deleteMutation,
        updateVariantPriceMutation,
        handleCopy,
        handleImportSuccess,
    };
}
