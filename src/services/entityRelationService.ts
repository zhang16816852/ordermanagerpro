import { supabase } from '@/integrations/supabase/client';

export type EntityType = 'product' | 'variant';

export interface EntityRelationData {
    modelIds?: string[];
    groupIds?: string[];
    exclusions?: { model_id: string; reason?: string }[];
    ordered?: { id: string; type: 'model' | 'group' | 'exclude' }[];
}

export const entityRelationService = {
    async updateRelations(entityType: EntityType, entityId: string, data: EntityRelationData) {
        const entityField = entityType === 'product' ? 'product_id' : 'variant_id';

        await (supabase.from('entity_model_relations') as any)
            .delete()
            .eq(entityField, entityId);

        const inserts: any[] = [];

        let sortOrder = 0;

        const seen = new Set<string>();
        if (Array.isArray(data.ordered) && data.ordered.length > 0) {
            data.ordered.forEach(entry => {
                if (entry.type === 'model') {
                    if (!data.modelIds?.includes(entry.id)) return;
                    seen.add(entry.id);
                    inserts.push({
                        [entityField]: entityId,
                        model_id: entry.id,
                        relation_type: 'include',
                        sort_order: sortOrder++
                    });
                } else if (entry.type === 'group') {
                    if (!data.groupIds?.includes(entry.id)) return;
                    seen.add(entry.id);
                    inserts.push({
                        [entityField]: entityId,
                        group_id: entry.id,
                        relation_type: 'include',
                        sort_order: sortOrder++
                    });
                } else {
                    const ex = data.exclusions?.find(e => e.model_id === entry.id);
                    if (!ex) return;
                    seen.add(entry.id);
                    inserts.push({
                        [entityField]: entityId,
                        model_id: ex.model_id,
                        relation_type: 'exclude',
                        reason: ex.reason,
                        sort_order: sortOrder++
                    });
                }
            });
        }

        (data.modelIds || []).forEach(model_id => {
            if (seen.has(model_id)) return;
            inserts.push({
                [entityField]: entityId,
                model_id,
                relation_type: 'include',
                sort_order: sortOrder++
            });
        });

        (data.groupIds || []).forEach(group_id => {
            if (seen.has(group_id)) return;
            inserts.push({
                [entityField]: entityId,
                group_id,
                relation_type: 'include',
                sort_order: sortOrder++
            });
        });

        (data.exclusions || []).forEach(ex => {
            if (seen.has(ex.model_id)) return;
            inserts.push({
                [entityField]: entityId,
                model_id: ex.model_id,
                relation_type: 'exclude',
                reason: ex.reason,
                sort_order: sortOrder++
            });
        });

        if (inserts.length > 0) {
            const { error } = await (supabase.from('entity_model_relations') as any).insert(inserts);
            if (error) throw error;
        }
    },

    async fetchAllRelations() {
        const { data } = await (supabase.from('entity_model_relations') as any).select('*');
        return {
            links: (data || []).filter(r => r.relation_type === 'include' && r.model_id),
            groups: (data || []).filter(r => r.relation_type === 'include' && r.group_id),
            exclusions: (data || []).filter(r => r.relation_type === 'exclude')
        };
    }
};
