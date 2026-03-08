import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, Pencil, Package, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { OrderStatusBadge } from './OrderStatusBadge';

interface OrderWithItems {
    id: string;
    code?: string;
    created_at: string;
    status: 'pending' | 'processing' | 'shipped';
    notes: string | null;
    order_items: {
        id: string;
        quantity: number;
        shipped_quantity: number;
        unit_price: number;
        status: string;
        product: { name: string; sku: string } | null;
        product_variant: { name: string } | null;
    }[];
}

interface OrdersCardViewProps {
    orders: OrderWithItems[] | undefined;
    isLoading: boolean;
    onView: (order: OrderWithItems) => void;
    onEdit: (orderId: string) => void;
    getOrderShipmentStatus: (items: OrderWithItems['order_items']) => string;
    getOrderTotal: (items: OrderWithItems['order_items']) => number;
}

export function OrdersCardView({
    orders,
    isLoading,
    onView,
    onEdit,
    getOrderShipmentStatus,
    getOrderTotal,
}: OrdersCardViewProps) {
    return (
        <div className="md:hidden flex-1 overflow-y-auto space-y-3 pr-1">
            {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 w-full rounded-xl" />
                ))
            ) : orders?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    沒有找到訂單
                </div>
            ) : (
                orders?.map((order) => {
                    const itemStatus = getOrderShipmentStatus(order.order_items);
                    const canEdit = order.status === 'pending';
                    return (
                        <Card key={order.id} className="rounded-xl shadow-sm">
                            <CardContent className="p-4 space-y-3">
                                {/* 頂部：編號與操作 */}
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1">
                                        <div className="text-xs font-mono text-muted-foreground">#{order.code || order.id.slice(0, 8)}</div>
                                        <OrderStatusBadge status={itemStatus} type="shipping" />
                                    </div>
                                    <div className="flex gap-1">
                                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onView(order)}>
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        {canEdit && (
                                            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onEdit(order.id)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {/* 中間：資訊 */}
                                <div className="grid grid-cols-2 gap-3 text-sm border-y py-3">
                                    <div className="flex items-center gap-2">
                                        <Package className="h-4 w-4 text-muted-foreground" />
                                        <span>品項: <span className="font-semibold">{order.order_items.length}</span></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Calendar className="h-4 w-4" />
                                        {format(new Date(order.created_at), 'MM/dd HH:mm', { locale: zhTW })}
                                    </div>
                                </div>

                                {/* 底部：金額 */}
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-muted-foreground">訂單金額</span>
                                    <span className="text-lg font-bold text-primary">${getOrderTotal(order.order_items).toFixed(2)}</span>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })
            )}
        </div>
    );
}
