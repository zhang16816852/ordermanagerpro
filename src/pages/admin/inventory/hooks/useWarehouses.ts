import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  type: string | null;
  include_in_actual: boolean;
  include_in_available: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

function generateCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').slice(0, 4).toLowerCase();
  const suffix = Math.random().toString(36).substring(2, 5);
  return prefix ? `${prefix}_${suffix}` : `wh_${suffix}`;
}

export function useWarehouses() {
  const queryClient = useQueryClient();

  const { data: warehouses = [], isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('warehouses' as any) as any)
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as Warehouse[];
    },
  });

  const createWarehouse = useMutation({
    mutationFn: async (wh: { name: string; code?: string; type?: string; include_in_actual: boolean; include_in_available: boolean }) => {
      const finalCode = wh.code?.trim() || generateCode(wh.name);
      const { error } = await (supabase.from('warehouses' as any) as any).insert({
        name: wh.name,
        code: finalCode,
        type: wh.type || null,
        include_in_actual: wh.include_in_actual,
        include_in_available: wh.include_in_available,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('倉庫已新增');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '新增失敗')),
  });

  const updateWarehouse = useMutation({
    mutationFn: async (wh: { id: string; name: string; code: string; type?: string | null; include_in_actual: boolean; include_in_available: boolean; is_active: boolean }) => {
      const { error } = await (supabase.from('warehouses' as any) as any).update({
        name: wh.name,
        code: wh.code,
        type: wh.type ?? null,
        include_in_actual: wh.include_in_actual,
        include_in_available: wh.include_in_available,
        is_active: wh.is_active,
      }).eq('id', wh.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('倉庫已更新');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '更新失敗')),
  });

  const reorderWarehouses = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      const updates = items.map(item => ({
        id: item.id,
        sort_order: item.sort_order,
      }));
      const { error } = await (supabase.from('warehouses' as any) as any).upsert(updates, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '排序更新失敗')),
  });

  const defaultWarehouse = warehouses.find(w => w.sort_order === 0) || warehouses[0];

  return { warehouses, isLoading, createWarehouse, updateWarehouse, reorderWarehouses, defaultWarehouse };
}
