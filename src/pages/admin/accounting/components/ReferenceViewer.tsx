import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Truck } from 'lucide-react';
import { SalesNoteDetailDialog, SalesNoteDetail } from '@/components/sales/SalesNoteDetailDialog';
import { OrderDetailDialog } from '@/components/order/OrderDetailDialog';
import { Order } from '@/types/order';
import { formatCurrency } from '@/lib/formatters';

export interface Reference {
  reference_type: string | null;
  reference_id: string | null;
}

interface ReferenceViewerProps {
  referenceType: string | null;
  referenceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PO_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  ordered: '已訂購',
  partial_received: '部分收貨',
  received: '已收貨',
  cancelled: '已取消',
};

interface PurchaseOrderView {
  id: string;
  supplier_id: string | null;
  status: string;
  order_date: string;
  expected_date: string | null;
  received_date: string | null;
  total_amount: number;
  notes: string | null;
  supplier_order_number: string | null;
  created_at: string;
  supplier?: { name: string } | null;
  items?: PurchaseOrderItemView[];
}

interface PurchaseOrderItemView {
  id: string;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  product?: { name: string; code: string } | null;
  variant?: { name: string; sku: string } | null;
}

export function ReferenceViewer({ referenceType, referenceId, open, onOpenChange }: ReferenceViewerProps) {
  const [showRaw, setShowRaw] = useState(false);

  const salesNoteQuery = useQuery<SalesNoteDetail | null>({
    queryKey: ['accounting-reference-sales-note', referenceId],
    queryFn: async () => {
      if (!referenceId) return null;
      const { data, error } = await (supabase as any)
        .from('sales_notes')
        .select(`
          *,
          store:stores(name, code),
          sales_note_items(
            id,
            quantity,
            sort_order,
            order_item:order_items(
              id,
              quantity,
              unit_price,
              sort_order,
              product:products(name, code),
              product_variant:product_variants(name)
            )
          )
        `)
        .eq('id', referenceId)
        .order('sort_order', { foreignTable: 'sales_note_items', ascending: true })
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        code: data.code,
        storeName: data.store?.name,
        storeCode: data.store?.code,
        status: data.status,
        payment_status: data.payment_status,
        created_at: data.created_at,
        shipped_at: data.shipped_at,
        received_at: data.received_at,
        notes: data.notes,
        access_token: data.access_token,
        items: [...(data.sales_note_items || [])]
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((item: any) => ({
            id: item.id,
            quantity: item.quantity,
            productName: item.order_item?.product?.name || '未知產品',
            productSku: item.order_item?.product?.code || '-',
            variantName: item.order_item?.product_variant?.name,
            unitPrice: item.order_item?.unit_price,
            sortOrder: item.sort_order ?? 0,
          })),
      };
    },
    enabled: open && referenceType === 'sales_note' && !!referenceId,
  });

  const orderQuery = useQuery<Order | null>({
    queryKey: ['accounting-reference-order', referenceId],
    queryFn: async () => {
      if (!referenceId) return null;
      const { data, error } = await (supabase as any)
        .from('orders')
        .select(`
          *,
          stores (name, code),
          order_items (
            id,
            quantity,
            shipped_quantity,
            unit_price,
            status,
            store_id,
            product_id,
            variant_id,
            sort_order,
            product:products (name, code),
            product_variant:product_variants (name)
          )
        `)
        .eq('id', referenceId)
        .order('sort_order', { ascending: true, foreignTable: 'order_items' })
        .maybeSingle();
      if (error) throw error;
      return (data as Order) || null;
    },
    enabled: open && referenceType === 'order' && !!referenceId,
  });

  const purchaseOrderQuery = useQuery<PurchaseOrderView | null>({
    queryKey: ['accounting-reference-purchase-order', referenceId],
    queryFn: async () => {
      if (!referenceId) return null;
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(name),
          items:purchase_order_items(
            id,
            quantity,
            received_quantity,
            unit_cost,
            product:products(name, code),
            variant:product_variants(name, sku)
          )
        `)
        .eq('id', referenceId)
        .maybeSingle();
      if (error) throw error;
      return (data as PurchaseOrderView) || null;
    },
    enabled: open && referenceType === 'purchase_order' && !!referenceId,
  });

  const isLoading = (referenceType === 'sales_note' && salesNoteQuery.isLoading)
    || (referenceType === 'order' && orderQuery.isLoading)
    || (referenceType === 'purchase_order' && purchaseOrderQuery.isLoading);

  const isError = (referenceType === 'sales_note' && salesNoteQuery.isError)
    || (referenceType === 'order' && orderQuery.isError)
    || (referenceType === 'purchase_order' && purchaseOrderQuery.isError);

  if (referenceType === 'sales_note') {
    return (
      <SalesNoteDetailDialog
        open={open}
        onOpenChange={onOpenChange}
        note={salesNoteQuery.data || null}
        enablePayment={false}
      />
    );
  }

  if (referenceType === 'order') {
    return (
      <OrderDetailDialog
        order={orderQuery.data || null}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }

  if (referenceType === 'purchase_order') {
    const po = purchaseOrderQuery.data;
    const items = po?.items || [];
    const totalAmount = po?.total_amount != null ? po.total_amount : items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              採購單詳情
            </DialogTitle>
            <DialogDescription>
              檢視此採購單的供應商資訊、品項清單與收貨狀態。
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-1/2" />
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : isError || !po ? (
            <div className="text-center py-8 text-muted-foreground">無法載入採購單資料</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-muted/20 p-4 rounded-lg border">
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">供應商</span>
                  <div className="font-medium">{po.supplier?.name || '-'}</div>
                  {po.supplier_order_number && (
                    <div className="text-xs text-muted-foreground font-mono">廠商單號：{po.supplier_order_number}</div>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">狀態</span>
                  <div><Badge variant={po.status === 'cancelled' ? 'secondary' : 'default'}>{PO_STATUS_LABEL[po.status] || po.status}</Badge></div>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">單據日期</span>
                  <div>{format(new Date(po.order_date), 'yyyy/MM/dd')}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">建立時間</span>
                  <div>{format(new Date(po.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}</div>
                </div>
                {po.received_date && (
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">收貨日期</span>
                    <div className="text-green-600">{format(new Date(po.received_date), 'yyyy/MM/dd')}</div>
                  </div>
                )}
                {po.expected_date && (
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">預期到貨</span>
                    <div>{format(new Date(po.expected_date), 'yyyy/MM/dd')}</div>
                  </div>
                )}
              </div>

              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>產品名稱</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">已收</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                      <TableHead className="text-right">總額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.variant?.sku || item.product?.code || '-'}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{item.product?.name || '-'}</p>
                          {item.variant?.name && <p className="text-xs text-muted-foreground">{item.variant.name}</p>}
                        </TableCell>
                        <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          <span className={item.received_quantity >= item.quantity ? 'text-green-600 font-bold' : 'text-orange-600'}>
                            {item.received_quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(item.unit_cost)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(item.quantity * item.unit_cost)}</TableCell>
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground italic">無品項</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end items-baseline gap-2 pt-2">
                <span className="text-sm text-muted-foreground">總計</span>
                <span className="text-xl font-bold text-primary">{formatCurrency(totalAmount)}</span>
              </div>

              {po.notes && (
                <div className="bg-amber-50/50 border border-amber-100 p-3 rounded-md text-sm">
                  <span className="text-amber-800 font-medium mb-1 block">備註：</span>
                  <p className="text-amber-900">{po.notes}</p>
                </div>
              )}

              <button
                className="text-xs text-muted-foreground underline"
                onClick={() => setShowRaw(v => !v)}
              >
                {showRaw ? '隱藏原始資料' : '顯示原始資料'}
              </button>
              {showRaw && (
                <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-auto max-h-60">{JSON.stringify(po, null, 2)}</pre>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
