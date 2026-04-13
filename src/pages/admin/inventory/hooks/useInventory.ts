import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAction } from '@/hooks/useSupabaseAction';
import { useState } from 'react';

export function useInventory() {
    const [search, setSearch] = useState('');
    const [lowStockOnly, setLowStockOnly] = useState(false);

    // 獲取所有庫存資料，包含關連的產品與變體資訊
    const { data: inventory = [], isLoading } = useQuery({
        queryKey: ['inventory-list'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_inventory')
                .select(`
                    id,
                    quantity,
                    updated_at,
                    product_id,
                    variant_id,
                    products!product_inventory_product_id_fkey (
                        name,
                        sku,
                        brand,
                        base_retail_price
                    ),
                    product_variants!product_inventory_variant_id_fkey (
                        name,
                        sku,
                        retail_price,
                        option_1,
                        option_2,
                        option_3
                    )
                `);

            if (error) throw error;
            return data || [];
        }
    });

    // 格式化資料以便於表格呈現
    const formattedData = inventory.map(item => {
        const product = item.products as any;
        const variant = item.product_variants as any;

        return {
            id: item.id,
            name: variant ? `${product?.name} (${variant.name})` : product?.name || '-',
            sku: variant?.sku || product?.sku || '-',
            specs: variant ? [variant.option_1, variant.option_2, variant.option_3].filter(Boolean).join(' / ') : '-',
            quantity: item.quantity,
            updatedAt: item.updated_at,
            isLowStock: item.quantity <= 5, // 假設低於 5 為低庫存
            price: variant?.retail_price || product?.base_retail_price || 0,
            original: item
        };
    });

    // 過濾邏輯
    const filteredData = formattedData.filter(item => {
        const matchesSearch = 
            item.name.toLowerCase().includes(search.toLowerCase()) || 
            item.sku.toLowerCase().includes(search.toLowerCase());
        
        if (lowStockOnly) {
            return matchesSearch && item.isLowStock;
        }
        return matchesSearch;
    });

    // 庫存更新 Action
    const updateInventory = useSupabaseAction(
        async ({ id, quantity }: { id: string, quantity: number }) => {
            const { error } = await supabase
                .from('product_inventory')
                .update({ quantity, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
        },
        {
            successMessage: '庫存已更新',
            invalidateKeys: [['inventory-list']],
        }
    );

    return {
        inventory: filteredData,
        isLoading,
        search,
        setSearch,
        lowStockOnly,
        setLowStockOnly,
        updateInventory
    };
}
