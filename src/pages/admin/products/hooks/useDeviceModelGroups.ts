import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface DeviceModelGroup {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface DeviceModelGroupItem {
  id: string;
  group_id: string;
  model_id: string;
  position: number;
}

export function useDeviceModelGroups() {
  const queryClient = useQueryClient();

  // 1. 獲取所有群組
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['device_model_groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('device_model_groups')
        .select('*')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return data as DeviceModelGroup[];
    },
  });

  // 2. 建立群組
  const createGroupMutation = useMutation({
    mutationFn: async (values: Partial<DeviceModelGroup>) => {
      const clean = values.name ? values.name.replace(/\s+/g, ' ').trim() : values.name;
      const { data, error } = await supabase
        .from('device_model_groups')
        // 透過 as any 繞過 Supabase 對 name 必填的型別限制，呼叫方需確保 name 有值
        .insert([{ ...values, name: clean } as any])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
      toast.success('群組建立成功');
    },
    onError: (err: any) => toast.error(`建立失敗: ${getErrorMessage(err)}`),
  });

  // 3. 更新群組
  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<DeviceModelGroup> }) => {
      const clean = values.name ? values.name.replace(/\s+/g, ' ').trim() : values.name;
      const { error } = await supabase
        .from('device_model_groups')
        .update({ ...values, name: clean })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
      toast.success('群組已更新');
    },
  });

  // 4. 軟刪除群組
  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('device_model_groups')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
      toast.success('群組已刪除');
    },
  });

  // 5. 管理群組成員 (加入型號)
  const addItemsMutation = useMutation({
    mutationFn: async ({ groupId, modelIds }: { groupId: string; modelIds: string[] }) => {
      const items = modelIds.map((modelId, index) => ({
        group_id: groupId,
        model_id: modelId,
        position: index
      }));
      const { error } = await supabase.from('device_model_group_items').upsert(items, { onConflict: 'group_id,model_id' });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['device_model_group_items', variables.groupId] });
      toast.success('已加入型號至群組');
    },
  });

  // 6. 移除群組成員
  const removeItemsMutation = useMutation({
    mutationFn: async ({ groupId, modelIds }: { groupId: string; modelIds: string[] }) => {
      const { error } = await supabase
        .from('device_model_group_items')
        .delete()
        .eq('group_id', groupId)
        .in('model_id', modelIds);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['device_model_group_items', variables.groupId] });
      toast.success('已從群組移除型號');
    },
  });

  // 7. 獲取特定群組的型號成員
  const useGroupItems = (groupId: string) => {
    return useQuery({
      queryKey: ['device_model_group_items', groupId],
      queryFn: async () => {
        if (!groupId) return [];
        const { data, error } = await supabase
          .from('device_model_group_items')
          .select('*, device_models(*)')
          .eq('group_id', groupId)
          .order('position');
        if (error) throw error;
        return data;
      },
      enabled: !!groupId,
    });
  };

  // 8. 獲取群組的使用統計 (受影響產品數)
  const useGroupUsage = (groupId: string) => {
    return useQuery({
      queryKey: ['device_model_group_usage', groupId],
      queryFn: async () => {
        if (!groupId) return { products: 0, variants: 0 };
        const [prodCount, varCount] = await Promise.all([
          supabase.from('entity_model_relations').select('*', { count: 'exact', head: true }).eq('group_id', groupId).eq('relation_type', 'include').not('group_id', 'is', null).not('product_id', 'is', null),
          supabase.from('entity_model_relations').select('*', { count: 'exact', head: true }).eq('group_id', groupId).eq('relation_type', 'include').not('group_id', 'is', null).not('variant_id', 'is', null),
        ]);
        return {
          products: prodCount.count || 0,
          variants: varCount.count || 0
        };
      },
      enabled: !!groupId,
    });
  };

  return {
    groups,
    isLoading,
    createGroupMutation,
    updateGroupMutation,
    deleteGroupMutation,
    addItemsMutation,
    removeItemsMutation,
    useGroupItems,
    useGroupUsage
  };
}
