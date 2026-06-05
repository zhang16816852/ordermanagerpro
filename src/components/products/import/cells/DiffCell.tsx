import { Badge } from '@/components/ui/badge';
import { ImportRow } from '../useProductImport';

interface DiffCellProps {
    row: ImportRow;
}

export function DiffCell({ row }: DiffCellProps) {
    if (row.action === 'update' && row.diff && row.diff.length > 0) {
        return (
            <div className="flex flex-wrap gap-0.5 max-w-[90px]">
                {row.diff.map(field => (
                    <Badge key={field} variant="outline" className="text-[8px] px-1 h-3 bg-amber-500/5 border-amber-500/20 text-amber-700 whitespace-nowrap">
                        {field}
                    </Badge>
                ))}
            </div>
        );
    }
    return <span className="text-[9px] text-muted-foreground/30 pl-2">-</span>;
}
