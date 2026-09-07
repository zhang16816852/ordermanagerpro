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
import { Check, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { useRepCommission } from '@/hooks/useRepCommission';

interface OrderDetailDialogProps {
    order: Order | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleteOrder?: (orderId: string) => void;
}

export function OrderDetailDialog({ order, open, onOpenChange, onDeleteOrder }: OrderDetailDialogProps) {
    const [isCopied, setIsCopied] = useState(false);
    const { isRep, computeOrder } = useRepCommission();

    const sortedOrderItems = useMemo(() =>
        [...(order?.order_items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        [order?.order_items]
    );

    if (!order) return null;

    const getTotalAmount = () =>
        order.order_items.reduce(
            (sum, item) => sum + item.quantity * item.unit_price,
            0
        );

    const repSummary = isRep
        ? computeOrder(order.order_items.map(i => ({
            productId: i.product_id,
            variantId: i.variant_id,
            unitPrice: i.unit_price,
            quantity: i.quantity,
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
                    <OrderDetailItemsTable items={sortedOrderItems} />

                    {/* Order Items - Mobile Cards */}
                    <OrderDetailItemsCards items={sortedOrderItems} />

                    {/* Total Amount */}
                    <div className="flex justify-end text-lg font-semibold text-primary">
                        總計：{formatCurrency(getTotalAmount())}
                    </div>

                    {/* 業務利潤 / 佣金 */}
                    {repSummary && (
                        <div className="flex justify-end gap-6 text-sm border-t pt-2 mt-1">
                            <span className="text-muted-foreground">
                                業務利潤：<span className="font-semibold text-emerald-600">{formatCurrency(repSummary.totalProfit)}</span>
                            </span>
                            <span className="text-muted-foreground">
                                估佣：<span className="font-semibold text-amber-600">{formatCurrency(repSummary.totalCommission)}</span>
                            </span>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
