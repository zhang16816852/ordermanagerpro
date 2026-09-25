import { Badge } from '@/components/ui/badge';
import type { LineTypeOption, OrderItemRow } from './orderItemsTypes';

export const LINE_TYPE_OPTION_LABELS: Record<LineTypeOption, string> = {
    sale: '一般',
    exchange: '換貨',
    return: '退貨',
    repair: '送修',
};

export function lineTypeOf(row: Pick<OrderItemRow, 'lineType' | 'isRepair'>): LineTypeOption {
    if (row.lineType === 'return') return row.isRepair ? 'repair' : 'return';
    if (row.lineType === 'exchange') return 'exchange';
    return 'sale';
}

export function LineTypeBadge({ row }: { row: Pick<OrderItemRow, 'lineType' | 'isRepair' | 'returnStatus'> }) {
    const lt = lineTypeOf(row);
    if (lt === 'sale' || lt === 'exchange') {
        if (lt === 'exchange') {
            return <Badge variant="outline" className="ml-2 bg-sky-50 text-sky-700 border-sky-200">換貨</Badge>;
        }
        return null;
    }
    const statusLabel =
        row.returnStatus === 'stock' ? '已退庫存'
        : row.returnStatus === 'exchange' ? '已換貨'
        : row.returnStatus === 'repaired' ? '已送修歸還'
        : null;
    return (
        <Badge variant="outline"
            className={`ml-2 ${lt === 'repair' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
            {lt === 'repair' ? '送修' : '退貨'}{statusLabel ? `・${statusLabel}` : ''}
        </Badge>
    );
}

export function LineTypePicker({ row, index, onUpdate }: {
    row: Pick<OrderItemRow, 'lineType' | 'isRepair'>;
    index: number;
    onUpdate: (index: number, lineType: LineTypeOption) => void;
}) {
    const lt = lineTypeOf(row);
    return (
        <select
            value={lt}
            onChange={(e) => onUpdate(index, e.target.value as LineTypeOption)}
            onClick={(e) => e.stopPropagation()}
            className="ml-2 h-7 rounded-md border border-input bg-transparent px-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            title="打單性質"
        >
            {(Object.keys(LINE_TYPE_OPTION_LABELS) as LineTypeOption[]).map((opt) => (
                <option key={opt} value={opt}>{LINE_TYPE_OPTION_LABELS[opt]}</option>
            ))}
        </select>
    );
}