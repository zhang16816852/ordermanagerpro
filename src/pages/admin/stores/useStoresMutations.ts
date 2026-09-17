import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { Store, StoreInsert } from './storesTypes';

export interface StoresMutationParams {
  user: { id: string } | null;
  selectedUserId: string | null;
  selectedStoreId: string;
  selectedRole: string;
  inviteEmail: string;
  setIsStoreDialogOpen: (v: boolean) => void;
  setEditingStore: (s: Store | null) => void;
  setShowAssignDialog: (v: boolean) => void;
  setSelectedUserId: (v: string | null) => void;
  setSelectedStoreId: (v: string) => void;
  setSelectedRole: (v: string) => void;
  setShowInviteDialog: (v: boolean) => void;
  setInviteEmail: (v: string) => void;
  setShowRoleDialog: (v: boolean) => void;
  setRoleUserId: (v: string | null) => void;
}

export function useStoresMutations(params: StoresMutationParams) {
  const {
    user,
    selectedUserId,
    selectedStoreId,
    selectedRole,
    inviteEmail,
    setIsStoreDialogOpen,
    setEditingStore,
    setShowAssignDialog,
    setSelectedUserId,
    setSelectedStoreId,
    setSelectedRole,
    setShowInviteDialog,
    setInviteEmail,
    setShowRoleDialog,
    setRoleUserId,
  } = params;
  const queryClient = useQueryClient();

  const createStoreMutation = useMutation({
    mutationFn: async (store: StoreInsert) => {
      const { error } = await (supabase.from('stores') as any).insert(store);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
      toast.success('店鋪已新增');
      setIsStoreDialogOpen(false);
    },
    onError: (err) => toast.error(`新增失敗：${getErrorMessage(err)}`),
  });

  const updateStoreMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Store> & { id: string }) => {
      const { error } = await (supabase.from('stores') as any).update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
      toast.success('店鋪已更新');
      setIsStoreDialogOpen(false);
      setEditingStore(null);
    },
    onError: (err) => toast.error(`更新失敗：${getErrorMessage(err)}`),
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !selectedStoreId) throw new Error('請選擇用戶和店鋪');
      const { data: existing } = await (supabase
        .from('store_users') as any)
        .select('id')
        .eq('user_id', selectedUserId)
        .eq('store_id', selectedStoreId)
        .single();
      if (existing) {
        const { error } = await (supabase
          .from('store_users') as any)
          .update({ role: selectedRole as 'founder' | 'manager' | 'employee' })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase
          .from('store_users') as any)
          .insert({ user_id: selectedUserId, store_id: selectedStoreId, role: selectedRole as 'founder' | 'manager' | 'employee' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('已指派店鋪成員');
      setShowAssignDialog(false);
      setSelectedUserId(null);
      setSelectedStoreId('');
      setSelectedRole('employee');
      queryClient.invalidateQueries({ queryKey: ['admin-store-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
    },
    onError: (err: Error) => toast.error(getErrorMessage(err)),
  });

  const removeStoreMutation = useMutation({
    mutationFn: async (storeUserId: string) => {
      const { error } = await (supabase.from('store_users') as any).delete().eq('id', storeUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已移除店鋪成員');
      queryClient.invalidateQueries({ queryKey: ['admin-store-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stores'] });
    },
    onError: (err: Error) => toast.error(getErrorMessage(err)),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!user || !selectedStoreId || !inviteEmail) throw new Error('請填寫完整資料');
      const { error } = await (supabase.from('invitations') as any).insert({
        email: inviteEmail,
        store_id: selectedStoreId,
        role: selectedRole as 'founder' | 'manager' | 'employee',
        invited_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('邀請已發送');
      setShowInviteDialog(false);
      setInviteEmail('');
      setSelectedStoreId('');
      setSelectedRole('employee');
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
    onError: (err: Error) => toast.error(getErrorMessage(err)),
  });

  // 設定系統角色（業務 / 管理員 / 維修人員 / 用戶）
  const systemRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      if (role === 'customer') {
        const { error } = await (supabase
          .from('user_roles') as any)
          .delete()
          .eq('user_id', userId);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase
        .from('user_roles') as any)
        .upsert(
          { user_id: userId, role },
          { onConflict: 'user_id,role' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('系統角色已更新');
      setShowRoleDialog(false);
      setRoleUserId(null);
      queryClient.invalidateQueries({ queryKey: ['admin-user-roles'] });
      queryClient.invalidateQueries({ queryKey: ['admin-reps'] });
      queryClient.invalidateQueries({ queryKey: ['admin-rep-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin-rep-assignments'] });
    },
    onError: (err: Error) => toast.error(getErrorMessage(err)),
  });

  return {
    createStoreMutation,
    updateStoreMutation,
    assignMutation,
    removeStoreMutation,
    inviteMutation,
    systemRoleMutation,
  };
}