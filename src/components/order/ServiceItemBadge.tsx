import { Badge } from '@/components/ui/badge';
import type { OrderItemRow } from './orderItemsTypes';

export function ServiceItemBadge({ item }: { item: OrderItemRow }) {
    if (item.itemType === 'shipping') {
        return (
            <Badge variant="secondary" className="ml-2 bg-orange-50 text-orange-700 border-orange-200">
                運費{item.shippingPayment === 'monthly' ? '・月結' : ''}
            </Badge>
        );
    }
    if (item.itemType === 'packaging') {
        return (
            <Badge variant="secondary" className="ml-2 bg-sky-50 text-sky-700 border-sky-200">包裝</Badge>
        );
    }
    if (item.parentTempKey) {
        return <Badge variant="outline" className="ml-2 text-muted-foreground">加購</Badge>;
    }
    return null;
}