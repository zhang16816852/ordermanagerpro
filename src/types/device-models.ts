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
export type FullDeviceModel = Database['public']['Tables']['device_models']['Row'] & {
    device_type?: string | null;
    screen_size?: string | null;
    device_series?: string | null;
    device_remarks?: string | null;
    release_date?: string | null;
    aliases?: string[] | null;
};

export type FullDeviceModelInsert = Database['public']['Tables']['device_models']['Insert'] & {
    device_type?: string | null;
    screen_size?: string | null;
    device_series?: string | null;
    device_remarks?: string | null;
    release_date?: string | null;
    aliases?: string[] | null;
};

export type FullDeviceModelUpdate = Database['public']['Tables']['device_models']['Update'] & {
    device_type?: string | null;
    screen_size?: string | null;
    device_series?: string | null;
    device_remarks?: string | null;
    release_date?: string | null;
    aliases?: string[] | null;
};
