import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface OrderItem {
    id: string;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    status: string;
    product: { name: string; sku: string } | null;
    product_variant: { name: string } | null;
    orderId: string;
    orderCreatedAt: string;
    orderStatus: string;
}

interface ItemsTableViewProps {
    items: OrderItem[];
    isLoading: boolean;
    statusLabels: Record<string, { label: string; className: string }>;
}

export function ItemsTableView({ items, isLoading, statusLabels }: ItemsTableViewProps) {
    return (
        <div className="hidden md:block flex-1 overflow-hidden rounded-lg border bg-card shadow-soft">
            <Table containerClassName="h-full">
                <TableHeader>
                    <TableRow>
                        <TableHead>產品名稱</TableHead>
                        <TableHead className="text-right">訂購</TableHead>
                        <TableHead className="text-right">已出貨</TableHead>
                        <TableHead className="text-right">待出貨</TableHead>
                        <TableHead>狀態</TableHead>
                        <TableHead>訂單日期</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            </TableRow>
                        ))
                    ) : items.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                沒有找到商品
                            </TableCell>
                        </TableRow>
                    ) : (
                        items.map((item) => {
                            const pending = item.quantity - item.shipped_quantity;
                            const itemStatusInfo = statusLabels[item.status];
                            return (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {item.product?.name}
                                        {item.product_variant && (
                                            <span className="text-muted-foreground ml-1">
                                                - {item.product_variant.name}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">{item.quantity}</TableCell>
                                    <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant={pending > 0 ? 'default' : 'secondary'}>{pending}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={itemStatusInfo.className} variant="secondary">
                                            {itemStatusInfo.label}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {format(new Date(item.orderCreatedAt), 'MM/dd', { locale: zhTW })}
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
