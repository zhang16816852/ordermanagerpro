import { Badge } from '@/components/ui/badge';

interface OrderStatusBadgeProps {
    status: string;
    type?: 'order' | 'shipping';
}

const ORDER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
    pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
    processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
    shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
};

const SHIPPING_STATUS_LABELS: Record<string, { label: string; className: string }> = {
    waiting: { label: '待出貨', className: 'bg-status-waiting text-warning-foreground' },
    partial: { label: '部分出貨', className: 'bg-status-partial text-primary-foreground' },
    shipped: { label: '已出貨', className: 'bg-status-shipped text-success-foreground' },
    out_of_stock: { label: '缺貨', className: 'bg-status-out-of-stock text-destructive-foreground' },
    discontinued: { label: '已停售', className: 'bg-status-discontinued text-muted-foreground' },
};

export function OrderStatusBadge({ status, type = 'shipping' }: OrderStatusBadgeProps) {
    const map = type === 'order' ? ORDER_STATUS_LABELS : SHIPPING_STATUS_LABELS;
    const config = map[status];

    if (!config) {
        return <Badge variant="outline">{status}</Badge>;
    }

    return (
        <Badge className={`${config.className} hover:${config.className}`}>
            {config.label}
        </Badge>
    );
}
