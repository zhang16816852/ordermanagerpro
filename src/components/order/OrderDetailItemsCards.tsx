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

interface OrderItemsCardsProps {
    items: OrderItem[];
}

export function OrderDetailItemsCards({ items }: OrderItemsCardsProps) {
    return (
        <div className="md:hidden w-full flex flex-col gap-2 overflow-y-auto ">
            {items.map((item) => (
                <Card key={item.id} className="rounded-2xl w-full">
                    <CardContent className="p-2 space-y-3 text-sm">
                        <div className="font-medium min-w-0">
                            <span className="block text-muted-foreground ml-1 break-all">
                                {item.product_variants?.name || item.products?.name}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 min-w-0">
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
    );
}
