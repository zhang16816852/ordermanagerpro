import { Card, CardContent } from '@/components/ui/card';
import { OrderStatusBadge } from './OrderStatusBadge';
import { LineTypeBadge } from './LineTypeBadge';
import { OrderItem } from '@/types/order';
import { formatCurrency } from '@/lib/formatters';

interface OrderItemsCardsProps {
    items: OrderItem[];
    /** 品項成本（id → 成本）。未傳則不顯示「成本」。成本未知以 costKnown=false 標示。 */
    costByItem?: Map<string, { unitCost: number | null; costKnown: boolean }>;
}

export function OrderDetailItemsCards({ items, costByItem }: OrderItemsCardsProps) {
    const sortedItems = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return (
        <div className="md:hidden w-full flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto ">
            {sortedItems.map((item) => (
                <Card key={item.id} className="rounded-2xl w-full">
                    <CardContent className="p-2 space-y-3 text-sm">
                        <div className="font-medium min-w-0">
                            <span className="block text-muted-foreground ml-1 break-all">
                                {item.product_variant?.name || item.product?.name}
                            </span>
                            <span className="inline-flex items-center mt-0.5">
                                <LineTypeBadge
                                    row={{
                                        lineType: item.line_type ?? 'sale',
                                        isRepair: item.is_repair ?? false,
                                        returnStatus: item.return_status ?? null,
                                    }}
                                />
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 min-w-0">
                            <div>
                                <span className="text-muted-foreground">單價：</span>
                                {formatCurrency(item.unit_price)}
                            </div>

                            {costByItem && (
                                <div>
                                    <span className="text-muted-foreground">成本：</span>
                                    {costByItem.get(item.id)?.costKnown === false ? (
                                        <span className="text-amber-600">成本未知</span>
                                    ) : (
                                        formatCurrency(costByItem.get(item.id)?.unitCost ?? 0)
                                    )}
                                </div>
                            )}

                            <div>
                                <span className="text-muted-foreground">數量：</span>
                                {(item.line_type ?? 'sale') === 'return' ? -item.quantity : item.quantity}
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
    );
}
