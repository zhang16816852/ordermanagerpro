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
      const { data, error } = await (supabase
        .from('device_model_groups') as any)
        .select('*')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return data as DeviceModelGroup[];
    },
  });

  // 2. 建立群組（原子化 RPC，自動處理軟刪除碰撞）
  const createGroupMutation = useMutation({
    mutationFn: async (values: Partial<DeviceModelGroup>) => {
      const clean = values.name ? values.name.replace(/\s+/g, ' ').trim() : values.name;
      const { data, error } = await (supabase.rpc as any)('create_device_model_group', {
        p_name: clean,
        p_description: values.description ?? null,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.reason || '建立失敗');
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
      if (data?.mode === 'revived') toast.success('已復活並更新原群組');
      else toast.success('群組建立成功');
    },
    onError: (err: any) => toast.error(`建立失敗: ${getErrorMessage(err)}`),
  });

  // 3. 更新群組（原子化 RPC，自動處理軟刪除碰撞）
  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<DeviceModelGroup> }) => {
      const clean = values.name ? values.name.replace(/\s+/g, ' ').trim() : values.name;
      const { data, error } = await (supabase.rpc as any)('rename_device_model_group', {
        p_id: id,
        p_new_name: clean,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.reason || '更新失敗');
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
      if (data?.merged?.length) toast.success(`群組已更新（已合併 ${data.merged.length} 筆引用）`);
      else toast.success('群組已更新');
    },
  });

  // 4. 刪除群組（原子化 RPC：無引用硬刪，有引用軟刪）
  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase.rpc as any)('delete_device_model_group', { p_id: id });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.reason || '刪除失敗');
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
      if (data?.mode === 'hard') toast.success('群組已永久刪除');
      else toast.success(`群組已刪除（仍有 ${data?.ref_count ?? 0} 筆引用，保留歷史）`);
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
      const { error } = await (supabase.from('device_model_group_items') as any).upsert(items, { onConflict: 'group_id,model_id' });
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
      const { error } = await (supabase
        .from('device_model_group_items') as any)
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
        const { data, error } = await (supabase
          .from('device_model_group_items') as any)
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
          (supabase.from('entity_model_relations') as any).select('*', { count: 'exact', head: true }).eq('group_id', groupId).eq('relation_type', 'include').not('group_id', 'is', null).not('product_id', 'is', null),
          (supabase.from('entity_model_relations') as any).select('*', { count: 'exact', head: true }).eq('group_id', groupId).eq('relation_type', 'include').not('group_id', 'is', null).not('variant_id', 'is', null),
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
