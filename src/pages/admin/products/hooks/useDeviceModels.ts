import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Database } from '@/integrations/supabase/types';

export type DeviceModel = Database['public']['Tables']['device_models']['Row'] & { device_type?: string | null, screen_size?: string | null, device_series?: string | null, device_remarks?: string | null, release_date?: string | null };
export type DeviceModelInsert = Database['public']['Tables']['device_models']['Insert'] & { device_type?: string | null, screen_size?: string | null, device_series?: string | null, device_remarks?: string | null, release_date?: string | null };
export type DeviceModelUpdate = Database['public']['Tables']['device_models']['Update'] & { device_type?: string | null, screen_size?: string | null, device_series?: string | null, device_remarks?: string | null, release_date?: string | null };

export function useDeviceModels() {
  const queryClient = useQueryClient();

  const { data: models = [], isLoading } = useQuery({
    queryKey: ['device_models'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('device_models')
        .select(`*`)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching device models:', error);
        throw error;
      }
      return data as (DeviceModel & { brand?: { name: string } | null })[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (newModel: DeviceModelInsert) => {
      const { data, error } = await supabase
        .from('device_models')
        .insert([newModel])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device_models'] });
      toast.success('型號標籤已新增');
    },
    onError: (error: any) => {
      console.error('Create error:', error);
      toast.error(error.message?.includes('unique') ? '該型號名稱已存在' : '新增失敗');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: DeviceModelUpdate }) => {
      const { data, error } = await supabase
        .from('device_models')
        .update(values)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device_models'] });
      toast.success('型號標籤已更新');
    },
    onError: (error) => {
      console.error('Update error:', error);
      toast.error('更新失敗');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('device_models')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device_models'] });
      toast.success('型號標籤已刪除');
    },
    onError: (error) => {
      console.error('Delete error:', error);
      toast.error('刪除失敗，可能有產品正在使用此標籤');
    },
  });

  return {
    models,
    isLoading,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}
