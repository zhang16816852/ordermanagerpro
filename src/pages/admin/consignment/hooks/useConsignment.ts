import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseAction } from '@/hooks/useSupabaseAction';
import { toast } from 'sonner';
import {
  ConsignmentOrder,
  ConsignmentOrderItem,
  ConsignmentOrderItemSummary,
  ConsignmentSalesReport,
  ConsignmentSettlement,
  Supplier,
  ProductOption,
  VariantOption,
  NewConsignmentItem,
  ConsignmentDirection,
} from '../types';

export function useConsignment() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['consignment'] });
    queryClient.invalidateQueries({ queryKey: ['consignment-reports'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    queryClient.invalidateQueries({ queryKey: ['shipping-pool'] });
    queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
  };

  const { data: suppliers = [] } = useQuery({
    queryKey: ['consignment-suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name, contact_name, phone, email, is_active')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Supplier[];
    },
  });

  const { data: stores = [] } = useQuery({
    queryKey: ['consignment-stores'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('stores')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ['consignment-products'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('id, name, code, variants:product_variants(id, name, sku, status)')
        .order('name');
      if (error) throw error;
      return (data || []) as ProductOption[];
    },
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['consignment-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('consignment_orders')
        .select('*, supplier:suppliers(id, name), store:stores(id, name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ConsignmentOrder[];
    },
  });

  const { data: pendingReports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['consignment-reports'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('consignment_sales_reports')
        .select(`
          *,
          consignment_order:consignment_orders(code),
          store:stores(id, name),
          item:consignment_order_items(
            id,
            product:products(id, name, code),
            variant:product_variants(id, name)
          )
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ConsignmentSalesReport[];
    },
  });

  function useOrderDetail(orderId: string | null) {
    return useQuery({
      queryKey: ['consignment-order-detail', orderId],
      enabled: !!orderId,
      queryFn: async () => {
        if (!orderId) return null;
        const { data: items, error: itemsError } = await (supabase as any)
          .from('consignment_order_items')
          .select(`
            *,
            product:products(id, name, code),
            variant:product_variants(id, name, sku)
          `)
          .eq('consignment_order_id', orderId);
        if (itemsError) throw itemsError;

        const { data: summaries, error: summaryError } = await (supabase as any)
          .from('consignment_order_item_summary')
          .select('*')
          .eq('consignment_order_id', orderId);
        if (summaryError) throw summaryError;

        const { data: settlements, error: settlementError } = await (supabase as any)
          .from('consignment_settlements')
          .select('*')
          .eq('consignment_order_id', orderId)
          .order('created_at', { ascending: false });
        if (settlementError) throw settlementError;

        const { data: sales, error: salesError } = await (supabase as any)
          .from('consignment_sales')
          .select('*')
          .eq('consignment_order_id', orderId)
          .eq('reversed', false);
        if (salesError) throw salesError;

        return {
          items: (items || []) as ConsignmentOrderItem[],
          summaries: (summaries || []) as ConsignmentOrderItemSummary[],
          settlements: (settlements || []) as ConsignmentSettlement[],
          sales: (sales || []) as { id: string; quantity: number; unit_price: number; unit_cost: number; source_type: string }[],
        };
      },
    });
  }

  const createOrderMutation = useSupabaseAction<{ id: string }, { direction: ConsignmentDirection; partnerId: string; note?: string }>(
    async ({ direction, partnerId, note }) => {
      const { data, error } = await (supabase as any)
        .from('consignment_orders')
        .insert({
          code: 'TMP',
          direction,
          supplier_id: direction === 'receive_from_supplier' ? partnerId : null,
          store_id: direction === 'send_to_store' ? partnerId : null,
          note: note || null,
          status: 'draft',
          created_by: user?.id,
        })
        .select()
        .single();
      if (error) throw error;

      // 店家寄賣（send_to_store）：同步建立真實來源訂單，讓「所有訂單」可勾選/出貨
      if (direction === 'send_to_store') {
        const { data: sourceOrder, error: orderError } = await (supabase as any)
          .from('orders')
          .insert({
            store_id: partnerId,
            created_by: user?.id,
            notes: note || null,
            source_type: 'consignment',
            status: 'pending',
            consignment_mode: true,
          })
          .select('id')
          .single();
        if (orderError) throw orderError;

        const { error: linkError } = await (supabase as any)
          .from('consignment_orders')
          .update({ source_order_id: sourceOrder.id })
          .eq('id', data.id);
        if (linkError) throw linkError;
      }

      return data as { id: string };
    },
    {
      successMessage: '寄賣單已建立',
      invalidateKeys: [['consignment-orders'], ['admin-orders']],
    }
  );

  const addItemMutation = useSupabaseAction<void, { orderId: string; item: NewConsignmentItem }>(
    async ({ orderId, item }) => {
      const { data: co } = await (supabase as any)
        .from('consignment_orders')
        .select('direction, store_id, source_order_id')
        .eq('id', orderId)
        .single();
      if (!co) throw new Error('找不到寄賣單');

      let orderItemId: string | null = null;
      if (co.direction === 'send_to_store' && co.source_order_id) {
        const { data: inserted, error: oiError } = await (supabase as any)
          .from('order_items')
          .insert({
            order_id: co.source_order_id,
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            store_id: co.store_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            shipped_quantity: 0,
            status: 'waiting',
          })
          .select('id')
          .single();
        if (oiError) throw oiError;
        orderItemId = inserted.id;
      }

      const payload: any = {
        consignment_order_id: orderId,
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
      };
      if (orderItemId) payload.order_item_id = orderItemId;

      const { error } = await (supabase as any)
        .from('consignment_order_items')
        .insert(payload);
      if (error) throw error;
    },
    {
      successMessage: '品項已新增',
      invalidateKeys: [['consignment-order-detail'], ['admin-orders']],
    }
  );

  const removeItemMutation = useSupabaseAction<void, string>(
    async (itemId) => {
      const { data: item } = await (supabase as any)
        .from('consignment_order_items')
        .select('order_item_id')
        .eq('id', itemId)
        .single();
      if (item?.order_item_id) {
        const { error: oiError } = await (supabase as any)
          .from('order_items')
          .delete()
          .eq('id', item.order_item_id);
        if (oiError) throw oiError;
      }
      const { error } = await (supabase as any)
        .from('consignment_order_items')
        .delete()
        .eq('id', itemId);
      if (error) throw error;
    },
    {
      successMessage: '品項已移除',
      invalidateKeys: [['consignment-order-detail'], ['admin-orders']],
    }
  );

  const updateItemMutation = useSupabaseAction<
    void,
    {
      orderId: string;
      itemId: string;
      patch: Partial<{ quantity: number; unit_price: number; unit_cost: number }>;
    }
  >(
    async ({ orderId, itemId, patch }) => {
      const { data: co } = await (supabase as any)
        .from('consignment_orders')
        .select('direction, source_order_id')
        .eq('id', orderId)
        .single();
      if (!co) throw new Error('找不到寄賣單');

      const { data: item } = await (supabase as any)
        .from('consignment_order_items')
        .select('order_item_id')
        .eq('id', itemId)
        .single();

      // 店家寄賣：同步鏡像來源 order_items（草稿尚未出貨，直接覆寫安全）
      if (co.direction === 'send_to_store' && item?.order_item_id) {
        const oiPatch: Record<string, number> = {};
        if (patch.quantity != null) oiPatch.quantity = patch.quantity;
        if (patch.unit_price != null) oiPatch.unit_price = patch.unit_price;
        if (Object.keys(oiPatch).length > 0) {
          const { error: oiError } = await (supabase as any)
            .from('order_items')
            .update(oiPatch)
            .eq('id', item.order_item_id);
          if (oiError) throw oiError;
        }
      }

      const { error } = await (supabase as any)
        .from('consignment_order_items')
        .update(patch)
        .eq('id', itemId);
      if (error) throw error;
    },
    {
      successMessage: '品項已更新',
      invalidateKeys: [['consignment-order-detail'], ['admin-orders']],
    }
  );

  const cancelOrderMutation = useSupabaseAction<void, string>(
    async (orderId) => {
      const { data: co } = await (supabase as any)
        .from('consignment_orders')
        .select('source_order_id')
        .eq('id', orderId)
        .single();
      if (co?.source_order_id) {
        const { data: src } = await (supabase as any)
          .from('orders')
          .select('status')
          .eq('id', co.source_order_id)
          .single();
        // 草稿鏡像來源訂單：取消即刪除；已出貨的來源訂單保留
        if (src?.status === 'pending') {
          const { error: delError } = await (supabase as any)
            .from('orders')
            .delete()
            .eq('id', co.source_order_id);
          if (delError) throw delError;
        }
      }
      const { error } = await (supabase as any)
        .from('consignment_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);
      if (error) throw error;
    },
    {
      successMessage: '寄賣單已取消',
      invalidateKeys: [['consignment-orders'], ['admin-orders']],
    }
  );

  const receiveItemsMutation = useSupabaseAction<
    void,
    { orderId: string; items: { consignment_order_item_id: string; received_quantity: number }[] }
  >(
    async ({ orderId, items }) => {
      const { error } = await (supabase as any).rpc('receive_consignment_items', {
        p_consignment_order_id: orderId,
        p_items: items,
        p_created_by: user?.id || null,
      });
      if (error) throw error;
    },
    {
      successMessage: '收貨完成，庫存已更新',
      invalidateKeys: [['consignment-orders'], ['consignment-order-detail']],
    }
  );

  const shipMutation = useSupabaseAction<Record<string, unknown>, { orderId: string; note?: string }>(
    async ({ orderId, note }) => {
      const { data, error } = await (supabase as any).rpc('create_consignment_shipment', {
        p_consignment_order_id: orderId,
        p_created_by: user?.id,
        p_notes: note || null,
        p_shipped_at: null,
      });
      if (error) throw error;
      return data;
    },
    {
      successMessage: '已出貨（店家寄賣，確認售出後才會開立銷貨單）',
      invalidateKeys: [['consignment-orders'], ['consignment-order-detail']],
    }
  );

  const reverseShipmentMutation = useSupabaseAction<Record<string, unknown>, { orderId: string; note?: string }>(
    async ({ orderId, note }) => {
      const { data, error } = await (supabase as any).rpc('reverse_consignment_shipment', {
        p_consignment_order_id: orderId,
        p_created_by: user?.id,
        p_note: note || null,
      });
      if (error) throw error;
      return data;
    },
    {
      successMessage: '已回滾出貨，品項已放回出貨池',
      invalidateKeys: [
        ['consignment-orders'],
        ['consignment-order-detail'],
        ['admin-orders'],
        ['shipping-pool'],
        ['shipping-pool-items'],
        ['inventory-list'],
        ['inventory-movements'],
      ],
    }
  );

  const confirmReportsMutation = useSupabaseAction<number, string[]>(
    async (reportIds) => {
      const { data, error } = await (supabase as any).rpc('confirm_consignment_sales', {
        p_report_ids: reportIds,
        p_confirmed_by: user?.id,
      });
      if (error) throw error;
      return data;
    },
    {
      successMessage: '銷售回報已審核確認，已依店家開立收款銷貨單',
      invalidateKeys: [['consignment-reports'], ['consignment-orders'], ['consignment-order-detail'], ['sales-notes'], ['store-sales-notes']],
    }
  );

  const rejectReportMutation = useSupabaseAction<void, string>(
    async (reportId) => {
      const { error } = await (supabase as any)
        .from('consignment_sales_reports')
        .update({ status: 'rejected', confirmed_by: user?.id, confirmed_at: new Date().toISOString() })
        .eq('id', reportId);
      if (error) throw error;
    },
    {
      successMessage: '已駁回該銷售回報',
      invalidateKeys: [['consignment-reports']],
    }
  );

  const returnItemsMutation = useSupabaseAction<
    void,
    { orderId: string; items: { consignment_order_item_id: string; quantity: number }[]; note?: string }
  >(
    async ({ orderId, items, note }) => {
      const { error } = await (supabase as any).rpc('return_consignment_items', {
        p_consignment_order_id: orderId,
        p_items: items,
        p_created_by: user?.id || null,
        p_note: note || null,
      });
      if (error) throw error;
    },
    {
      successMessage: '退回已記錄，庫存已更新',
      invalidateKeys: [['consignment-orders'], ['consignment-order-detail']],
    }
  );

  const settleMutation = useSupabaseAction<
    string,
    { orderId: string; settlementType: string; amount: number; accountId?: string; note?: string }
  >(
    async ({ orderId, settlementType, amount, accountId, note }) => {
      const { data, error } = await (supabase as any).rpc('settle_consignment', {
        p_consignment_order_id: orderId,
        p_settlement_type: settlementType,
        p_amount: amount,
        p_account_id: accountId || null,
        p_note: note || null,
        p_created_by: user?.id || null,
      });
      if (error) throw error;
      return data;
    },
    {
      successMessage: '結算已記錄',
      invalidateKeys: [['consignment-orders'], ['consignment-order-detail']],
    }
  );

  const { data: accounts = [] } = useQuery({
    queryKey: ['consignment-accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('accounts').select('id, name').order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['consignment-warehouses'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('warehouses').select('id, code, name').order('name');
      if (error) throw error;
      return (data || []) as { id: string; code: string; name: string }[];
    },
  });

  return {
    suppliers,
    stores,
    products,
    orders,
    ordersLoading,
    pendingReports,
    reportsLoading,
    useOrderDetail,
    accounts,
    warehouses,
    createOrderMutation,
    addItemMutation,
    removeItemMutation,
    updateItemMutation,
    cancelOrderMutation,
    receiveItemsMutation,
    shipMutation,
    reverseShipmentMutation,
    confirmReportsMutation,
    rejectReportMutation,
    returnItemsMutation,
    settleMutation,
    invalidateAll,
  };
}
