import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditLogItem {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    performed_by: string;
    created_at: string;
    old_value: any;
    new_value: any;
    store_id: string | null;
    profiles?: {
        full_name: string | null;
        email: string;
    };
}

export function useAuditLogs(filters: {
    entityType?: string;
    action?: string;
    storeId?: string;
    page: number;
    pageSize: number;
}) {
    return useQuery({
        queryKey: ['admin-audit-logs', filters],
        queryFn: async () => {
            const from = (filters.page - 1) * filters.pageSize;
            const to = from + filters.pageSize - 1;

            let query = (supabase as any)
                .from('audit_logs')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(from, to);

            if (filters.entityType && filters.entityType !== 'all') {
                query = query.eq('entity_type', filters.entityType);
            }
            if (filters.action && filters.action !== 'all') {
                query = query.eq('action', filters.action);
            }
            if (filters.storeId && filters.storeId !== 'all') {
                query = query.eq('store_id', filters.storeId);
            }

            const { data, error, count } = await query;

            if (error) throw error;

            let logsWithProfiles = (data || []) as AuditLogItem[];

            if (logsWithProfiles.length > 0) {
                // 收集所有唯一的 performed_by (這是一個 string 陣列)
                const userIds = [...new Set(logsWithProfiles.map(log => log.performed_by).filter(Boolean))];
                
                if (userIds.length > 0) {
                    const { data: profilesData } = await supabase
                        .from('profiles')
                        .select('id, full_name, email')
                        .in('id', userIds);
                        
                    if (profilesData) {
                        const profilesMap = new Map();
                        profilesData.forEach(p => profilesMap.set(p.id, p));
                        
                        logsWithProfiles = logsWithProfiles.map(log => ({
                            ...log,
                            profiles: profilesMap.get(log.performed_by)
                        }));
                    }
                }
            }

            return {
                logs: logsWithProfiles,
                total: count || 0
            };
        }
    });
}
