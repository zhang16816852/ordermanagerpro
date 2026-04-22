import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CategorySpec {
    id: string;
    name: string;
    key: string;
    type: 'text' | 'select' | 'boolean' | 'multiselect' | 'number_with_unit';
    options: string[];
    defaultValue: string;
    logicConfig?: {
        triggers?: {
            on_value: string;
            operator?: 'eq' | 'ne';
            targets: { id: string; is_quantity_detail?: boolean }[];
        }[];
    };
}

export function useCategorySpecs(categoryIds: string[]) {
    return useQuery({
        queryKey: ['category_specs', categoryIds],
        enabled: categoryIds.length > 0,
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('category_spec_links' as any) as any)
                .select(`
                    category_id,
                    spec_id,
                    sort_order,
                    specification_definitions (
                        id,
                        name,
                        type,
                        options,
                        default_value,
                        logic_config
                    )
                `)
                .in('category_id', categoryIds)
                .order('sort_order', { ascending: true });

            if (error) {
                console.error('[useCategorySpecs] Fetch error:', error);
                return [];
            }

            const seenSpecs = new Set<string>();
            const result: CategorySpec[] = [];

            data.forEach((d: any) => {
                const spec = d.specification_definitions;
                if (!spec || seenSpecs.has(spec.id)) return;
                seenSpecs.add(spec.id);
                result.push({
                    id: spec.id,
                    name: spec.name,
                    key: spec.id,
                    type: spec.type,
                    options: spec.options || [],
                    defaultValue: spec.default_value || '',
                    logicConfig: spec.logic_config as any
                });
            });

            return result;
        },
    });
}
