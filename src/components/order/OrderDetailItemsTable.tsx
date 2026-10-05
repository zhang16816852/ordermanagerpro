import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { OrderStatusBadge } from './OrderStatusBadge';
import { LineTypeBadge } from './LineTypeBadge';
import { OrderItem } from '@/types/order';
import { formatCurrency } from '@/lib/formatters';

interface OrderItemsTableProps {
    items: OrderItem[];
    /** 品項成本（id → 成本）。未傳則不顯示「成本」欄。成本未知以 costKnown=false 標示。 */
    costByItem?: Map<string, { unitCost: number | null; costKnown: boolean }>;
}

export function OrderDetailItemsTable({ items, costByItem }: OrderItemsTableProps) {
    const sortedItems = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const showCost = !!costByItem;
    return (
        <div className="hidden md:block border rounded-lg flex-1 min-h-0 overflow-y-auto">
            <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">產品名稱</TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">單價</TableHead>
                        {showCost && (
                            <TableHead className="sticky top-0 bg-muted/50 z-10 text-right">成本</TableHead>
                        )}
                        <TableHead className="sticky top-0 bg-muted/50 z-10">數量</TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">已出貨</TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">狀態</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedItems.map((item) => {
                        const cost = costByItem?.get(item.id);
                        return (
                        <TableRow key={item.id}>
                            <TableCell>
                                <span className="inline-flex items-center">
                                    {item.product_variant?.name || item.product?.name}
                                    <LineTypeBadge
                                        row={{
                                            lineType: item.line_type ?? 'sale',
                                            isRepair: item.is_repair ?? false,
                                            returnStatus: item.return_status ?? null,
                                        }}
                                    />
                                </span>
                            </TableCell>
                            <TableCell className="text-right">
                                {formatCurrency(item.unit_price)}
                            </TableCell>
                            {showCost && (
                                <TableCell className="text-right">
                                    {cost?.costKnown === false ? (
                                        <span
                                            className="text-amber-600"
                                            title="尚未建立成本資料，請於採購單或商品成本補登"
                                        >
                                            成本未知
                                        </span>
                                    ) : (
                                        formatCurrency(cost?.unitCost ?? 0)
                                    )}
                                </TableCell>
                            )}
                            <TableCell className="text-right">
                                {(item.line_type ?? 'sale') === 'return' ? -item.quantity : item.quantity}
                            </TableCell>
                            <TableCell className="text-right">
                                {item.shipped_quantity}
                            </TableCell>
                            <TableCell>
                                <OrderStatusBadge status={item.status} type="shipping" />
                            </TableCell>
                        </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
