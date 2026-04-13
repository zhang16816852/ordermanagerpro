import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
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
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, has_variants, base_wholesale_price')
        .eq('status', 'active')
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
        .eq('purchase_order_id', viewingOrderId);
      if (error) throw error;

      // Get product info
      const productIds = (data || []).map((item: any) => item.product_id).filter(Boolean);
      let productMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, name, sku')
          .in('id', productIds);
        productMap = (prods || []).reduce((acc, p) => ({ ...acc, [p.id]: p }), {});
      }

      // Get variant info
      const variantIds = (data || []).map((item: any) => item.variant_id).filter(Boolean);
      let variantMap: Record<string, any> = {};
      if (variantIds.length > 0) {
        const { data: variants } = await supabase
          .from('product_variants')
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
      const { error } = await (supabase as any).from('purchase_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('採購訂單已刪除');
    },
    onError: () => toast.error('刪除失敗'),
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
      const { error } = await (supabase as any).from('purchase_order_items').insert(data);
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

  const receiveItemsMutation = useMutation({
    mutationFn: async (items: { id: string; received_quantity: number }[]) => {
      for (const item of items) {
        const { error } = await (supabase as any)
          .from('purchase_order_items')
          .update({ received_quantity: item.received_quantity })
          .eq('id', item.id);
        if (error) throw error;

        // Inventory update
        const orderItem = orderItems.find(i => i.id === item.id);
        if (orderItem && orderItem.product_id) {
          const { data: existing } = await (supabase as any)
            .from('product_inventory')
            .select('quantity')
            .eq('product_id', orderItem.product_id)
            .maybeSingle();

          const currentQty = existing?.quantity || 0;
          const { error: invError } = await (supabase as any)
            .from('product_inventory')
            .upsert({
              product_id: orderItem.product_id,
              variant_id: orderItem.variant_id,
              quantity: currentQty + item.received_quantity,
            }, {
              onConflict: 'product_id,variant_id',
            });
          if (invError) console.error('Inventory update error:', invError);
        }
      }

      // Update status
      const allReceived = orderItems.every(item => {
        const received = items.find(i => i.id === item.id);
        return received ? received.received_quantity >= item.quantity : item.received_quantity >= item.quantity;
      });

      const anyReceived = items.some(i => i.received_quantity > 0);
      const newStatus: PurchaseOrderStatus = allReceived ? 'received' : anyReceived ? 'partial_received' : 'ordered';

      if (viewingOrderId) {
        await (supabase as any)
          .from('purchase_orders')
          .update({
            status: newStatus,
            received_date: allReceived ? new Date().toISOString().split('T')[0] : null,
          })
          .eq('id', viewingOrderId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', viewingOrderId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
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

  return {
    suppliers,
    isLoadingSuppliers,
    orders,
    ordersLoading,
    products,
    orderItems,
    itemsLoading,
    accounts,
    createOrderMutation,
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    addItemMutation,
    receiveItemsMutation,
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
