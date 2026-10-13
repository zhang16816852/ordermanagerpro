import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getErrorDetails, getErrorMessage } from "@/lib/errorMessages";

export function useSalesNotesMutations() {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("delete_sales_note", {
        p_sales_note_id: id,
      });
      if (error) throw error;
      const res = (data ?? null) as unknown as { ok?: boolean; reason?: string; adopted_by?: Array<{ label?: string }> } | null;
      if (res && res.ok !== false) return;
      const reason = res?.reason || "刪除失敗";
      const err = new Error(reason) as Error & { hint?: string };
      const labels = (res?.adopted_by || []).map((b: any) => b?.label).filter(Boolean).join("、");
      err.hint = labels ? `被引用：${labels}（請先處理後再刪除）` : "請先處理會計/佣金/寄賣紀錄後再刪除";
      throw err;
    },
    onSuccess: () => {
      toast.success("銷貨單已刪除並回滾至出貨池");
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
    },
    onError: (error: unknown) => {
      const details = getErrorDetails(error);
      console.error("[delete_sales_note]", details, error);
      const msg = getErrorMessage(error);
      const suffix = details.code ? `（${details.code}）` : "";
      const description = [details.details, details.hint].filter(Boolean).join(" | ") || undefined;
      toast.error(`刪除失敗：${msg}${suffix}`, {
        description,
        duration: 6000,
      });
    },
  });

  return { deleteMutation };
}
