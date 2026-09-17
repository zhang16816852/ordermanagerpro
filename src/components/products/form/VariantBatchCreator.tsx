import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Layers, Sparkles } from 'lucide-react';
import { StandaloneDeviceModelSelectField } from '../StandaloneDeviceModelSelectField';
import { VariantOptionsEditor } from '@/components/products/variant/VariantOptionsEditor';
import { useVariantBatchCreator } from './useVariantBatchCreator';
import { VariantBatchPreview } from './VariantBatchPreview';
import { OrphanConfirmDialog } from './OrphanConfirmDialog';
import type { VariantBatchCreatorProps } from './variantBatchCreatorTypes';

export function VariantBatchCreator({ open, onOpenChange, product, onSuccess }: VariantBatchCreatorProps) {
  const ctl = useVariantBatchCreator({ open, onOpenChange, product, onSuccess });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            批次建立變體
          </DialogTitle>
          <DialogDescription>
            在下方定義選項群組與各選項值，可選填批發價／零售價，系統會自動生成所有排列組合
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <VariantOptionsEditor
            groups={ctl.optionGroups}
            onChange={ctl.setOptionGroups}
            suggestions={ctl.suggestions}
            suggestionsLoading={ctl.suggestionsLoading}
            onImportSuggestion={ctl.importSuggestion}
            onImportAllSuggestions={ctl.importAllSuggestions}
          />

          {/* Device Models */}
          <div className="space-y-2">
            <Label>型號 / 群組（選填）</Label>
            <StandaloneDeviceModelSelectField
              selectionOrder={ctl.selectedDeviceRefs}
              onOrderChange={ctl.setSelectedDeviceRefs}
            />
          </div>

          {/* Barcode List */}
          <div className="space-y-2">
            <Label htmlFor="barcodeList">條碼列表（選填）</Label>
            <Textarea
              id="barcodeList"
              placeholder="依生成順序貼上條碼，每行一個。&#10;例如產生 6 個變體就貼 6 行，第 n 行對應第 n 個變體"
              value={ctl.barcodeList}
              onChange={(e) => ctl.setBarcodeList(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          {/* Default Prices */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultWholesale">預設批發價</Label>
              <Input
                id="defaultWholesale"
                type="number"
                step="0.01"
                disabled={ctl.isUnified}
                value={ctl.isUnified ? String(product?.unified_wholesale_price ?? 0) : ctl.defaultWholesalePrice}
                onChange={(e) => ctl.setDefaultWholesalePrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultRetail">預設零售價</Label>
              <Input
                id="defaultRetail"
                type="number"
                step="0.01"
                disabled={ctl.isUnified}
                value={ctl.isUnified ? String(product?.unified_retail_price ?? 0) : ctl.defaultRetailPrice}
                onChange={(e) => ctl.setDefaultRetailPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          {ctl.isUnified && (
            <p className="text-xs text-emerald-600">此產品為「統一價格」，生成變體將自動套用產品統一價，無需個別設定。</p>
          )}

          <Button onClick={ctl.generateVariants} className="w-full" variant="secondary">
            <Sparkles className="mr-2 h-4 w-4" />
            生成變體預覽
          </Button>

          {/* Preview */}
          {ctl.generatedVariants.length > 0 && (
            <VariantBatchPreview
              variants={ctl.generatedVariants}
              diffSummary={ctl.diffSummary}
              deviceNames={ctl.deviceNames}
              isUnified={ctl.isUnified}
              onUpdate={ctl.updateVariantField}
              onRemove={ctl.removeVariant}
            />
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { onOpenChange(false); ctl.resetForm(); }}>
              取消
            </Button>
            <Button
              onClick={ctl.handleSave}
              disabled={ctl.generatedVariants.length === 0 || ctl.createMutation.isPending}
            >
              {ctl.createMutation.isPending ? '建立中...' : `建立 ${ctl.generatedVariants.length} 個變體`}
            </Button>
          </div>
        </div>
      </DialogContent>
      </Dialog>

      {ctl.orphanConfirm && (
        <OrphanConfirmDialog
          orphanConfirm={ctl.orphanConfirm}
          onCancel={() => ctl.setOrphanConfirm(null)}
          onProceed={ctl.proceedWithOrphans}
        />
      )}
    </>
  );
}