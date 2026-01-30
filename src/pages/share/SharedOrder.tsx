import { useEffect } from "react";
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

interface SharedOrderData {
  order: {
    id: string;
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
  const { user } = useAuth(); // 用來監聽登入狀態變化

  const { data, isLoading, error } = useQuery({
    // 將 user?.id 加入 key，這樣當用戶登入/登出時會自動重新抓取資料(更新價格顯示)
    queryKey: ["shared-order", orderId, token, user?.id],
    queryFn: async () => {
      if (!orderId || !token) throw new Error("連結無效");

      // 呼叫我們剛剛建立的 RPC
      const { data, error } = await supabase
        .rpc("get_shared_order_details", {
          p_order_id: orderId,
          p_token: token
        });

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
      <div className="container mx-auto p-4 max-w-md mt-10">
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
  // 判斷後端是否有回傳價格 (若未登入，後端會回傳 null)
  const showPrice = items.length > 0 && items[0].unit_price !== null;

  return (
    <div className="container mx-auto p-4 max-w-3xl space-y-6">
      <Card>
        <CardHeader className="border-b bg-muted/40">
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
              <Badge variant={order.status === 'completed' ? 'default' : 'secondary'}>
                {order.status === 'completed' ? '已完成' : '處理中'}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
                <Printer className="h-4 w-4 mr-2" />
                列印 / 另存 PDF
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            訂單編號: {order.id} <br />
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

      {!user && (
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg border border-dashed print:hidden">
          您目前處於訪客模式，僅顯示商品數量。
          <a href="/login" className="underline ml-1 hover:text-primary">登入</a> 以查看價格資訊。
        </div>
      )}
    </div>
  );
}
