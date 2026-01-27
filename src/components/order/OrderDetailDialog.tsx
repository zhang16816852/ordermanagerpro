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
import { Badge } from '@/components/ui/badge';
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
    stores?: { name: string; code: string | null } | null; // For Admin
    order_items: OrderItem[];
}

interface OrderDetailDialogProps {
    order: OrderDetail | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OrderDetailDialog({ order, open, onOpenChange }: OrderDetailDialogProps) {
    if (!order) return null;

    const getTotalAmount = () => {
        return order.order_items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>訂單詳情</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Order Info */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
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
                                <span>{order.source_type === 'frontend' ? '前台訂單' : '後台代訂'}</span>
                            </div>
                        )}
                    </div>

                    {order.notes && (
                        <div className="text-sm border-l-2 pl-3 py-1 bg-muted/20">
                            <span className="text-muted-foreground mr-2">備註：</span>
                            <span>{order.notes}</span>
                        </div>
                    )}

                    {/* Items Table */}
                    <div className="border rounded-lg overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>產品名稱</TableHead>
                                    <TableHead className="text-right">單價</TableHead>
                                    <TableHead className="text-right">數量</TableHead>
                                    <TableHead className="text-right">已出貨</TableHead>
                                    <TableHead>狀態</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {order.order_items.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-mono text-sm">
                                            {item.products?.sku}
                                        </TableCell>
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
                                        <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                                        <TableCell>
                                            <OrderStatusBadge status={item.status} type="shipping" />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex justify-end text-lg font-semibold text-primary">
                        總計：${getTotalAmount().toFixed(2)}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
