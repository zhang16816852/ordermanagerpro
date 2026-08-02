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
      return data as { id: string };
    },
    {
      successMessage: '寄賣單已建立',
      invalidateKeys: [['consignment-orders']],
    }
  );

  const addItemMutation = useSupabaseAction<void, { orderId: string; item: NewConsignmentItem }>(
    async ({ orderId, item }) => {
      const { error } = await (supabase as any)
        .from('consignment_order_items')
        .insert({
          consignment_order_id: orderId,
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          unit_cost: item.unit_cost,
        });
      if (error) throw error;
    },
    {
      successMessage: '品項已新增',
      invalidateKeys: [['consignment-order-detail']],
    }
  );

  const removeItemMutation = useSupabaseAction<void, string>(
    async (itemId) => {
      const { error } = await (supabase as any)
        .from('consignment_order_items')
        .delete()
        .eq('id', itemId);
      if (error) throw error;
    },
    {
      successMessage: '品項已移除',
      invalidateKeys: [['consignment-order-detail']],
    }
  );

  const cancelOrderMutation = useSupabaseAction<void, string>(
    async (orderId) => {
      const { error } = await (supabase as any)
        .from('consignment_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);
      if (error) throw error;
    },
    {
      successMessage: '寄賣單已取消',
      invalidateKeys: [['consignment-orders']],
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
      successMessage: '已出貨並建立銷貨單',
      invalidateKeys: [['consignment-orders'], ['consignment-order-detail']],
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
      successMessage: '銷售回報已審核確認',
      invalidateKeys: [['consignment-reports'], ['consignment-orders'], ['consignment-order-detail']],
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
    cancelOrderMutation,
    receiveItemsMutation,
    shipMutation,
    confirmReportsMutation,
    rejectReportMutation,
    returnItemsMutation,
    settleMutation,
    invalidateAll,
  };
}
