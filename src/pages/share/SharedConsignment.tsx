
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertCircle, Truck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SharedReceiptExport } from "./SharedReceiptExport";
import { useState } from "react";

interface SharedConsignmentData {
  consignment: {
    id: string;
    code?: string;
    direction: string;
    created_at: string;
    status: string;
    notes: string;
    store_name?: string;
    supplier_name?: string;
    access_token?: string;
  };
  items: {
    product_name: string;
    variant_name?: string | null;
    quantity: number;
    unit_price: number | null;
  }[];
}

const DIRECTION_LABEL: Record<string, string> = {
  send_to_store: "店家寄賣",
  receive_from_supplier: "廠商寄賣",
};

export default function SharedConsignment() {
  const { consignmentId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, isAdmin } = useAuth();
  const isPrintingMode = searchParams.get("print") === "true";
  const [printSize] = useState<"a4" | "middle-cut">((searchParams.get("size") as "a4" | "middle-cut") || "a4");

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-consignment", consignmentId, token, user?.id],
    queryFn: async () => {
      if (!consignmentId || !token) throw new Error("連結無效");

      const { data, error } = await supabase
        .rpc("get_shared_consignment_details", {
          p_identifier: consignmentId,
          p_token: token
        } as any);

      if (error) throw error;
      if (!data) throw new Error("找不到寄賣單或連結已過期");

      return data as unknown as SharedConsignmentData;
    },
    retry: false
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto p-4 max-w-md mt-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>無法讀取寄賣單</AlertTitle>
          <AlertDescription>連結可能錯誤或已失效。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { consignment, items } = data;
  const sortedItems = [...(items ?? [])];
  const showPrice = sortedItems.length > 0 && sortedItems[0].unit_price !== null;
  const directionLabel = DIRECTION_LABEL[consignment.direction] || consignment.direction;
  const placeName = consignment.store_name || consignment.supplier_name || "-";

  if (isPrintingMode) {
    return (
      <SharedReceiptExport
        items={sortedItems.map((item: any) => ({
          name: item.product_name,
          variant: item.variant_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))}
        title={directionLabel}
        docTitleLabel="店家"
        storeName={placeName}
        code={consignment.code || consignment.id}
        createdAt={consignment.created_at}
        status={consignment.status === 'active' ? '進行中' : consignment.status}
        notes={consignment.notes}
        qrValue={window.location.href.replace(/[?&]print=true.*/, "")}
        filenamePrefix="寄賣單"
        canViewPrice={showPrice}
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
            <Truck className="h-5 w-5" />
            {directionLabel}詳情
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {placeName}・{consignment.code || consignment.id}・
            {new Date(consignment.created_at).toLocaleDateString('zh-TW')}
          </p>
        </div>
        <Badge variant={consignment.status === 'active' ? 'outline' : 'secondary'}>
          {consignment.status === 'active' ? '進行中' : consignment.status}
        </Badge>
      </div>

      <SharedReceiptExport
        items={sortedItems.map((item: any) => ({
          name: item.product_name,
          variant: item.variant_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))}
        title={directionLabel}
        docTitleLabel="店家"
        storeName={placeName}
        code={consignment.code || consignment.id}
        createdAt={consignment.created_at}
        status={consignment.status === 'active' ? '進行中' : consignment.status}
        notes={consignment.notes}
        qrValue={window.location.href.replace(/[?&]print=true.*/, "")}
        filenamePrefix="寄賣單"
        canViewPrice={showPrice}
        webPreview
        defaultPaperSize={printSize}
      />

      {!user && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg border border-dashed print:hidden">
          訪客模式僅顯示數量。
          <a href="/login" className="underline ml-1 hover:text-primary">登入</a> 以查看價格。
        </div>
      )}
    </div>
  );
}
