import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { OrderStatusBadge } from './OrderStatusBadge';

interface OrderItem {
    id: string;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    status: string;
    product: { name: string; sku: string } | null;
    product_variant: { name: string } | null;
}

interface OrderItemsTableProps {
    items: OrderItem[];
}

export function OrderDetailItemsTable({ items }: OrderItemsTableProps) {
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
                    {items.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell>
                                {item.product?.name}
                                {item.product_variant && (
                                    <span className="text-muted-foreground ml-1">
                                        - {item.product_variant.name}
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
    );
}
