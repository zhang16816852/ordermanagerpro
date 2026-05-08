import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { CategorySpec } from '@/hooks/useCategorySpecs';

interface SpecTrigger {
    id: string;
    source_spec_id: string;
    target_spec_id: string;
    condition_dsl: any;
    priority: number;
}

interface SpecStore {
    specDefinitions: CategorySpec[];
    specMap: Map<string, CategorySpec>;
    specTriggers: SpecTrigger[];
    isLoading: boolean;
    fetchSpecs: (force?: boolean) => Promise<void>;
}

export const useSpecStore = create<SpecStore>((set, get) => ({
    specDefinitions: [],
    specMap: new Map(),
    specTriggers: [],
    isLoading: false,
    fetchSpecs: async (force = false) => {
        if (!force && get().specDefinitions.length > 0) return;

        set({ isLoading: true });
        try {
            // 1. 抓取規格定義
            const { data: defData, error: defError } = await supabase
                .from('specification_definitions')
                .select('*')
                .order('name');

            if (defError) throw defError;

            // 2. 抓取連動規則 (DSL)
            const { data: triggerData, error: triggerError } = await supabase
                .from('specification_triggers')
                .select('*')
                .order('priority', { ascending: false });

            if (triggerError) throw triggerError;

            const specs = (defData || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                key: s.id,
                type: s.type,
                expectedType: s.expected_type,
                options: s.options || [],
                defaultValue: s.default_value || '',
                logicConfig: s.logic_config as any,
                configuration: s.configuration,
                sort_order: s.sort_order || 0
            }));

            const map = new Map();
            specs.forEach(s => map.set(s.id, s));

            set({ 
                specDefinitions: specs, 
                specMap: map, 
                specTriggers: triggerData || [],
                isLoading: false 
            });
        } catch (err) {
            console.error('[SpecStore] Fetch failed:', err);
            set({ isLoading: false });
        }
    }
}));
