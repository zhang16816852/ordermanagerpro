import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertCircle, Package, Printer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";
import { PrintDialog, PrintOptions } from "@/components/PrintDialog";
import { QRCodeSVG } from "qrcode.react";
import html2pdf from "html2pdf.js";

interface SharedOrderData {
  order: {
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

export default function SharedOrder() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { user } = useAuth();
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const isPrintingMode = searchParams.get("print") === "true";
  const printSize = searchParams.get("size") || "a4";
  const printMargin = searchParams.get("margin") || "full";
  const printRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-order", orderId, token, user?.id],
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

  useEffect(() => {
    if (isPrintingMode && data) {
      const timer = setTimeout(() => {
        window.print();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isPrintingMode, data]);

  const handlePrint = async (options: PrintOptions) => {
    if (!printRef.current || !data) return;

    const element = printRef.current;

    const opt = {
      margin: options.margin === 'full' ? 0 : [10, 10, 10, 10],
      filename: `訂單_${data.order.code || data.order.id}.pdf`,
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

    element.classList.add('is-printing-mode');
    const sizeClass = options.paperSize === 'a4' ? 'print-a4' : 'print-middle-cut';
    const marginClass = options.margin === 'full' ? 'print-no-margin' : '';
    element.classList.add(sizeClass);
    if (marginClass) element.classList.add(marginClass);

    toast.info("正在產生 PDF 並匯出...");
    setIsPrintDialogOpen(false);

    try {
      // @ts-ignore
      await html2pdf().set(opt).from(element).save();
      toast.success("PDF 匯出成功");
    } catch (err) {
      console.error("PDF error:", err);
      toast.error("PDF 產生失敗");
      window.print();
    } finally {
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
                <Package className="h-5 w-5" />
                訂單詳情
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {order.store_name}
              </p>
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
                <Badge variant={order.status === 'completed' ? 'default' : 'secondary'}>
                  {order.status === 'completed' ? '已完成' : '處理中'}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => setIsPrintDialogOpen(true)} className="print:hidden">
                  <Printer className="h-4 w-4 mr-2" />
                  列印 / 另存 PDF
                </Button>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            訂單編號: {order.code || order.id} <br />
            建立時間: {new Date(order.created_at).toLocaleString()}
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
        </CardContent>
      </Card>

      {!isPrintingMode && !user && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg border border-dashed print:hidden">
          您目前處於訪客模式，僅顯示商品數量。
          <a href="/login" className="underline ml-1 hover:text-primary">登入</a> 以查看價格資訊。
        </div>
      )}
    </div>
  );
}
