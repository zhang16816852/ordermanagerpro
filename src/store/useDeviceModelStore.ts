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
    groupItems: { group_id: string, model_id: string }[];
    isLoading: boolean;
    isAdding: boolean;
    isInitialized: boolean;
    fetchData: (force?: boolean, serverVersion?: string) => Promise<void>;
    addModel: (newModel: Partial<DeviceModel>) => Promise<DeviceModel | null>;
    getModelsByNames: (names: string[]) => DeviceModel[];
}

// Read cache helper
const getCachedData = () => {
    try {
        const cache = localStorage.getItem('device_models_cache_v2');
        if (cache) {
            const parsed = JSON.parse(cache);
            if (parsed && parsed.version && Array.isArray(parsed.models)) {
                return parsed;
            }
        }
    } catch (e) {
        console.error('[DeviceModelStore] Read cache failed:', e);
    }
    return null;
};

const initialCache = getCachedData();

export const useDeviceModelStore = create<DeviceModelStore>((set, get) => ({
    models: initialCache?.models || [],
    brands: initialCache?.brands || [],
    groups: initialCache?.groups || [],
    groupItems: initialCache?.groupItems || [],
    isLoading: false,
    isAdding: false,
    isInitialized: !!initialCache,

    fetchData: async (force = false, serverVersion?: string) => {
        if (!force && get().isInitialized) return;

        set({ isLoading: true });
        try {
            const results = await Promise.all([
                supabase.from('device_models').select('*').order('name'),
                supabase.from('device_brands').select('*').order('name'),
                supabase.from('device_model_groups').select('*').is('deleted_at', null).order('name'),
                supabase.from('device_model_group_items').select('group_id, model_id').order('position')
            ]);

            const [modelsRes, brandsRes, groupsRes, groupItemsRes] = results;

            if (modelsRes.error) throw modelsRes.error;
            if (brandsRes.error) throw brandsRes.error;
            if (groupsRes.error) throw groupsRes.error;
            if (groupItemsRes.error) throw groupItemsRes.error;

            const models = modelsRes.data || [];
            const brands = brandsRes.data || [];
            const groups = groupsRes.data || [];
            const groupItems = groupItemsRes.data || [];

            // Save to localStorage
            const version = serverVersion || (initialCache?.version || '260529-0001');
            localStorage.setItem('device_models_cache_v2', JSON.stringify({
                version,
                models,
                brands,
                groups,
                groupItems
            }));

            set({ 
                models, 
                brands, 
                groups,
                groupItems,
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
            const updatedModels = [...get().models, created].sort((a, b) => a.name.localeCompare(b.name));
            
            // Also write updated models to localStorage to keep cache and state consistent
            const currentCache = getCachedData();
            const currentVersion = currentCache?.version || '260529-0001';
            localStorage.setItem('device_models_cache_v2', JSON.stringify({
                version: currentVersion,
                models: updatedModels,
                brands: get().brands,
                groups: get().groups,
                groupItems: get().groupItems
            }));

            set({
                models: updatedModels,
                isAdding: false
            });
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
