import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertCircle, FileText, Printer, Download, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface SharedSalesData {
  sales_note: {
    id: string;
    code?: string;
    created_at: string;
    status: string;
    store_name: string;
    notes: string;
  };
  items: {
    product_name: string;
    quantity: number;
    unit_price: number | null;
  }[];
}

export default function SharedSales() {
  const { salesNoteId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-sale", salesNoteId, token, user?.id],
    queryFn: async () => {
      if (!salesNoteId || !token) throw new Error("連結無效");

      const { data, error } = await supabase
        .rpc("get_shared_sales_note_details", {
          p_sales_note_id: salesNoteId,
          p_token: token
        });

      if (error) throw error;
      if (!data) throw new Error("找不到銷貨單或連結已過期");
      
      return data as unknown as SharedSalesData;
    },
    retry: false
  });

  const confirmReceiveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("請先登入");
      if (!salesNoteId) throw new Error("無效的銷貨單 ID");

      const { error } = await supabase
        .from('sales_notes')
        .update({
          status: 'received',
          received_at: new Date().toISOString(),
          received_by: user.id,
        })
        .eq('id', salesNoteId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已確認收貨');
      queryClient.invalidateQueries({ queryKey: ["shared-sale", salesNoteId, token, user?.id] });
    },
    onError: (error) => {
      toast.error(`確認失敗：${error.message}`);
    },
  });

  const handleDownloadCSV = () => {
    if (!data) return;
    const { sales_note, items } = data;
    const showPrice = items.length > 0 && items[0].unit_price !== null;

    // 建立 CSV 內容
    let csvContent = "\uFEFF"; // BOM for Excel Chinese support
    csvContent += `銷貨單號,${sales_note.code || sales_note.id}\n`;
    csvContent += `店家,${sales_note.store_name}\n`;
    csvContent += `日期,${new Date(sales_note.created_at).toLocaleDateString()}\n\n`;
    
    csvContent += showPrice 
      ? "商品名稱,數量,單價,小計\n"
      : "商品名稱,數量\n";

    items.forEach((item: any) => {
      const row = [
        `"${item.product_name.replace(/"/g, '""')}"`, // Escape quotes
        item.quantity,
      ];
      if (showPrice) {
        row.push(item.unit_price, item.unit_price * item.quantity);
      }
      csvContent += row.join(",") + "\n";
    });

    // 下載檔案
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `銷貨單_${sales_note.code || sales_note.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("已開始下載 CSV");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
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
  const showPrice = items.length > 0 && items[0].unit_price !== null;

  return (
    <div className="container mx-auto p-4 max-w-3xl space-y-6">
      <Card>
        <CardHeader className="border-b bg-muted/40">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-5 w-5" />
                銷貨單詳情
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{sales_note.store_name}</p>
            </div>
            <div className="flex flex-col items-end gap-2 print:hidden">
              <Badge variant={sales_note.status === 'completed' ? 'default' : 'secondary'}>
                {sales_note.status === 'completed' ? '已完成' : '處理中'}
              </Badge>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleDownloadCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  匯出 Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-2" />
                  列印 / PDF
                </Button>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            單號: {sales_note.code || sales_note.id} <br />
            日期: {new Date(sales_note.created_at).toLocaleString()}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">商品名稱</TableHead>
                <TableHead className="text-right pr-6">數量</TableHead>
                {showPrice && <TableHead className="text-right pr-6">單價</TableHead>}
                {showPrice && <TableHead className="text-right pr-6">小計</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell className="pl-6 font-medium">{item.product_name}</TableCell>
                  <TableCell className="text-right pr-6">{item.quantity}</TableCell>
                  {showPrice && (
                    <>
                      <TableCell className="text-right pr-6">${item.unit_price?.toLocaleString()}</TableCell>
                      <TableCell className="text-right pr-6">${(item.unit_price * item.quantity).toLocaleString()}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {showPrice && (
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={3} className="text-right font-bold pr-6">總計</TableCell>
                  <TableCell className="text-right font-bold pr-6 text-lg">
                    ${items.reduce((sum: number, item: any) => sum + (item.unit_price * item.quantity), 0).toLocaleString()}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {user && !isAdmin && sales_note.status === 'shipped' && (
            <div className="flex justify-end p-4 border-t bg-muted/10">
              <Button
                onClick={() => confirmReceiveMutation.mutate()}
                disabled={confirmReceiveMutation.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Check className="mr-2 h-4 w-4" />
                {confirmReceiveMutation.isPending ? "確認中..." : "確認收貨"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!user && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg border border-dashed print:hidden">
          訪客模式僅顯示數量。
          <a href="/login" className="underline ml-1 hover:text-primary">登入</a> 以查看價格。
        </div>
      )}
    </div>
  );
}