import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CustomerStatementStore {
  id: string;
  name: string;
  code?: string | null;
  brand?: string | null;
}

export interface CustomerStatement {
  id: string;
  title: string;
  brand?: string | null;
  store_id?: string | null;
  date_from: string;
  date_to: string;
  access_token: string;
  created_by: string;
  created_at: string;
  store?: CustomerStatementStore | null;
  stores?: CustomerStatementStore[] | null;
}

export function statementShareLink(stmt: { id: string; access_token: string }): string {
  return `${window.location.origin}/share/statement/${stmt.id}?token=${stmt.access_token}`;
}

export function useCustomerStatements() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["customer-statement-shares"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customer_statement_shares")
        .select(`
          *,
          stores:customer_statement_share_stores(store:stores(id, name, code, brand))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((row: any) => {
        const flatStores = (row.stores || [])
          .map((s: any) => s?.store)
          .filter(Boolean);
        return {
          ...row,
          stores: flatStores.length ? flatStores : row.store ? [row.store] : null,
          store: flatStores[0] || row.store || null,
        } as CustomerStatement;
      });
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["customer-statement-shares"] });

  const createStatementMutation = useMutation({
    mutationFn: async (input: {
      title: string;
      storeIds: string[];
      dateFrom: string;
      dateTo: string;
      createdBy: string;
    }) => {
      const { data, error } = await (supabase as any).rpc(
        "create_customer_statement_share",
        {
          p_title: input.title,
          p_store_ids: input.storeIds,
          p_date_from: input.dateFrom,
          p_date_to: input.dateTo,
          p_created_by: input.createdBy,
        }
      );
      if (error) throw error;
      if (!data || data.ok === false) {
        throw new Error(data?.reason || "建立對帳單失敗");
      }
      const stmt = data.statement;
      return {
        id: stmt.id,
        title: stmt.title,
        brand: stmt.brand,
        date_from: stmt.date_from,
        date_to: stmt.date_to,
        access_token: stmt.access_token,
        created_by: stmt.created_by,
        created_at: stmt.created_at,
        stores: (stmt.stores || []) as CustomerStatementStore[],
        store: (stmt.stores || [])[0] || null,
      } as CustomerStatement;
    },
    onSuccess: invalidate,
  });

  const updateStatementMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await (supabase as any)
        .from("customer_statement_shares")
        .update({ title })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteStatementMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("customer_statement_shares")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    statements: data,
    isLoading,
    createStatementMutation,
    updateStatementMutation,
    deleteStatementMutation,
  };
}