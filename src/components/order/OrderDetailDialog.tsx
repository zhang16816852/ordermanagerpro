import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { OrderInfo } from './OrderInfo';
import { OrderDetailItemsTable } from './OrderDetailItemsTable';
import { OrderDetailItemsCards } from './OrderDetailItemsCards';
import { Order } from '@/types/order';

interface OrderDetailDialogProps {
    order: Order | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OrderDetailDialog({ order, open, onOpenChange }: OrderDetailDialogProps) {
    if (!order) return null;

    const getTotalAmount = () =>
        order.order_items.reduce(
            (sum, item) => sum + item.quantity * item.unit_price,
            0
        );

    const formattedDate = format(new Date(order.created_at), 'yyyy/MM/dd HH:mm', {
        locale: zhTW,
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-1xl max-h-[70vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>訂單詳情</DialogTitle>
                    <DialogDescription>
                        檢視此銷售訂單的摘要、購買品項清單及總計金額。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col flex-1 min-h-0 gap-2 ">
                    {/* Order Basic Info */}
                    <OrderInfo
                        orderId={order.code || order.id}
                        storeName={order.stores?.name}
                        createdAt={formattedDate}
                        sourceType={order.source_type}
                        notes={order.notes}
                    />

                    {/* Order Items - Desktop Table */}
                    <OrderDetailItemsTable items={order.order_items} />

                    {/* Order Items - Mobile Cards */}
                    <OrderDetailItemsCards items={order.order_items} />

                    {/* Total Amount */}
                    <div className="flex justify-end text-lg font-semibold text-primary">
                        總計：${getTotalAmount().toFixed(2)}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
