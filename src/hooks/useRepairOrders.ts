import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { RepairOrder, RepairOrderInsert, RepairOrderUpdate, RepairOrderItem, RepairOrderItemInsert, RepairOrderSummary } from '@/types/repair';

export function useRepairTechnicians() {
  const { data: technicians, isLoading } = useQuery({
    queryKey: ['repair_technicians'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('list_repair_contractors');
      if (error) throw error;
      return (data || []) as { id: string; email: string; full_name: string | null }[];
    },
  });
  return { technicians, isLoading };
}

export function useRepairAssigneeMap() {
  const { data } = useQuery({
    queryKey: ['repair_assignee_emails'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('repair_assignee_emails');
      if (error) throw error;
      const map: Record<string, { email: string | null; full_name: string | null }> = {};
      ((data || []) as { user_id: string; email: string; full_name: string | null }[]).forEach((r) => {
        map[r.user_id] = { email: r.email, full_name: r.full_name };
      });
      return map;
    },
  });
  return data || {};
}

export function useRepairOrders(storeId?: string | null) {
  const queryClient = useQueryClient();

  const queryKey = ['repair_orders', storeId || 'all'];

  const { data: orders, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = (supabase as any).from('repair_orders')
        .select(`
          *,
          device_model:device_model_id(name, specifications, device_type, screen_size),
          store:store_id(name),
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
        store?: { name: string } | null;
        items?: RepairOrderItem[];
      })[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: RepairOrderInsert) => {
      const { data, error } = await (supabase as any).from('repair_orders')
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
      toast.error('建立失敗：' + getErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: RepairOrderUpdate }) => {
      const { data, error } = await (supabase as any).from('repair_orders')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['repair_order', data.id] });
      }
      toast.success('維修單已更新');
    },
    onError: (err: any) => {
      toast.error('更新失敗：' + getErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('repair_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('維修單已刪除');
    },
    onError: (err: any) => {
      toast.error('刪除失敗：' + getErrorMessage(err));
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await (supabase as any).from('repair_orders')
        .update({ status: status as any })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['repair_order', data.id] });
      }
      toast.success(`狀態已更新為 ${data.status}`);
    },
    onError: (err: any) => {
      toast.error('狀態更新失敗：' + getErrorMessage(err));
    },
  });

  const acceptAndStartMutation = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const { data, error } = await (supabase as any).from('repair_orders')
        .update({ assigned_to: userId, status: 'diagnosing' })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['repair_order', data.id] });
      }
      toast.success(`已接單：${data.code}`);
    },
    onError: (err: any) => {
      toast.error('接單失敗：' + getErrorMessage(err));
    },
  });

  const deliverMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).from('repair_orders')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['repair_order', data.id] });
      }
      toast.success(`已交還客戶：${data.code}`);
    },
    onError: (err: any) => {
      toast.error('交還客戶失敗：' + getErrorMessage(err));
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
    acceptAndStartMutation,
    deliverMutation,
  };
}

export function useRepairOrderDetail(orderId: string) {
  const queryKey = ['repair_order', orderId];

  const { data: order, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('repair_orders')
        .select(`
          *,
          device_model:device_model_id(id, name, specifications, device_type, screen_size, device_series, brand:brand_id(id, name)),
          device_brand:device_model_id(brand_id(name)),
          store:store_id(name),
          items:repair_order_items(*, product:product_id(name, code), variant:variant_id(name, sku)),
          status_history:repair_order_status_history(*),
          checklists:repair_device_checklists(*)
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
  const queryClient = useQueryClient();
  const queryKey = ['repair_order_items', orderId];

  const { data: items, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('repair_order_items')
        .select('*, product:product_id(name, code), variant:variant_id(name, sku)')
        .eq('repair_order_id', orderId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as (RepairOrderItem & { product?: { name: string; code: string } | null; variant?: { name: string; sku: string } | null })[];
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (values: RepairOrderItemInsert) => {
      const { data, error } = await (supabase as any).from('repair_order_items').insert([values]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['repair_order', orderId] });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<RepairOrderItemInsert> }) => {
      const { data, error } = await (supabase as any).from('repair_order_items').update(values).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['repair_order', orderId] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('repair_order_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['repair_order', orderId] });
    },
  });

  return { items, isLoading, addItemMutation, updateItemMutation, deleteItemMutation };
}
