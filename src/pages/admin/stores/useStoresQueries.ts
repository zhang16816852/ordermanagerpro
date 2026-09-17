import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { StoreWithMembers } from './storesTypes';

export interface StoresQueriesResult {
  stores?: StoreWithMembers[];
  storesLoading: boolean;
  profiles?: any[];
  profilesLoading: boolean;
  userRoles?: any[];
  storeUsers?: any[];
  storesList?: { id: string; name: string; code: string | null }[];
  invitations?: any[];
  profilesForStore?: any[];
}

export function useStoresQueries(): StoresQueriesResult {
  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ['admin-stores'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('stores') as any)
        .select('*, store_users(count)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as StoreWithMembers[];
    },
  });

  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['admin-profiles'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('profiles') as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ['admin-user-roles'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('user_roles') as any)
        .select('user_id, role');
      if (error) throw error;
      return data;
    },
  });

  const { data: storeUsers } = useQuery({
    queryKey: ['admin-store-users'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('store_users') as any)
        .select(`
          id,
          user_id,
          role,
          store_id,
          store:stores(name, code)
        `);
      if (error) throw error;
      return data;
    },
  });

  const { data: storesList } = useQuery({
    queryKey: ['admin-stores-list'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('stores') as any)
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: invitations } = useQuery({
    queryKey: ['admin-invitations'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('invitations') as any)
        .select('*, stores(name, code)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profilesForStore } = useQuery({
    queryKey: ['admin-profiles-for-store'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('profiles') as any)
        .select('id, email, full_name, phone');
      if (error) throw error;
      return data;
    },
  });

  return {
    stores,
    storesLoading,
    profiles,
    profilesLoading,
    userRoles,
    storeUsers,
    storesList,
    invitations,
    profilesForStore,
  };
}