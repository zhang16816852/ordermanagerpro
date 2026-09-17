import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OrderListTab } from './components/OrderListTab';
import { SupplierTab } from './components/SupplierTab';
import { ReceivingTab } from './components/ReceivingTab';
import { OrderForm } from './components/OrderForm';
import { SupplierForm } from './components/SupplierForm';
import { OrderDetailDialog } from './components/OrderDetailDialog';
import { PurchaseOrder } from './types';
import { usePurchaseOrders, PurchaseOrderFilters } from './hooks/usePurchaseOrders';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { isSameDay } from 'date-fns';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { ClipboardList, Users, Plus, PackageCheck, CalendarIcon, X, Trash2 } from 'lucide-react';

export default function AdminPurchaseOrders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'orders');
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);

  const [filters, setFilters] = useState<PurchaseOrderFilters>({
    supplierId: searchParams.get('supplier') || undefined,
    purpose: searchParams.get('purpose') || undefined,
    status: searchParams.get('status') || undefined,
    dateFrom: searchParams.get('from') || undefined,
    dateTo: searchParams.get('to') || undefined,
  });
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>(
    filters.dateFrom && filters.dateTo
      ? { from: new Date(filters.dateFrom), to: new Date(filters.dateTo) }
      : {}
  );

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
    createOrderMutation,
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    addItemMutation,
    reorderItemsMutation,
    importItemsMutation,
    receiveItemsMutation,
    makePaymentMutation,
    unlinkOrdersFromPurchaseMutation,
  } = usePurchaseOrders(viewingOrder?.id, filters);

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
          <Button onClick={() => setCreateOrderOpen(true)}>
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
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.supplierId || 'all'} onValueChange={(v) => updateFilterUrl({ supplierId: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="全部供應商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部供應商</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.purpose || 'all'} onValueChange={(v) => updateFilterUrl({ purpose: v })}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部類型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類型</SelectItem>
                <SelectItem value="general">一般進貨</SelectItem>
                <SelectItem value="repair_parts">維修叫料</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.status || 'all'} onValueChange={(v) => updateFilterUrl({ status: v })}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="ordered">已下單</SelectItem>
                <SelectItem value="partial_received">部分收貨</SelectItem>
                <SelectItem value="received">已收貨</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>

            {/* Date range filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[260px] justify-start text-left font-normal",
                    !dateRange.from && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to && !isSameDay(dateRange.from, dateRange.to) ? (
                      <>
                        {format(dateRange.from, "yyyy/MM/dd")} ~ {format(dateRange.to, "yyyy/MM/dd")}
                      </>
                    ) : (
                      format(dateRange.from, "yyyy/MM/dd")
                    )
                  ) : (
                    <span>選擇日期範圍</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange as any}
                  onSelect={(range) => {
                    const resolved: { from?: Date; to?: Date } = range?.from && !range.to
                      ? { from: range.from, to: range.from }
                      : range || {};
                    setDateRange(resolved);
                    updateFilterUrl({
                      dateFrom: resolved.from ? format(resolved.from, "yyyy-MM-dd") : undefined,
                      dateTo: resolved.to ? format(resolved.to, "yyyy-MM-dd") : undefined,
                    });
                  }}
                  numberOfMonths={2}
                  locale={zhTW}
                />
              </PopoverContent>
            </Popover>
            {(filters.dateFrom || filters.dateTo) && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="清除日期篩選"
                onClick={() => {
                  setDateRange({});
                  updateFilterUrl({ dateFrom: undefined, dateTo: undefined });
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {(filters.supplierId || filters.purpose || filters.status || filters.dateFrom || filters.dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setDateRange({});
                  updateFilterUrl({ supplierId: undefined, purpose: undefined, status: undefined, dateFrom: undefined, dateTo: undefined });
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />清除篩選
              </Button>
            )}
          </div>

          <OrderListTab
            orders={orders}
            onView={(order) => setViewingOrder(order)}
            onEdit={(order) => { setEditingOrder(order); setCreateOrderOpen(true); }}
            onDelete={(id) => { if (confirm('確定要刪除此採購單嗎？')) deleteOrderMutation.mutate(id); }}
            onStatusChange={(id, status: any) => updateOrderMutation.mutate({ id, status })}
            isLoading={ordersLoading}
          />
        </TabsContent>

        <TabsContent value="receiving" className="space-y-4">
          <ReceivingTab />
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          <SupplierTab
            suppliers={suppliers}
            onAdd={() => setCreateSupplierOpen(true)}
            isLoading={isLoadingSuppliers}
          />
        </TabsContent>
      </Tabs>

      {/* Create/Edit Order Dialog */}
      <Dialog
        open={createOrderOpen}
        onOpenChange={(open) => {
          setCreateOrderOpen(open);
          if (!open) setEditingOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOrder ? '編輯採購單' : '建立採購單'}</DialogTitle>
            <DialogDescription>
              填寫採購單的基本資訊，包含供應商選擇與預期到貨日期。
            </DialogDescription>
          </DialogHeader>
          <OrderForm
            order={editingOrder}
            suppliers={suppliers}
            isLoading={createOrderMutation.isPending || updateOrderMutation.isPending}
            onSubmit={(data) => {
              if (editingOrder) {
                updateOrderMutation.mutate({ id: editingOrder.id, ...data }, {
                  onSuccess: () => setCreateOrderOpen(false)
                });
              } else {
                createOrderMutation.mutate(data, {
                  onSuccess: () => setCreateOrderOpen(false)
                });
              }
            }}
          />
        </DialogContent>
      </Dialog>

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
            <OrderDetailDialog
              key={viewingOrder.id}
              order={viewingOrder}
              orderItems={orderItems}
              products={products}
              accounts={accounts}
              sourceOrderMap={sourceOrderMap}
              supplierMappingMap={supplierMappingMap}
              isLoading={itemsLoading || addItemMutation.isPending || importItemsMutation.isPending || receiveItemsMutation.isPending || makePaymentMutation.isPending}
              onAddItem={(data) => addItemMutation.mutate({ purchase_order_id: viewingOrder.id, ...data })}
              onImportItems={(items) => importItemsMutation.mutate({ purchaseOrderId: viewingOrder.id, items })}
              onReceiveItems={(items) => receiveItemsMutation.mutate(items)}
              onMakePayment={(data) => makePaymentMutation.mutate({ orderId: viewingOrder.id, ...data })}
              onUnlinkOrder={(orderId) => {
                if (window.confirm(`確定要解除與此訂單（${sourceOrderMap[orderId] || orderId.slice(0, 8)}）的採購關聯嗎？\n未收貨的數量將從採購單中扣除，並可重新進行採購。`)) {
                  unlinkOrdersFromPurchaseMutation.mutate({ purchaseOrderId: viewingOrder.id, orderIds: [orderId] });
                }
              }}
              onReorder={(items) => reorderItemsMutation.mutate(items)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
