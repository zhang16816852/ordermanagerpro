// src/components/order/CheckoutForm.tsx
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Send } from "lucide-react";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import CartPanel from "./CartPanel";

interface CheckoutFormProps {
  storeId: string;
  userId: string;
  sourceType: "frontend" | "admin_proxy";
  /** 成功後導向路徑 */
  successRedirect: string;
  /** 要失效的 query key */
  queryKeyToInvalidate: string;
  /** 返回購物頁路徑 */
  catalogPath?: string;
  /** 標題 */
  title?: string;
  /** 描述 */
  description?: string;
}

export default function CheckoutForm({
  storeId,
  userId,
  sourceType,
  successRedirect,
  queryKeyToInvalidate,
  catalogPath = "/catalog",
  title = "確認訂單",
  description = "請再次確認品項與數量，並填寫備註（如有需要）",
}: CheckoutFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { items, notes, totalAmount, updateNotes, clearDraft } = useStoreDraft(storeId);

  const createOrderMutation = useMutation({
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

      const orderItems = items.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        store_id: storeId,
        quantity: item.quantity,
        unit_price: item.price,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) throw itemsError;

      return order;
    },
    onSuccess: () => {
      toast.success("訂單已成功建立！");
      clearDraft();
      queryClient.invalidateQueries({ queryKey: [queryKeyToInvalidate] });
      navigate(successRedirect);
    },
    onError: (error: any) => {
      toast.error(error.message || "建立訂單失敗，請再試一次");
    },
  });

  // 若購物車為空
  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">購物車是空的</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-muted-foreground">
              您尚未選擇任何商品，請先前往商品目錄選購。
            </p>
            <Button onClick={() => navigate(catalogPath)} size="lg">
              <ArrowLeft className="h-4 w-4 mr-2" />
              回商品目錄選購
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 py-6">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-2">{description}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 購物車內容 */}
        <div className="lg:col-span-2">
          <CartPanel storeId={storeId} showCheckoutButton={false} />
        </div>

        {/* 訂單備註與提交 */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>訂單備註（選填）</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="例如：急件、指定送貨時間、特殊包裝需求..."
                value={notes}
                onChange={(e) => updateNotes(e.target.value)}
                rows={5}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>訂單總金額</span>
                <span className="text-2xl font-bold text-primary">
                  ${totalAmount.toLocaleString()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                size="lg"
                className="w-full"
                onClick={() => createOrderMutation.mutate()}
                disabled={createOrderMutation.isPending}
              >
                <Send className="h-5 w-5 mr-2" />
                {createOrderMutation.isPending ? "提交中..." : "確認送出訂單"}
              </Button>

              <Button
                variant="outline"
                className="w-full mt-3"
                onClick={() => navigate(catalogPath)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                繼續購物
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
