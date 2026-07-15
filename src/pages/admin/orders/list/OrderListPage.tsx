import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Plus, Package, FileText, Send } from 'lucide-react';
import { OrderDetailDialog } from '@/components/order/OrderDetailDialog';
import { OrdersCardView } from '@/components/order/OrdersCardView';
import { ItemsCardView } from '@/components/order/ItemsCardView';
import { Order, OrderItem } from '@/types/order';
import { exportToCSV } from '@/lib/exportUtils';
import * as xlsx from 'xlsx';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { useOrdersList } from './hooks/useOrdersList';
import { OrderFilters } from './components/OrderFilters';
import { OrderTableView } from './components/OrderTableView';
import { ItemTableView } from './components/ItemTableView';
import { AggregateTableView, AggregatedItem } from './components/AggregateTableView';
import { AggregateCardsView } from './components/AggregateCardsView';
import { AggregateToPODialog } from './components/AggregateToPODialog';
import { BatchActionBar } from './components/BatchActionBar';
import { ShipToPoolDialog } from './components/ShipToPoolDialog';

export default function AdminOrderList() {
  const navigate = useNavigate();

  // Basic UI States
  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs = ['pending', 'processing', 'shipped'] as const;
  const urlTab = searchParams.get('tab') as typeof validTabs[number] | null;
  const [statusTab, setStatusTab] = useState<'pending' | 'processing' | 'shipped'>(
    validTabs.includes(urlTab as any) ? (urlTab as 'pending' | 'processing' | 'shipped') : 'pending'
  );
  const [viewMode, setViewMode] = useState<'orders' | 'items' | 'aggregate'>(
    searchParams.get('view') === 'items' ? 'items' : searchParams.get('view') === 'aggregate' ? 'aggregate' : 'orders'
  );
  const [search, setSearch] = useState(searchParams.get('id') || searchParams.get('search') || '');
  const [storeFilter, setStoreFilter] = useState<string>(searchParams.get('store') || 'all');

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
  const [directShipDialogOpen, setDirectShipDialogOpen] = useState(false);
  const [directShipNotes, setDirectShipNotes] = useState('');
  const [convertToPOOpen, setConvertToPOOpen] = useState(false);
  const [selectedAggregateItems, setSelectedAggregateItems] = useState<Map<string, { productId: string; variantId: string | null; quantity: number; maxQuantity: number; productName: string; sku: string; sourceOrderIds: string[] }>>(new Map());
  const { user } = useAuth();
  const queryClient = useQueryClient();

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

  const directShipMutation = useMutation({
    mutationFn: async ({
      orderIds, notes,
    }: { orderIds: string[]; notes: string }) => {
      if (!user) throw new Error('未登入');
      const results = [];
      for (const orderId of orderIds) {
        const { data, error } = await supabase.rpc('direct_ship_order', {
          p_order_id: orderId,
          p_created_by: user.id,
          p_notes: notes || null,
        });
        if (error) throw error;
        results.push(data);
      }
      return results;
    },
    onSuccess: (results, variables) => {
      const count = variables.orderIds.length;
      toast.success(`已將 ${count} 個訂單轉為銷貨單`, {
        action: count === 1 ? {
          label: '複製連結',
          onClick: () => {
            const r = results[0] as any;
            const link = `${window.location.origin}/share/sales-note/${r.sales_note_code || r.sales_note_id}?token=${r.access_token}`;
            navigator.clipboard.writeText(link);
            toast.success('連結已複製');
          },
        } : undefined,
        duration: 10000,
      });
      setDirectShipDialogOpen(false);
      setDirectShipNotes('');
      setSelectedOrderIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

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
          orderCode: order.code,
          orderStatus: order.status,
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
          orderCode: order.code,
          orderStatus: order.status,
          orderCreatedAt: order.created_at,
          storeName: order.stores?.name || '',
          storeCode: order.stores?.code || '',
          storeId: order.store_id,
          pendingQuantity: 0,
        }))
    ) || [];
  }, [orders, search, viewMode]);

  // Aggregation logic: group pending items by product_id + variant_id across all stores
  const aggregatedItems = useMemo((): AggregatedItem[] => {
    if (viewMode !== 'aggregate') return [];

    const allItems = orders?.flatMap(order =>
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
          storeName: order.stores?.name || '',
          storeCode: order.stores?.code || '',
          storeId: order.store_id,
          pendingQuantity: getPendingQuantity(item),
        }))
    ) || [];

    // Group by productId + variantId
    const grouped = new Map<string, AggregatedItem>();
    for (const item of allItems) {
      const key = `${item.product_id}_${item.variant_id || 'null'}`;
      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.totalPendingQuantity += item.pendingQuantity;
        if (!existing.sourceOrderIds.includes(item.orderId)) {
          existing.sourceOrderIds.push(item.orderId);
        }
        const existingStore = existing.storeBreakdown.find(s => s.storeId === item.storeId);
        if (existingStore) {
          existingStore.quantity += item.pendingQuantity;
        } else {
          existing.storeBreakdown.push({
            storeId: item.storeId,
            storeName: item.storeName,
            storeCode: item.storeCode,
            quantity: item.pendingQuantity,
          });
        }
      } else {
        grouped.set(key, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          productName: item.product?.name || '',
          variantName: item.product_variant?.name || null,
          sku: item.product?.sku || '',
          totalPendingQuantity: item.pendingQuantity,
          sourceOrderIds: [item.orderId],
          storeBreakdown: [{
            storeId: item.storeId,
            storeName: item.storeName,
            storeCode: item.storeCode,
            quantity: item.pendingQuantity,
          }],
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [orders, search, viewMode, getPendingQuantity]);

  // Helper functions
  const getOrderShipmentStatus = (items: OrderItem[]) => {
    if (items.length === 0) return 'waiting';
    const allProcessed = items.every((i) =>
      i.status === 'shipped' || i.status === 'cancelled' || i.status === 'discontinued'
    );
    const someShipped = items.some((i) => i.shipped_quantity > 0);
    if (allProcessed) return 'shipped';
    if (someShipped) return 'partial';
    return 'waiting';
  };

  const getOrderTotal = (items: OrderItem[]) => {
    return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  };

  const itemStatusLabels: Record<string, { label: string; className: string }> = {
    waiting: { label: '待出貨', className: 'bg-primary text-primary-foreground' },
    partial: { label: '部分出貨', className: 'bg-warning text-warning-foreground' },
    shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
    cancelled: { label: '已取消', className: 'bg-destructive text-destructive-foreground' },
    out_of_stock: { label: '缺貨', className: 'bg-muted text-muted-foreground' },
    discontinued: { label: '已停售', className: 'bg-muted text-muted-foreground' },
  };

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

  // Aggregate view handlers
  const getAggregateItemKey = (item: AggregatedItem) => `${item.productId}_${item.variantId || 'null'}`;

  const handleToggleAggregateSelection = (item: AggregatedItem, checked: boolean) => {
    const key = getAggregateItemKey(item);
    setSelectedAggregateItems(prev => {
      const next = new Map(prev);
      if (checked) {
        next.set(key, {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.totalPendingQuantity,
          maxQuantity: item.totalPendingQuantity,
          productName: item.productName,
          sku: item.sku,
          sourceOrderIds: item.sourceOrderIds,
        });
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const handleToggleAllAggregate = (checked: boolean) => {
    if (checked) {
      const next = new Map<string, { productId: string; variantId: string | null; quantity: number; maxQuantity: number; productName: string; sku: string; sourceOrderIds: string[] }>();
      aggregatedItems.forEach(item => {
        next.set(getAggregateItemKey(item), {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.totalPendingQuantity,
          maxQuantity: item.totalPendingQuantity,
          productName: item.productName,
          sku: item.sku,
          sourceOrderIds: item.sourceOrderIds,
        });
      });
      setSelectedAggregateItems(next);
    } else {
      setSelectedAggregateItems(new Map());
    }
  };

  const handleUpdateAggregateQuantity = (key: string, quantity: number) => {
    setSelectedAggregateItems(prev => {
      const next = new Map(prev);
      const item = next.get(key);
      if (item) {
        next.set(key, { ...item, quantity: Math.min(Math.max(1, quantity), item.maxQuantity) });
      }
      return next;
    });
  };

  const handleExportAggregateCSV = () => {
    const data = Array.from(selectedAggregateItems.values()).map(item => {
      const agg = aggregatedItems.find(a => getAggregateItemKey(a) === `${item.productId}_${item.variantId || 'null'}`);
      const storeDetail = agg?.storeBreakdown.map(s =>
        `${s.storeCode || s.storeName}: ${s.quantity}`
      ).join(', ') || '';
      return {
        '產品名稱': item.productName,
        'SKU': item.sku,
        '總需求量': item.maxQuantity,
        '叫貨量': item.quantity,
        '門市明細': storeDetail,
      };
    });
    exportToCSV(data, `叫貨總覽_${statusTab}`);
  };

  const handleExportAggregateExcel = () => {
    const data = Array.from(selectedAggregateItems.values()).map(item => {
      const agg = aggregatedItems.find(a => getAggregateItemKey(a) === `${item.productId}_${item.variantId || 'null'}`);
      const storeDetail = agg?.storeBreakdown.map(s =>
        `${s.storeCode || s.storeName}: ${s.quantity}`
      ).join(', ') || '';
      return {
        '產品名稱': item.productName,
        'SKU': item.sku,
        '總需求量': item.maxQuantity,
        '叫貨量': item.quantity,
        '門市明細': storeDetail,
      };
    });
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '叫貨總覽');
    xlsx.writeFile(wb, `叫貨總覽_${statusTab}_${Date.now()}.xlsx`);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] space-y-4 p-4 md:p-6 overflow-hidden bg-muted/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">所有訂單</h1>
          <p className="text-muted-foreground">查看與管理系統中的所有訂單</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          setSelectedAggregateItems(new Map());
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("tab", v);
            return next;
          }, { replace: true });
        }}
        viewMode={viewMode}
        onViewModeChange={(v) => {
          setViewMode(v);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("view", v);
            return next;
          }, { replace: true });
        }}
        search={search}
        onSearchChange={setSearch}
        storeFilter={storeFilter}
        onStoreFilterChange={(v) => {
          setStoreFilter(v);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (v && v !== "all") next.set("store", v);
            else next.delete("store");
            return next;
          }, { replace: true });
        }}
        stores={stores}
      />

      <div className="flex-1 min-h-0 flex flex-col pt-2">
        {viewMode === 'orders' && (
          <>
            {/* Desktop: Table */}
            <div className="hidden md:block flex-1 min-h-0">
              <div className="h-full flex flex-col">
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
                    if (checked) setSelectedOrderIds(new Set(filteredOrders.map(o => o.id)));
                    else setSelectedOrderIds(new Set());
                  }}
                  onView={setViewingOrder}
                  onEdit={(id) => navigate(`/admin/orders/${id}/edit`)}
                />
              </div>
            </div>
            {/* Mobile: Cards */}
            <div className="md:hidden flex-1 min-h-0">
              <OrdersCardView
                orders={filteredOrders}
                isLoading={isLoading}
                onView={setViewingOrder}
                onEdit={(id) => navigate(`/admin/orders/${id}/edit`)}
                getOrderShipmentStatus={getOrderShipmentStatus}
                getOrderTotal={getOrderTotal}
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
                      orderId: item.orderId,
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
                        orderId: item.orderId,
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
            </div>
            </div>
            {/* Mobile: Cards */}
            <div className="md:hidden flex-1 min-h-0">
              <ItemsCardView
                items={allPendingItems}
                isLoading={isLoading}
                statusLabels={itemStatusLabels}
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
                  onToggleAll={handleToggleAllAggregate}
                  onUpdateQuantity={handleUpdateAggregateQuantity}
                />
              </div>
            </div>
            {/* Mobile: Cards */}
            <div className="md:hidden flex-1 min-h-0">
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
        isLoading={confirmOrdersMutation.isPending || addToShippingPoolMutation.isPending || cancelItemsMutation.isPending || directShipMutation.isPending}
        onConfirmOrders={() => confirmOrdersMutation.mutate(Array.from(selectedOrderIds))}
        onShipItems={() => setShipToPoolOpen(true)}
        onDirectShipOrders={() => setDirectShipDialogOpen(true)}
        onCancelItems={() => {
          if (confirm(`確定要標記這 ${selectedItems.size} 個品項為 停產/取消 嗎？`)) {
            cancelItemsMutation.mutate({ itemIds: Array.from(selectedItems.keys()), targetStatus: 'cancelled' });
          }
        }}
        onConvertToPO={() => setConvertToPOOpen(true)}
        onExportAggregateCSV={handleExportAggregateCSV}
        onExportAggregateExcel={handleExportAggregateExcel}
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

      {/* Direct Ship Dialog */}
      <Dialog open={directShipDialogOpen} onOpenChange={setDirectShipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              直接轉銷貨單
            </DialogTitle>
            <DialogDescription>
              將 {selectedOrderIds.size} 個訂單的所有剩餘品項直接出貨，跳過出貨池。
              品項將全額出貨，無法部分出貨。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="text-sm flex gap-4">
                <span><span className="text-muted-foreground">選擇訂單：</span><span className="font-medium">{selectedOrderIds.size}</span></span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">備註（選填）</label>
              <Textarea
                value={directShipNotes}
                onChange={(e) => setDirectShipNotes(e.target.value)}
                placeholder="輸入出貨備註..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDirectShipDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => directShipMutation.mutate({ orderIds: Array.from(selectedOrderIds), notes: directShipNotes })}
              disabled={directShipMutation.isPending}
            >
              {directShipMutation.isPending ? '處理中...' : '確認轉銷貨單'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order Detail View */}
      <OrderDetailDialog
        order={viewingOrder}
        open={!!viewingOrder}
        onOpenChange={(open) => !open && setViewingOrder(null)}
      />

      {/* Convert to PO Dialog */}
      <AggregateToPODialog
        open={convertToPOOpen}
        onOpenChange={setConvertToPOOpen}
        selectedItems={Array.from(selectedAggregateItems.values())}
        onCreated={() => {
          setSelectedAggregateItems(new Map());
          setConvertToPOOpen(false);
        }}
      />
    </div>
  );
}
