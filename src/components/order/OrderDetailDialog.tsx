import { useState, useMemo } from 'react';
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
            <DialogContent className="max-w-1xl max-h-[85vh] md:max-h-[70vh] flex flex-col">
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
                    <OrderDetailItemsTable items={sortedOrderItems} costByItem={costByItem} />

                    {/* Order Items - Mobile Cards */}
                    <OrderDetailItemsCards items={sortedOrderItems} costByItem={costByItem} />

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
