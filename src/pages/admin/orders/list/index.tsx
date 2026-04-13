import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus, Package, FileText } from 'lucide-react';
import { OrderDetailDialog } from '@/components/order/OrderDetailDialog';
import { Order } from '@/types/order';
import { exportToCSV } from '@/lib/exportUtils';

import { useOrdersList } from './hooks/useOrdersList';
import { OrderFilters } from './components/OrderFilters';
import { OrderTableView } from './components/OrderTableView';
import { ItemTableView } from './components/ItemTableView';
import { BatchActionBar } from './components/BatchActionBar';
import { ShipToPoolDialog } from './components/ShipToPoolDialog';

export default function AdminOrderList() {
  const navigate = useNavigate();

  // Basic UI States
  const [searchParams] = useSearchParams();
  const [statusTab, setStatusTab] = useState<'pending' | 'processing' | 'shipped'>('pending');
  const [viewMode, setViewMode] = useState<'orders' | 'items'>('orders');
  const [search, setSearch] = useState(searchParams.get('id') || searchParams.get('search') || '');
  const [storeFilter, setStoreFilter] = useState<string>('all');

  // 當 URL 參數變動時同步搜尋框
  useEffect(() => {
    const id = searchParams.get('id');
    const q = searchParams.get('search');
    if (id) setSearch(id);
    else if (q) setSearch(q);
  }, [searchParams]);

  // Selection States
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Map<string, any>>(new Map());
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [shipToPoolOpen, setShipToPoolOpen] = useState(false);

  // Core Hook
  const {
    stores,
    orders,
    isLoading,
    shippingPoolMap,
    getPendingQuantity,
    syncOrdersMutation,
    confirmOrdersMutation,
    addToShippingPoolMutation,
    cancelItemsMutation,
  } = useOrdersList(storeFilter, statusTab);

  // Filtering Logic (Orders)
  const filteredOrders = useMemo(() => {
    return orders?.filter((order) => {
      if (!search || viewMode !== 'orders') return true;
      const searchLower = search.toLowerCase();
      return (
        order.stores?.name.toLowerCase().includes(searchLower) ||
        order.stores?.code?.toLowerCase().includes(searchLower) ||
        order.id.toLowerCase().includes(searchLower) ||
        (order.code && order.code.toLowerCase().includes(searchLower))
      );
    }) || [];
  }, [orders, search, viewMode]);

  // Filtering Logic (Items - Flattened)
  const allPendingItems = useMemo(() => {
    if (viewMode !== 'items') return [];
    return orders?.flatMap(order =>
      order.order_items
        .filter(item => getPendingQuantity(item) > 0 && item.status !== 'cancelled' && item.status !== 'discontinued')
        .filter(item => {
          if (!search) return true;
          const searchLower = search.toLowerCase();
          return (
            item.product?.name.toLowerCase().includes(searchLower) ||
            item.product?.sku.toLowerCase().includes(searchLower)
          );
        })
        .map(item => ({
          ...item,
          orderId: order.id,
          orderCreatedAt: order.created_at,
          storeName: order.stores?.name || '',
          storeCode: order.stores?.code || '',
          storeId: order.store_id,
          pendingQuantity: getPendingQuantity(item),
        }))
    ) || [];
  }, [orders, search, viewMode, getPendingQuantity]);

  const allCancelledItems = useMemo(() => {
    if (viewMode !== 'items') return [];
    return orders?.flatMap(order =>
      order.order_items
        .filter(item => item.status === 'cancelled' || item.status === 'discontinued')
        .filter(item => {
          if (!search) return true;
          const searchLower = search.toLowerCase();
          return (
            item.product?.name.toLowerCase().includes(searchLower) ||
            item.product?.sku.toLowerCase().includes(searchLower)
          );
        })
        .map(item => ({
          ...item,
          orderId: order.id,
          orderCreatedAt: order.created_at,
          storeName: order.stores?.name || '',
          storeCode: order.stores?.code || '',
          storeId: order.store_id,
          pendingQuantity: 0,
        }))
    ) || [];
  }, [orders, search, viewMode]);

  // Grouped Selections for Dialog
  const groupedSelections = useMemo(() => {
    return Array.from(selectedItems.values()).reduce((acc, item) => {
      if (!acc[item.storeId]) {
        acc[item.storeId] = { storeName: item.storeName, items: [] };
      }
      acc[item.storeId].items.push(item);
      return acc;
    }, {} as Record<string, { storeName: string; items: any[] }>);
  }, [selectedItems]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] space-y-4 p-4 md:p-6 overflow-hidden bg-muted/10">
      <div className="flex items-center justify-between flex-none">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">所有訂單</h1>
          <p className="text-muted-foreground">查看與管理系統中的所有訂單</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate('/admin/orders/new')} size="sm">
            <Plus className="mr-2 h-4 w-4" /> 代訂訂單
          </Button>
          <Button
            onClick={() => {
                const exportData = filteredOrders.map(o => ({
                    "店鋪名稱": o.stores?.name,
                    "訂單ID": o.id,
                    "訂單編號": o.code || '-',
                    "狀態": o.status,
                    "建立日期": new Date(o.created_at).toLocaleString(),
                    "備註": o.notes || '-'
                }));
                exportToCSV(exportData, `訂單列表_${statusTab}`);
            }}
            variant="outline"
            size="sm"
          >
            <FileText className="mr-2 h-4 w-4" /> 匯出 CSV
          </Button>
          <Button
            onClick={() => syncOrdersMutation.mutate()}
            variant="outline"
            size="sm"
            disabled={syncOrdersMutation.isPending}
          >
            <Package className="mr-2 h-4 w-4" /> 同步舊訂單狀態
          </Button>
        </div>
      </div>

      <OrderFilters
        statusTab={statusTab}
        onStatusTabChange={(v) => {
          setStatusTab(v);
          setSelectedOrderIds(new Set());
          setSelectedItems(new Map());
        }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        search={search}
        onSearchChange={setSearch}
        storeFilter={storeFilter}
        onStoreFilterChange={setStoreFilter}
        stores={stores}
      />

      <div className="flex-1 min-h-0 flex flex-col pt-2">
        {viewMode === 'orders' ? (
          <OrderTableView
            orders={filteredOrders}
            isLoading={isLoading}
            statusTab={statusTab}
            selectedOrderIds={selectedOrderIds}
            onToggleSelection={(id, checked) => {
              const next = new Set(selectedOrderIds);
              if (checked) next.add(id); else next.delete(id);
              setSelectedOrderIds(next);
            }}
            onToggleAll={(checked) => {
              if (checked) setSelectedOrderIds(new Set(filteredOrders.map(o => o.code || o.id)));
              else setSelectedOrderIds(new Set());
            }}
            onView={setViewingOrder}
            onEdit={(id) => navigate(`/admin/orders/${id}/edit`)}
          />
        ) : (
          <ItemTableView
            items={allPendingItems}
            cancelledItems={allCancelledItems}
            isLoading={isLoading}
            selectedItems={selectedItems}
            shippingPoolMap={shippingPoolMap}
            onToggleSelection={(item, checked) => {
              const next = new Map(selectedItems);
              if (checked) {
                next.set(item.id, {
                  itemId: item.id,
                  productName: item.product?.name || '',
                  sku: item.product?.sku || '',
                  quantity: item.pendingQuantity,
                  maxQuantity: item.pendingQuantity,
                  storeId: item.storeId,
                  storeName: item.storeName,
                });
              } else next.delete(item.id);
              setSelectedItems(next);
            }}
            onToggleAll={(checked) => {
              if (checked) {
                const next = new Map();
                allPendingItems.forEach(item => {
                  next.set(item.id, {
                    itemId: item.id,
                    productName: item.product?.name || '',
                    sku: item.product?.sku || '',
                    quantity: item.pendingQuantity,
                    maxQuantity: item.pendingQuantity,
                    storeId: item.storeId,
                    storeName: item.storeName,
                  });
                });
                setSelectedItems(next);
              } else setSelectedItems(new Map());
            }}
            onUpdateQuantity={(id, qty) => {
              const next = new Map(selectedItems);
              const item = next.get(id);
              if (item) {
                next.set(id, { ...item, quantity: Math.min(Math.max(1, qty), item.maxQuantity) });
                setSelectedItems(next);
              }
            }}
            onRestoreItem={(id) => cancelItemsMutation.mutate({ itemIds: [id], targetStatus: 'waiting' })}
          />
        )}
      </div>

      <BatchActionBar
        statusTab={statusTab}
        viewMode={viewMode}
        selectedOrderCount={selectedOrderIds.size}
        selectedItemCount={selectedItems.size}
        isLoading={confirmOrdersMutation.isPending || addToShippingPoolMutation.isPending || cancelItemsMutation.isPending}
        onConfirmOrders={() => confirmOrdersMutation.mutate(Array.from(selectedOrderIds))}
        onShipItems={() => setShipToPoolOpen(true)}
        onCancelItems={() => {
          if (confirm(`確定要標記這 ${selectedItems.size} 個品項為 停產/取消 嗎？`)) {
            cancelItemsMutation.mutate({ itemIds: Array.from(selectedItems.keys()), targetStatus: 'cancelled' });
          }
        }}
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

      {/* Order Detail View */}
      <OrderDetailDialog
        order={viewingOrder}
        open={!!viewingOrder}
        onOpenChange={(open) => !open && setViewingOrder(null)}
      />
    </div>
  );
}
