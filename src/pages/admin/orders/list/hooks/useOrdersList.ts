import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Order, OrderItem, ShippingPoolItem } from '@/types/order';
import { toast } from 'sonner';

export function useOrdersList(storeFilter: string, statusTab: 'pending' | 'processing' | 'shipped') {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // 1. Shipping Pool items (for pending quantity calculation)
  const { data: shippingPoolItems = [] } = useQuery({
    queryKey: ['shipping-pool-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipping_pool')
        .select('order_item_id, quantity');
      if (error) throw error;
      return data as ShippingPoolItem[];
    },
  });

  const shippingPoolMap = new Map(
    shippingPoolItems.map(item => [item.order_item_id, item.quantity]) || []
  );

  // 2. Stores list for filter
  const { data: stores = [] } = useQuery({
    queryKey: ['stores-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // 3. Main Orders Query
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['admin-orders', storeFilter, statusTab],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select(`
          id,
          code,
          created_at,
          source_type,
          status,
          notes,
          store_id,
          stores (name, code),
          order_items (
            id,
            quantity,
            shipped_quantity,
            unit_price,
            status,
            store_id,
            product:products (name, sku),
            product_variant:product_variants (name, option_1, option_2)
          )
        `)
        .eq('status', statusTab)
        .order('created_at', { ascending: false });

      if (storeFilter && storeFilter !== 'all') {
        query = query.eq('store_id', storeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Order[];
    },
  });

  // Helper functions
  const getPendingQuantity = (item: { id: string; quantity: number; shipped_quantity: number }) => {
    const inPool = shippingPoolMap.get(item.id) || 0;
    return item.quantity - item.shipped_quantity - inPool;
  };

  const syncOrdersMutation = useMutation({
    mutationFn: async () => {
      const { data: processingOrders, error } = await supabase
        .from('orders')
        .select(`id, order_items (quantity, shipped_quantity, status)`)
        .eq('status', 'processing');

      if (error) throw error;
      if (!processingOrders || processingOrders.length === 0) return 0;

      const ordersToUpdate = processingOrders
        .filter(order => {
          if (!order.order_items || order.order_items.length === 0) return false;
          return order.order_items.every(item =>
            item.shipped_quantity >= item.quantity ||
            item.status === 'cancelled' ||
            item.status === 'discontinued'
          );
        })
        .map(order => order.id);

      if (ordersToUpdate.length === 0) return 0;

      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'shipped' })
        .in('id', ordersToUpdate);

      if (updateError) throw updateError;
      return ordersToUpdate.length;
    },
    onSuccess: (count) => {
      if (count > 0) {
        toast.success(`已成功同步 ${count} 筆訂單狀態為「已出貨」`);
        queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      } else {
        toast.info('沒有需要同步的訂單');
      }
    },
    onError: (error: Error) => toast.error(`同步失敗: ${error.message}`),
  });

  const confirmOrdersMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'processing' })
        .in('id', orderIds);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast.success(`已將 ${variables.length} 個訂單轉為處理中`);
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addToShippingPoolMutation = useMutation({
    mutationFn: async (items: any[]) => {
      if (!user) throw new Error('未登入');
      const poolItems = items.map(item => ({
        order_item_id: item.itemId,
        quantity: item.quantity,
        store_id: item.storeId,
        created_by: user.id,
      }));

      const { error } = await supabase.from('shipping_pool').insert(poolItems);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast.success(`已加入出貨池，共 ${variables.length} 個項目`);
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelItemsMutation = useMutation({
    mutationFn: async ({ itemIds, targetStatus }: { itemIds: string[]; targetStatus: 'cancelled' | 'waiting' }) => {
      const { error } = await supabase
        .from('order_items')
        .update({ status: targetStatus })
        .in('id', itemIds);
      if (error) throw error;
      return { count: itemIds.length, targetStatus };
    },
    onSuccess: ({ count, targetStatus }) => {
      const label = targetStatus === 'cancelled' ? '停產/取消' : '還原待出貨';
      toast.success(`已將 ${count} 個品項標記為「${label}」`);
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    stores,
    orders,
    isLoading,
    shippingPoolMap,
    getPendingQuantity,
    syncOrdersMutation,
    confirmOrdersMutation,
    addToShippingPoolMutation,
    cancelItemsMutation,
  };
}
