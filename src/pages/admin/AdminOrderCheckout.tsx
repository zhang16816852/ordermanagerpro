import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { useStoreDraft } from "@/store/useOrderDraftStore";
import OrderReviewPanel from "@/components/order/OrderReviewPanel";
import { toast } from "sonner";
import type { OrderDraftItem } from "@/store/useOrderDraftStore";

export default function AdminOrderCheckout() {
  const [searchParams] = useSearchParams();
  const storeId = searchParams.get("storeId") || "";
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: store } = useQuery({
    queryKey: ["store", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id, name, code, brand")
        .eq("id", storeId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!storeId,
  });

  const {
    items: draftItems,
    notes: draftNotes,
    priceSyncMap: draftPriceSyncMap,
    clearDraft,
    updateItemPrice,
    updateQuantity,
    reorderItems,
    setPriceSyncMap,
  } = useStoreDraft(storeId);

  const [items, setItems] = useState<OrderDraftItem[]>(draftItems);
  const [notes, setNotes] = useState(draftNotes);
  const [priceSyncMap, setLocalPriceSyncMap] = useState<Record<string, boolean>>(draftPriceSyncMap);

  const syncItems = useCallback(
    (newItems: OrderDraftItem[]) => {
      setItems(newItems);
      reorderItems(newItems);
    },
    [reorderItems]
  );

  const syncNotes = useCallback(
    (newNotes: string) => {
      setNotes(newNotes);
    },
    []
  );

  const syncPriceSyncMap = useCallback(
    (newMap: Record<string, boolean>) => {
      setLocalPriceSyncMap(newMap);
      setPriceSyncMap(newMap);
    },
    [setPriceSyncMap]
  );

  const handleItemsChange = useCallback(
    (newItems: OrderDraftItem[]) => {
      setItems(newItems);
      reorderItems(newItems);
    },
    [reorderItems]
  );

  const { createOrder: createPendingOrder, isPending: isPendingMode1 } = useCreateOrder({
    storeId,
    userId: user?.id ?? "",
    sourceType: "admin_proxy",
    customItems: items,
    customNotes: notes,
    queryKeyToInvalidate: ["admin-orders"],
    onSuccess: () => {
      clearDraft();
      navigate("/admin/orders");
    },
  });

  const [isPendingMode2, setIsPendingMode2] = useState(false);

  const isSubmitting = isPendingMode1 || isPendingMode2;

  const syncPrices = useCallback(async () => {
    if (!store?.brand) return;

    const itemsToSync = items
      .filter((i) => priceSyncMap[i.id])
      .map((i) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        wholesale_price: i.price,
      }));

    if (itemsToSync.length === 0) return;

    const { error } = await supabase.rpc("upsert_brand_product_prices", {
      p_brand: store.brand,
      p_products: itemsToSync,
    });

    if (error) {
      console.error("同步價格失敗:", error);
      toast.error("部分價格同步失敗，請至品牌價格管理頁面檢查");
    }
  }, [store, items, priceSyncMap]);

  const handleSubmit = useCallback(
    async (mode: "pending" | "shipped_with_sales_note") => {
      if (mode === "pending") {
        await syncPrices();
        createPendingOrder();
        return;
      }

      setIsPendingMode2(true);
      try {
        const payload = items.map((i) => ({
          product_id: i.productId,
          variant_id: i.variantId || null,
          quantity: i.quantity,
          unit_price: i.price,
          selected_model_name: i.selectedModelName || null,
        }));

        const { data, error } = await supabase.rpc("create_order_with_sales_note", {
          p_store_id: storeId,
          p_created_by: user?.id,
          p_notes: notes.trim() || null,
          p_items: payload,
        });

        if (error) throw error;

        await syncPrices();

        const link = `${window.location.origin}/share/sales-note/${data.sales_note_code || data.sales_note_id}?token=${data.access_token}`;

        toast.success("訂單已建立並開立銷貨單！", {
          duration: 10000,
          action: {
            label: "複製連結",
            onClick: () => {
              navigator.clipboard.writeText(link);
              toast.success("連結已複製");
            },
          },
        });

        clearDraft();
        navigate("/admin/orders");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "建立訂單失敗");
      } finally {
        setIsPendingMode2(false);
      }
    },
    [items, notes, storeId, user, navigate, clearDraft, createPendingOrder, syncPrices]
  );

  if (!storeId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        請先選擇店鋪再進行結帳
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <OrderReviewPanel
        storeId={storeId}
        storeName={store?.name || ""}
        storeCode={store?.code || ""}
        items={items}
        notes={notes}
        priceSyncMap={priceSyncMap}
        onItemsChange={handleItemsChange}
        onNotesChange={syncNotes}
        onPriceSyncMapChange={syncPriceSyncMap}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
