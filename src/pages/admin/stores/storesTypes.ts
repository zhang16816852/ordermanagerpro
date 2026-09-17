import { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Store = Tables<'stores'>;
export type StoreInsert = TablesInsert<'stores'>;

export interface StoreWithMembers extends Store {
  store_users: { count: number }[];
}

export type StoreUserRecord = {
  id: string;
  user_id: string;
  role: string;
  store_id: string;
  profile?: { email: string; full_name: string | null; phone: string | null };
};