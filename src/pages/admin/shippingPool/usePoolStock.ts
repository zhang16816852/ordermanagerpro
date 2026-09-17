import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ShippingPoolItem } from "./shippingPoolTypes";

// 批次取得出貨池品項在各倉庫的庫存（product_id + variant_id → warehouse_id → qty）
export function usePoolStock(items: ShippingPoolItem[]) {
  const productIds = [...new Set(items.map(i => i.order_item?.product_id).filter(Boolean))];
  return useQuery({
    queryKey: ["shipping-pool-stock", productIds.join(",")],
    queryFn: async () => {
      if (productIds.length === 0) return {};
      const { data, error } = await (supabase
        .from("product_inventory") as any)
        .select("product_id, variant_id, warehouse_id, quantity")
        .in("product_id", productIds);
      if (error) throw error;
      const map: Record<string, Record<string, number>> = {};
      for (const row of (data || []) as Array<{ product_id: string; variant_id: string | null; warehouse_id: string; quantity: number }>) {
        const key = `${row.product_id}:${row.variant_id || ""}`;
        if (!map[key]) map[key] = {};
        map[key][row.warehouse_id] = row.quantity;
      }
      return map;
    },
    staleTime: 30_000,
  });
}