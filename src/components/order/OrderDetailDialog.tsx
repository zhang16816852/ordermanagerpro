import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { OrderInfo } from './OrderInfo';
import { OrderDetailItemsTable } from './OrderDetailItemsTable';
import { OrderDetailItemsCards } from './OrderDetailItemsCards';
import { Order } from '@/types/order';
import { Check, Share2, Trash2, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { useRepCommission } from '@/hooks/useRepCommission';
import { useRepStoreAssignments } from '@/hooks/useRepStoreAssignments';
import { useBusinessProfitCalculator, businessProfitSummary } from '@/hooks/useBusinessProfit';
import { useDocumentProfit, type DocProfitInputItem } from '@/hooks/useDocumentProfit';
import { sumProfit } from '@/utils/grossProfit';
import { ProfitCell } from '@/components/shared/ProfitCell';
import { ParcelManager } from '@/components/shipping/ParcelManager';
import { supabase } from '@/integrations/supabase/client';


interface OrderDetailDialogProps {
    order: Order | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleteOrder?: (orderId: string) => void;
    onProcessReturns?: () => void;
    onRevertReturns?: () => void;
    parcelEditable?: boolean;
}

export function OrderDetailDialog({ order, open, onOpenChange, onDeleteOrder, onProcessReturns, onRevertReturns, parcelEditable = false }: OrderDetailDialogProps) {
    const [isCopied, setIsCopied] = useState(false);
    const { isRep, computeOrder } = useRepCommission();

    const sortedOrderItems = useMemo(() =>
        [...(order?.order_items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        [order?.order_items]
    );

    const hasPendingReturns = (order?.order_items ?? []).some(
        (item) => item.line_type === 'return' && item.return_status === 'pending'
    );

    // 撤銷退貨適用於「任何」退貨列（含已退庫存的誤標），故不限定 pending
    const hasAnyReturns = (order?.order_items ?? []).some(
        (item) => item.line_type === 'return'
    );

    // 業務身分：維持既有（業務利潤／估佣）；非業務身分：有業務門市看業務利潤，無業務門市看毛利
    const { assignments, isRepStore } = useRepStoreAssignments();
    const { calcForStore, costOf } = useBusinessProfitCalculator(assignments.map((a) => a.rep_id));

    const detailProfitInput = useMemo<DocProfitInputItem[]>(() =>
        (order?.order_items ?? []).map((item) => {
            const isReturn = item.line_type === 'return';
            return {
                key: `${order?.id ?? 'order'}:${item.id}`,
                productId: item.product_id,
                variantId: item.variant_id ?? null,
                quantity: isReturn ? -(item.quantity || 0) : item.quantity || 0,
                unitPrice: item.unit_price || 0,
                snapshotCost: item.unit_cost ?? null,
                lineType: item.line_type ?? null,
            };
        }),
    [order?.id, order?.order_items]);

    const detailDocProfit = useDocumentProfit(detailProfitInput);

    // 採購綁定：查詢此訂單已被哪些採購單品項採購（source_order_ids 含本訂單 id）
    const { data: poBindings = [] } = useQuery({
      queryKey: ['order-po-bindings', order?.id],
      queryFn: async () => {
        if (!order?.id) return [];
        const { data, error } = await (supabase as any)
          .from('purchase_order_items')
          .select(`
            id, source_order_ids, source_quantities, quantity, received_quantity, product_id, variant_id,
            purchase_orders (supplier_order_number, status)
          `)
          .contains('source_order_ids', [order.id]);
        if (error) throw error;
        return (data || []) as {
          id: string;
          source_order_ids: string[] | null;
          source_quantities: Record<string, number> | null;
          quantity: number;
          received_quantity: number;
          product_id: string | null;
          variant_id: string | null;
          purchase_orders?: { supplier_order_number: string | null; status: string | null } | null;
        }[];
      },
      enabled: !!order?.id,
    });

    // 每個 order_item 的採購狀態：key = order_item.id
    const poBindByItem = useMemo(() => {
      const map = new Map<string, {
        poCode: string | null;
        poStatus: string | null;
        purchasedQty: number;
        receivedQty: number;
        status: 'none' | 'covered' | 'partial' | 'over' | 'stock';
      }>();
      if (!order) return map;
      for (const item of order.order_items) {
        const poCodeList: string[] = [];
        let purchasedQty = 0;
        let receivedQty = 0;
        let over = false;
        for (const poi of poBindings) {
          // ⚠️ 必須匹配 product_id + variant_id，否則會把所有 PO 都歸屬到所有品項
          if (poi.product_id !== item.product_id) continue;
          if ((poi.variant_id || null) !== (item.variant_id || null)) continue;
          const sq = poi.source_quantities || {};
          const qtyForThisOrder = Number(sq[order.id!] || 0);
          if (qtyForThisOrder > 0) {
            const po = Array.isArray(poi.purchase_orders) ? poi.purchase_orders?.[0] : poi.purchase_orders;
            poCodeList.push(po?.supplier_order_number || poi.id.slice(0, 8));
            purchasedQty += qtyForThisOrder;
            receivedQty += poi.received_quantity || 0;
          }
          // 該採購單品項總採購量超過 PO 品項數量＝超量
          const sqTotal = Object.values(sq).reduce((s, v) => s + Number(v || 0), 0);
          if (sqTotal > (poi.quantity || 0)) over = true;
        }
        const pending = Math.max(0, item.quantity - (item.shipped_quantity || 0));
        let status: 'none' | 'covered' | 'partial' | 'over' | 'stock' = 'none';
        if (over) status = 'over';
        else if (purchasedQty <= 0) status = 'none';
        else if (purchasedQty >= pending) status = 'covered';
        else if (purchasedQty > 0) status = 'partial';
        map.set(item.id, {
          poCode: poCodeList.join('、') || null,
          poStatus: poBindings.length > 0 ? (Array.isArray(poBindings[0].purchase_orders) ? poBindings[0].purchase_orders?.[0]?.status : poBindings[0].purchase_orders?.status) : null,
          purchasedQty,
          receivedQty,
          status,
        });
      }
      return map;
    }, [order, poBindings]);

    const storeProfit = useMemo(() => {
        if (!order) return null;
        const lines: DocProfitInputItem[] = [];
        void lines;
        const grossLines = detailProfitInput
            .map((row) => detailDocProfit.byKey.get(row.key))
            .filter((l): l is NonNullable<typeof l> => !!l);
        const gross = grossLines.length > 0 ? sumProfit(grossLines) : null;
        const biz = calcForStore(
            order.store_id,
            detailProfitInput.map((r) => ({
                productId: r.productId,
                variantId: r.variantId,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
                snapshotCost: r.snapshotCost,
                lineType: r.lineType,
            }))
        );
        if (biz) return { mode: 'business' as const, summary: businessProfitSummary(gross?.revenue ?? 0, biz), biz };
        return { mode: 'gross' as const, summary: gross, biz: null };
    }, [order, detailProfitInput, detailDocProfit.byKey, calcForStore]);

    // 品項成本：業務身分維持空（業務利潤由 repSummary 顯示）；其餘依單據口徑（業務門市用業務口徑）
    const costByItem = useMemo(() => {
        if (!order || isRep) return undefined;
        const map = new Map<string, { unitCost: number | null; costKnown: boolean }>();
        const biz = isRepStore(order.store_id);
        for (const row of detailProfitInput) {
            const itemId = row.key.slice(row.key.lastIndexOf(':') + 1);
            const line = detailDocProfit.byKey.get(row.key);
            if (biz) {
                const resolved = costOf(order.store_id, {
                    productId: row.productId,
                    variantId: row.variantId,
                    quantity: row.quantity,
                    unitPrice: row.unitPrice,
                    snapshotCost: row.snapshotCost,
                    lineType: row.lineType,
                });
                map.set(itemId, { unitCost: resolved.unitCost, costKnown: resolved.costKnown });
            } else {
                map.set(itemId, { unitCost: line?.cost ?? null, costKnown: line?.costKnown ?? false });
            }
        }
        return map;
    }, [order, isRep, isRepStore, detailProfitInput, detailDocProfit.byKey, costOf]);



    if (!order) return null;

    const getTotalAmount = () =>
        order.order_items.reduce(
            (sum, item) =>
                sum + (item.line_type === 'return' ? -1 : 1) * item.quantity * item.unit_price,
            (order.shipping_fee ?? 0)
        );

    const repSummary = isRep
        ? computeOrder(order.order_items.map(i => ({
            productId: i.product_id,
            variantId: i.variant_id,
            unitPrice: i.unit_price,
            quantity: i.quantity,
            lineType: i.line_type,
          })))
        : null;

    const formattedDate = format(new Date(order.created_at), 'yyyy/MM/dd HH:mm', {
        locale: zhTW,
    });

    const getShareLink = () => {
        if (!order.access_token) return '';
        return `${window.location.origin}/share/order/${order.code || order.id}?token=${order.access_token}`;
    };

    const copyShareLink = () => {
        const link = getShareLink();
        if (!link) {
            toast.error('此訂單無分享連結');
            return;
        }
        navigator.clipboard.writeText(link);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
        toast.success('分享連結已複製');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[85vh] md:max-h-[70vh] flex flex-col">
                <DialogHeader>
                    <div className="flex items-center justify-between pr-6">
                        <div>
                            <DialogTitle>訂單詳情</DialogTitle>
                            <DialogDescription>
                                檢視此銷售訂單的摘要、購買品項清單及總計金額。
                            </DialogDescription>
                        </div>
                        {order.access_token && (
                            <Button variant="outline" size="sm" onClick={copyShareLink}>
                                {isCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4 mr-1" />}
                                {isCopied ? '已複製' : '分享'}
                            </Button>
                        )}
                        {onProcessReturns && hasPendingReturns && (
                            <Button variant="outline" size="sm" onClick={onProcessReturns}>
                                <RotateCcw className="h-4 w-4 mr-1" />
                                處理退貨
                            </Button>
                        )}
                        {onRevertReturns && hasAnyReturns && (
                            <Button variant="outline" size="sm" onClick={onRevertReturns}>
                                <Undo2 className="h-4 w-4 mr-1" />
                                撤銷退貨
                            </Button>
                        )}
                        {onDeleteOrder && (
                            <Button variant="destructive" size="sm" onClick={() => onDeleteOrder(order.id)}>
                                <Trash2 className="h-4 w-4 mr-1" />
                                刪除訂單
                            </Button>
                        )}
                    </div>
                </DialogHeader>

                <div className="flex flex-col flex-1 min-h-0 gap-2 ">
                    {/* Order Basic Info */}
                    <OrderInfo
                        orderId={order.code || order.id}
                        storeName={order.stores?.name}
                        createdAt={formattedDate}
                        sourceType={order.source_type}
                        notes={order.notes}
                        consignmentMode={order.consignment_mode}
                    />

                    {/* Order Items - Desktop Table */}
                    <OrderDetailItemsTable items={sortedOrderItems} costByItem={costByItem} poBindByItem={poBindByItem} />

                    {/* Order Items - Mobile Cards */}
                    <OrderDetailItemsCards items={sortedOrderItems} costByItem={costByItem} poBindByItem={poBindByItem} />

                    {/* Shipping / Parcels */}
                    <div className="border-t pt-2 mt-1 space-y-2">
                        {(order.delivery_method_title || (order.shipping_fee ?? 0) > 0) && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">
                                    配送：{order.delivery_method_title || '未指定'}
                                </span>
                                <span>運費：{formatCurrency(order.shipping_fee ?? 0)}</span>
                            </div>
                        )}
                        <ParcelManager docType="order" docId={order.id} editable={parcelEditable} deliveryType={order.delivery_type} />
                    </div>

                    {/* Total Amount */}
                    <div className="flex justify-end text-lg font-semibold text-primary">
                        總計：{formatCurrency(getTotalAmount())}
                    </div>

                    {/* 利潤：業務身分看業務利潤／估佣；非業務身分「有業務門市看業務利潤、無業務門市看毛利」（互斥） */}
                    {isRep && repSummary ? (
                        <div className="flex justify-end gap-6 text-sm border-t pt-2 mt-1">
                            <span className="text-muted-foreground">
                                業務利潤：<span className="font-semibold text-emerald-600">{formatCurrency(repSummary.totalProfit)}</span>
                            </span>
                            <span className="text-muted-foreground">
                                估佣：<span className="font-semibold text-amber-600">{formatCurrency(repSummary.totalCommission)}</span>
                            </span>
                        </div>
                    ) : storeProfit?.summary ? (
                        <div className="flex justify-end text-sm border-t pt-2 mt-1">
                            <ProfitCell
                                summary={storeProfit.summary}
                                mode={storeProfit.mode}
                                commission={storeProfit.mode === 'business' ? storeProfit.biz?.commission ?? null : null}
                                repName={storeProfit.mode === 'business' ? storeProfit.biz?.repName ?? null : null}
                            />
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
