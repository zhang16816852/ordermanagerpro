import { Layers } from 'lucide-react';
import { useVariantManager } from './useVariantManager';
import { VariantManagerToolbar } from './variantManager/VariantManagerToolbar';
import { VariantsTable } from './variantManager/VariantsTable';
import { BatchEditDialog } from './variantManager/BatchEditDialog';
import { VariantEditDialog } from './VariantEditDialog';
import { VariantBatchCreator } from './form/VariantBatchCreator';
import type { VariantManagerProps } from './variantManagerTypes';

export function VariantManager({ products, search }: VariantManagerProps) {
  const c = useVariantManager({ products, search });

  return (
    <div className="space-y-4">
      <VariantManagerToolbar
        products={c.productsWithVariants}
        selectedProductId={c.selectedProductId}
        onSelectProduct={c.handleSelectProduct}
        selectedProduct={c.selectedProduct ?? null}
        variantCount={c.variants.length}
        onAddVariant={() => c.openEditDialog(null)}
        onOpenBatch={() => c.setIsBatchOpen(true)}
      />

      <VariantsTable
        selectedProductId={c.selectedProductId}
        variants={c.variants}
        variantsLoading={c.variantsLoading}
        selectedVariantIds={c.selectedVariantIds}
        onToggleSelectAll={c.toggleSelectAll}
        onToggleVariant={c.toggleSelectVariant}
        onEdit={c.openEditDialog}
        onDelete={c.deleteMutation.mutate}
        onOpenBatchEdit={() => { c.setBatchEditEntries([]); c.setIsBatchEditOpen(true); }}
        onBatchDelete={() => c.batchDeleteMutation.mutate(Array.from(c.selectedVariantIds))}
        batchDeletePending={c.batchDeleteMutation.isPending}
      />

      {/* 批次編輯對話框 */}
      <BatchEditDialog
        open={c.isBatchEditOpen}
        onOpenChange={c.setIsBatchEditOpen}
        entries={c.batchEditEntries}
        updateBatchEntry={c.updateBatchEntry}
        removeBatchEntry={(idx) => c.setBatchEditEntries(prev => prev.filter((_, i) => i !== idx))}
        addBatchEntry={() => c.setBatchEditEntries(prev => [...prev, { field: '', value: '' }])}
        optionGroupsData={c.optionGroupsData}
        selectedCount={c.selectedVariantIds.size}
        onHandleBatchEdit={c.handleBatchEdit}
        batchEditPending={c.batchEditMutation.isPending}
      />

      {!c.selectedProductId && (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">請先選擇一個產品</p>
        </div>
      )}

      <VariantEditDialog
        open={c.isDialogOpen}
        onOpenChange={c.setIsDialogOpen}
        product={c.selectedProduct ?? null}
        variant={c.editingVariant}
        onSuccess={c.invalidateVariants}
      />

      {c.selectedProduct && (
        <VariantBatchCreator
          open={c.isBatchOpen}
          onOpenChange={c.setIsBatchOpen}
          product={c.selectedProduct}
          onSuccess={c.invalidateVariants}
        />
      )}
    </div>
  );
}