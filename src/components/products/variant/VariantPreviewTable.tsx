import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type SharedVariant,
  type VariantEditableField,
} from '@/utils/variantGeneration';

interface VariantPreviewTableProps {
  variants: SharedVariant[];
  onUpdate: (index: number, field: VariantEditableField, value: string) => void;
  onRemove: (index: number) => void;
  disablePrices?: boolean;
  maxHeight?: string;
}

export function VariantPreviewTable({
  variants,
  onUpdate,
  onRemove,
  disablePrices = false,
  maxHeight = '300px',
}: VariantPreviewTableProps) {
  const longestSkuLen = variants.reduce((m, v) => Math.max(m, v.sku.length), 0);
  const skuWidth = `${Math.max(16, Math.min(longestSkuLen + 3, 40))}ch`;
  return (
    <div className="border rounded-lg overflow-y-auto" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="bg-muted sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-3 py-2 text-left">變體名稱</th>
            <th className="px-3 py-2 text-left">條碼 (Barcode)</th>
            <th className="px-3 py-2 text-right w-24">批發價</th>
            <th className="px-3 py-2 text-right w-24">零售價</th>
            <th className="px-3 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant, index) => (
            <tr key={index} className="border-t hover:bg-muted/50">
              <td className="px-3 py-2">
                <Input
                  value={variant.sku}
                  onChange={(e) => onUpdate(index, 'sku', e.target.value)}
                  title={variant.sku}
                  className="h-7 font-mono text-xs"
                  style={{ width: skuWidth }}
                />
              </td>
              <td className="px-3 py-2 min-w-[220px]">
                <Input
                  value={variant.name}
                  onChange={(e) => onUpdate(index, 'name', e.target.value)}
                  title={variant.name}
                  className="h-7 w-full min-w-0"
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  placeholder="掃描或輸入條碼"
                  value={variant.barcode}
                  onChange={(e) => onUpdate(index, 'barcode', e.target.value)}
                  className="h-7 w-36"
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  type="number"
                  step="0.01"
                  disabled={disablePrices}
                  value={variant.wholesale_price}
                  onChange={(e) => onUpdate(index, 'wholesale_price', e.target.value)}
                  className="h-7 w-20 text-right"
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  type="number"
                  step="0.01"
                  disabled={disablePrices}
                  value={variant.retail_price}
                  onChange={(e) => onUpdate(index, 'retail_price', e.target.value)}
                  className="h-7 w-20 text-right"
                />
              </td>
              <td className="px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive"
                  onClick={() => onRemove(index)}
                >
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}