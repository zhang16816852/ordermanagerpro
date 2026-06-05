import { Badge } from '@/components/ui/badge';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImportRow } from '../useProductImport';

interface RowStatusCellProps {
    row: ImportRow;
}

export function RowStatusCell({ row }: RowStatusCellProps) {
    if (!row.isValid) {
        return (
            <div className="bg-destructive/10 p-1 rounded-full inline-block">
                <AlertCircle className="h-3 w-3 text-destructive" />
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center gap-0.5">
            {row.action === 'create' ? (
                <Badge className="text-[9px] px-1 h-3.5 bg-emerald-500 hover:bg-emerald-600 scale-90">新增</Badge>
            ) : (!row.diff || row.diff.length === 0) ? (
                <Badge variant="outline" className="text-[9px] px-1 h-3.5 border-slate-300 text-slate-400 bg-slate-50 scale-90">
                    無變更 (跳過)
                </Badge>
            ) : (
                <Badge variant="outline" className="text-[9px] px-1 h-3.5 border-amber-500 text-amber-600 bg-amber-50 scale-90">
                    更新
                </Badge>
            )}
            <Badge variant="secondary" className={cn(
                "text-[8px] px-1 h-3.5 scale-90",
                row.is_variant ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-slate-50 text-slate-600 border-slate-200"
            )}>
                {row.is_variant ? '變體' : '主商品'}
            </Badge>
        </div>
    );
}
