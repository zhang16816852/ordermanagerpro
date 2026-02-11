import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { OrderStatusBadge } from './OrderStatusBadge';

interface OrderItem {
    id: string;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    status: string;
    products: { name: string; sku: string } | null;
    product_variants: { name: string } | null;
}

interface OrderDetail {
    id: string;
    created_at: string;
    source_type?: 'frontend' | 'admin_proxy';
    status: string;
    notes: string | null;
    stores?: { name: string; code: string | null } | null;
    order_items: OrderItem[];
}

interface OrderDetailDialogProps {
    order: OrderDetail | null;
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>訂單詳情</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col flex-1 min-h-0 gap-4">
                    {/* Order Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground mr-2">訂單編號：</span>
                            <span className="font-mono">{order.id}</span>
                        </div>

                        {order.stores && (
                            <div>
                                <span className="text-muted-foreground mr-2">店鋪：</span>
                                <span>{order.stores.name}</span>
                            </div>
                        )}

                        <div>
                            <span className="text-muted-foreground mr-2">建立時間：</span>
                            <span>
                                {format(new Date(order.created_at), 'yyyy/MM/dd HH:mm', {
                                    locale: zhTW,
                                })}
                            </span>
                        </div>

                        {order.source_type && (
                            <div>
                                <span className="text-muted-foreground mr-2">來源：</span>
                                <span>
                                    {order.source_type === 'frontend'
                                        ? '前台訂單'
                                        : '後台代訂'}
                                </span>
                            </div>
                        )}
                    </div>

                    {order.notes && (
                        <div className="text-sm border-l-2 pl-3 py-1 bg-muted/20">
                            <span className="text-muted-foreground mr-2">備註：</span>
                            <span>{order.notes}</span>
                        </div>
                    )}

                    {/* Desktop Table */}
                    <div className="hidden md:block border rounded-lg flex-1 min-h-0 overflow-y-auto">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="sticky top-0 bg-muted/50 z-10">產品名稱</TableHead>
                                    <TableHead className="sticky top-0 bg-muted/50 z-10">單價</TableHead>
                                    <TableHead className="sticky top-0 bg-muted/50 z-10">數量</TableHead>
                                    <TableHead className="sticky top-0 bg-muted/50 z-10">已出貨</TableHead>
                                    <TableHead className="sticky top-0 bg-muted/50 z-10">狀態</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {order.order_items.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            {item.products?.name}
                                            {item.product_variants && (
                                                <span className="text-muted-foreground ml-1">
                                                    - {item.product_variants.name}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            ${item.unit_price.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right">{item.quantity}</TableCell>
                                        <TableCell className="text-right">
                                            {item.shipped_quantity}
                                        </TableCell>
                                        <TableCell>
                                            <OrderStatusBadge status={item.status} type="shipping" />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden flex flex-col gap-3 overflow-y-auto">
                        {order.order_items.map((item) => (
                            <Card key={item.id} className="rounded-2xl">
                                <CardContent className="p-4 space-y-2 text-sm">
                                    <div className="font-medium">
                                        {item.products?.name}
                                        {item.product_variants && (
                                            <span className="text-muted-foreground ml-1">
                                                - {item.product_variants.name}
                                            </span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="text-muted-foreground">單價：</span>
                                            ${item.unit_price.toFixed(2)}
                                        </div>

                                        <div>
                                            <span className="text-muted-foreground">數量：</span>
                                            {item.quantity}
                                        </div>

                                        <div>
                                            <span className="text-muted-foreground">已出貨：</span>
                                            {item.shipped_quantity}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">狀態：</span>
                                            <OrderStatusBadge status={item.status} type="shipping" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="flex justify-end text-lg font-semibold text-primary">
                        總計：${getTotalAmount().toFixed(2)}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
