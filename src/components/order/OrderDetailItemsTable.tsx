import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderItem } from '@/types/order';
import { formatCurrency } from '@/lib/formatters';

interface OrderItemsTableProps {
    items: OrderItem[];
}

export function OrderDetailItemsTable({ items }: OrderItemsTableProps) {
    const sortedItems = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return (
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
                    {sortedItems.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell>
                                {item.product_variant?.name || item.product?.name}
                            </TableCell>
                            <TableCell className="text-right">
                                {formatCurrency(item.unit_price)}
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
    );
}
