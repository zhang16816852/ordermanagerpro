import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { CacheService, CACHE } from '@/services/cacheService';
import { fetchAllRows } from '@/lib/utils';

export type DeviceModel = Database['public']['Tables']['device_models']['Row'];
export type DeviceBrand = Database['public']['Tables']['device_brands']['Row'];
export type DeviceModelGroup = Database['public']['Tables']['device_model_groups']['Row'];

const CACHE_CFG = CACHE.deviceModels;

interface DeviceModelCache {
  models: DeviceModel[];
  brands: DeviceBrand[];
  groups: DeviceModelGroup[];
  groupItems: { group_id: string; model_id: string }[];
}

interface DeviceModelStore {
  models: DeviceModel[];
  brands: DeviceBrand[];
  groups: DeviceModelGroup[];
  groupItems: { group_id: string; model_id: string }[];
  isLoading: boolean;
  isAdding: boolean;
  isInitialized: boolean;
  dataVersion: string;
  fetchData: (force?: boolean, serverVersion?: string) => Promise<void>;
  addModel: (newModel: Partial<DeviceModel>) => Promise<DeviceModel | null>;
  getModelsByNames: (names: string[]) => DeviceModel[];
}

function readCache(): DeviceModelCache | null {
  const result = CacheService.get<DeviceModelCache>(CACHE_CFG.key, CACHE_CFG.schema);
  if (result.exists && result.data) return result.data;

  // Try to migrate from old cache
  try {
    const old = localStorage.getItem('device_models_cache_v2');
    if (old) {
      const parsed = JSON.parse(old);
      if (parsed && parsed.version && Array.isArray(parsed.models)) {
        CacheService.set(CACHE_CFG.key, {
          models: parsed.models || [],
          brands: parsed.brands || [],
          groups: parsed.groups || [],
          groupItems: parsed.groupItems || [],
        }, parsed.version, CACHE_CFG.schema);
        localStorage.removeItem('device_models_cache_v2');
        return {
          models: parsed.models || [],
          brands: parsed.brands || [],
          groups: parsed.groups || [],
          groupItems: parsed.groupItems || [],
        };
      }
    }
  } catch { /* ignore */ }
  return null;
}

function writeCache(data: DeviceModelCache, version: string) {
  CacheService.set(CACHE_CFG.key, data, version, CACHE_CFG.schema);
}

const initialCache = readCache();
const initialVersion = (() => {
  const cached = localStorage.getItem('device_models_cache_v2');
  if (cached) {
    try { return JSON.parse(cached).version || '0'; } catch { /* */ }
  }
  return '0';
})();

export const useDeviceModelStore = create<DeviceModelStore>((set, get) => ({
  models: initialCache?.models || [],
  brands: initialCache?.brands || [],
  groups: initialCache?.groups || [],
  groupItems: initialCache?.groupItems || [],
  isLoading: false,
  isAdding: false,
  isInitialized: !!initialCache,
  dataVersion: initialVersion,

  fetchData: async (force = false, serverVersion?: string) => {
    if (!force && get().isInitialized) return;

    set({ isLoading: true });
    try {
      const results = await Promise.all([
        fetchAllRows<any>('device_models', '*', { order: [{ column: 'name' }] }),
        supabase.from('device_brands').select('*').order('name'),
        supabase.from('device_model_groups').select('*').is('deleted_at', null).order('name'),
        supabase.from('device_model_group_items').select('group_id, model_id').order('position')
      ]);

      const [models, brandsRes, groupsRes, groupItemsRes] = results;

      if (brandsRes.error) throw brandsRes.error;
      if (groupsRes.error) throw groupsRes.error;
      if (groupItemsRes.error) throw groupItemsRes.error;

      const brands = brandsRes.data || [];
      const groups = groupsRes.data || [];
      const groupItems = groupItemsRes.data || [];

      const version = serverVersion || initialVersion || '260529-0001';
      writeCache({ models, brands, groups, groupItems }, version);

      set({
        models,
        brands,
        groups,
        groupItems,
        isLoading: false,
        isInitialized: true,
        dataVersion: version,
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
      const currentVersion = get().dataVersion;

      writeCache({
        models: updatedModels,
        brands: get().brands,
        groups: get().groups,
        groupItems: get().groupItems,
      }, currentVersion);

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
