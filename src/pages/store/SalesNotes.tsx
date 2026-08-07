import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Package, PackageCheck, Send } from 'lucide-react';
import { SalesNoteListTable } from '@/components/sales/SalesNoteListTable';
import { SalesNoteDetailDialog } from '@/components/sales/SalesNoteDetailDialog';
import type { SalesNoteDetail } from '@/components/sales/SalesNoteDetailDialog';

interface SalesNoteWithItems {
  id: string;
  code?: string;
  status: 'draft' | 'shipped' | 'received';
  shipped_at: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  sales_note_items: {
    id: string;
    quantity: number;
    order_items: {
      id: string;
      product: { name: string; code: string } | null;
      product_variant: { name: string } | null;
    } | null;
  }[];
}

interface SalesNoteSummary {
  id: string;
  code?: string;
  status: string;
  itemCount: number;
  created_at: string;
  shipped_at?: string | null;
  received_at?: string | null;
}

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
  received_at: string | null;
  items: ConsignmentItem[];
}

export default function StoreSalesNotes() {
  const { user, storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'consignment');

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [reportItem, setReportItem] = useState<{ orderId: string; itemId: string } | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [salePrice, setSalePrice] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const { data: salesNotes, isLoading: notesLoading } = useQuery({
    queryKey: ['store-sales-notes', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await (supabase
        .from('sales_notes') as any)
        .select(`
          id,
          code,
          status,
          shipped_at,
          received_at,
          notes,
          created_at,
          sales_note_items (
            id,
            quantity,
            order_items (
              id,
              product:products (name, code),
              product_variant:product_variants (name)
            )
          )
        `)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SalesNoteWithItems[];
    },
    enabled: !!storeId,
  });

  const confirmReceiveMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await (supabase
        .from('sales_notes') as any)
        .update({
          status: 'received',
          received_at: new Date().toISOString(),
          received_by: user?.id,
        })
        .eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
      toast.success('已確認收貨');
      setSelectedNoteId(null);
    },
    onError: (error) => {
      toast.error(`確認失敗：${getErrorMessage(error)}`);
    },
  });

  const { data: consignmentData, isLoading: consignmentLoading } = useQuery({
    queryKey: ["store-consignment", storeId],
    queryFn: async () => {
      if (!storeId) return { orders: [], summaries: {} as Record<string, SummaryRow> };
      const { data: orderData, error: orderError } = await (supabase
        .from("consignment_orders") as any)
        .select(`
          id, code, status, note, received_at,
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

  const summaries = consignmentData?.summaries || {};
  const orderList = consignmentData?.orders || [];

  const reportMutation = useMutation({
    mutationFn: async ({ itemId }: { orderId: string; itemId: string }) => {
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

  const confirmReceiptMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (!user) throw new Error("未登入");
      const { error } = await (supabase as any).rpc("confirm_consignment_receipt", {
        p_consignment_order_id: orderId,
        p_received_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已確認收貨，可開始回報銷售");
      queryClient.invalidateQueries({ queryKey: ["store-consignment"] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const openReport = (orderId: string, itemId: string) => {
    const order = orderList.find((o) => o.id === orderId);
    if (order && !order.received_at) {
      toast.warning("請先確認收貨，再回報銷售");
      return;
    }
    const summary = summaries[itemId];
    const available = summary ? summary.remaining_quantity : 0;
    if (available <= 0) {
      toast.warning("此商品沒有可回報的剩餘數量");
      return;
    }
    setQuantity(available);
    setReportItem({ orderId, itemId });
  };

  const mappedSalesNotes = useMemo<SalesNoteSummary[]>(() => {
    if (!salesNotes) return [];
    return salesNotes.map((note) => ({
      id: note.id,
      code: note.code,
      status: note.status,
      itemCount: note.sales_note_items.length,
      created_at: note.created_at,
      shipped_at: note.shipped_at,
      received_at: note.received_at,
    }));
  }, [salesNotes]);

  const selectedNoteDetail = useMemo<SalesNoteDetail | null>(() => {
    if (!selectedNoteId || !salesNotes) return null;
    const note = salesNotes.find((n) => n.id === selectedNoteId);
    if (!note) return null;

    return {
      id: note.id,
      code: note.code,
      status: note.status,
      created_at: note.created_at,
      shipped_at: note.shipped_at,
      received_at: note.received_at,
      notes: note.notes,
      items: note.sales_note_items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        productSku: item.order_items?.product?.code || '',
        productName: item.order_items?.product?.name || '',
        variantName: item.order_items?.product_variant?.name || null,
      })),
    };
  }, [selectedNoteId, salesNotes]);

  const handleConfirmReceive = (noteId: string) => {
    confirmReceiveMutation.mutate(noteId);
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", value);
      return next;
    }, { replace: true });
  };

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">您尚未被指派到任何店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">寄賣與銷貨</h1>
        <p className="text-muted-foreground">回報店家寄賣商品銷售，並確認銷貨單收貨</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="consignment" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            寄賣銷售
          </TabsTrigger>
          <TabsTrigger value="sales-notes" className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            銷貨單
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consignment" className="space-y-4">
          {consignmentLoading ? (
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
                          {order.received_at ? (
                            <Badge variant="outline" className="border-green-500 text-green-600">已收貨</Badge>
                          ) : (
                            <Badge variant="secondary">待收貨</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-sm text-muted-foreground">
                            已出貨 <span className="font-medium text-foreground">{totalShipped}</span> 件
                            / 已回報 <span className="font-medium text-foreground">{totalSold}</span> 件
                          </div>
                          {!order.received_at && order.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 border-green-500 hover:bg-green-50"
                              onClick={() => confirmReceiptMutation.mutate(order.id)}
                              disabled={confirmReceiptMutation.isPending}
                            >
                              <PackageCheck className="h-3.5 w-3.5 mr-1" />確認收貨
                            </Button>
                          )}
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
                                        disabled={available <= 0 || !order.received_at || reportMutation.isPending}
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
        </TabsContent>

        <TabsContent value="sales-notes" className="space-y-4">
          <SalesNoteListTable
            data={mappedSalesNotes}
            isLoading={notesLoading}
            onView={handleViewNote}
            showStoreColumn={false}
          />

          <SalesNoteDetailDialog
            note={selectedNoteDetail}
            open={!!selectedNoteId}
            onOpenChange={(open) => !open && setSelectedNoteId(null)}
            onConfirmReceive={handleConfirmReceive}
            isConfirming={confirmReceiveMutation.isPending}
            showSku={false}
          />
        </TabsContent>
      </Tabs>

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

  function handleViewNote(note: SalesNoteSummary) {
    setSelectedNoteId(note.id);
  }
}
