import { useState } from 'react';
import { OrderListTab } from './components/OrderListTab';
import { SupplierTab } from './components/SupplierTab';
import { OrderForm } from './components/OrderForm';
import { SupplierForm } from './components/SupplierForm';
import { OrderDetailDialog } from './components/OrderDetailDialog';
import { PurchaseOrder } from './types';
import { usePurchaseOrders } from './hooks/usePurchaseOrders';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClipboardList, Users, Plus } from 'lucide-react';

export default function AdminPurchaseOrders() {
  const [activeTab, setActiveTab] = useState('orders');
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);

  // Custom hook for all DB operations
  const {
    suppliers,
    isLoadingSuppliers,
    orders,
    ordersLoading,
    products,
    orderItems,
    itemsLoading,
    accounts,
    createOrderMutation,
    updateOrderMutation,
    deleteOrderMutation,
    createSupplierMutation,
    addItemMutation,
    receiveItemsMutation,
    makePaymentMutation,
  } = usePurchaseOrders(viewingOrder?.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">採購管理</h1>
          <p className="text-muted-foreground">管理供應商採購單與庫存入庫作業</p>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> 採購單
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex items-center gap-2">
            <Users className="h-4 w-4" /> 供應商夥伴
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <OrderListTab
            orders={orders}
            onView={(order) => setViewingOrder(order)}
            onEdit={(order) => { setEditingOrder(order); setCreateOrderOpen(true); }}
            onDelete={(id) => { if (confirm('確定要刪除此採購單嗎？')) deleteOrderMutation.mutate(id); }}
            isLoading={ordersLoading}
          />
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
              order={viewingOrder}
              orderItems={orderItems}
              products={products}
              accounts={accounts}
              isLoading={itemsLoading || addItemMutation.isPending || receiveItemsMutation.isPending || makePaymentMutation.isPending}
              onAddItem={(data) => addItemMutation.mutate({ purchase_order_id: viewingOrder.id, ...data })}
              onImportItems={(items) => {
                items.forEach(item => addItemMutation.mutate({ purchase_order_id: viewingOrder.id, ...item }));
              }}
              onReceiveItems={(items) => receiveItemsMutation.mutate(items)}
              onMakePayment={(data) => makePaymentMutation.mutate({ orderId: viewingOrder.id, ...data })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
