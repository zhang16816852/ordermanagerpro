import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

export type DeviceModel = Database['public']['Tables']['device_models']['Row'];
export type DeviceBrand = Database['public']['Tables']['device_brands']['Row'];

interface DeviceModelStore {
    models: DeviceModel[];
    brands: DeviceBrand[];
    isLoading: boolean;
    isAdding: boolean;
    isInitialized: boolean;
    fetchData: (force?: boolean) => Promise<void>;
    addModel: (newModel: Partial<DeviceModel>) => Promise<DeviceModel | null>;
    getModelsByNames: (names: string[]) => DeviceModel[];
}

export const useDeviceModelStore = create<DeviceModelStore>((set, get) => ({
    models: [],
    brands: [],
    isLoading: false,
    isAdding: false,
    isInitialized: false,

    fetchData: async (force = false) => {
        if (!force && get().isInitialized) return;

        set({ isLoading: true });
        try {
            const [modelsRes, brandsRes] = await Promise.all([
                supabase.from('device_models').select('*').order('name'),
                supabase.from('device_brands').select('*').order('name')
            ]);

            if (modelsRes.error) throw modelsRes.error;
            if (brandsRes.error) throw brandsRes.error;

            set({ 
                models: modelsRes.data || [], 
                brands: brandsRes.data || [], 
                isLoading: false, 
                isInitialized: true 
            });
        } catch (err) {
            console.error('[DeviceModelStore] Fetch failed:', err);
            set({ isLoading: false });
        }
    },

    addModel: async (newModel) => {
        set({ isAdding: true });
        try {
            const { data, error } = await supabase
                .from('device_models')
                .insert([newModel as any])
                .select()
                .single();

            if (error) throw error;

            const created = data as DeviceModel;
            set(state => ({
                models: [...state.models, created].sort((a, b) => a.name.localeCompare(b.name)),
                isAdding: false
            }));
            return created;
        } catch (err) {
            console.error('[DeviceModelStore] Add failed:', err);
            set({ isAdding: false });
            return null;
        }
    },

    getModelsByNames: (names) => {
        if (!names || names.length === 0) return [];
        const normalizedNames = names.map(n => n.trim().toLowerCase());
        return get().models.filter(m => 
            normalizedNames.includes(m.name.toLowerCase()) || 
            (m.aliases && m.aliases.some(a => normalizedNames.includes(a.toLowerCase())))
        );
    }
}));
