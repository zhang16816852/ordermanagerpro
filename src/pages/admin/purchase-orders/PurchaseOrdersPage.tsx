import { usePurchaseOrdersPageController } from './hooks/usePurchaseOrdersPageController';
import { PurchaseOrdersPageHeader } from './components/PurchaseOrdersPageHeader';
import { PurchaseOrdersPageTabs } from './components/PurchaseOrdersPageTabs';
import { PurchaseOrdersPageDialogs } from './components/PurchaseOrdersPageDialogs';

export default function AdminPurchaseOrders() {
  const c = usePurchaseOrdersPageController();

  const ordersTabProps = {
    suppliers: c.suppliers,
    filters: c.filters,
    onFiltersChange: c.updateFilterUrl,
    onClearFilters: () => {
      c.updateFilterUrl({
        supplierId: undefined,
        purpose: undefined,
        status: undefined,
        dateFrom: undefined,
        dateTo: undefined,
      });
      c.setPaidFilterUrl('all');
    },
    sortField: c.sortField,
    sortDir: c.sortDir,
    onSortFieldChange: c.handleSortFieldChange,
    onToggleSortDir: c.handleToggleSortDir,
    showPaidFilter: c.canSeePayments,
    paidFilter: c.paidFilter,
    onPaidFilterChange: c.setPaidFilterUrl,
    isLoading: c.ordersLoading,
    summary: {
      count: c.visibleOrders.length,
      total: c.paymentSummary.total,
      paid: c.paymentSummary.paid,
      unpaid: c.paymentSummary.unpaid,
      unpaidCount: c.paymentSummary.unpaidCount,
    },
    batchMode: c.batchMode,
    onBatchModeChange: c.handleBatchModeChange,
    selectedCount: c.selectedOrders.length,
    orderableCount: c.orderableOrders.length,
    receivableCount: c.receivableOrders.length,
    payableCount: c.batchPaymentPlan.lines.length,
    canPay: c.canBatchPay,
    isOrdering: c.batchOrderMutation.isPending,
    isReceiving: c.batchReceiveItemsMutation.isPending,
    isPaying: c.recordPaymentMutation.isPending,
    onOrder: c.handleBatchOrder,
    onReceive: c.handleBatchReceive,
    onPay: c.handleBatchPay,
    onClear: c.clearSelection,
    orders: c.sortedOrders,
    onView: c.handleViewOrder,
    onEdit: c.handleEditOrder,
    onDelete: c.handleDeleteOrder,
    onStatusChange: c.handleStatusChange,
    paidAmountMap: c.canSeePayments ? c.paidAmountMap : undefined,
    onSort: c.handleSort,
    selectedIds: c.selectedIds,
    onToggleSelect: c.toggleSelect,
    onToggleSelectAll: c.setSelectedIds,
    batchLocked: c.batchPending,
  };

  return (
    <div className="space-y-6">
      <PurchaseOrdersPageHeader
        onCreateSupplier={() => c.setCreateSupplierOpen(true)}
        onImportPurchase={() => { c.setImportMode('purchase'); c.setImportOpen(true); }}
        onImportReturns={() => { c.setImportMode('returns'); c.setImportOpen(true); }}
        onCreateOrder={() => c.navigate('/admin/orders/checkout?type=purchase')}
      />

      <PurchaseOrdersPageTabs
        activeTab={c.activeTab}
        onTabChange={c.handleTabChange}
        ordersTabProps={ordersTabProps}
        suppliers={c.suppliers}
        onAddSupplier={() => c.setCreateSupplierOpen(true)}
        onEditSupplier={c.setEditingSupplier}
        isLoadingSuppliers={c.isLoadingSuppliers}
      />

      <PurchaseOrdersPageDialogs c={c} />
    </div>
  );
}