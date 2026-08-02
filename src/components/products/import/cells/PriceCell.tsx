import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ImportRow } from '../useProductImport';

interface PriceCellProps {
    row: ImportRow;
    index: number;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
}

export function PriceCell({ row, index, onUpdate }: PriceCellProps) {
    const wholesaleKey = 'variant_wholesale_price' as const;
    const retailKey = 'variant_retail_price' as const;

    const wholesaleValue = row.variant_wholesale_price ?? 0;
    const retailValue = row.variant_retail_price ?? 0;

    return (
        <div className="flex flex-col items-end gap-0.5">
            <div className="flex gap-1 items-center justify-end">
                <div className="flex flex-col items-end">
                    <span className="text-[7px] text-muted-foreground/50 leading-none">批發</span>
                    <Input
                        type="number"
                        value={wholesaleValue}
                        onChange={(e) => onUpdate(index, wholesaleKey, parseFloat(e.target.value) || 0)}
                        className={cn(
                            "h-6 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent",
                            (row.diff?.includes('批發價') || row.diff?.includes('變體批發價')) && "bg-amber-500/20 text-amber-900"
                        )}
                    />
                </div>
                <div className="flex flex-col items-end border-l pl-1 ml-1 border-muted/30">
                    <span className="text-[7px] text-muted-foreground/50 leading-none">零售</span>
                    <Input
                        type="number"
                        value={retailValue}
                        onChange={(e) => onUpdate(index, retailKey, parseFloat(e.target.value) || 0)}
                        className={cn(
                            "h-6 w-14 text-[10px] text-right p-1 border-dotted border-b border-t-0 border-x-0 rounded-none bg-transparent font-bold",
                            (row.diff?.includes('零售價') || row.diff?.includes('變體零售價')) && "bg-amber-500/20 text-amber-900"
                        )}
                    />
                </div>
            </div>
            <span className="text-[7px] text-muted-foreground/40 italic">定價</span>
        </div>
    );
}
