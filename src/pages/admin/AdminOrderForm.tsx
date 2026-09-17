import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, AlertTriangle, Send, Truck, ShoppingBag, PackageCheck, X, Package, Save } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderInfoCard } from '@/components/order/OrderInfoCard';
import { OrderItemsPanel } from '@/components/order/OrderItemsPanel';
import { ProductSelector } from '@/components/order/ProductSelector';

import { useAdminOrderFormController } from './orders/form/useAdminOrderFormController';
import { useAdminOrderFormHeader, statusLabels } from './orders/form/useAdminOrderFormHeader';
import { DirectShipDialog } from './orders/form/DirectShipDialog';

export default function AdminOrderForm() {
  const c = useAdminOrderFormController();
  const navigate = useNavigate();
  useAdminOrderFormHeader({
    isEditMode: c.isEditMode,
    orderType: c.orderType,
    orderIdVal: c.orderIdVal,
    orderCodeVal: c.orderCodeVal,
    orderStatusVal: c.orderStatusVal,
    orderConsignmentMode: c.orderConsignmentMode,
    displayStoreName: c.displayStoreName,
    isTogglePending: c.isTogglePending,
    onToggleStatus: () => c.toggleStatusMutation.mutate(),
    navigate,
    navigateBack: c.navigateBack,
  });

  // Loading / empty states
  if (c.isEditMode && c.orderLoading) {
    return <div className="flex items-center justify-center h-64" role="status" aria-live="polite"><div className="text-muted-foreground">載入中…</div></div>;
  }
  if (c.isEditMode && !c.order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">找不到訂單</p>
        <Button onClick={() => navigate('/admin/orders')}><ArrowLeft className="mr-2 h-4 w-4" />返回訂單列表</Button>
      </div>
    );
  }

  const statusInfo = c.order ? statusLabels[c.order.status] || { label: c.order.status, className: 'bg-muted text-muted-foreground' } : null;

  const renderOrderInfoCard = (collapsed: boolean = false) => (
    <OrderInfoCard
      orderType={c.orderType}
      isEditMode={c.isEditMode}
      order={c.order}
      displayStoreName={c.displayStoreName}
      displayBrand={c.displayBrand}
      storesList={c.storesList}
      suppliersList={c.suppliersList}
      storeLocked={!!c.searchParams.get('storeId') && !c.isEditMode}
      selectedStoreId={c.selectedStoreId}
      onStoreChange={c.setSelectedStoreId}
      supplierId={c.supplierId}
      onSupplierChange={c.setSupplierId}
      targetStoreId={c.targetStoreId}
      onTargetStoreChange={c.setTargetStoreId}
      expectedDate={c.expectedDate}
      onExpectedDateChange={c.setExpectedDate}
      supplierOrderNumber={c.supplierOrderNumber}
      onSupplierOrderNumberChange={c.setSupplierOrderNumber}
      notes={c.notes}
      onNotesChange={c.setNotes}
      shippedAt={c.shippedAt}
      onShippedAtChange={c.setShippedAt}
      consignmentMode={c.consignmentMode}
      onConsignmentModeChange={c.setConsignmentMode}
      items={c.items}
      getItemWarehouse={c.getItemWarehouse}
      itemWarehouses={c.itemWarehouses}
      onItemWarehouseChange={(id, w) => c.setItemWarehouses((prev) => ({ ...prev, [id]: w }))}
      itemSources={c.itemSources}
      onItemSourceChange={(id, src) => c.setItemSources((prev) => ({ ...prev, [id]: src }))}
      activePanel={c.activePanel}
      onTogglePanel={() => c.setActivePanel(c.activePanel === 'information' ? null : 'information')}
      collapsed={collapsed}
    />
  );

  const renderProductSelector = (bare: boolean = false, collapsed: boolean = false) => (
    <ProductSelector
      products={c.storeProducts}
      productsLoading={c.productsLoading}
      filteredProducts={c.filteredProducts}
      storeId={c.draftKey}
      viewMode={c.viewMode}
      onViewModeChange={c.setViewMode}
      productSearch={c.productSearch}
      onSearchChange={c.setProductSearch}
      filterSheetOpen={c.filterSheetOpen}
      onFilterSheetToggle={() => c.setFilterSheetOpen((v) => !v)}
      selectedCategory={c.selectedCategory}
      onCategoryChange={c.handleCategoryChange}
      selectedSpecs={c.selectedSpecs}
      onSpecChange={c.handleSpecChange}
      selectedBrands={c.selectedBrandsParam}
      onBrandChange={c.handleBrandsChange}
      onClearFilters={c.handleClearFilters}
      activePanel={c.activePanel}
      onTogglePanel={() => c.setActivePanel(c.activePanel === 'products' ? null : 'products')}
      bare={bare}
      collapsed={collapsed}
    />
  );

  const renderOrderItemsPanel = (collapsed: boolean = false) => (
    <OrderItemsPanel
      isEditMode={c.isEditMode}
      orderType={c.orderType}
      items={c.items}
      onUpdateQuantity={c.handleQuantityChange}
      onUpdatePrice={c.handlePriceChange}
      onRemove={c.handleRemoveItem}
      onSplit={c.handleSplitItem}
      onReorder={c.handleReorder}
      priceSyncMap={c.priceSyncMap}
      onTogglePriceSync={c.handleTogglePriceSync}
      activePanel={c.activePanel}
      onTogglePanel={() => c.setActivePanel(c.activePanel === 'items' ? null : 'items')}
      collapsed={collapsed}
    />
  );

  return (
    <div className="space-y-4">
      {/* Type selector (create mode only) */}
      {!c.isEditMode && !c.isRep && (
        <Tabs value={c.orderType} onValueChange={(v) => c.setOrderType(v as any)}>
          <TabsList>
            <TabsTrigger value="sales" className="gap-1.5">
              <ShoppingBag className="h-4 w-4" />銷售訂單
            </TabsTrigger>
            <TabsTrigger value="purchase" className="gap-1.5">
              <Truck className="h-4 w-4" />採購單
            </TabsTrigger>
            <TabsTrigger value="consignment_receive" className="gap-1.5">
              <PackageCheck className="h-4 w-4" />寄賣收貨
            </TabsTrigger>
            <TabsTrigger value="consignment_send" className="gap-1.5">
              <Send className="h-4 w-4" />寄賣出貨
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Warning for non-pending orders */}
      {c.isEditMode && c.order!.status !== 'pending' && (
        <Alert variant="default" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800 dark:text-yellow-200">
            此訂單狀態為「{statusInfo?.label}」，部分品項可能已在出貨池或已出貨。修改時請謹慎操作，避免資料不一致。
          </AlertDescription>
        </Alert>
      )}

      {/* Main area - DESKTOP (lg+): responsive expandable layout */}
      <div className="hidden lg:flex flex-col gap-4 lg:h-[calc(100vh-210px)]">
        {c.activePanel === 'items' ? (
          <>
            {/* Order items expanded: OrderInfo (top-left, header only) + ProductSelector (top-right, header only) | OrderItems (bottom, full height) */}
            <div className="flex flex-row gap-4 shrink-0">
              <div className="lg:w-[380px] shrink-0">{renderOrderInfoCard(true)}</div>
              <div className="flex-1 min-w-0">{renderProductSelector(false, true)}</div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">{renderOrderItemsPanel(false)}</div>
          </>
        ) : c.activePanel === 'information' ? (
          <>
            {/* Information expanded: OrderInfo (left, full height) | OrderItems (top-right) + ProductSelector (bottom-right) */}
            <div className="flex flex-row gap-4 min-h-0 lg:flex-1">
              <div className="lg:flex-[5] min-w-0 overflow-auto h-full">{renderOrderInfoCard(false)}</div>
              <div className="flex flex-col gap-4 lg:flex-[5] min-w-0 overflow-hidden">
                <div className="flex-1 min-h-0 overflow-auto">{renderOrderItemsPanel(false)}</div>
                <div className="flex-1 min-h-0 overflow-auto">{renderProductSelector(false, false)}</div>
              </div>
            </div>
          </>
        ) : c.activePanel === 'products' ? (
          <>
            {/* Products expanded: OrderInfo (top-left, collapsed) + OrderItems (bottom-left) | ProductSelector (right, wide) */}
            <div className="flex flex-row gap-4 min-h-0 lg:flex-1">
              <div className="flex flex-col gap-4 lg:flex-[3] min-w-0 overflow-hidden">
                <div className="shrink-0">{renderOrderInfoCard(true)}</div>
                <div className="flex-1 min-h-0 overflow-auto">{renderOrderItemsPanel(false)}</div>
              </div>
              <div className="lg:flex-[7] min-w-0 overflow-auto h-full">{renderProductSelector(false, false)}</div>
            </div>
          </>
        ) : (
          <>
            {/* Default balanced layout: OrderInfo (top-left) + OrderItems (bottom-left) | ProductSelector (right) */}
            <div className="flex flex-row gap-4 min-h-0 lg:flex-1">
              <div className="flex flex-col gap-4 lg:flex-[3] min-w-0 overflow-hidden">
                <div className="shrink-0 max-h-[340px] overflow-auto">{renderOrderInfoCard(false)}</div>
                <div className="flex-1 min-h-0 overflow-auto">{renderOrderItemsPanel(false)}</div>
              </div>
              <div className="lg:flex-[7] min-w-0 overflow-auto h-full">{renderProductSelector(false, false)}</div>
            </div>
          </>
        )}
      </div>

      {/* Main area - MOBILE (<lg): order info + order items inline, catalog in right drawer */}
      <div className="lg:hidden flex flex-col gap-4">
        {renderOrderInfoCard(false)}
        {renderOrderItemsPanel(false)}
      </div>

      {/* Mobile bottom floating button (hidden when drawer open) */}
      {!c.mobileCatalogOpen && (
        <button
          type="button"
          onClick={() => c.setMobileCatalogOpen(true)}
          className="lg:hidden fixed top-1/2 -translate-y-1/2 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          aria-label="開啟商品選擇"
        >
          <Package className="h-6 w-6" />
        </button>
      )}

      {/* Mobile right-side catalog drawer */}
      {c.mobileCatalogOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => c.setMobileCatalogOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-background shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-3 border-b shrink-0">
              <span className="font-semibold">商品選擇</span>
              <Button variant="ghost" size="icon" onClick={() => c.setMobileCatalogOpen(false)} aria-label="關閉">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">{renderProductSelector(true)}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {c.orderType === 'sales' && (
          <Button variant="outline" onClick={c.syncPrices} disabled={c.isSubmitting}>
            <Save className="mr-2 h-4 w-4" />同步價格
          </Button>
        )}
        {c.isEditMode ? (
          <>
            {c.order?.status === 'processing' && !c.isRep && (
              <Button variant="default" onClick={() => c.setDirectShipDialogOpen(true)} disabled={c.isSubmitting}>
                <Send className="mr-2 h-4 w-4" />
                {c.order?.consignment_mode ? '寄賣出貨' : '轉銷貨單'}
              </Button>
            )}
            <Button onClick={() => c.updateOrderMutation.mutate()} disabled={c.isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {c.updateOrderMutation.isPending ? '儲存中…' : '儲存變更'}
            </Button>
          </>
        ) : c.orderType === 'sales' ? (
          <>
            <Button onClick={() => c.createPendingMutation.mutate()} disabled={c.isSubmitting || c.items.length === 0}>
              {c.createPendingMutation.isPending ? '建立中…' : '建立訂單'}
            </Button>
            {!c.isRep && (
              <Button onClick={c.handleCreateWithSalesNote} disabled={c.isSubmitting || c.items.length === 0} variant="default">
                {c.consignmentMode ? '建立訂單並寄賣出貨' : '建立訂單並開立銷貨單'}
              </Button>
            )}
          </>
        ) : c.orderType === 'purchase' ? (
          <Button onClick={() => c.createPurchaseOrderMutation.mutate()} disabled={c.isSubmitting || c.items.length === 0 || !c.supplierId}>
            {c.createPurchaseOrderMutation.isPending ? '建立中…' : '建立採購單'}
          </Button>
        ) : c.orderType === 'consignment_receive' ? (
          <Button onClick={() => c.createConsignmentReceiveMutation.mutate()} disabled={c.isSubmitting || c.items.length === 0 || !c.supplierId}>
            {c.createConsignmentReceiveMutation.isPending ? '建立中…' : '建立寄賣收貨單'}
          </Button>
        ) : (
          <Button onClick={() => c.createConsignmentSendMutation.mutate()} disabled={c.isSubmitting || c.items.length === 0 || !c.supplierId || !c.targetStoreId}>
            {c.createConsignmentSendMutation.isPending ? '建立中…' : '建立寄賣出貨單'}
          </Button>
        )}
      </div>

      {/* Direct Ship Dialog */}
      <DirectShipDialog
        open={c.directShipDialogOpen}
        onOpenChange={(open) => {
          c.setDirectShipDialogOpen(open);
          if (open) c.setItemWarehouses({});
        }}
        order={c.order}
        orderId={c.orderId}
        items={c.items}
        displayStoreName={c.displayStoreName}
        shippedAt={c.shippedAt}
        onShippedAtChange={c.setShippedAt}
        getItemWarehouse={c.getItemWarehouse}
        onItemWarehouseChange={(id, w) => c.setItemWarehouses((prev) => ({ ...prev, [id]: w }))}
        itemSources={c.itemSources}
        onItemSourceChange={(id, src) => c.setItemSources((prev) => ({ ...prev, [id]: src }))}
        isPending={c.directShipMutation.isPending}
        onConfirm={() => c.directShipMutation.mutate()}
      />
    </div>
  );
}