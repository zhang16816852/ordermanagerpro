import { useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import type { StoreOption, RepOption, SalesNoteRow } from "./salesNotesTypes";

interface UseSalesNotesQueriesParams {
  storeFilter: string[];
  statusFilter: string;
  repFilter: string;
  dateRange: DateRange | undefined;
}

export function useSalesNotesQueries({
  storeFilter,
  statusFilter,
  repFilter,
  dateRange,
}: UseSalesNotesQueriesParams) {
  const { data: stores } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("stores") as any).select("id, name, code");
      if (error) throw error;
      return data as StoreOption[];
    },
  });

  const { data: repsData = [] } = useQuery({
    queryKey: ["admin-reps-for-sales-filter"],
    queryFn: async () => {
      const { data: roles } = await (supabase
        .from('user_roles') as any)
        .select('user_id')
        .eq('role', 'rep');
      if (!roles || roles.length === 0) return [] as RepOption[];
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await (supabase
        .from('profiles') as any)
        .select('id, full_name, email')
        .in('id', userIds);
      return (profiles || []).map((p: any) => ({
        user_id: p.id,
        full_name: p.full_name,
        email: p.email,
      })) as RepOption[];
    },
  });

  const { data: repAssignedStoreIds = [] } = useQuery({
    queryKey: ['admin-rep-stores-for-sales-filter', repFilter],
    queryFn: async () => {
      if (repFilter === 'all') return [] as string[];
      const { data } = await (supabase
        .from('rep_store_assignments') as any)
        .select('store_id')
        .eq('rep_id', repFilter);
      return (data || []).map((a: any) => a.store_id as string);
    },
    enabled: repFilter !== 'all',
  });

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ["admin-sales-notes", storeFilter.join(','), statusFilter, repFilter, repAssignedStoreIds.join(','), dateRange?.from, dateRange?.to],
    queryFn: async () => {
      let query = (supabase
        .from("sales_notes") as any)
        .select(`
          *,
          store:stores(name, code),
          sales_note_items(
            id,
            quantity,
            returned_quantity,
            sort_order,
            order_item:order_items(
              id,
              order_id,
              quantity,
              unit_price,
              unit_cost,
              sort_order,
              product_id,
              variant_id,
              line_type,
              line_note,
              order:orders(code),
              product:products(name, code),
              product_variant:product_variants(name, sku)
            )
          )
        `)
        .order("created_at", { ascending: false })
        .order("sort_order", { foreignTable: "sales_note_items", ascending: true });

      if (repAssignedStoreIds.length > 0) {
        query = query.in("store_id", repAssignedStoreIds);
      } else if (storeFilter.length > 0) {
        query = query.in("store_id", storeFilter);
      }
      if (statusFilter !== "all") {
        if (statusFilter === "unreceived") {
          query = query.eq("payment_status", "unpaid");
        } else if (statusFilter === "received") {
          query = query.eq("payment_status", "paid");
        }
      }
      if (dateRange?.from) {
        const fromStr = format(dateRange.from, "yyyy-MM-dd");
        const toStr = dateRange.to
          ? format(addDays(dateRange.to, 1), "yyyy-MM-dd")
          : format(addDays(dateRange.from, 1), "yyyy-MM-dd");
        query = query
          .not("shipped_at", "is", null)
          .gte("shipped_at", fromStr)
          .lt("shipped_at", toStr);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as SalesNoteRow[];
    },
  });

  return { stores, repsData, isLoading, salesNotes };
}
