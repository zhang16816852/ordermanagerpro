import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusType = 'order' | 'product' | 'purchase' | 'accounting' | 'general';

interface StatusBadgeProps {
    status: string;
    type?: StatusType;
    className?: string;
}

const CONFIG: Record<StatusType, Record<string, { label: string, variant: string }>> = {
    order: {
        pending: { label: '未確認', variant: 'bg-amber-100 text-amber-700 border-amber-200' },
        processing: { label: '處理中', variant: 'bg-blue-100 text-blue-700 border-blue-200' },
        shipped: { label: '已出貨', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        cancelled: { label: '已取消', variant: 'bg-slate-100 text-slate-500 border-slate-200' },
    },
    product: {
        active: { label: '上架中', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        preorder: { label: '預購中', variant: 'bg-blue-100 text-blue-700 border-blue-200' },
        sold_out: { label: '已售完', variant: 'bg-orange-100 text-orange-700 border-orange-200' },
        discontinued: { label: '已停售', variant: 'bg-slate-100 text-slate-500 border-slate-200' },
    },
    purchase: {
        pending: { label: '待處理', variant: 'bg-amber-100 text-amber-700 border-amber-200' },
        processing: { label: '採購中', variant: 'bg-blue-100 text-blue-700 border-blue-200' },
        completed: { label: '已入庫', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    },
    accounting: {
        unpaid: { label: '未付款', variant: 'bg-rose-100 text-rose-700 border-rose-200' },
        paid: { label: '已付款', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        reconciled: { label: '已核銷', variant: 'bg-blue-100 text-blue-700 border-blue-200' },
    },
    general: {
        active: { label: '啟用', variant: 'bg-emerald-100 text-emerald-700' },
        inactive: { label: '停用', variant: 'bg-slate-100 text-slate-500' },
    }
};

export function StatusBadge({ status, type = 'general', className }: StatusBadgeProps) {
    const config = CONFIG[type][status] || { label: status, variant: 'bg-slate-100 text-slate-500' };

    return (
        <Badge
            variant="outline"
            className={cn(
                "px-2 py-0.5 font-normal text-[11px] border shadow-none transition-none",
                config.variant,
                className
            )}
        >
            {config.label}
        </Badge>
    );
}
