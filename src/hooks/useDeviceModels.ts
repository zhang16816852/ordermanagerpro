import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DeviceModel {
    id: string;
    name: string;
    brand_id: string | null;
    sort_order: number;
}

export function useDeviceModels() {
    return useQuery({
        queryKey: ['device_models_active'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('device_models')
                .select('*')
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });
            
            if (error) {
                console.error('[useDeviceModels] Fetch error:', error);
                return [];
            }
            return data as DeviceModel[];
        },
        staleTime: 1000 * 60 * 10, // 10 minutes cache
    });
}
