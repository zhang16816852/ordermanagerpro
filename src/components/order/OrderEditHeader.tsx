import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';

interface OrderEditHeaderProps {
    orderId: string;
    statusLabel: string;
    statusClassName: string;
    onBack: () => void;
}

export function OrderEditHeader({
    orderId,
    statusLabel,
    statusClassName,
    onBack,
}: OrderEditHeaderProps) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    返回
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">編輯訂單</h1>
                    <p className="text-muted-foreground font-mono text-sm">{orderId}</p>
                </div>
            </div>
            <Badge className={statusClassName}>{statusLabel}</Badge>
        </div>
    );
}
