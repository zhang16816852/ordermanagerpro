// src/components/order/CheckoutForm.tsx
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Send } from "lucide-react";
import { useCreateOrder } from "@/hooks/useCreateOrder";
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

  const { createOrder, isPending, items, totalAmount, notes, updateNotes } = useCreateOrder({
    storeId,
    userId,
    sourceType,
    queryKeyToInvalidate: [queryKeyToInvalidate],
    onSuccess: () => {
      navigate(successRedirect);
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
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* 左側：備註卡 */}
      <Card className="space-y-4 lg:col-span-3">
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

      {/* 右側：送出卡 */}
      <Card className="space-y-4 lg:col-span-2">
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
            onClick={() => createOrder()}
            disabled={isPending}
          >
            <Send className="h-5 w-5 mr-2" />
            {isPending ? "提交中..." : "確認送出訂單"}
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

      {/* 下方購物車，跨兩欄 */}
      <div className="lg:col-span-5">
        <CartPanel storeId={storeId} showCheckoutButton={false} />
      </div>
    </div>
  );
}
