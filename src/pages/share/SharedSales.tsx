
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
import { useState, useEffect, useRef } from "react";
import { PrintDialog, PrintOptions } from "@/components/PrintDialog";
import { QRCodeSVG } from "qrcode.react";
import html2pdf from "html2pdf.js";

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
    variant_name?: string | null;
    quantity: number;
    unit_price: number;
  }[];
}

export default function SharedSales() {
  const { salesNoteId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const isPrintingMode = searchParams.get("print") === "true";
  const printSize = searchParams.get("size") || "a4";
  const printMargin = searchParams.get("margin") || "full";
  const printRef = useRef<HTMLDivElement>(null);



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
  useEffect(() => {
    if (isPrintingMode && data) {
      // Small delay to ensure QR code and styles are rendered
      const timer = setTimeout(() => {
        window.print();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isPrintingMode, data]);
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

  const handlePrint = async (options: PrintOptions) => {
    if (!printRef.current || !data) return;

    const element = printRef.current;

    // 預設匯出設定
    const opt = {
      margin: options.margin === 'full' ? 0 : [10, 10, 10, 10],
      filename: `銷貨單_${data.sales_note.code || data.sales_note.id}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        letterRendering: true
      },
      jsPDF: {
        unit: 'mm',
        format: options.paperSize === 'a4' ? 'a4' : [241, 140],
        orientation: 'portrait'
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // 暫時加上列印樣式類別以進行擷取
    element.classList.add('is-printing-mode');
    const sizeClass = options.paperSize === 'a4' ? 'print-a4' : 'print-middle-cut';
    const marginClass = options.margin === 'full' ? 'print-no-margin' : '';
    element.classList.add(sizeClass);
    if (marginClass) element.classList.add(marginClass);

    toast.info("正在產生 PDF 並匯出...");
    setIsPrintDialogOpen(false);

    try {
      // @ts-ignore - html2pdf might have type issues depending on version
      await html2pdf().set(opt).from(element).save();
      toast.success("PDF 匯出成功");
    } catch (err) {
      console.error("PDF generation error:", err);
      toast.error("PDF 產生失敗，請確認瀏覽器權限或試試列印功能");
      // 如果失敗，可以退回到傳統列印
      window.print();
    } finally {
      // 移除列印專用類別
      element.classList.remove('is-printing-mode', sizeClass);
      if (marginClass) element.classList.remove(marginClass);
    }
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
    <div
      ref={printRef}
      className={`container mx-auto p-4 max-w-3xl space-y-6 ${isPrintingMode ? 'is-printing-mode' : ''
        } ${isPrintingMode && printSize === 'a4' ? 'print-a4' : isPrintingMode ? 'print-middle-cut' : ''
        } ${isPrintingMode && printMargin === 'full' ? 'print-no-margin' : ''}`}
    >
      {!isPrintingMode && (
        <PrintDialog
          isOpen={isPrintDialogOpen}
          onClose={() => setIsPrintDialogOpen(false)}
          onPrint={handlePrint}
        />
      )}
      <Card className={isPrintingMode ? 'border-none shadow-none' : ''}>
        <CardHeader className={`border-b bg-muted/40 ${isPrintingMode ? 'bg-white pb-2' : ''}`}>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-5 w-5" />
                銷貨單詳情
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{sales_note.store_name}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* QR Code and Page Info - Only visible in print */}
              <div className="hidden print:flex print-header-info">
                <div className="print-qr-code">
                  <QRCodeSVG value={window.location.href.replace(/[\?&]print=true.*/, "")} size={60} />
                </div>
                <div className="text-[10px] print-page-info font-mono mt-1 text-right"></div>
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
                  <Button variant="outline" size="sm" onClick={() => setIsPrintDialogOpen(true)}>
                    <Printer className="h-4 w-4 mr-2" />
                    列印 / PDF
                  </Button>
                </div>
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
                  <TableCell className="pl-6 font-medium">
                    {item.product_name}
                    {item.variant_name && (
                      <span className="text-muted-foreground ml-1">
                        - {item.variant_name}
                      </span>
                    )}
                  </TableCell>
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

          {/* Hide receipt confirm button during print */}
          {!isPrintingMode && user && !isAdmin && sales_note.status === 'shipped' && (
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

      {!isPrintingMode && !user && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg border border-dashed print:hidden">
          訪客模式僅顯示數量。
          <a href="/login" className="underline ml-1 hover:text-primary">登入</a> 以查看價格。
        </div>
      )}
      {/* Print Footer for Page Numbers */}
      <div className="hidden print:block print-footer">
        頁碼：<span className="print-page-number"></span>
      </div>
    </div>
  );
}