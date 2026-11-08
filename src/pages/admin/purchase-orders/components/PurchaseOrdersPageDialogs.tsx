import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SupplierForm } from './SupplierForm';
import { PurchaseOrderDetailDialog } from './PurchaseOrderDetailDialog';
import { PurchaseDocImportDialog } from './PurchaseDocImportDialog';
import { BatchReceiveDialog } from './BatchReceiveDialog';
import { EntryDialog } from '@/pages/admin/accounting/components/EntryDialog';
import type { PurchaseOrder } from '../types';
// controller type is intentionally loose (any) to avoid circular imports

// Loose typing: controller return type
type Controller = any;

export function PurchaseOrdersPageDialogs({ c }: { c: Controller }) {
  return (
    <>
      {/* New Supplier Dialog */}
      <Dialog open={c.createSupplierOpen} onOpenChange={c.setCreateSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增供應商</DialogTitle>
            <DialogDescription>
              建立新的供應商聯絡資訊，以便後續進行採購與產品對照管理。
            </DialogDescription>
          </DialogHeader>
          <SupplierForm
            isLoading={c.createSupplierMutation.isPending}
            onSubmit={(data: any) => {
              c.createSupplierMutation.mutate(data, {
                onSuccess: () => c.setCreateSupplierOpen(false),
              });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Supplier Dialog */}
      <Dialog open={!!c.editingSupplier} onOpenChange={(open: boolean) => { if (!open) c.setEditingSupplier(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>編輯供應商</DialogTitle>
            <DialogDescription>
              修改供應商聯絡資訊；勾選「物流公司」可讓此供應商作為配送方式綁定的物流商。
            </DialogDescription>
          </DialogHeader>
          {c.editingSupplier && (
            <SupplierForm
              key={c.editingSupplier.id}
              initial={c.editingSupplier}
              isLoading={c.updateSupplierMutation.isPending}
              onSubmit={(data: any) => {
                c.updateSupplierMutation.mutate({ id: c.editingSupplier.id, ...data }, {
                  onSuccess: () => c.setEditingSupplier(null),
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Order Detail View Dialog */}
      <Dialog open={!!c.viewingOrder} onOpenChange={(open: boolean) => { if (!open) c.setViewingOrder(null); }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">採購單詳情</DialogTitle>
            <DialogDescription>
              檢視此採購單的所有品項、收貨進度與付款對帳紀錄。
            </DialogDescription>
          </DialogHeader>
          {c.viewingOrder && (
            <PurchaseOrderDetailDialog
              key={c.viewingOrder.id}
              order={c.viewingOrder}
              orderItems={c.orderItems}
              products={c.products}
              accounts={c.accounts}
              categories={c.categories}
              paidAmount={c.canSeePayments ? c.paidAmountMap[c.viewingOrder.id] : undefined}
              sourceOrderMap={c.sourceOrderMap}
              sourceOrderStoreMap={c.sourceOrderStoreMap}
              sourceOrderDateMap={c.sourceOrderDateMap}
              supplierMappingMap={c.supplierMappingMap}
              canEditVendorMapping={c.canSeePayments}
              onSaveVendorMapping={(p: any) => c.saveVendorMappingMutation.mutateAsync(p)}
              isLoading={c.itemsLoading || c.importItemsMutation.isPending || c.receiveItemsMutation.isPending || c.recordPaymentMutation.isPending}
              onImportItems={(data: any) => c.importItemsMutation.mutateAsync(data)}
              onReceiveItems={(items: any) => c.receiveItemsMutation.mutate(items)}
              onMakePayment={(data: any, references: any) => {
                c.recordPaymentMutation.mutate(
                  { orderIds: [c.viewingOrder.id], data, references },
                  { onSuccess: () => c.setViewingOrder(null) },
                );
              }}
              onEditOrder={() => c.navigate(`/admin/purchase-orders/${c.viewingOrder.id}/edit`)}
              onUpdateItem={(data: any) => c.updateItemMutation.mutateAsync(data)}
              onDeleteItem={(data: any) => c.deleteItemMutation.mutateAsync(data)}
              onUnlinkOrder={(orderId: string) => {
                if (window.confirm(`確定要解除與此訂單（${c.sourceOrderMap[orderId] || orderId.slice(0, 8)}）的採購關聯嗎？\n未收貨的數量將從採購單中扣除，並可重新進行採購。\n\n注意：若此品項僅由此訂單供應且尚未收貨，該品項將一併從採購單移除。`)) {
                  c.unlinkOrdersFromPurchaseMutation.mutate({ purchaseOrderId: c.viewingOrder.id, orderIds: [orderId] });
                }
              }}
              onReorder={(items: any) => c.reorderItemsMutation.mutateAsync(items)}
              onUpdateOrder={c.handleUpdateOrder}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Import Dialog */}
      <PurchaseDocImportDialog
        open={c.importOpen}
        onOpenChange={c.setImportOpen}
        suppliers={c.suppliers}
        defaultSupplierId={c.filters.supplierId}
        mode={c.importMode}
      />

      {/* Batch Receive Dialog */}
      <BatchReceiveDialog
        open={c.batchReceiveOpen}
        onOpenChange={(open: boolean) => { if (!c.batchReceiveItemsMutation.isPending) c.setBatchReceiveOpen(open); }}
        orders={c.receivableOrders}
        isPending={c.batchReceiveItemsMutation.isPending}
        onConfirm={c.handleBatchReceiveConfirm}
      />

      {/* Batch Payment Dialog */}
      {c.batchPayOpen && (
        <EntryDialog
          open={c.batchPayOpen}
          onOpenChange={(open: boolean) => { if (!c.recordPaymentMutation.isPending) c.setBatchPayOpen(open); }}
          categories={c.categories}
          accounts={c.accounts}
          isLoading={c.recordPaymentMutation.isPending}
          prefill={{
            amount: Math.abs(c.batchPaymentPlan.netApplied),
            categoryId: (() => {
              const wantType = c.batchPaymentPlan.netApplied < 0 ? 'expense' : 'income';
              const hit = c.categories.find(
                (cat: any) => cat.type === wantType && (cat.name.includes('採購') || cat.name.includes('供應商')),
              );
              return hit?.id || c.categories.find((cat: any) => cat.type === wantType)?.id;
            })(),
            description: `採購合併付款（${c.batchPaymentPlan.lines.length} 張）: ${c.batchPaymentPlan.supplierName}`,
            referenceType: 'purchase_order',
            referenceId: c.batchPaymentPlan.lines[0]?.orderId,
            markAsPaid: true,
            docItems: c.batchPaymentDocItems,
          }}
          onSubmit={c.handleBatchPaySubmit}
        />
      )}
    </>
  );
}