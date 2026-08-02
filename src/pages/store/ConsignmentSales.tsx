import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, Send } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { useAuth } from "@/hooks/useAuth";

interface SummaryRow {
  consignment_order_item_id: string;
  consignment_order_id: string;
  shipped_quantity: number;
  sold_quantity: number;
  returned_from_store: number;
  remaining_quantity: number;
}

interface ConsignmentItem {
  id: string;
  consignment_order_id: string;
  quantity: number;
  unit_price: number;
  product: { name: string; code: string };
  product_variant?: { name: string };
}

interface ConsignmentOrderRow {
  id: string;
  code: string;
  status: string;
  note: string | null;
  items: ConsignmentItem[];
}

export default function StoreConsignmentSales() {
  const { user, storeId } = useAuth();
  const queryClient = useQueryClient();
  const [reportItem, setReportItem] = useState<{ orderId: string; itemId: string } | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [salePrice, setSalePrice] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["store-consignment", storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const { data: orderData, error: orderError } = await (supabase
        .from("consignment_orders") as any)
        .select(`
          id, code, status, note,
          items:consignment_order_items(
            id,
            quantity,
            unit_price,
            product:products(name, code),
            product_variant:product_variants(name)
          )
        `)
        .eq("direction", "send_to_store")
        .eq("store_id", storeId)
        .in("status", ["draft", "active"])
        .order("created_at", { ascending: false });
      if (orderError) throw orderError;

      const orders = (orderData || []) as ConsignmentOrderRow[];

      const summaries: Record<string, SummaryRow> = {};
      if (orders.length > 0) {
        const { data: summaryData, error: summaryError } = await (supabase
          .from("consignment_order_item_summary") as any)
          .select("*")
          .in("consignment_order_id", orders.map(o => o.id));
        if (summaryError) throw summaryError;
        (summaryData || []).forEach((s: SummaryRow) => { summaries[s.consignment_order_item_id] = s; });
      }

      return { orders, summaries };
    },
    enabled: !!storeId,
  });

  const summaries = (orders as any)?.summaries || {};
  const orderList = (orders as any)?.orders || [];

  const reportMutation = useMutation({
    mutationFn: async ({ orderId, itemId }: { orderId: string; itemId: string }) => {
      if (!user) throw new Error("未登入");
      const { data, error } = await (supabase as any).rpc("report_consignment_sale", {
        p_consignment_order_item_id: itemId,
        p_quantity: quantity,
        p_sale_price: salePrice ? parseFloat(salePrice) : null,
        p_note: note || null,
        p_created_by: user.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("銷售回報已送出，待後台審核");
      setReportItem(null);
      setQuantity(1);
      setSalePrice("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["store-consignment"] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const openReport = (orderId: string, itemId: string) => {
    const summary = summaries[itemId];
    const available = summary ? summary.remaining_quantity : 0;
    if (available <= 0) {
      toast.warning("此商品沒有可回報的剩餘數量");
      return;
    }
    setQuantity(available);
    setReportItem({ orderId, itemId });
  };

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">請先選擇店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">寄賣銷售回報</h1>
        <p className="text-muted-foreground">回報店家寄賣商品的銷售數量，由後台審核後結算</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">載入中...</div>
      ) : orderList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">目前沒有寄賣訂單</p>
          <p className="text-sm">後台建立店家寄賣單並出貨後，即可在此回報銷售</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orderList.map((order: ConsignmentOrderRow) => {
            const totalSold = order.items.reduce((sum, item) => {
              const s = summaries[item.id];
              return sum + (s?.sold_quantity ?? 0);
            }, 0);
            const totalShipped = order.items.reduce((sum, item) => {
              const s = summaries[item.id];
              return sum + (s?.shipped_quantity ?? 0);
            }, 0);
            return (
              <Card key={order.id}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base font-mono">{order.code}</CardTitle>
                      <Badge variant="outline" className="border-blue-500 text-blue-600">寄賣</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      已出貨 <span className="font-medium text-foreground">{totalShipped}</span> 件
                      / 已回報 <span className="font-medium text-foreground">{totalSold}</span> 件
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-2 px-3 font-medium">商品</th>
                          <th className="text-right py-2 px-3 font-medium w-20">出貨</th>
                          <th className="text-right py-2 px-3 font-medium w-20">已回報</th>
                          <th className="text-right py-2 px-3 font-medium w-20">可回報</th>
                          <th className="text-right py-2 px-3 font-medium w-28">建議售價</th>
                          <th className="text-right py-2 px-3 font-medium w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item) => {
                          const s = summaries[item.id];
                          const shipped = s?.shipped_quantity ?? 0;
                          const sold = s?.sold_quantity ?? 0;
                          const available = s?.remaining_quantity ?? 0;
                          return (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="py-2 px-3">
                                <p className="font-medium">{item.product.name}</p>
                                {item.product_variant?.name && (
                                  <p className="text-xs text-muted-foreground">{item.product_variant.name}</p>
                                )}
                              </td>
                              <td className="text-right py-2 px-3">{shipped}</td>
                              <td className="text-right py-2 px-3">{sold}</td>
                              <td className="text-right py-2 px-3 font-medium">{available}</td>
                              <td className="text-right py-2 px-3 text-muted-foreground">
                                ${item.unit_price.toLocaleString()}
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-blue-600 border-blue-500 hover:bg-blue-50"
                                    onClick={() => openReport(order.id, item.id)}
                                    disabled={available <= 0 || reportMutation.isPending}
                                  >
                                    <Send className="h-3.5 w-3.5 mr-1" />回報銷售
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!reportItem} onOpenChange={(open) => { if (!open) setReportItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>回報銷售</DialogTitle>
            <DialogDescription>填寫本次實際銷售數量與售價（若為預設售價可留空）。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>銷售數量</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <p className="text-xs text-muted-foreground">此商品目前可回報上限：{summaries[reportItem?.itemId || ""]?.remaining_quantity ?? 0}</p>
            </div>
            <div className="space-y-2">
              <Label>實際售價（選填）</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="留空將使用建議售價"
              />
            </div>
            <div className="space-y-2">
              <Label>備註（選填）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入備註" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportItem(null)}>取消</Button>
            <Button onClick={() => reportItem && reportMutation.mutate(reportItem)} disabled={reportMutation.isPending}>
              {reportMutation.isPending ? '送出中...' : '送出回報'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
