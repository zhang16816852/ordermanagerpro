import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RepairOrder, RepairOrderInsert, RepairOrderUpdate, RepairOrderItem, RepairOrderItemInsert, RepairOrderSummary } from '@/types/repair';

export function useRepairOrders(storeId?: string | null) {
  const queryClient = useQueryClient();

  const queryKey = ['repair_orders', storeId || 'all'];

  const { data: orders, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = supabase
        .from('repair_orders')
        .select(`
          *,
          device_model:device_model_id(name, specifications, device_type, screen_size),
          assigned_tech:assigned_to(email),
          items:repair_order_items(*)
        `)
        .order('created_at', { ascending: false });

      if (storeId) {
        query = query.eq('store_id', storeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as (RepairOrder & {
        device_model?: { name: string; specifications: any; device_type: string; screen_size: string } | null;
        assigned_tech?: { email: string } | null;
        items?: RepairOrderItem[];
      })[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: RepairOrderInsert) => {
      const { data, error } = await supabase
        .from('repair_orders')
        .insert([values])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('維修單已建立');
    },
    onError: (err: any) => {
      toast.error('建立失敗：' + err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: RepairOrderUpdate }) => {
      const { data, error } = await supabase
        .from('repair_orders')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('維修單已更新');
    },
    onError: (err: any) => {
      toast.error('更新失敗：' + err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('repair_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('維修單已刪除');
    },
    onError: (err: any) => {
      toast.error('刪除失敗：' + err.message);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase
        .from('repair_orders')
        .update({ status: status as any })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(`狀態已更新為 ${data.status}`);
    },
    onError: (err: any) => {
      toast.error('狀態更新失敗：' + err.message);
    },
  });

  return {
    orders,
    isLoading,
    error,
    createMutation,
    updateMutation,
    deleteMutation,
    updateStatusMutation,
  };
}

export function useRepairOrderDetail(orderId: string) {
  const queryKey = ['repair_order', orderId];

  const { data: order, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repair_orders')
        .select(`
          *,
          device_model:device_model_id(id, name, specifications, device_type, screen_size, device_series),
          device_brand:device_model_id(brand_id(name)),
          assigned_tech:assigned_to(id, email),
          items:repair_order_items(*, product:product_id(name, sku), variant:variant_id(name, sku)),
          status_history:repair_order_status_history(*, changed_by_user:changed_by(email))
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;
      return data as any;
    },
  });

  return { order, isLoading };
}

export function useRepairOrderItems(orderId: string) {
  const queryKey = ['repair_order_items', orderId];

  const { data: items, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repair_order_items')
        .select('*, product:product_id(name, sku), variant:variant_id(name, sku)')
        .eq('repair_order_id', orderId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as (RepairOrderItem & { product?: { name: string; sku: string } | null; variant?: { name: string; sku: string } | null })[];
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (values: RepairOrderItemInsert) => {
      const { data, error } = await supabase.from('repair_order_items').insert([values]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<RepairOrderItemInsert> }) => {
      const { data, error } = await supabase.from('repair_order_items').update(values).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('repair_order_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return { items, isLoading, addItemMutation, updateItemMutation, deleteItemMutation };
}
