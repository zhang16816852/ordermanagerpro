
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertCircle, FileText, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { format } from "date-fns";
import { useState } from "react";
import { SharedReceiptExport } from "./SharedReceiptExport";

interface SharedSalesData {
  sales_note: {
    id: string;
    code?: string;
    created_at: string;
    shipped_at?: string | null;
    status: string;
    store_name: string;
    notes: string;
    access_token?: string;
  };
  items: {
    product_name: string;
    variant_name?: string | null;
    quantity: number;
    unit_price: number | null;
    sort_order?: number;
  }[];
}

export default function SharedSales() {
  const { salesNoteId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const isPrintingMode = searchParams.get("print") === "true";
  const [printSize] = useState<"a4" | "middle-cut">((searchParams.get("size") as "a4" | "middle-cut") || "a4");

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-sale", salesNoteId, token, user?.id],
    queryFn: async () => {
      if (!salesNoteId || !token) throw new Error("連結無效");

      const { data, error } = await supabase
        .rpc("get_shared_sales_note_details", {
          p_identifier: salesNoteId,
          p_token: token
        } as any);

      if (error) throw error;
      if (!data) throw new Error("找不到銷貨單或連結已過期");

      return data as unknown as SharedSalesData;
    },
    retry: false
  });

  const confirmReceiveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("請先登入");
      if (!data?.sales_note?.id) throw new Error("無效的銷貨單 ID");

      const { error } = await (supabase
        .from('sales_notes') as any)
        .update({
          status: 'received',
          received_at: new Date().toISOString(),
          received_by: user.id,
        })
        .eq('id', data.sales_note.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已確認收貨');
      queryClient.invalidateQueries({ queryKey: ["shared-sale", salesNoteId, token, user?.id] });
    },
    onError: (error) => {
      toast.error(`確認失敗：${getErrorMessage(error)}`);
    },
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
          <AlertTitle>無法讀取銷貨單</AlertTitle>
          <AlertDescription>連結可能錯誤或已失效。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { sales_note, items } = data;
  const sortedItems = [...(items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const showPrice = sortedItems.length > 0 && sortedItems[0].unit_price !== null;

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
        title="銷貨單"
        docTitleLabel="店名"
        storeName={sales_note.store_name}
        code={sales_note.code || sales_note.id}
        createdAt={sales_note.created_at}
        status={sales_note.status === 'completed' ? '已完成' : '處理中'}
        notes={sales_note.notes}
        qrValue={window.location.href.replace(/[?&]print=true.*/, "")}
        filenamePrefix="銷貨單"
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
            <FileText className="h-5 w-5" />
            銷貨單詳情
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {sales_note.store_name}・{sales_note.code || sales_note.id}・
            {format(new Date(sales_note.shipped_at || sales_note.created_at), "yyyy/MM/dd")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={sales_note.status === 'completed' ? 'default' : 'secondary'}>
            {sales_note.status === 'completed' ? '已完成' : '處理中'}
          </Badge>
          {user && !isAdmin && sales_note.status === 'shipped' && (
            <Button
              onClick={() => confirmReceiveMutation.mutate()}
              disabled={confirmReceiveMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="mr-2 h-4 w-4" />
              {confirmReceiveMutation.isPending ? "確認中…" : "確認收貨"}
            </Button>
          )}
        </div>
      </div>

      <SharedReceiptExport
        items={sortedItems.map((item) => ({
          name: item.product_name,
          variant: item.variant_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))}
        title="銷貨單"
        docTitleLabel="店名"
        storeName={sales_note.store_name}
        code={sales_note.code || sales_note.id}
        createdAt={sales_note.created_at}
        status={sales_note.status === 'completed' ? '已完成' : '處理中'}
        notes={sales_note.notes}
        qrValue={window.location.href.replace(/[?&]print=true.*/, "")}
        filenamePrefix="銷貨單"
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
