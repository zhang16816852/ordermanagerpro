import { Badge } from '@/components/ui/badge';
import { AlertCircle, Layers, X } from 'lucide-react';
import { VariantPreviewTable } from '@/components/products/variant/VariantPreviewTable';
import type { SharedVariant, VariantEditableField } from '@/utils/variantGeneration';
import type { DiffSummary } from './variantBatchCreatorTypes';

interface VariantBatchPreviewProps {
  variants: SharedVariant[];
  diffSummary: DiffSummary | null;
  deviceNames: string[];
  isUnified: boolean;
  onUpdate: (index: number, field: VariantEditableField, value: string) => void;
  onRemove: (index: number) => void;
}

export function VariantBatchPreview({ variants, diffSummary, deviceNames, isUnified, onUpdate, onRemove }: VariantBatchPreviewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">預覽（{variants.length} 個變體）</h4>
        <Badge variant="outline">點擊可編輯價格</Badge>
      </div>

      {diffSummary && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {diffSummary.added > 0 && <Badge variant="secondary">新增 {diffSummary.added}</Badge>}
            {diffSummary.updated > 0 && <Badge className="bg-teal-600 text-white">更新 {diffSummary.updated}</Badge>}
            {diffSummary.kept - diffSummary.updated > 0 && <Badge variant="outline">保留 {diffSummary.kept - diffSummary.updated}</Badge>}
          </div>
          {diffSummary.priceUpdated > 0 && (
            <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>{diffSummary.priceUpdated} 個變體價格已依選項值／預設價格更新，原有手動修改已覆寫</span>
            </div>
          )}
          {diffSummary.orphans.length > 0 && (
            <details className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-950/10 border-amber-300/40 text-sm">
              <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">
                {diffSummary.orphans.length} 個既有變體將不會再被生成（儲存時檢查；未被訂單／庫存引用者會自動刪除，被引用者會擋下並提示）
              </summary>
              <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {diffSummary.orphans.map(ov => (
                  <li key={ov.sku} className="flex items-center gap-2 text-muted-foreground">
                    <X className="h-3 w-3 shrink-0" />
                    <span className="font-mono text-xs">{ov.sku}</span>
                    <span>{ov.name}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {deviceNames.length > 0 && (
        <div className="flex items-center gap-2 p-2.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
          <Layers className="h-4 w-4 text-blue-600 shrink-0" />
          <span>
            {variants.some(v => v._modelGroupId && v._modelGroupType)
              ? '變體將逐一關聯對應的型號/群組'
              : `型號/群組將關聯至所有 ${variants.length} 個變體`}
            ：
            {deviceNames.join('、')}
          </span>
        </div>
      )}

      <VariantPreviewTable
        variants={variants}
        onUpdate={onUpdate}
        onRemove={onRemove}
        disablePrices={isUnified}
      />

      <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <span>確認無誤後點擊下方按鈕建立變體，SKU 重複將會導致失敗</span>
      </div>
    </div>
  );
}