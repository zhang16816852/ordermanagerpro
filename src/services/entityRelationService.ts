import { supabase } from '@/integrations/supabase/client';

export type EntityType = 'product' | 'variant';

export interface EntityRelationData {
    modelIds?: string[];
    groupIds?: string[];
    exclusions?: { model_id: string; reason?: string }[];
}

export const entityRelationService = {
    /**
     * 更新實體的關聯資料
     */
    async updateRelations(entityType: EntityType, entityId: string, data: EntityRelationData) {
        // 1. 更新型號連結
        if (data.modelIds !== undefined) {
            await supabase.from('device_model_links')
                .delete()
                .eq('entity_type', entityType)
                .eq('entity_id', entityId);
            
            if (data.modelIds.length > 0) {
                const links = data.modelIds.map(model_id => ({
                    entity_type: entityType,
                    entity_id: entityId,
                    model_id
                }));
                const { error } = await supabase.from('device_model_links').insert(links);
                if (error) throw error;
            }
        }

        // 2. 更新群組連結
        if (data.groupIds !== undefined) {
            await supabase.from('device_model_group_links')
                .delete()
                .eq('entity_type', entityType)
                .eq('entity_id', entityId);
            
            if (data.groupIds.length > 0) {
                const links = data.groupIds.map(group_id => ({
                    entity_type: entityType,
                    entity_id: entityId,
                    group_id
                }));
                const { error } = await supabase.from('device_model_group_links').insert(links);
                if (error) throw error;
            }
        }

        // 3. 更新排除型號
        if (data.exclusions !== undefined) {
            await supabase.from('device_model_exclusions')
                .delete()
                .eq('entity_type', entityType)
                .eq('entity_id', entityId);
            
            if (data.exclusions.length > 0) {
                const links = data.exclusions.map(ex => ({
                    entity_type: entityType,
                    entity_id: entityId,
                    model_id: ex.model_id,
                    reason: ex.reason
                }));
                const { error } = await supabase.from('device_model_exclusions').insert(links);
                if (error) throw error;
            }
        }
    },

    /**
     * 批次獲取多個實體的關聯資料 (用於優化全量同步)
     */
    async fetchAllRelations() {
        const [links, groups, exclusions] = await Promise.all([
            supabase.from('device_model_links').select('*'),
            supabase.from('device_model_group_links').select('*, device_model_groups(name)'),
            supabase.from('device_model_exclusions').select('*')
        ]);

        return {
            links: links.data || [],
            groups: groups.data || [],
            exclusions: exclusions.data || []
        };
    }
};
