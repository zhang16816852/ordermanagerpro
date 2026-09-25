import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CustomerStatement {
  id: string;
  title: string;
  store_id: string;
  date_from: string;
  date_to: string;
  access_token: string;
  created_by: string;
  created_at: string;
  store?: {
    id: string;
    name: string;
    code?: string | null;
  } | null;
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
          store:stores(name, code)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CustomerStatement[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["customer-statement-shares"] });

  const createStatementMutation = useMutation({
    mutationFn: async (input: {
      title: string;
      storeId: string;
      dateFrom: string;
      dateTo: string;
      createdBy: string;
    }) => {
      const { data, error } = await (supabase as any)
        .from("customer_statement_shares")
        .insert({
          title: input.title,
          store_id: input.storeId,
          date_from: input.dateFrom,
          date_to: input.dateTo,
          created_by: input.createdBy,
        })
        .select(`*, store:stores(name, code)`)
        .single();
      if (error) throw error;
      return data as CustomerStatement;
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