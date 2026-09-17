import { useMutation } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { GroupedByStore } from "./shippingPoolTypes";

interface UseShippingPoolMutationsParams {
  user: { id: string } | null;
  queryClient: QueryClient;
  selectedStores: Set<string>;
  sortedGroups: GroupedByStore[];
  notes: string;
  shippedAt: string;
  warehouseMap: Record<string, string>;
  sourceMap: Record<string, string>;
  consignmentOverrideMap: Record<string, boolean>;
  setSelectedPoolItemIds: (s: Set<string>) => void;
  setSelectedStores: (s: Set<string>) => void;
  setShowShipDialog: (v: boolean) => void;
  setNotes: (v: string) => void;
}

export function useShippingPoolMutations({
  user,
  queryClient,
  selectedStores,
  sortedGroups,
  notes,
  shippedAt,
  warehouseMap,
  sourceMap,
  consignmentOverrideMap,
  setSelectedPoolItemIds,
  setSelectedStores,
  setShowShipDialog,
  setNotes,
}: UseShippingPoolMutationsParams) {
  // 批次將選取出貨池品項移回訂單（移出出貨池），單一 RPC 一次寫入，避免逐筆刪除
  const batchRemoveMutation = useMutation({
    mutationFn: async (poolIds: string[]) => {
      if (!user) throw new Error("未登入");
      if (poolIds.length === 0) throw new Error("請至少選擇一個品項");

      const { data, error } = await supabase.rpc("remove_items_from_shipping_pool", {
        p_pool_ids: poolIds,
        p_created_by: user.id,
      });
      if (error) throw error;
      return data as { deleted_count: number; reverted_order_ids: string[] };
    },
    onSuccess: (data) => {
      const revertedCount = data?.reverted_order_ids?.length || 0;
      toast.success(
        `已將 ${data?.deleted_count ?? 0} 個品項移出出貨池${revertedCount > 0 ? `，${revertedCount} 個訂單回退為待確認` : ""}`
      );
      setSelectedPoolItemIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["shipping-pool"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const shipMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("未登入");
      if (selectedStores.size === 0) throw new Error("請選擇至少一個店家");

      // 出貨前先把「目前畫面順序」（表頭排序＋拖曳）回寫 DB，
      // 確保 ship_from_pool 依顯示順序建立銷貨單品項
      for (const group of sortedGroups) {
        if (!selectedStores.has(group.storeId)) continue;
        const payload = group.items.map((item, idx) => ({
          id: item.id,
          sort_order: idx + 1,
        }));
        if (payload.length === 0) continue;
        const { error: reorderError } = await supabase.rpc("reorder_shipping_pool_items", { p_items: payload });
        if (reorderError) throw reorderError;
      }

      const { data, error } = await supabase.rpc("ship_from_pool", {
        p_store_ids: Array.from(selectedStores),
        p_created_by: user.id,
        p_notes: notes || undefined,
        p_shipped_at: shippedAt ? new Date(shippedAt).toISOString() : undefined,
        p_warehouse_id: undefined,
        p_warehouse_map: warehouseMap,
        p_source_map: sourceMap,
        p_consignment_override_map: consignmentOverrideMap,
      });

      if (error) throw error;
      return data as Array<{ sales_note_id: string; sales_note_code: string; store_id: string; access_token: string }>;
    },
    onSuccess: (data) => {
      const notes = (data || []).filter(d => d.sales_note_id && d.access_token);
      const noteCount = notes.length;
      toast.success(
        noteCount > 0
          ? `已建立 ${noteCount} 個銷售單並出貨${data && data.length > noteCount ? `，${data.length - noteCount} 個店家以寄賣方式出貨` : ''}`
          : `已出貨（${data?.length ?? 0} 個店家皆為寄賣方式，確認售出後再開立銷貨單）`,
        {
          action: noteCount > 0 ? {
            label: "檢視銷貨單",
            onClick: () => {
              const note = notes[0];
              if (!note) return;
              const link = `${window.location.origin}/share/sale/${note.sales_note_code || note.sales_note_id}?token=${note.access_token}`;
              window.open(link, "_blank", "noopener,noreferrer");
            },
          } : undefined,
        }
      );
      setSelectedStores(new Set());
      setShowShipDialog(false);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["shipping-pool"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
    },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error));
    },
  });

  return { batchRemoveMutation, shipMutation };
}