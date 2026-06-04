import { formatSpecValue } from '@/utils/specLogic';
import { ImportRow } from '../../hooks/useProductImport';

interface SpecsCellProps {
    row: ImportRow;
    specDefs?: { id: string; name: string }[];
}

export function SpecsCell({ row, specDefs = [] }: SpecsCellProps) {
    const specsText = row._specs && Object.keys(row._specs).length > 0
        ? Object.entries(row._specs).map(([key, val]) => {
            const [, specId] = key.split(':');
            const def = specDefs.find(d => d.id === specId);
            return `${def?.name || specId}: ${val}`;
        }).join(', ')
        : (row.spec_values ? formatSpecValue(row.spec_values) : '-');

    return (
        <div
            className="text-[9px] font-medium text-muted-foreground truncate max-w-[130px]"
            title={specsText}
        >
            {specsText}
        </div>
    );
}
