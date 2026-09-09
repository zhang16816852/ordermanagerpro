import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertCircle, Package } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SharedReceiptExport } from "./SharedReceiptExport";
import { useState } from "react";

interface SharedOrderData {
  order: {
    id: string;
    code?: string;
    store_id: string;
    created_at: string;
    status: string;
    store_name: string;
    notes: string;
  };
  items: {
    product_name: string;
    variant_name?: string | null;
    quantity: number;
    unit_price: number | null;
    sort_order?: number;
  }[];
}

export default function SharedOrder() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, isAdmin, storeRoles } = useAuth();
  const isPrintingMode = searchParams.get("print") === "true";
  const [printSize] = useState<"a4" | "middle-cut">((searchParams.get("size") as "a4" | "middle-cut") || "a4");

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-order", orderId, token, user?.id, storeRoles],
    queryFn: async () => {
      if (!orderId || !token) throw new Error("連結無效");

      const { data, error } = await supabase
        .rpc("get_shared_order_details", {
          p_identifier: orderId,
          p_token: token
        } as any);

      if (error) throw error;
      if (!data) throw new Error("找不到訂單或連結已過期");

      return data as unknown as SharedOrderData;
    },
    retry: false
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto p-4 max-md mt-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>無法讀取訂單</AlertTitle>
          <AlertDescription>
            請確認您的連結是否正確，或聯繫管理員。
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { order, items } = data;
  const sortedItems = [...(items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const canViewPrice = user ? (isAdmin || storeRoles.some(r => r.store_id === order.store_id)) : false;

  // 列印模式：只顯示列印版型，方便版面調整測試
  if (isPrintingMode) {
    return (
      <SharedReceiptExport
        items={sortedItems.map((item) => ({
          name: item.product_name,
          variant: item.variant_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))}
        title="訂單"
        docTitleLabel="訂購店家"
        storeName={order.store_name}
        code={order.code || order.id}
        createdAt={order.created_at}
        status={order.status === 'completed' ? '已完成' : '處理中'}
        notes={order.notes}
        qrValue={window.location.href.replace(/[?&]print=true.*/, "")}
        filenamePrefix="訂單"
        canViewPrice={canViewPrice}
        printMode
        webPreview
        defaultPaperSize={printSize}
      />
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Package className="h-5 w-5" />
            訂單詳情
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {order.store_name}・{order.code || order.id}・{new Date(order.created_at).toLocaleString()}
          </p>
        </div>
        <Badge variant={order.status === 'completed' ? 'default' : 'secondary'}>
          {order.status === 'completed' ? '已完成' : '處理中'}
        </Badge>
      </div>

      <SharedReceiptExport
        items={sortedItems.map((item) => ({
          name: item.product_name,
          variant: item.variant_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))}
        title="訂單"
        docTitleLabel="訂購店家"
        storeName={order.store_name}
        code={order.code || order.id}
        createdAt={order.created_at}
        status={order.status === 'completed' ? '已完成' : '處理中'}
        notes={order.notes}
        qrValue={window.location.href.replace(/[?&]print=true.*/, "")}
        filenamePrefix="訂單"
        canViewPrice={canViewPrice}
        webPreview
        defaultPaperSize={printSize}
      />

      {!canViewPrice && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg border border-dashed print:hidden">
          {user ? "您不是此店鋪的人員，僅顯示商品數量。" : "您目前處於訪客模式，僅顯示商品數量。"}
          {!user && <a href="/login" className="underline ml-1 hover:text-primary">登入</a>}
        </div>
      )}
    </div>
  );
}
