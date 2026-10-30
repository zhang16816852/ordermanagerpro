// 成本配對狀態中文對照
export const COST_MATCH_STATUS_LABELS: Record<string, string> = {
    // inventory_movements 層級
    confirmed: '已確認',
    pending_match: '待配對',
    matched: '已配對',
    unmatched: '無法配對',
    reversed: '已回滾',
    // order_items 層級
    estimated: '估算中',
    fifo_confirmed: '已確認',
    fifo_partial: '部分配對',
    fifo_pending: '待配對',
};

export const COST_MATCH_STATUS_COLORS: Record<string, string> = {
    confirmed: 'text-emerald-600 border-emerald-200',
    pending_match: 'text-amber-600 border-amber-200',
    matched: 'text-blue-600 border-blue-200',
    unmatched: 'text-rose-600 border-rose-200',
    reversed: 'text-muted-foreground',
    estimated: 'text-muted-foreground',
    fifo_confirmed: 'text-emerald-600 border-emerald-200',
    fifo_partial: 'text-blue-600 border-blue-200',
    fifo_pending: 'text-amber-600 border-amber-200',
};

export function costMatchLabel(status: string | null | undefined): string {
    if (!status) return '-';
    return COST_MATCH_STATUS_LABELS[status] || status;
}

export function costMatchColor(status: string | null | undefined): string {
    if (!status) return 'text-muted-foreground';
    return COST_MATCH_STATUS_COLORS[status] || 'text-muted-foreground';
}