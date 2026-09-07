import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { PurchaseOrder, Supplier, PurchaseOrderItem, ProductWithPrice, PurchaseOrderStatus } from '../types';

export function usePurchaseOrders(viewingOrderId?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Queries
  const { data: suppliers = [], isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Supplier[];
    },
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['purchase-orders', suppliers],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      return ((data || []) as any[]).map((order) => ({
        ...order,
        supplier: suppliers.find(s => s.id === order.supplier_id),
      })) as PurchaseOrder[];
    },
    enabled: suppliers.length >= 0,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-purchase'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('products') as any)
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data as ProductWithPrice[];
    },
  });

  const { data: orderItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['purchase-order-items', viewingOrderId],
    queryFn: async () => {
      if (!viewingOrderId) return [];
      const { data, error } = await (supabase as any)
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', viewingOrderId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Get product info
      const productIds = (data || []).map((item: any) => item.product_id).filter(Boolean);
      let productMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prods } = await (supabase
          .from('products') as any)
          .select('id, name, code')
          .in('id', productIds);
        productMap = (prods || []).reduce((acc, p) => ({ ...acc, [p.id]: p }), {});
      }

      // Get variant info
      const variantIds = (data || []).map((item: any) => item.variant_id).filter(Boolean);
      let variantMap: Record<string, any> = {};
      if (variantIds.length > 0) {
        const { data: variants } = await (supabase
          .from('product_variants') as any)
          .select('id, name, sku')
          .in('id', variantIds);
        variantMap = (variants || []).reduce((acc, v) => ({ ...acc, [v.id]: v }), {});
      }

      return ((data || []) as any[]).map((item) => ({
        ...item,
        product: productMap[item.product_id],
        variant: variantMap[item.variant_id],
      })) as PurchaseOrderItem[];
    },
    enabled: !!viewingOrderId,
  });

  // Fetch supplier product mappings for vendor code/name in exports
  const viewingOrder = viewingOrderId ? orders.find(o => o.id === viewingOrderId) : null;
  const { data: supplierMappingMap = {} } = useQuery({
    queryKey: ['supplier-mappings-export', viewingOrder?.supplier_id],
    queryFn: async () => {
      if (!viewingOrder?.supplier_id) return {};
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('internal_product_id, internal_variant_id, vendor_product_id, vendor_product_name')
        .eq('supplier_id', viewingOrder.supplier_id);
      if (error) throw error;
      return (data || []).reduce((acc: Record<string, { vendor_product_id: string; vendor_product_name: string }>, m: any) => {
        const key = `${m.internal_product_id}_${m.internal_variant_id || 'null'}`;
        acc[key] = { vendor_product_id: m.vendor_product_id, vendor_product_name: m.vendor_product_name };
        return acc;
      }, {});
    },
    enabled: !!viewingOrder?.supplier_id,
  });

  // Fetch source order codes for display
  const allSourceOrderIds = [...new Set(orderItems.flatMap(item => item.source_order_ids || []))];
  const { data: sourceOrderMap = {} } = useQuery({
    queryKey: ['source-order-codes', allSourceOrderIds],
    queryFn: async () => {
      if (allSourceOrderIds.length === 0) return {};
      const { data, error } = await (supabase as any)
        .from('orders')
        .select('id, code')
        .in('id', allSourceOrderIds);
      if (error) throw error;
      return (data || []).reduce((acc: Record<string, string>, o: any) => {
        acc[o.id] = o.code || o.id.slice(0, 8);
        return acc;
      }, {});
    },
    enabled: allSourceOrderIds.length > 0,
  });

  // Mutations
  const createOrderMutation = useMutation({
    mutationFn: async (data: Partial<PurchaseOrder>) => {
      const { data: result, error } = await (supabase as any)
        .from('purchase_orders')
        .insert({
          ...data,
          created_by: user?.id,
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('採購訂單已建立');
    },
    onError: () => toast.error('建立失敗'),
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<PurchaseOrder> & { id: string }) => {
      const { error } = await (supabase as any).from('purchase_orders').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('採購訂單已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc('delete_purchase_order_if_empty', {
        p_purchase_order_id: id,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string; adopted_by?: unknown };
      if (!res?.ok) {
        let reason = res?.reason || '刪除失敗';
        const blocks = res?.adopted_by as Array<{ label?: string }> | undefined;
        if (Array.isArray(blocks) && blocks.length > 0) {
          reason = `${reason}（${blocks.map((b) => b?.label).filter(Boolean).join('、')}）`;
        }
        throw new Error(reason);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('採購訂單已刪除');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '刪除失敗'),
  });

  const createSupplierMutation = useMutation({
    mutationFn: async (data: Partial<Supplier>) => {
      const { error } = await (supabase as any).from('suppliers').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('供應商已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const addItemMutation = useMutation({
    mutationFn: async (data: Partial<PurchaseOrderItem>) => {
      // Assign next sort_order so new items append at the end
      const { data: last } = await (supabase as any)
        .from('purchase_order_items')
        .select('sort_order')
        .eq('purchase_order_id', viewingOrderId)
        .order('sort_order', { ascending: false })
        .limit(1);
      const nextSort = ((last?.[0]?.sort_order ?? 0) as number) + 1;

      const { error } = await (supabase as any)
        .from('purchase_order_items')
        .insert({ ...data, sort_order: nextSort });
      if (error) throw error;

      if (viewingOrderId) {
        // Need to fetch order total and update
        const { data: order } = await (supabase as any).from('purchase_orders').select('total_amount').eq('id', viewingOrderId).single();
        const newTotal = (order?.total_amount || 0) + (data.quantity || 0) * (data.unit_cost || 0);
        await (supabase as any)
          .from('purchase_orders')
          .update({ total_amount: newTotal })
          .eq('id', viewingOrderId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('品項已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, quantity, unit_cost }: { itemId: string; quantity: number; unit_cost: number }) => {
      const { error } = await (supabase as any)
        .from('purchase_order_items')
        .update({ quantity, unit_cost })
        .eq('id', itemId);
      if (error) throw error;

      // Recalculate PO total
      if (viewingOrderId) {
        const { data: items } = await (supabase as any)
          .from('purchase_order_items')
          .select('quantity, unit_cost');
        const newTotal = (items || []).reduce((sum: number, i: any) => sum + (i.quantity || 0) * (i.unit_cost || 0), 0);
        await (supabase as any)
          .from('purchase_orders')
          .update({ total_amount: newTotal })
          .eq('id', viewingOrderId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('品項已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      // Get item info before deleting for total recalculation
      const { data: item } = await (supabase as any)
        .from('purchase_order_items')
        .select('quantity, unit_cost')
        .eq('id', itemId)
        .single();

      const { error } = await (supabase as any)
        .from('purchase_order_items')
        .delete()
        .eq('id', itemId);
      if (error) throw error;

      // Recalculate PO total
      if (viewingOrderId) {
        const { data: items } = await (supabase as any)
          .from('purchase_order_items')
          .select('quantity, unit_cost');
        const newTotal = (items || []).reduce((sum: number, i: any) => sum + (i.quantity || 0) * (i.unit_cost || 0), 0);
        await (supabase as any)
          .from('purchase_orders')
          .update({ total_amount: newTotal })
          .eq('id', viewingOrderId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('品項已刪除');
    },
    onError: () => toast.error('刪除失敗'),
  });

  const reorderItemsMutation = useMutation({
    mutationFn: async (items: PurchaseOrderItem[]) => {
      const p_items = items.map((item, index) => ({
        id: item.id,
        sort_order: index + 1,
      }));
      const { error } = await (supabase as any)
        .rpc('reorder_purchase_order_items', { p_items });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('品項順序已更新');
    },
    onError: () => toast.error('更新順序失敗'),
  });

  const importItemsMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items }: { purchaseOrderId: string; items: Partial<PurchaseOrderItem>[] }) => {
      if (!items || items.length === 0) return;
      const { data: last } = await (supabase as any)
        .from('purchase_order_items')
        .select('sort_order')
        .eq('purchase_order_id', purchaseOrderId)
        .order('sort_order', { ascending: false })
        .limit(1);
      const base = ((last?.[0]?.sort_order ?? 0) as number);

      const rows = items.map((item, index) => ({
        purchase_order_id: purchaseOrderId,
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        quantity: item.quantity || 0,
        unit_cost: item.unit_cost || 0,
        sort_order: base + index + 1,
      }));

      const { error } = await (supabase as any)
        .from('purchase_order_items')
        .insert(rows);
      if (error) throw error;

      const totalDelta = rows.reduce((sum, row) => sum + (row.quantity || 0) * (row.unit_cost || 0), 0);
      const { data: order } = await (supabase as any)
        .from('purchase_orders')
        .select('total_amount')
        .eq('id', purchaseOrderId)
        .single();
      await (supabase as any)
        .from('purchase_orders')
        .update({ total_amount: (order?.total_amount || 0) + totalDelta })
        .eq('id', purchaseOrderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success(`採購品項已匯入`);
    },
    onError: () => toast.error('匯入失敗'),
  });

  const receiveItemsMutation = useMutation({
    mutationFn: async (params: { items: { id: string; received_quantity: number; warehouse_id?: string }[] }) => {
      const { items } = params;

      // Build payload for receive_purchase_items RPC (now handles UPDATE + status atomically)
      const po = orders.find(o => o.id === viewingOrderId);
      const poCode = po?.supplier_order_number || viewingOrderId || '';
      const rpcItems = items.map(item => {
        const orderItem = orderItems.find(i => i.id === item.id);
        return {
          id: item.id,
          product_id: orderItem?.product_id,
          variant_id: orderItem?.variant_id || null,
          received_quantity: item.received_quantity,
          purchase_order_id: viewingOrderId,
          purchase_order_code: poCode,
          warehouse_id: item.warehouse_id || null,
        };
      });

      const { error: rpcError } = await (supabase as any)
        .rpc('receive_purchase_items', {
          p_items: rpcItems,
          p_warehouse_id: null,
        });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      toast.success('收貨已記錄');
    },
    onError: () => toast.error('記錄失敗'),
  });

  const returnItemsMutation = useMutation({
    mutationFn: async (params: {
      items: { id: string; quantity: number }[];
      warehouseId?: string;
      creditAccountId?: string;
      reason?: string;
    }) => {
      const { items, warehouseId, creditAccountId, reason } = params;

      const rpcItems = items.map((item) => ({
        purchase_order_item_id: item.id,
        quantity: item.quantity,
      }));

      const { error } = await (supabase as any).rpc('process_purchase_return', {
        p_purchase_order_id: viewingOrderId,
        p_items: rpcItems,
        p_warehouse_id: warehouseId || null,
        p_credit_account_id: creditAccountId || null,
        p_reason: reason || '',
        p_created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      toast.success('廠商退貨已完成');
    },
    onError: () => toast.error('退貨失敗'),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('accounts').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const unlinkOrdersFromPurchaseMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, orderIds }: { purchaseOrderId: string; orderIds: string[] }) => {
      const { data, error } = await (supabase as any)
        .rpc('unlink_orders_from_purchase_order', {
          p_purchase_order_id: purchaseOrderId,
          p_order_ids: orderIds,
        });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      const removed = data?.removed_item_count ?? 0;
      const updated = data?.updated_item_count ?? 0;
      toast.success(`已解除 ${removed + updated} 筆採購連結（移除 ${removed} 筆、更新 ${updated} 筆）`);
    },
    onError: () => toast.error('解除採購連結失敗'),
  });

  return {
    suppliers,
    isLoadingSuppliers,
    orders,
    ordersLoading,
    products,
    orderItems,
    itemsLoading,
    sourceOrderMap,
    supplierMappingMap,
    accounts,
    createOrderMutation,
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    addItemMutation,
    updateItemMutation,
    deleteItemMutation,
    reorderItemsMutation,
    importItemsMutation,
    receiveItemsMutation,
    returnItemsMutation,
    unlinkOrdersFromPurchaseMutation,
    // Provide a way to record payment
    makePaymentMutation: useMutation({
      mutationFn: async (data: { orderId: string; accountId: string; amount: number; date: string }) => {
        // 1. Create transaction
        const { error: txError } = await (supabase as any).from('transactions').insert({
          account_id: data.accountId,
          amount: -data.amount,
          type: 'expense',
          category: '採購付款',
          description: `採購單付款 #${data.orderId.slice(0, 8)}`,
          date: data.date,
        });
        if (txError) throw txError;

        // 2. Update account balance
        const { data: acc } = await (supabase as any).from('accounts').select('balance').eq('id', data.accountId).single();
        await (supabase as any).from('accounts').update({ balance: (acc?.balance || 0) - data.amount }).eq('id', data.accountId);

        // 3. Mark PO as paid (optional, depends on schema, let's assume we update a flag or just log it)
        // In current schema, we don't have a specific 'paid' field, but we've recorded the transaction.
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['accounts'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        toast.success('付款已記錄');
      },
      onError: () => toast.error('付款失敗'),
    }),
  };
}
