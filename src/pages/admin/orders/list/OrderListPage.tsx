import { useNavigate } from 'react-router-dom';
import { OrderDetailDialog } from '@/components/order/OrderDetailDialog';
import { OrdersCardView } from '@/components/order/OrdersCardView';
import { ItemsCardView } from '@/components/order/ItemsCardView';
import { OrderTableView } from './components/OrderTableView';
import { ItemTableView } from './components/ItemTableView';
import { AggregateTableView } from './components/AggregateTableView';
import { AggregateCardsView } from './components/AggregateCardsView';
import { AggregateToPODialog } from './components/AggregateToPODialog';
import { BatchActionBar } from './components/BatchActionBar';
import { ShipToPoolDialog } from './components/ShipToPoolDialog';
import { OrderListHeader } from './components/OrderListHeader';
import { ConvertToConsignmentDialog, DirectShipDialog, ReverseShipmentDialog } from './OrderListDialogs';
import { getOrderShipmentStatus, getOrderTotal } from './orderListUtils';
import { useOrderListPageController } from './useOrderListPageController';

export default function AdminOrderList() {
  const navigate = useNavigate();
  const c = useOrderListPageController();

  const {
    statusTab,
    viewMode,
    search,
    setSearch,
    storeFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    poFilter,
    setPoFilter,
    repFilter,
    setRepFilter,
    repsData,
    stores,
    orders,
    isLoading,
    shippingPoolMap,
    poLinkMap,
    consignmentBySourceOrderId,
    syncOrdersMutation,
    confirmOrdersMutation,
    addToShippingPoolMutation,
    cancelItemsMutation,
    isRep,
    filteredOrders,
    sortedOrders,
    allPendingItems,
    allCancelledItems,
    aggregatedItems,
    commissionByOrder,
    orderPoolGroupedItems,
    poItemsSource,
    selectedOrderIds,
    setSelectedOrderIds,
    selectedItems,
    setSelectedItems,
    viewingOrder,
    setViewingOrder,
    shipToPoolOpen,
    setShipToPoolOpen,
    orderPoolOpen,
    setOrderPoolOpen,
    convertToConsignmentOpen,
    setConvertToConsignmentOpen,
    reverseShipmentOrder,
    setReverseShipmentOrder,
    reverseNote,
    setReverseNote,
    directShipDialogOpen,
    setDirectShipDialogOpen,
    directShipAt,
    setDirectShipAt,
    directShipNotes,
    setDirectShipNotes,
    setItemWarehouses,
    getItemWarehouse,
    convertToPOOpen,
    setConvertToPOOpen,
    selectedAggregateItems,
    setSelectedAggregateItems,
    directShipMutation,
    convertToConsignmentMutation,
    unlinkOrdersMutation,
    reverseShipmentMutation,
    handleDeleteOrders,
    handleReverseShipment,
    handleSort,
    groupedSelections,
    handleToggleAggregateSelection,
    handleToggleAllAggregate,
    handleUpdateAggregateQuantity,
    handleExportAggregateCSV,
    handleExportAggregateExcel,
    handleItemToggleSelection,
    handleItemToggleAll,
    handleUpdateItemQuantity,
    hasConsignmentSelection,
    hasNormalSelection,
    allSelectedConsignment,
  } = c;

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)] space-y-4 p-4 md:p-6 bg-muted/10">
      <OrderListHeader
        isRep={isRep}
        statusTab={statusTab}
        onStatusTabChange={c.handleStatusTabChange}
        viewMode={viewMode}
        onViewModeChange={c.handleViewModeChange}
        search={search}
        onSearchChange={setSearch}
        storeFilter={storeFilter}
        onStoreFilterChange={c.handleStoreFilterChange}
        stores={stores as any[]}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        poFilter={poFilter}
        onPoFilterChange={setPoFilter}
        repFilter={repFilter}
        onRepFilterChange={setRepFilter}
        reps={repsData}
        onExportCSV={c.handleExportOrdersCSV}
        syncPending={syncOrdersMutation.isPending}
        onSync={() => syncOrdersMutation.mutate()}
      />

      <div className="flex-1 min-h-0 flex flex-col pt-2">
        {viewMode === 'orders' && (
          <>
            {/* Desktop: Table */}
            <div className="hidden md:block flex-1 min-h-0">
              <div className="h-full flex flex-col">
                <OrderTableView
                  orders={sortedOrders}
                  isLoading={isLoading}
                  statusTab={statusTab}
                  selectedOrderIds={selectedOrderIds}
                  onToggleSelection={(id, checked) => {
                    const next = new Set(selectedOrderIds);
                    if (checked) next.add(id); else next.delete(id);
                    setSelectedOrderIds(next);
                  }}
                  onToggleAll={(checked) => {
                    if (checked) setSelectedOrderIds(new Set(sortedOrders.map(o => o.id)));
                    else setSelectedOrderIds(new Set());
                  }}
                  onView={setViewingOrder}
                  onEdit={(id) => navigate(`/admin/orders/${id}/edit`)}
                  onReverseShipment={handleReverseShipment}
                  sortField={c.sortField}
                  sortDirection={c.sortDirection}
                  onSort={handleSort}
                  poLinkMap={poLinkMap}
                  consignmentBySourceOrder={consignmentBySourceOrderId}
                  commissionByOrder={commissionByOrder}
                />
              </div>
            </div>
            {/* Mobile: Cards */}
            <div className="md:hidden flex-1 min-h-0 flex flex-col">
              <OrdersCardView
                orders={filteredOrders}
                isLoading={isLoading}
                onView={setViewingOrder}
                onEdit={(id) => navigate(`/admin/orders/${id}/edit`)}
                onReverseShipment={handleReverseShipment}
                statusTab={statusTab}
                consignmentBySourceOrder={consignmentBySourceOrderId}
                getOrderShipmentStatus={getOrderShipmentStatus}
                getOrderTotal={getOrderTotal}
                commissionByOrder={commissionByOrder}
              />
            </div>
          </>
        )}

        {viewMode === 'items' && (
          <>
            {/* Desktop: Table */}
            <div className="hidden md:block flex-1 min-h-0">
              <div className="h-full flex flex-col">
                <ItemTableView
                  items={allPendingItems}
                  cancelledItems={allCancelledItems}
                  isLoading={isLoading}
                  selectedItems={selectedItems}
                  shippingPoolMap={shippingPoolMap}
                  onToggleSelection={handleItemToggleSelection}
                  onToggleAll={(checked) => handleItemToggleAll(checked, allPendingItems)}
                  onUpdateQuantity={handleUpdateItemQuantity}
                  onRestoreItem={(id) => cancelItemsMutation.mutate({ itemIds: [id], targetStatus: 'waiting' })}
                  poLinkMap={poLinkMap}
                />
              </div>
            </div>
            {/* Mobile: Cards */}
            <div className="md:hidden flex-1 min-h-0 flex flex-col">
              <ItemsCardView
                items={allPendingItems}
                isLoading={isLoading}
                statusLabels={c.itemStatusLabels}
              />
            </div>
          </>
        )}

        {viewMode === 'aggregate' && (
          <>
            {/* Desktop: Table */}
            <div className="hidden md:block flex-1 min-h-0">
              <div className="h-full flex flex-col">
                <AggregateTableView
                  items={aggregatedItems}
                  isLoading={isLoading}
                  selectedItems={selectedAggregateItems}
                  onToggleSelection={handleToggleAggregateSelection}
                  onToggleAll={(checked) => handleToggleAllAggregate(checked, aggregatedItems)}
                  onUpdateQuantity={handleUpdateAggregateQuantity}
                />
              </div>
            </div>
            {/* Mobile: Cards */}
            <div className="md:hidden flex-1 min-h-0 flex flex-col">
              <AggregateCardsView
                items={aggregatedItems}
                isLoading={isLoading}
                selectedItems={selectedAggregateItems}
                onToggleSelection={handleToggleAggregateSelection}
                onUpdateQuantity={handleUpdateAggregateQuantity}
              />
            </div>
          </>
        )}
      </div>

      <BatchActionBar
        statusTab={statusTab}
        viewMode={viewMode}
        selectedOrderCount={selectedOrderIds.size}
        selectedItemCount={selectedItems.size}
        selectedAggregateCount={selectedAggregateItems.size}
        hasConsignmentSelection={hasConsignmentSelection}
        hasNormalSelection={hasNormalSelection}
        allSelectedConsignment={allSelectedConsignment}
        isLoading={confirmOrdersMutation.isPending || addToShippingPoolMutation.isPending || cancelItemsMutation.isPending || directShipMutation.isPending || convertToConsignmentMutation.isPending}
        onConfirmOrders={() => confirmOrdersMutation.mutate(Array.from(selectedOrderIds))}
        onShipItems={() => setShipToPoolOpen(true)}
        onDirectShipOrders={() => setDirectShipDialogOpen(true)}
        onConvertToConsignment={() => setConvertToConsignmentOpen(true)}
        onShipOrdersToPool={() => setOrderPoolOpen(true)}
        onCancelItems={() => {
          if (confirm(`確定要標記這 ${selectedItems.size} 個品項為 停產/取消 嗎？`)) {
            cancelItemsMutation.mutate({ itemIds: Array.from(selectedItems.keys()), targetStatus: 'cancelled' });
          }
        }}
        onConvertToPO={() => setConvertToPOOpen(true)}
        linkedToPO={Array.from(selectedOrderIds).some(id => poLinkMap.has(id))}
        onUnlinkOrders={() => {
          const ids = Array.from(selectedOrderIds).filter(id => poLinkMap.has(id));
          if (ids.length === 0) return;
          if (window.confirm(`確定要解除這 ${ids.length} 個訂單與採購單的關聯嗎？\n未收貨的數量將從採購單中扣除，並可重新進行採購。`)) {
            unlinkOrdersMutation.mutate(ids);
          }
        }}
        onExportAggregateCSV={handleExportAggregateCSV}
        onExportAggregateExcel={handleExportAggregateExcel}
        onDeleteOrders={() => handleDeleteOrders(Array.from(selectedOrderIds))}
        isRep={isRep}
      />

      {/* Confirmation Dialogs */}
      <ShipToPoolDialog
        open={shipToPoolOpen}
        onOpenChange={setShipToPoolOpen}
        groupedItems={groupedSelections}
        isLoading={addToShippingPoolMutation.isPending}
        onConfirm={() => addToShippingPoolMutation.mutate(Array.from(selectedItems.values()), {
          onSuccess: () => {
            setShipToPoolOpen(false);
            setSelectedItems(new Map());
          }
        })}
      />

      {/* Whole-order Ship To Pool Dialog */}
      <ShipToPoolDialog
        open={orderPoolOpen}
        onOpenChange={setOrderPoolOpen}
        groupedItems={orderPoolGroupedItems}
        isLoading={addToShippingPoolMutation.isPending}
        onConfirm={() => addToShippingPoolMutation.mutate(Object.values(orderPoolGroupedItems).flatMap(g => g.items), {
          onSuccess: () => {
            setOrderPoolOpen(false);
            setSelectedOrderIds(new Set());
          }
        })}
      />

      {/* Convert To Consignment Dialog */}
      <ConvertToConsignmentDialog
        open={convertToConsignmentOpen}
        onOpenChange={setConvertToConsignmentOpen}
        orders={orders}
        selectedOrderIds={selectedOrderIds}
        isPending={convertToConsignmentMutation.isPending}
        onConfirm={() => convertToConsignmentMutation.mutate(Array.from(selectedOrderIds))}
      />

      {/* Direct Ship Dialog */}
      <DirectShipDialog
        open={directShipDialogOpen}
        onOpenChange={(open) => {
          if (!open) setItemWarehouses({});
          setDirectShipDialogOpen(open);
        }}
        orders={orders}
        selectedOrderIds={selectedOrderIds}
        allSelectedConsignment={allSelectedConsignment}
        directShipAt={directShipAt}
        onDirectShipAtChange={setDirectShipAt}
        directShipNotes={directShipNotes}
        onDirectShipNotesChange={setDirectShipNotes}
        getItemWarehouse={getItemWarehouse}
        onItemWarehouseChange={(itemId, w) => setItemWarehouses(prev => ({ ...prev, [itemId]: w }))}
        isPending={directShipMutation.isPending}
        onConfirm={() => directShipMutation.mutate({ orderIds: Array.from(selectedOrderIds), notes: directShipNotes })}
      />

      {/* Reverse Consignment Shipment Dialog */}
      <ReverseShipmentDialog
        open={!!reverseShipmentOrder}
        target={reverseShipmentOrder}
        onOpenChange={(open) => !open && setReverseShipmentOrder(null)}
        note={reverseNote}
        onNoteChange={setReverseNote}
        isPending={reverseShipmentMutation.isPending}
        onConfirm={() =>
          reverseShipmentMutation.mutate({
            consignmentOrderId: reverseShipmentOrder?.consignmentOrderId || '',
            note: reverseNote,
          })
        }
      />

      {/* Order Detail View */}
      <OrderDetailDialog
        order={viewingOrder}
        open={!!viewingOrder}
        onOpenChange={(open) => !open && setViewingOrder(null)}
        onDeleteOrder={(id) => handleDeleteOrders([id])}
      />

      {/* Convert to PO Dialog */}
      <AggregateToPODialog
        open={convertToPOOpen}
        onOpenChange={setConvertToPOOpen}
        selectedItems={poItemsSource}
        onCreated={() => {
          setSelectedAggregateItems(new Map());
          setSelectedOrderIds(new Set());
          setConvertToPOOpen(false);
        }}
      />
    </div>
  );
}