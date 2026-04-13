import { Badge } from '@/components/ui/badge';
import { Check, X, AlertCircle } from 'lucide-react';
import { ImportRow } from '../hooks/useProductImport';

interface ValidationSummaryProps {
    data: ImportRow[];
}

export function ValidationSummary({ data }: ValidationSummaryProps) {
    const validRows = data.filter(r => r.isValid);
    const invalidRows = data.filter(r => !r.isValid);
    const productCount = new Set(validRows.map(r => r.product_sku)).size;
    const variantCount = validRows.filter(r => r.hasVariant).length;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
                <Badge variant="default" className="bg-success text-success-foreground px-3 py-1 text-xs">
                    <Check className="h-3 w-3 mr-1" />
                    有效 {validRows.length} 筆
                </Badge>
                {invalidRows.length > 0 && (
                    <Badge variant="destructive" className="px-3 py-1 text-xs">
                        <X className="h-3 w-3 mr-1" />
                        錯誤 {invalidRows.length} 筆
                    </Badge>
                )}
                <div className="flex gap-2 text-xs font-medium text-muted-foreground ml-auto bg-muted/50 px-3 py-1 rounded-full">
                    <span>產品: {productCount}</span>
                    <span className="opacity-30">|</span>
                    <span>變體: {variantCount}</span>
                </div>
            </div>

            {invalidRows.length > 0 && (
                <div className="bg-destructive/10 rounded-xl p-4 border border-destructive/20">
                    <h4 className="font-bold text-destructive mb-2 flex items-center gap-2 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        匯入阻斷錯誤 ({invalidRows.length})
                    </h4>
                    <ul className="text-[11px] space-y-1 text-destructive/80 max-h-40 overflow-auto pr-2 custom-scrollbar">
                        {invalidRows.map((row, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="font-bold"># {data.indexOf(row) + 1}:</span>
                                <span>{row.errors.join('、')}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
