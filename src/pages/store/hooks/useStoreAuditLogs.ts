import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useStoreAuditLogs(storeId: string | undefined, isFounder: boolean, entityFilter: string) {
  return useQuery({
    queryKey: ["store-audit-logs", storeId, entityFilter],
    queryFn: async () => {
      if (!storeId) return [];

      let query = supabase
        .from("audit_logs")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!storeId && isFounder,
  });
}
