import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckSquare, Edit3, Trash2, Pencil } from 'lucide-react';
import type { VariantWithExtras } from '../variantManagerTypes';
import { STATUS_LABELS } from '../variantManagerTypes';

interface VariantsTableProps {
  selectedProductId: string | null;
  variants: VariantWithExtras[];
  variantsLoading: boolean;
  selectedVariantIds: Set<string>;
  onToggleSelectAll: (checked: boolean) => void;
  onToggleVariant: (id: string) => void;
  onEdit: (variant: VariantWithExtras) => void;
  onDelete: (id: string) => void;
  onOpenBatchEdit: () => void;
  onBatchDelete: () => void;
  batchDeletePending: boolean;
}

export function VariantsTable({
  selectedProductId,
  variants,
  variantsLoading,
  selectedVariantIds,
  onToggleSelectAll,
  onToggleVariant,
  onEdit,
  onDelete,
  onOpenBatchEdit,
  onBatchDelete,
  batchDeletePending,
}: VariantsTableProps) {
  if (!selectedProductId) return null;

  return (
    <>
      {selectedVariantIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">已選取 {selectedVariantIds.size} 項</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onOpenBatchEdit}>
              <Edit3 className="mr-1 h-4 w-4" />
              批次編輯
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (window.confirm(`確定要刪除所選的 ${selectedVariantIds.size} 個變體？`)) {
                  onBatchDelete();
                }
              }}
              disabled={batchDeletePending}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              刪除所選
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={variants.length > 0 && selectedVariantIds.size === variants.length}
                  ref={(el) => { if (el) el.indeterminate = selectedVariantIds.size > 0 && selectedVariantIds.size < variants.length; }}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                />
              </TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>名稱</TableHead>
              <TableHead>選項</TableHead>
              <TableHead className="text-right">批發價</TableHead>
              <TableHead className="text-right">零售價</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variantsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : variants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  此產品尚無變體，點擊「新增變體」或「批次建立」開始
                </TableCell>
              </TableRow>
            ) : (
              variants.map((variant) => (
                <TableRow key={variant.id} className={selectedVariantIds.has(variant.id) ? 'bg-muted/50' : ''}>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedVariantIds.has(variant.id)}
                      onChange={() => onToggleVariant(variant.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{variant.sku}</TableCell>
                  <TableCell className="font-medium">{variant.name}</TableCell>
                  <TableCell>
                    {(variant.optionDisplays && variant.optionDisplays.length > 0) ? (
                      <div className="flex flex-wrap gap-1">
                        {(variant.optionDisplays || []).map((opt, i) => (
                          opt.hexCode ? (
                            <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-xs" title={opt.groupName}>
                              <div className="w-2.5 h-2.5 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: opt.hexCode }} />
                              <span>{opt.label}</span>
                            </div>
                          ) : (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {opt.groupName}: {opt.label}
                            </Badge>
                          )
                        ))}
                      </div>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right">${variant.wholesale_price}</TableCell>
                  <TableCell className="text-right">${variant.retail_price}</TableCell>
                  <TableCell>
                    <Badge variant={variant.status === 'active' ? 'default' : 'secondary'}>
                      {STATUS_LABELS[variant.status]}
                    </Badge>
                    {variant.device_model_links && variant.device_model_links.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {variant.device_model_links.map((link) => (
                          <Badge key={link.model_id} variant="secondary" className="text-[9px] px-1 h-3.5 bg-amber-100 text-amber-800 hover:bg-amber-100/80 border-transparent">
                            {link.device_models?.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(variant)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => onDelete(variant.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}