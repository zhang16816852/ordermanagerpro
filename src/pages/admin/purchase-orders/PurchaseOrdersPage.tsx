import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { OrderListTab } from './components/OrderListTab';
import { OrderFilterBar } from './components/OrderFilterBar';
import { SupplierTab } from './components/SupplierTab';
import { ReceivingTab } from './components/ReceivingTab';
import { SupplierForm } from './components/SupplierForm';
import { PurchaseOrderDetailDialog } from './components/PurchaseOrderDetailDialog';
import { PurchaseDocImportDialog } from './components/PurchaseDocImportDialog';
import { PurchaseOrder, Supplier } from './types';
import { usePurchaseOrders, PurchaseOrderFilters } from './hooks/usePurchaseOrders';
import { poPaymentSummary } from './paymentSummary';
import {
  parsePoSort,
  sortPurchaseOrders,
  defaultPoSortDir,
  type PoSortField,
} from './orderSort';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/formatters';
import { ClipboardList, Users, Plus, PackageCheck, FileUp, Undo2 } from 'lucide-react';

export default function AdminPurchaseOrders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'orders');
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'purchase' | 'returns'>('purchase');
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);


  const [filters, setFilters] = useState<PurchaseOrderFilters>({
    supplierId: searchParams.get('supplier') || undefined,
    purpose: searchParams.get('purpose') || undefined,
    status: searchParams.get('status') || undefined,
    dateFrom: searchParams.get('from') || undefined,
    dateTo: searchParams.get('to') || undefined,
  });

  // 排列狀態直接以網址為單一真值（不另存 useState），避免與網址不同步
  const { sortField, sortDir } = useMemo(() => parsePoSort(searchParams), [searchParams]);

  const writeSortUrl = (patch: { sortField?: PoSortField; sortDir?: 'asc' | 'desc' }) => {
    setSearchParams((prevParams) => {
      const sp = new URLSearchParams(prevParams);
      const nextField = patch.sortField ?? sortField;
      const nextDir = patch.sortDir ?? sortDir;
      sp.set('sort', nextField);
      sp.set('dir', nextDir);
      return sp;
    }, { replace: true });
  };

  /** 表頭點擊：同一欄翻轉方向；換欄位則取該欄預設方向（數值／日期由大到小） */
  const handleSort = (field: PoSortField) => {
    if (field === sortField) {
      writeSortUrl({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      writeSortUrl({ sortField: field, sortDir: defaultPoSortDir(field) });
    }
  };

  /** 手機版排序下拉：只換欄位，方向取預設 */
  const handleSortFieldChange = (field: PoSortField) => {
    writeSortUrl({ sortField: field, sortDir: defaultPoSortDir(field) });
  };

  /** 手機版方向鈕：只翻轉方向 */
  const handleToggleSortDir = () => {
    writeSortUrl({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
  };

  const updateFilterUrl = (patch: PurchaseOrderFilters) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      setSearchParams((prevParams) => {
        const sp = new URLSearchParams(prevParams);
        const keys: (keyof PurchaseOrderFilters)[] = ['supplierId', 'purpose', 'status', 'dateFrom', 'dateTo'];
        keys.forEach((k) => {
          const spKey = k === 'supplierId' ? 'supplier' : k === 'dateFrom' ? 'from' : k === 'dateTo' ? 'to' : k;
          const v = next[k];
          if (v && v !== 'all') sp.set(spKey, v);
          else sp.delete(spKey);
        });
        return sp;
      }, { replace: true });
      return next;
    });
  };

  // Custom hook for all DB operations
  const {
    suppliers,
    isLoadingSuppliers,
    orders,
    ordersLoading,
    products,
    orderItems,
    itemsLoading,
    sourceOrderMap,
    supplierMappingMap,
    accounts,
    categories,
    paidAmountMap,
    canSeePayments,
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    updateSupplierMutation,
    updateItemMutation,
    deleteItemMutation,
    reorderItemsMutation,
    importItemsMutation,
    receiveItemsMutation,
    recordPaymentMutation,
    unlinkOrdersFromPurchaseMutation,
  } = usePurchaseOrders(viewingOrder?.id, filters);

  // 金額摘要直接由「已套用篩選後的 orders」推導，因此篩選條件一變動即同步更新。
  // 採購退貨單為負數金額，此處帶正負號回加，讓 總金額 = 已付 + 未付 恆成立。
  const paymentSummary = useMemo(() => {
    let total = 0;
    let paid = 0;
    let unpaid = 0;
    let unpaidCount = 0;
    for (const order of orders) {
      const s = poPaymentSummary(order.total_amount, paidAmountMap[order.id]);
      const sign = s.isCredit ? -1 : 1;
      total += sign * s.payable;
      paid += sign * s.paid;
      unpaid += sign * s.unpaid;
      if (s.unpaid > 0) unpaidCount += 1;
    }
    return { total, paid, unpaid, unpaidCount };
  }, [orders, paidAmountMap]);

  // 列表排列（純顯示層）。刻意不併入 filters —— filters 同時是 usePurchaseOrders 的
  // queryKey 與 PostgREST 條件，放排序進去會讓切換排列時重新打 DB。
  const sortedOrders = useMemo(
    () => sortPurchaseOrders(orders, sortField, sortDir),
    [orders, sortField, sortDir],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">採購管理</h1>
          <p className="text-muted-foreground">管理供應商採購單、進貨收貨與庫存入庫作業</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateSupplierOpen(true)} variant="outline">
            <Plus className="h-4 w-4 mr-2" /> 新增供應商
          </Button>
          <Button onClick={() => { setImportMode('purchase'); setImportOpen(true); }} variant="outline">
            <FileUp className="h-4 w-4 mr-2" /> 匯入採購單
          </Button>
          <Button onClick={() => { setImportMode('returns'); setImportOpen(true); }} variant="outline">
            <Undo2 className="h-4 w-4 mr-2" /> 匯入退貨單
          </Button>
          <Button onClick={() => navigate('/admin/orders/checkout?type=purchase')}>
            <Plus className="h-4 w-4 mr-2" /> 建立採購單
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", v);
          return next;
        }, { replace: true });
      }} className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" aria-hidden="true" /> 採購單
          </TabsTrigger>
          <TabsTrigger value="receiving" className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4" aria-hidden="true" /> 進貨處理
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex items-center gap-2">
            <Users className="h-4 w-4" aria-hidden="true" /> 供應商夥伴
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          {/* Filters + 排列入口 */}
          <OrderFilterBar
            suppliers={suppliers}
            filters={filters}
            onFiltersChange={updateFilterUrl}
            onClearFilters={() =>
              updateFilterUrl({
                supplierId: undefined,
                purpose: undefined,
                status: undefined,
                dateFrom: undefined,
                dateTo: undefined,
              })
            }
            sortField={sortField}
            sortDir={sortDir}
            onSortFieldChange={handleSortFieldChange}
            onToggleSortDir={handleToggleSortDir}
          />

          {/* 金額摘要：依目前篩選條件計算 */}
          {!ordersLoading && orders.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs sm:text-sm leading-4">
              <span>採購單: <strong>{orders.length}</strong> 張</span>
              <span className="text-muted-foreground">|</span>
              <span>總金額: <strong>{formatCurrency(paymentSummary.total)}</strong></span>
              {canSeePayments && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-green-600">已付: <strong>{formatCurrency(paymentSummary.paid)}</strong></span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-amber-600">
                    未付: <strong>{formatCurrency(paymentSummary.unpaid)}</strong>
                    <span className="text-muted-foreground">（{paymentSummary.unpaidCount} 張未付清）</span>
                  </span>
                </>
              )}
            </div>
          )}

          <OrderListTab
            orders={sortedOrders}
            onView={(order) => setViewingOrder(order)}
            onEdit={(order) => navigate(`/admin/purchase-orders/${order.id}/edit`)}
            onDelete={(id) => { if (confirm('確定要刪除此採購單嗎？')) deleteOrderMutation.mutate(id); }}
            onStatusChange={(id, status: any) => updateOrderMutation.mutate({ id, status })}
            isLoading={ordersLoading}
            paidAmountMap={canSeePayments ? paidAmountMap : undefined}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
          />
        </TabsContent>

        <TabsContent value="receiving" className="space-y-4">
          <ReceivingTab />
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          <SupplierTab
            suppliers={suppliers}
            onAdd={() => setCreateSupplierOpen(true)}
            onEdit={setEditingSupplier}
            isLoading={isLoadingSuppliers}
          />
        </TabsContent>
      </Tabs>

      {/* New Supplier Dialog */}
      <Dialog open={createSupplierOpen} onOpenChange={setCreateSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增供應商</DialogTitle>
            <DialogDescription>
              建立新的供應商聯絡資訊，以便後續進行採購與產品對照管理。
            </DialogDescription>
          </DialogHeader>
          <SupplierForm
            isLoading={createSupplierMutation.isPending}
            onSubmit={(data) => {
              createSupplierMutation.mutate(data, {
                onSuccess: () => setCreateSupplierOpen(false)
              });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Supplier Dialog */}
      <Dialog open={!!editingSupplier} onOpenChange={(open) => { if (!open) setEditingSupplier(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>編輯供應商</DialogTitle>
            <DialogDescription>
              修改供應商聯絡資訊；勾選「物流公司」可讓此供應商作為配送方式綁定的物流商。
            </DialogDescription>
          </DialogHeader>
          {editingSupplier && (
            <SupplierForm
              key={editingSupplier.id}
              initial={editingSupplier}
              isLoading={updateSupplierMutation.isPending}
              onSubmit={(data) => {
                updateSupplierMutation.mutate({ id: editingSupplier.id, ...data }, {
                  onSuccess: () => setEditingSupplier(null)
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Order Detail View Dialog */}
      <Dialog open={!!viewingOrder} onOpenChange={(open) => { if (!open) setViewingOrder(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              採購單詳情
            </DialogTitle>
            <DialogDescription>
              檢視此採購單的所有品項、收貨進度與付款對帳紀錄。
            </DialogDescription>
          </DialogHeader>
          {viewingOrder && (
            <PurchaseOrderDetailDialog
              key={viewingOrder.id}
              order={viewingOrder}
              orderItems={orderItems}
              products={products}
              accounts={accounts}
              categories={categories}
              paidAmount={canSeePayments ? paidAmountMap[viewingOrder.id] : undefined}
              sourceOrderMap={sourceOrderMap}
              supplierMappingMap={supplierMappingMap}
              isLoading={itemsLoading || importItemsMutation.isPending || receiveItemsMutation.isPending || recordPaymentMutation.isPending}
              onImportItems={(data) => importItemsMutation.mutateAsync(data)}
              onReceiveItems={(items) => receiveItemsMutation.mutate(items)}
              onMakePayment={(data, references) => {
                recordPaymentMutation.mutate(
                  { orderIds: [viewingOrder.id], data, references },
                  { onSuccess: () => setViewingOrder(null) },
                );
              }}
              onEditOrder={() => navigate(`/admin/purchase-orders/${viewingOrder.id}/edit`)}
              onUpdateItem={(data) => updateItemMutation.mutateAsync(data)}
              onDeleteItem={(data) => deleteItemMutation.mutateAsync(data)}
              onUnlinkOrder={(orderId) => {
                if (window.confirm(`確定要解除與此訂單（${sourceOrderMap[orderId] || orderId.slice(0, 8)}）的採購關聯嗎？\n未收貨的數量將從採購單中扣除，並可重新進行採購。`)) {
                  unlinkOrdersFromPurchaseMutation.mutate({ purchaseOrderId: viewingOrder.id, orderIds: [orderId] });
                }
              }}
              onReorder={(items) => reorderItemsMutation.mutateAsync(items)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Import Dialog */}
      <PurchaseDocImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        suppliers={suppliers}
        defaultSupplierId={filters.supplierId}
        mode={importMode}
      />

    </div>
  );
}
