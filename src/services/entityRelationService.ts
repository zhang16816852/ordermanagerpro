import { supabase } from '@/integrations/supabase/client';

export type EntityType = 'product' | 'variant';

export interface EntityRelationData {
    modelIds?: string[];
    groupIds?: string[];
    exclusions?: { model_id: string; reason?: string }[];
}

export const entityRelationService = {
    async updateRelations(entityType: EntityType, entityId: string, data: EntityRelationData) {
        const entityField = entityType === 'product' ? 'product_id' : 'variant_id';

        await supabase.from('entity_model_relations')
            .delete()
            .eq(entityField, entityId);

        const inserts: any[] = [];

        if (data.modelIds?.length) {
            inserts.push(...data.modelIds.map(model_id => ({
                [entityField]: entityId,
                model_id,
                relation_type: 'include'
            })));
        }

        if (data.groupIds?.length) {
            inserts.push(...data.groupIds.map(group_id => ({
                [entityField]: entityId,
                group_id,
                relation_type: 'include'
            })));
        }

        if (data.exclusions?.length) {
            inserts.push(...data.exclusions.map(ex => ({
                [entityField]: entityId,
                model_id: ex.model_id,
                relation_type: 'exclude',
                reason: ex.reason
            })));
        }

        if (inserts.length > 0) {
            const { error } = await supabase.from('entity_model_relations').insert(inserts);
            if (error) throw error;
        }
    },

    async fetchAllRelations() {
        const { data } = await supabase.from('entity_model_relations').select('*');
        return {
            links: (data || []).filter(r => r.relation_type === 'include' && r.model_id),
            groups: (data || []).filter(r => r.relation_type === 'include' && r.group_id),
            exclusions: (data || []).filter(r => r.relation_type === 'exclude')
        };
    }
};
