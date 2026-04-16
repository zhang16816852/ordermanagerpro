import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { CategorySpec } from '@/hooks/useCategorySpecs';

interface SpecStore {
    specDefinitions: CategorySpec[];
    specMap: Map<string, CategorySpec>;
    isLoading: boolean;
    fetchSpecs: () => Promise<void>;
}

export const useSpecStore = create<SpecStore>((set, get) => ({
    specDefinitions: [],
    specMap: new Map(),
    isLoading: false,
    fetchSpecs: async () => {
        // 如果已經有資料就不重抓，除非強制重抓
        if (get().specDefinitions.length > 0) return;

        set({ isLoading: true });
        try {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any)
                .select('*')
                .order('name');

            if (error) throw error;

            const specs = (data || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                key: s.id,
                type: s.type,
                options: s.options || [],
                defaultValue: s.default_value || '',
                logicConfig: s.logic_config as any
            }));

            const map = new Map();
            specs.forEach(s => map.set(s.id, s));

            set({ specDefinitions: specs, specMap: map, isLoading: false });
        } catch (err) {
            console.error('[SpecStore] Fetch failed:', err);
            set({ isLoading: false });
        }
    }
}));
