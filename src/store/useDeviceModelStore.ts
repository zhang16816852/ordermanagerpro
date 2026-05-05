import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

export type DeviceModel = Database['public']['Tables']['device_models']['Row'];
export type DeviceBrand = Database['public']['Tables']['device_brands']['Row'];
export type DeviceModelGroup = Database['public']['Tables']['device_model_groups']['Row'];

interface DeviceModelStore {
    models: DeviceModel[];
    brands: DeviceBrand[];
    groups: DeviceModelGroup[];
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
    groups: [],
    isLoading: false,
    isAdding: false,
    isInitialized: false,

    fetchData: async (force = false) => {
        if (!force && get().isInitialized) return;

        set({ isLoading: true });
        try {
            const [modelsRes, brandsRes, groupsRes] = await Promise.all([
                supabase.from('device_models').select('*').order('name'),
                supabase.from('device_brands').select('*').order('name'),
                supabase.from('device_model_groups').select('*').is('deleted_at', null).order('name')
            ]);

            if (modelsRes.error) throw modelsRes.error;
            if (brandsRes.error) throw brandsRes.error;
            if (groupsRes.error) throw groupsRes.error;

            set({ 
                models: modelsRes.data || [], 
                brands: brandsRes.data || [], 
                groups: groupsRes.data || [],
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
