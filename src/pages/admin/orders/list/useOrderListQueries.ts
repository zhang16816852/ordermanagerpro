import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RepFilterOption {
  user_id: string;
  full_name: string;
  email: string;
}

export function useOrderListQueries(repFilter: string) {
  // 業務列表（篩選下拉用）
  const { data: repsData = [] } = useQuery<RepFilterOption[]>({
    queryKey: ['admin-reps-for-filter'],
    queryFn: async () => {
      const { data: roles } = await (supabase
        .from('user_roles') as any)
        .select('user_id')
        .eq('role', 'rep');
      if (!roles || roles.length === 0) return [];
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await (supabase
        .from('profiles') as any)
        .select('id, full_name, email')
        .in('id', userIds);
      return (profiles || []).map((p: any) => ({
        user_id: p.id,
        full_name: p.full_name,
        email: p.email,
      }));
    },
  });

  // 選取業務的名下店家 IDs
  const { data: repAssignedStoreIds = [] } = useQuery<string[]>({
    queryKey: ['admin-rep-stores-for-filter', repFilter],
    queryFn: async () => {
      if (repFilter === 'all') return [];
      const { data } = await (supabase
        .from('rep_store_assignments') as any)
        .select('store_id')
        .eq('rep_id', repFilter);
      return (data || []).map((a: any) => a.store_id as string);
    },
    enabled: repFilter !== 'all',
  });

  return { repsData, repAssignedStoreIds };
}