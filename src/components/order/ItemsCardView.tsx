import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { FlatOrderItem } from '@/types/order';
interface ItemsCardViewProps {
    items: FlatOrderItem[];
    isLoading: boolean;
    statusLabels: Record<string, { label: string; className: string }>;
}

export function ItemsCardView({ items, isLoading, statusLabels }: ItemsCardViewProps) {
    console.log(items)
    return (
        <div className="md:hidden flex-1 overflow-y-auto space-y-3 pr-1">
            {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-28 w-full rounded-xl" />
                ))
            ) : items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    沒有找到商品
                </div>
            ) : (
                items.map((item) => {
                    const pending = item.quantity - item.shipped_quantity;
                    const itemStatusInfo = statusLabels[item.status];
                    return (
                        <Card key={item.id} className="rounded-xl shadow-sm">
                            <CardContent className="p-4 space-y-4">

                                {/* 上排：商品 + 右上資訊 */}
                                <div className="flex justify-between items-start gap-2">

                                    {/* 商品資訊 */}
                                    <div className="flex-1">
                                        <div className="font-semibold text-base leading-snug">
                                            {item.product_variant?.name || item.product?.name}
                                        </div>
                                    </div>


                                    {/* 右上角：日期 + 待出貨 */}
                                    <div className="flex flex-col items-end gap-1">

                                        <span className="text-xs text-muted-foreground">
                                            {format(new Date(item.orderCreatedAt), 'MM/dd', { locale: zhTW })}
                                        </span>
                                        {/* 狀態 */}
                                        <Badge
                                            variant={pending > 0 ? "default" : "secondary"}
                                            className="text-xs"
                                        >
                                            待出貨 {pending}
                                        </Badge>

                                    </div>
                                </div>

                                {/* 數量資訊 */}
                                <div className="grid grid-cols-2 gap-3 text-sm">

                                    <div>
                                        <div className="text-muted-foreground">訂購</div>
                                        <div className="font-semibold text-base">
                                            {item.quantity}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-muted-foreground">已出貨</div>
                                        <div className="font-semibold text-base">
                                            {item.shipped_quantity}
                                        </div>
                                    </div>

                                </div>
                            </CardContent>

                        </Card>
                    );
                })
            )}
        </div>
    );
}
