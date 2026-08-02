import { ImportRow } from '../useProductImport';

interface ColorCellProps {
    row: ImportRow;
    index: number;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    allColors: any[];
}

export function ColorCell({ row, index, onUpdate, allColors }: ColorCellProps) {
    return <span className="text-[10px] text-muted-foreground/30">-</span>;
}
