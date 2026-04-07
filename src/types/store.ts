import type { Database } from "../integrations/supabase/types";

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Store = Tables<'stores'>;

export type StoreRoleType = 'founder' | 'manager' | 'employee';

export interface StoreRole {
    store_id: string;
    store_name: string;
    role: StoreRoleType;
}

export interface StoreMember {
    id: string;
    store_id: string;
    profile_id: string;
    role: StoreRoleType;
    profile?: {
        full_name: string | null;
        email: string | null;
    };
}
