import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { ConsignmentGroupedView } from '@/components/consignment/ConsignmentGroupedView';
import type {
  ConsignmentViewOrder,
  ConsignmentViewStatus,
} from '@/components/consignment/consignmentViewTypes';

interface SalesNoteWithItems {
  id: string;
  code?: string;
  store_id: string;
  status: 'draft' | 'shipped' | 'received';
  payment_status?: string;
  shipped_at: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  sales_note_items: {
    id: string;
    quantity: number;
    returned_quantity?: number;
    sort_order?: number;
    order_items: {
      id: string;
      order_id: string;
      unit_price?: number;
      order: { code: string | null } | null;
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
  product: { id?: string; name: string; code: string };
  product_variant?: { id?: string; name: string };
}

interface ConsignmentOrderRow {
  id: string;
  code: string;
  status: string;
  note: string | null;
  created_at: string;
  shipped_at: string | null;
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
          store_id,
          status,
          payment_status,
          shipped_at,
          received_at,
          notes,
          created_at,
          sales_note_items (
            id,
            quantity,
            returned_quantity,
            sort_order,
            order_items (
              id,
              order_id,
              order:orders (code),
              sort_order,
              unit_price,
              line_type,
              line_note,
              product:products (name, code),
              product_variant:product_variants (name)
            )
          )
        `)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .order('sort_order', { foreignTable: 'sales_note_items', ascending: true });
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
          id, code, status, note, created_at, shipped_at, received_at,
          items:consignment_order_items(
            id,
            quantity,
            unit_price,
            product:products(id, name, code),
            product_variant:product_variants(id, name)
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
  const orderList = useMemo(() => consignmentData?.orders ?? [], [consignmentData?.orders]);

  const consignmentViewOrders = useMemo<ConsignmentViewOrder[]>(
    () =>
      orderList.map((order) => ({
        id: order.id,
        code: order.code,
        direction: 'send_to_store' as const,
        status: order.status as ConsignmentViewStatus,
        created_at: order.created_at,
        shipped_at: order.shipped_at,
        received_at: order.received_at,
        note: order.note,
        store: { id: storeId || '', name: storeRoles[0]?.store_name || '本店' },
        items: (order.items || []).map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          product: item.product,
          variant: item.product_variant,
        })),
      })),
    [orderList, storeId, storeRoles]
  );

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
      payment_status: note.payment_status,
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
      store_id: note.store_id,
      status: note.status,
      payment_status: note.payment_status,
      created_at: note.created_at,
      shipped_at: note.shipped_at,
      received_at: note.received_at,
      notes: note.notes,
      items: [...note.sales_note_items]
        .sort((a, b) => ((a as any).sort_order ?? 0) - ((b as any).sort_order ?? 0))
        .map((item) => ({
          id: item.id,
          orderItemId: (item as any).order_items?.id,
          orderCode: (item as any).order_items?.order?.code,
          quantity: item.quantity,
          returnedQuantity: (item as any).returned_quantity ?? 0,
          productSku: item.order_items?.product?.code || '',
          productName: item.order_items?.product?.name || '',
          variantName: item.order_items?.product_variant?.name || null,
          unitPrice: (item as any).order_items?.unit_price,
          lineType: (item as any).order_items?.line_type,
          lineNote: (item as any).order_items?.line_note,
          sortOrder: (item as any).sort_order ?? 0,
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
            <Package className="h-4 w-4" aria-hidden="true" />
            寄賣銷售
          </TabsTrigger>
          <TabsTrigger value="sales-notes" className="flex items-center gap-2">
            <Send className="h-4 w-4" aria-hidden="true" />
            銷貨單
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consignment" className="space-y-4">
          <ConsignmentGroupedView
            orders={consignmentViewOrders}
            summaries={summaries}
            isLoading={consignmentLoading}
            emptyState={
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">目前沒有寄賣訂單</p>
                <p className="text-sm">後台建立店家寄賣單並出貨後，即可在此回報銷售</p>
              </div>
            }
            renderOrderActions={(order) => {
              const orderItems = order.items || [];
              const totalShipped = orderItems.reduce(
                (sum, item) => sum + (summaries[item.id]?.shipped_quantity ?? 0),
                0
              );
              const totalSold = orderItems.reduce(
                (sum, item) => sum + (summaries[item.id]?.sold_quantity ?? 0),
                0
              );
              return (
                <>
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    已出貨 <span className="font-medium text-foreground">{totalShipped}</span> 件
                    / 已回報 <span className="font-medium text-foreground">{totalSold}</span> 件
                  </span>
                  {!order.received_at && order.status === 'active' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-500 hover:bg-green-50 shrink-0"
                      onClick={() => confirmReceiptMutation.mutate(order.id)}
                      disabled={confirmReceiptMutation.isPending}
                    >
                      <PackageCheck className="h-3.5 w-3.5 mr-1" />確認收貨
                    </Button>
                  )}
                </>
              );
            }}
            renderItemActions={(order, item, summary) => {
              const available = summary?.remaining_quantity ?? 0;
              return (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-blue-600 border-blue-500 hover:bg-blue-50"
                  onClick={() => openReport(order.id, item.id)}
                  disabled={available <= 0 || !order.received_at || reportMutation.isPending}
                >
                  <Send className="h-3.5 w-3.5 mr-1" />回報銷售
                </Button>
              );
            }}
            renderProductActions={(product) => {
              const target = product.defaultReportTarget;
              return (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-blue-600 border-blue-500 hover:bg-blue-50"
                  onClick={() => { if (target) openReport(target.orderId, target.itemId); }}
                  disabled={!target || reportMutation.isPending}
                >
                  <Send className="h-3.5 w-3.5 mr-1" />回報銷售
                </Button>
              );
            }}
          />
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
              {reportMutation.isPending ? '送出中…' : '送出回報'}
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
