import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAction } from '@/hooks/useSupabaseAction';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import { getErrorMessage } from '@/lib/errorMessages';
import { toast } from 'sonner';

const PAGE_SIZE = 10;

export function useInventory() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [lowStockOnly, setLowStockOnly] = useState(searchParams.get('lowStock') === 'true');
    const [warehouseFilter, setWarehouseFilter] = useState(searchParams.get('wh') || 'all');
    const [stockStatusFilter, setStockStatusFilter] = useState(searchParams.get('status') || 'all');
    const [itemTypeFilter, setItemTypeFilter] = useState(searchParams.get('type') || 'all');
    const { user } = useAuth();

    const { data: inventory = [], isLoading } = useQuery({
        queryKey: ['inventory-list'],
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('product_inventory') as any)
                .select(`
                    id,
                    quantity,
                    updated_at,
                    product_id,
                    variant_id,
                    warehouse_id,
                    products (
                        name,
                        code,
                        item_type
                    ),
                    suspense_quantity,
                    product_variants (
                        name,
                        sku,
                        retail_price
                    ),
                    warehouses (
                        code,
                        name
                    )
                `);

            if (error) throw error;
            return data || [];
        }
    });

    const formattedData = inventory.map(item => {
        const product = item.products as any;
        const variant = item.product_variants as any;
        const wh = item.warehouses as any;

        return {
            id: item.id,
            name: variant?.name || product?.name || '-',
            code: variant?.sku || product?.code || '-',
            specs: variant ? product?.name || '-' : '-',
            quantity: item.quantity,
            suspenseQuantity: item.suspense_quantity || 0,
            updatedAt: item.updated_at,
            isLowStock: item.quantity <= 5,
            price: variant?.retail_price || 0,
            productId: item.product_id,
            variantId: item.variant_id,
            warehouseId: item.warehouse_id,
            warehouseCode: wh?.code || 'own',
            warehouseName: wh?.name || '自有倉庫',
            itemType: product?.item_type || 'product',
            original: item
        };
    });

    const filteredData = formattedData
        .filter(item => {
            const matchesSearch =
                item.name.toLowerCase().includes(search.toLowerCase()) ||
                item.code.toLowerCase().includes(search.toLowerCase());

            if (!matchesSearch) return false;

            if (lowStockOnly && !item.isLowStock) return false;

            if (warehouseFilter !== 'all' && item.warehouseCode !== warehouseFilter) return false;

            if (itemTypeFilter !== 'all' && item.itemType !== itemTypeFilter) return false;

            if (stockStatusFilter !== 'all') {
                if (stockStatusFilter === 'negative' && !(item.quantity < 0)) return false;
                if (stockStatusFilter === 'zero' && item.quantity !== 0) return false;
                if (stockStatusFilter === 'low' && !(item.quantity > 0 && item.quantity <= 5)) return false;
                if (stockStatusFilter === 'normal' && !(item.quantity > 5)) return false;
            }

            return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

    const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
    const pageParam = parseInt(searchParams.get('page') || '1', 10);
    const rawPageIndex = Number.isFinite(pageParam) && pageParam > 0 ? pageParam - 1 : 0;
    const pageIndex = Math.min(rawPageIndex, totalPages - 1);

    const setPageIndex = (index: number) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (index > 0) next.set('page', String(index + 1));
            else next.delete('page');
            return next;
        }, { replace: true });
    };

    const updateInventory = useSupabaseAction(
        async ({ id, quantity, note }: { id: string, quantity: number, note?: string }) => {
            const { error } = await (supabase.rpc('adjust_inventory' as any) as any)({
                p_id: id,
                p_new_quantity: quantity,
                p_created_by: user?.id,
                p_note: note || null,
            });
            if (error) throw error;
        },
        {
            successMessage: '庫存已更新',
            invalidateKeys: [['inventory-list'], ['inventory-movements']],
        }
    );

    const queryClient = useQueryClient();
    const recalculateInventory = useMutation({
        mutationFn: async () => {
            const { data, error } = await (supabase.rpc('recalculate_inventory' as any) as any)({
                p_created_by: user?.id || null,
            });
            if (error) throw error;
            return data;
        },
        onSuccess: (data: any) => {
            const changed = data?.filter((r: any) => r.diff !== 0)?.length || 0;
            const created = data?.filter((r: any) => r.old_quantity === 0 && r.diff > 0)?.length || 0;
            toast.success(`庫存重算完成，${changed} 項已更新${created ? `（${created} 項新建）` : ''}`);
            queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
        },
        onError: (error: Error) => {
            toast.error(getErrorMessage(error, '重算失敗'));
        },
    });

    const updateSearch = (value: string) => {
        setSearch(value);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (value) next.set('search', value);
            else next.delete('search');
            next.delete('page');
            return next;
        }, { replace: true });
    };

    const updateLowStockOnly = (value: boolean) => {
        setLowStockOnly(value);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (value) next.set('lowStock', 'true');
            else next.delete('lowStock');
            next.delete('page');
            return next;
        }, { replace: true });
    };

    const updateWarehouseFilter = (value: string) => {
        setWarehouseFilter(value);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (value && value !== 'all') next.set('wh', value);
            else next.delete('wh');
            next.delete('page');
            return next;
        }, { replace: true });
    };

    const updateStockStatusFilter = (value: string) => {
        setStockStatusFilter(value);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (value && value !== 'all') next.set('status', value);
            else next.delete('status');
            next.delete('page');
            return next;
        }, { replace: true });
    };

    const updateItemTypeFilter = (value: string) => {
        setItemTypeFilter(value);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (value && value !== 'all') next.set('type', value);
            else next.delete('type');
            next.delete('page');
            return next;
        }, { replace: true });
    };

    const warehouses: { code: string; name: string }[] = Array.from(
        new Map(formattedData.map(i => [i.warehouseCode, i.warehouseName])).entries()
    ).map(([code, name]) => ({ code: code as string, name: name as string }));

    return {
        inventory: filteredData,
        isLoading,
        search,
        setSearch: updateSearch,
        lowStockOnly,
        setLowStockOnly: updateLowStockOnly,
        warehouseFilter,
        setWarehouseFilter: updateWarehouseFilter,
        stockStatusFilter,
        setStockStatusFilter: updateStockStatusFilter,
        itemTypeFilter,
        setItemTypeFilter: updateItemTypeFilter,
        warehouses,
        pageIndex,
        pageSize: PAGE_SIZE,
        totalPages,
        setPageIndex,
        updateInventory,
        recalculateInventory,
    };
}

export function useInventoryMovements(productId: string | null, variantId: string | null) {
    return useQuery({
        queryKey: ['inventory-movements', productId, variantId],
        enabled: !!productId,
        queryFn: async () => {
            let query: any = (supabase
                .from('inventory_movements' as any) as any)
                .select(`
                    *,
                    batch:product_batches!batch_id (
                        id,
                        purchase_order_id,
                        purchase_orders:purchase_order_id (
                            id,
                            supplier_order_number
                        )
                    ),
                    matched_batch:product_batches!matched_batch_id (
                        id,
                        purchase_order_id,
                        purchase_orders:purchase_order_id (
                            id,
                            supplier_order_number
                        )
                    )
                `)
                .eq('product_id', productId)
                .order('created_at', { ascending: false });

            if (variantId) {
                query = query.eq('variant_id', variantId);
            }

            const { data, error } = await query;
            if (error) throw error;
            return (data || []).map((m: any) => ({
                id: m.id,
                quantityChange: m.quantity_change,
                balanceAfter: m.balance_after,
                sourceType: m.source_type,
                referenceCode: m.reference_code,
                note: m.note,
                warehouseId: m.warehouse_id,
                createdAt: m.created_at,
                createdBy: m.created_by,
                costMatchStatus: m.cost_match_status || 'confirmed',
                batchId: m.batch_id || null,
                matchedBatchId: m.matched_batch_id || null,
                unitCost: m.unit_cost,
                purchaseOrderCode: (m.batch?.purchase_orders?.supplier_order_number || m.matched_batch?.purchase_orders?.supplier_order_number) || null,
                purchaseOrderId: (m.batch?.purchase_order_id || m.matched_batch?.purchase_order_id) || null,
            }));
        }
    });
}
