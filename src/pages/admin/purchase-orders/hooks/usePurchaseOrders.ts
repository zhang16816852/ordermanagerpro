import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  PurchaseOrder, Supplier, PurchaseOrderItem, ProductWithPrice, PurchaseOrderStatus,
  type PoItemWritePayload, type PoUpdateItemsArgs, type PoWriteResult,
} from '../types';
import { LotInput } from '@/utils/lotTracking';

export interface PurchaseOrderFilters {
  supplierId?: string;
  purpose?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 採購單表頭／品項寫入的唯一 RPC 入口（20260930000005）。
 *
 * 這裡是全站唯一需要把 optional 參數轉成「可傳 null」的地方：
 * generated types 將 p_* 標為 `?: string`（省略即 DEFAULT NULL），
 * 但語意上必須區分「明確傳 null ＝ 不變更」與「傳 '' ＝ 清空」，
 * 欄位則由 PoUpdateItemsArgs 把關。回傳 { ok:false, reason } 一律轉為 throw，
 * 讓呼叫端只需處理 throw 與成功兩種路徑。
 */
async function rpcUpdatePurchaseOrder(args: PoUpdateItemsArgs): Promise<PoWriteResult | null> {
  const { data, error } = await supabase.rpc('update_purchase_order_with_items', {
    ...args,
  } as unknown as Database['public']['Functions']['update_purchase_order_with_items']['Args']);
  if (error) throw error;
  const res = data as PoWriteResult | null;
  if (res && res.ok === false) throw new Error(res.reason || '更新失敗');
  return res;
}

export function usePurchaseOrders(viewingOrderId?: string, filters?: PurchaseOrderFilters) {
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
    queryKey: ['purchase-orders', suppliers, filters],
    queryFn: async () => {
      let query = (supabase as any)
        .from('purchase_orders')
        .select('*');
      if (filters?.supplierId && filters.supplierId !== 'all') {
        query = query.eq('supplier_id', filters.supplierId);
      }
      if (filters?.purpose && filters.purpose !== 'all') {
        query = query.eq('purpose', filters.purpose);
      }
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters?.dateFrom) {
        query = query.gte('order_date', filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte('order_date', filters.dateTo);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
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
          .select('id, name, sku, tracking_mode')
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
        .select('internal_product_id, internal_variant_id, vendor_product_id, vendor_product_name, is_primary')
        .eq('supplier_id', viewingOrder.supplier_id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      // 同一料號可對多個內部目標，反向查詢（目標 → 料號）時以主對照優先
      return (data || []).reduce((acc: Record<string, { vendor_product_id: string; vendor_product_name: string; is_primary: boolean }>, m: any) => {
        const key = `${m.internal_product_id}_${m.internal_variant_id || 'null'}`;
        const existing = acc[key];
        if (existing && existing.is_primary) return acc;
        acc[key] = { vendor_product_id: m.vendor_product_id, vendor_product_name: m.vendor_product_name, is_primary: !!m.is_primary };
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
  // 表頭更新一律走交易化 RPC（20260930000005）：內含狀態合法性、收貨鎖定、
  // 已取消鎖品項與 total_amount 重算；不可用裸 insert/update 繞過守門。
  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<PurchaseOrder> & { id: string }) => {
      // null = 不變更（RPC 以 COALESCE 保留原值）；notes 需以原字串送出才能清空
      return rpcUpdatePurchaseOrder({
        p_purchase_order_id: id,
        p_notes: data.notes === undefined ? null : data.notes,
        p_items: [],
        p_deleted_item_ids: [],
        p_status: data.status ?? null,
        p_order_date: data.order_date || null,
        p_expected_date: data.expected_date || null,
        p_purpose: data.purpose ?? null,
        p_supplier_order_number: data.supplier_order_number ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order'] });
      toast.success('採購訂單已更新');
    },
    onError: (error: Error) => toast.error(error?.message || '更新失敗'),
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
      queryClient.invalidateQueries({ queryKey: ['delivery-methods-logistics-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-suppliers'] });
      toast.success('供應商已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const updateSupplierMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Supplier> & { id: string }) => {
      const { error } = await (supabase as any).from('suppliers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-methods-logistics-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-suppliers'] });
      toast.success('供應商已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  // 品項寫入唯一路徑：整單品項一次送出，伺服端依序重編 sort_order、重算 total_amount
  // 並執行守門（已收貨不可降量／刪除／換商品、已取消單鎖品項）。不可用裸 insert/update 繞過。
  const callWriteItems = async (
    purchaseOrderId: string,
    items: Array<Omit<PoItemWritePayload, 'id'> & { id: string | null }>,
    deletedItemIds: string[] = [],
  ) => {
    return rpcUpdatePurchaseOrder({
      p_purchase_order_id: purchaseOrderId,
      p_notes: null,
      p_items: items,
      p_deleted_item_ids: deletedItemIds,
      p_status: null,
      p_order_date: null,
      p_expected_date: null,
      p_purpose: null,
      p_supplier_order_number: null,
    });
  };

  const invalidateItemWrites = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };

  const updateItemMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items }: { purchaseOrderId: string; items: PoItemWritePayload[] }) => {
      await callWriteItems(purchaseOrderId, items);
    },
    onSuccess: () => {
      invalidateItemWrites();
      toast.success('品項已更新');
    },
    onError: (e) => toast.error(getErrorMessage(e, '更新失敗')),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items, deletedItemIds }: {
      purchaseOrderId: string;
      items: PoItemWritePayload[];
      deletedItemIds: string[];
    }) => {
      await callWriteItems(purchaseOrderId, items, deletedItemIds);
    },
    onSuccess: () => {
      invalidateItemWrites();
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('品項已刪除');
    },
    onError: (e) => toast.error(getErrorMessage(e, '刪除失敗')),
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
      invalidateItemWrites();
      toast.success('品項順序已更新');
    },
    onError: (e) => toast.error(getErrorMessage(e, '更新順序失敗')),
  });

  const importItemsMutation = useMutation({
    mutationFn: async ({ purchaseOrderId, items }: {
      purchaseOrderId: string;
      /** 整單品項：既有品項帶 id，新品項 id 為 null */
      items: Array<Omit<PoItemWritePayload, 'id'> & { id: string | null }>;
    }) => {
      if (!items || items.length === 0) return;
      await callWriteItems(purchaseOrderId, items);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', variables.purchaseOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success('採購品項已匯入');
    },
    onError: (e) => toast.error(getErrorMessage(e, '匯入失敗')),
  });

  const receiveItemsMutation = useMutation({
    mutationFn: async (params: {
      items: { id: string; received_quantity: number; warehouse_id?: string; lots?: LotInput }[];
    }) => {
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

      const rpcLots = items
        .filter(item => item.lots)
        .map(item => ({ purchase_order_item_id: item.id, ...item.lots } as Record<string, unknown>));

      const { error: rpcError } = await (supabase as any)
        .rpc('receive_purchase_items', {
          p_items: rpcItems,
          p_warehouse_id: null,
          p_lots: rpcLots.length > 0 ? rpcLots : null,
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
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    updateSupplierMutation,
    updateItemMutation,
    deleteItemMutation,
    reorderItemsMutation,
    importItemsMutation,
    receiveItemsMutation,
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
