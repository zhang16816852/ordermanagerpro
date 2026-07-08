import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { useStoreDraft } from "@/store/useOrderDraftStore";
import type { OrderDraftItem } from "@/store/useOrderDraftStore";

interface UseCreateOrderParams {
  storeId: string;
  userId: string;
  sourceType: "frontend" | "admin_proxy";
  queryKeyToInvalidate?: string[];
  customItems?: OrderDraftItem[];
  customNotes?: string;
  onSuccess?: (order: { id: string; code?: string | null; access_token: string }) => void;
  onSettled?: () => void;
}

export function useCreateOrder({
  storeId,
  userId,
  sourceType,
  queryKeyToInvalidate,
  customItems,
  customNotes,
  onSuccess,
  onSettled,
}: UseCreateOrderParams) {
  const queryClient = useQueryClient();
  const { items: draftItems, notes: draftNotes, totalAmount, updateNotes, clearDraft } = useStoreDraft(storeId);
  const items = customItems ?? draftItems;
  const notes = customNotes ?? draftNotes;

  const mutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("購物車是空的");
      if (!storeId || !userId) throw new Error("無法取得店鋪或使用者資訊");

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          store_id: storeId,
          created_by: userId,
          notes: notes.trim() || null,
          source_type: sourceType,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = items.map((item: OrderDraftItem) => ({
        order_id: order.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        store_id: storeId,
        quantity: item.quantity,
        unit_price: item.price,
        selected_model_name: item.selectedModelName || null,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) throw itemsError;

      return order;
    },
    onSuccess: (data) => {
      toast.success("訂單已成功建立！");
      clearDraft();
      if (queryKeyToInvalidate) {
        queryKeyToInvalidate.forEach(key =>
          queryClient.invalidateQueries({ queryKey: [key] })
        );
      }
      if (onSuccess) {
        onSuccess(data);
      }
    },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error, "建立訂單失敗"));
    },
    onSettled,
  });

  return {
    createOrder: mutation.mutate,
    isPending: mutation.isPending,
    totalAmount,
    items,
    notes,
    updateNotes,
  };
}
