// src/components/order/CheckoutForm.tsx
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Send } from "lucide-react";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { formatCurrency } from "@/lib/formatters";
import {
  DeliveryCard,
} from "@/components/shipping/DeliveryCard";
import {
  useDeliveryMethods,
} from "@/components/shipping/DeliveryMethodPicker";
import type {
  ShippingAddressValue,
} from "@/components/shipping/ShippingAddressFields";
import CartPanel from "./CartPanel";
import { MobileFooter } from "@/components/layout/MobileFooter";

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

interface StoreInfoWithAddress {
  id: string;
  name: string;
  phone: string | null;
  recipient: string | null;
  brand: string | null;
  postal_code: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  default_delivery_method_id: string | null;
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

  const { data: storeInfo } = useQuery<StoreInfoWithAddress | null>({
    queryKey: ["store-info", storeId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("stores") as any)
        .select(
          "id, name, phone, recipient, brand, postal_code, city, district, address, default_delivery_method_id"
        )
        .eq("id", storeId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!storeId,
  });

  const { data: deliveryMethods = [] } = useDeliveryMethods();
  const defaultMethodId = storeInfo?.default_delivery_method_id ?? null;

  const [deliveryMethodId, setDeliveryMethodId] = useState<string | null>(null);
  const [shippingAddress, setShippingAddress] = useState<ShippingAddressValue>({
    recipient: "",
    phone: "",
    postal_code: "",
    city: "",
    district: "",
    address: "",
  });

  const applyStoreAddress = () => {
    if (!storeInfo) return;
    setShippingAddress({
      recipient: storeInfo.recipient || storeInfo.name || "",
      phone: storeInfo.phone || "",
      postal_code: storeInfo.postal_code || "",
      city: storeInfo.city || "",
      district: storeInfo.district || "",
      address: storeInfo.address || "",
    });
  };

  // 首次載入套用店家預設配送方式
  useEffect(() => {
    if (!deliveryMethodId && defaultMethodId) {
      setDeliveryMethodId(defaultMethodId);
    }
  }, [defaultMethodId, deliveryMethodId]);

  const deliveryMethod = useMemo(
    () => (deliveryMethods || []).find((m) => m.id === deliveryMethodId) || null,
    [deliveryMethods, deliveryMethodId]
  );

  const { createOrder, isPending, items, totalAmount, grandTotal, notes, updateNotes } = useCreateOrder({
    storeId,
    userId,
    sourceType,
    queryKeyToInvalidate: [queryKeyToInvalidate],
    deliveryMethod,
    shippingAddress,
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
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 pb-24 md:pb-0">
      {/* 左側：備註 + 配送卡 */}
      <div className="space-y-6 lg:col-span-3">
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

        <DeliveryCard
          methods={deliveryMethods}
          value={deliveryMethodId}
          onValueChange={setDeliveryMethodId}
          address={shippingAddress}
          onAddressChange={setShippingAddress}
          onApplyStoreAddress={applyStoreAddress}
        />
      </div>

      {/* 右側：送出卡 */}
      <Card className="space-y-4 lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex justify-between">
            <span>訂單總金額</span>
            <span className="text-2xl font-bold text-primary">
              {formatCurrency(grandTotal)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>商品金額</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span>運費</span>
            <span>{formatCurrency(deliveryMethod?.price ?? 0)}</span>
          </div>
        </CardContent>
        <CardContent className="hidden md:block">
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

      {/* Mobile Checkout Footer */}
      <MobileFooter>
        <div className="space-y-2">
          <div className="flex items-center justify-between font-semibold">
            <span>商品金額</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>運費</span>
            <span>{formatCurrency(deliveryMethod?.price ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-semibold">
            <span>總計</span>
            <span className="text-primary">{formatCurrency(grandTotal)}</span>
          </div>
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
            className="w-full"
            onClick={() => navigate(catalogPath)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            繼續購物
          </Button>
        </div>
      </MobileFooter>
    </div>
  );
}