import { Database } from '@/integrations/supabase/types';

// Frontend/cache version (from @/hooks/useDeviceModels)
export interface DeviceModel {
    id: string;
    name: string;
    brand_id: string | null;
    sort_order: number;
    aliases: string[] | null;
    device_series: string | null;
}

// Admin/CRUD version (full DB row + custom fields)
export type FullDeviceModel = Omit<Database['public']['Tables']['device_models']['Row'], 'specifications'> & {
    device_type?: string | null;
    screen_size?: string | null;
    device_series?: string | null;
    device_remarks?: string | null;
    release_date?: string | null;
    aliases?: string[] | null;
    specifications?: Record<string, any> | null;
};

export type FullDeviceModelInsert = Omit<Database['public']['Tables']['device_models']['Insert'], 'specifications'> & {
    device_type?: string | null;
    screen_size?: string | null;
    device_series?: string | null;
    device_remarks?: string | null;
    release_date?: string | null;
    aliases?: string[] | null;
    specifications?: Record<string, any> | null;
};

export type FullDeviceModelUpdate = Omit<Database['public']['Tables']['device_models']['Update'], 'specifications'> & {
    device_type?: string | null;
    screen_size?: string | null;
    device_series?: string | null;
    device_remarks?: string | null;
    release_date?: string | null;
    aliases?: string[] | null;
    specifications?: Record<string, any> | null;
};
