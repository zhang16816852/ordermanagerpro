import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { OrderStatusBadge } from './OrderStatusBadge';
import { Order, OrderItem } from '@/types/order';

interface OrdersTableViewProps {
    orders: Order[] | undefined;
    isLoading: boolean;
    onView: (order: Order) => void;
    onEdit: (orderId: string) => void;
    getOrderShipmentStatus: (items: OrderItem[]) => string;
    getOrderTotal: (items: OrderItem[]) => number;
}

export function OrdersTableView({
    orders,
    isLoading,
    onView,
    onEdit,
    getOrderShipmentStatus,
    getOrderTotal,
}: OrdersTableViewProps) {
    return (
        <div className="hidden md:block flex-1 overflow-hidden rounded-lg border bg-card shadow-soft">
            <Table containerClassName="h-full">
                <TableHeader>
                    <TableRow>
                        <TableHead>訂單編號</TableHead>
                        <TableHead>品項數</TableHead>
                        <TableHead className="text-right">金額</TableHead>
                        <TableHead>出貨狀態</TableHead>
                        <TableHead>建立時間</TableHead>
                        <TableHead className="w-24"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                <TableCell><Skeleton className="h-8 w-16" /></TableCell>
                            </TableRow>
                        ))
                    ) : orders?.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                沒有找到訂單
                            </TableCell>
                        </TableRow>
                    ) : (
                        orders?.map((order) => {
                            const itemStatus = getOrderShipmentStatus(order.order_items);
                            const canEdit = order.status === 'pending';
                            return (
                                <TableRow key={order.id}>
                                    <TableCell className="font-mono text-xs font-medium">
                                        {order.code || order.id.slice(0, 8)}
                                    </TableCell>
                                    <TableCell>{order.order_items.length}</TableCell>
                                    <TableCell className="text-right font-medium">
                                        ${getOrderTotal(order.order_items).toFixed(2)}
                                    </TableCell>
                                    <TableCell>
                                        <OrderStatusBadge status={itemStatus} type="shipping" />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {format(new Date(order.created_at), 'MM/dd HH:mm', { locale: zhTW })}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onView(order)}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            {canEdit && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onEdit(order.id)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
