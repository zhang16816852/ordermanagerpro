import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Package, FileText, Send, Store, RotateCcw } from 'lucide-react';
import { WarehouseSelector } from "@/components/WarehouseSelector";
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { OrderDetailDialog } from '@/components/order/OrderDetailDialog';
import { OrdersCardView } from '@/components/order/OrdersCardView';
import { ItemsCardView } from '@/components/order/ItemsCardView';
import { Order, OrderItem } from '@/types/order';
import { exportToCSV } from '@/lib/exportUtils';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';

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
  const { defaultWarehouse } = useWarehouses();
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
  const [orderPoolOpen, setOrderPoolOpen] = useState(false);
  const [convertToConsignmentOpen, setConvertToConsignmentOpen] = useState(false);
  const [reverseShipmentOrder, setReverseShipmentOrder] = useState<{ order: Order; consignmentOrderId: string } | null>(null);
  const [reverseNote, setReverseNote] = useState('');
  const [directShipDialogOpen, setDirectShipDialogOpen] = useState(false);
  const [directShipNotes, setDirectShipNotes] = useState('');
  const [directShipAt, setDirectShipAt] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [itemWarehouses, setItemWarehouses] = useState<Record<string, string>>({});

  const getItemWarehouse = (itemId: string) => itemWarehouses[itemId] || defaultWarehouse?.id || '';
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
      const results: any[] = [];
      for (const orderId of orderIds) {
        const order = orders.find(o => o.id === orderId);
        const warehouseMap: Record<string, string> = {};
        if (order?.order_items) {
          for (const item of order.order_items) {
            const wh = getItemWarehouse(item.id);
            if (wh) warehouseMap[item.id] = wh;
          }
        }
        const { data, error } = await supabase.rpc('direct_ship_order', {
          p_order_id: orderId,
          p_created_by: user.id,
          p_notes: notes || undefined,
          p_shipped_at: directShipAt ? new Date(directShipAt).toISOString() : undefined,
          p_warehouse_id: undefined,
          p_warehouse_map: warehouseMap as any,
        });
        if (error) throw error;
        results.push(data as any);
      }
      return results;
    },
    onSuccess: (results, variables) => {
      const count = variables.orderIds.length;
      const isConsignmentShip = Array.from(variables.orderIds).every(
        (id) => orders.find((o) => o.id === id)?.consignment_mode
      );
      toast.success(isConsignmentShip ? `已寄賣出貨 ${count} 個訂單` : `已將 ${count} 個訂單轉為銷貨單`, {
        action: count === 1 && !isConsignmentShip ? {
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

  const convertToConsignmentMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      if (!user) throw new Error('未登入');
      const { error: markError } = await (supabase
        .from('orders') as any)
        .update({ consignment_mode: true })
        .in('id', orderIds);
      if (markError) throw markError;
      for (const orderId of orderIds) {
        const { data, error } = await supabase.rpc('direct_ship_order', {
          p_order_id: orderId,
          p_created_by: user.id,
          p_notes: undefined,
          p_shipped_at: undefined,
          p_warehouse_id: undefined,
          p_warehouse_map: undefined,
          p_source_map: undefined,
        });
        if (error) throw error;
      }
      return orderIds;
    },
    onSuccess: (orderIds) => {
      toast.success(`已將 ${orderIds.length} 個訂單轉為寄賣出貨`);
      setConvertToConsignmentOpen(false);
      setSelectedOrderIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const reverseShipmentMutation = useMutation({
    mutationFn: async ({ consignmentOrderId, note }: { consignmentOrderId: string; note: string }) => {
      if (!user) throw new Error('未登入');
      const { data, error } = await supabase.rpc('reverse_consignment_shipment', {
        p_consignment_order_id: consignmentOrderId,
        p_created_by: user.id,
        p_note: note || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('已回滾出貨，品項已放回出貨池');
      setReverseShipmentOrder(null);
      setReverseNote('');
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const handleReverseShipment = async (order: Order) => {
    if (!user) {
      toast.error('未登入');
      return;
    }
    const { data, error } = await (supabase.from('consignment_orders') as any)
      .select('id')
      .eq('source_order_id', order.id)
      .eq('direction', 'send_to_store')
      .eq('status', 'active')
      .maybeSingle();
    if (error) {
      toast.error(getErrorMessage(error));
      return;
    }
    if (!data) {
      toast.error('找不到對應的寄賣單');
      return;
    }
    setReverseShipmentOrder({ order, consignmentOrderId: data.id });
    setReverseNote('');
  };

  const orderPoolGroupedItems = useMemo(() => {
    const grouped: Record<string, { storeName: string; items: any[] }> = {};
    for (const order of orders) {
      if (!selectedOrderIds.has(order.id)) continue;
      for (const item of order.order_items) {
        const pending = getPendingQuantity(item);
        if (pending <= 0) continue;
        if (item.status === 'cancelled' || item.status === 'discontinued') continue;
        if (!grouped[order.store_id]) {
          grouped[order.store_id] = { storeName: order.stores?.name || '', items: [] };
        }
        grouped[order.store_id].items.push({
          itemId: item.id,
          productName: item.product?.name || '',
          sku: item.product?.code || '',
          quantity: pending,
          maxQuantity: pending,
          storeId: order.store_id,
          storeName: order.stores?.name || '',
          orderId: order.id,
        });
      }
    }
    return grouped;
  }, [orders, selectedOrderIds, getPendingQuantity]);
  useEffect(() => {
    if (!directShipDialogOpen || !defaultWarehouse) return;

    const items = orders
      .filter(o => selectedOrderIds.has(o.id))
      .flatMap(o => o.order_items)
      .filter(item =>
        item.status !== 'cancelled' &&
        item.status !== 'discontinued' &&
        (item.quantity - item.shipped_quantity) > 0
      );
    if (items.length === 0) return;

    const productIds = [...new Set(items.map(i => i.product_id))];

    (supabase
      .from('product_inventory') as any)
      .select('product_id, variant_id, warehouse_id, quantity')
      .in('product_id', productIds)
      .then(({ data: inventory }: any) => {
        const whMap: Record<string, string> = {};
        for (const item of items) {
          const inv = (inventory || []).filter(i =>
            i.product_id === item.product_id &&
            (i.variant_id === item.variant_id || (!i.variant_id && !item.variant_id))
          );
          const defaultStocked = inv.find(i => i.warehouse_id === defaultWarehouse.id && i.quantity > 0);
          if (defaultStocked) {
            whMap[item.id] = defaultStocked.warehouse_id;
            continue;
          }
          const anyStocked = inv.find(i => i.quantity > 0);
          if (anyStocked) {
            whMap[item.id] = anyStocked.warehouse_id;
            continue;
          }
          whMap[item.id] = defaultWarehouse.id;
        }
        setItemWarehouses(whMap);
      });
  }, [directShipDialogOpen, selectedOrderIds, orders, defaultWarehouse]);

  // Filtering Logic (Orders)
  const matchesSearch = useCallback((order: Order) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      order.stores?.name.toLowerCase().includes(searchLower) ||
      order.stores?.code?.toLowerCase().includes(searchLower) ||
      order.id.toLowerCase().includes(searchLower) ||
      (order.code && order.code.toLowerCase().includes(searchLower))
    );
  }, [search]);

  const filteredOrders = useMemo(() => {
    return orders?.filter((order) => {
      if (viewMode !== 'orders') return true;
      return matchesSearch(order);
    }) || [];
  }, [orders, viewMode, matchesSearch]);

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
            item.product?.code.toLowerCase().includes(searchLower)
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
            item.product?.code.toLowerCase().includes(searchLower)
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
            item.product?.code.toLowerCase().includes(searchLower)
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
          sku: item.product?.code || '',
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

  const handleExportAggregateCSV = async () => {
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
    await exportToCSV(data, `叫貨總覽_${statusTab}`);
  };

  const handleExportAggregateExcel = async () => {
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
    const xlsx = await import('xlsx');
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '叫貨總覽');
    xlsx.writeFile(wb, `叫貨總覽_${statusTab}_${Date.now()}.xlsx`);
  };

  const selectedOrdersArray = Array.from(selectedOrderIds)
    .map((id) => filteredOrders.find((o) => o.id === id))
    .filter((o): o is Order => !!o);
  const hasConsignmentSelection = selectedOrdersArray.some((o) => o.consignment_mode);
  const hasNormalSelection = selectedOrdersArray.some((o) => !o.consignment_mode);
  const allSelectedConsignment =
    selectedOrdersArray.length > 0 && selectedOrdersArray.every((o) => o.consignment_mode);

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
            onClick={async () => {
                const exportData = filteredOrders.map(o => ({
                    "店鋪名稱": o.stores?.name,
                    "訂單ID": o.id,
                    "訂單編號": o.code || '-',
                    "狀態": o.status,
                    "建立日期": new Date(o.created_at).toLocaleString(),
                    "備註": o.notes || '-'
                }));
                await exportToCSV(exportData, `訂單列表_${statusTab}`);
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
                  onReverseShipment={handleReverseShipment}
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
                onReverseShipment={handleReverseShipment}
                statusTab={statusTab}
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
                      sku: item.product?.code || '',
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
                        sku: item.product?.code || '',
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
      <Dialog open={convertToConsignmentOpen} onOpenChange={setConvertToConsignmentOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              轉寄賣出貨
            </DialogTitle>
            <DialogDescription>
              將所選訂單標記為寄賣模式並直接出貨，不開立銷貨單；店家確認售出後才開立收款銷貨單。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border divide-y max-h-96 overflow-y-auto">
            {orders.filter(o => selectedOrderIds.has(o.id)).map(order => (
              <div key={order.id} className="flex items-center justify-between px-3 py-2">
                <div className="text-sm font-medium">{order.code} - {order.stores?.name || '未知店家'}</div>
                <div className="text-xs text-muted-foreground">{order.order_items.filter(i => i.status !== 'cancelled' && i.status !== 'discontinued' && (i.quantity - i.shipped_quantity) > 0).length} 個品項待寄賣出貨</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertToConsignmentOpen(false)} disabled={convertToConsignmentMutation.isPending}>
              取消
            </Button>
            <Button
              onClick={() => convertToConsignmentMutation.mutate(Array.from(selectedOrderIds))}
              disabled={convertToConsignmentMutation.isPending}
            >
              {convertToConsignmentMutation.isPending ? '處理中...' : '確認轉寄賣出貨'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Direct Ship Dialog */}
      <Dialog open={directShipDialogOpen} onOpenChange={(open) => {
        if (!open) setItemWarehouses({});
        setDirectShipDialogOpen(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {allSelectedConsignment ? '寄賣出貨' : '直接轉銷貨單'}
            </DialogTitle>
            <DialogDescription>
              {allSelectedConsignment
                ? '所有品項將以寄賣模式出貨（不開立銷貨單），店家確認收貨並回報銷售後才會開收款單。'
                : '為每個品項選擇出貨倉庫，所有剩餘數量將全額出貨。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">出貨時間</label>
                <Input
                  type="datetime-local"
                  value={directShipAt}
                  onChange={(e) => setDirectShipAt(e.target.value)}
                  className="mt-1"
                />
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
            <div className="rounded-lg border divide-y max-h-96 overflow-y-auto">
              {orders.filter(o => selectedOrderIds.has(o.id)).map(order => (
                <div key={order.id}>
                  <div className="px-3 py-2 bg-muted/30 font-medium text-sm">{order.code} - {order.stores?.name || '未知店家'}</div>
                  <div className="divide-y">
                    {order.order_items
                      .filter(item => item.status !== 'cancelled' && item.status !== 'discontinued' && (item.quantity - item.shipped_quantity) > 0)
                      .map(item => (
                        <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{item.product?.name || '未知商品'}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.product?.code}{item.product_variant?.name ? ` / ${item.product_variant.name}` : ''} × {item.quantity - item.shipped_quantity}
                            </div>
                          </div>
                          <WarehouseSelector
                            value={getItemWarehouse(item.id)}
                            onChange={(w) => setItemWarehouses(prev => ({ ...prev, [item.id]: w }))}
                            productId={item.product_id}
                            variantId={item.variant_id}
                          />
                        </div>
                    ))}
                  </div>
                </div>
              ))}
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
              {directShipMutation.isPending ? '處理中...' : allSelectedConsignment ? '確認寄賣出貨' : '確認轉銷貨單'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse Consignment Shipment Dialog */}
      <Dialog open={!!reverseShipmentOrder} onOpenChange={(open) => !open && setReverseShipmentOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-destructive" />
              回滾出貨（{reverseShipmentOrder?.order.code}）
            </DialogTitle>
            <DialogDescription>
              將此寄賣訂單的出貨整單回滾：扣回已出貨數量、品項放回出貨池，寄賣單退回草稿狀態。店家尚未確認收貨時才能執行。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>備註（選填）</Label>
            <Textarea
              value={reverseNote}
              onChange={(e) => setReverseNote(e.target.value)}
              placeholder="輸入回滾原因"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseShipmentOrder(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                reverseShipmentMutation.mutate({
                  consignmentOrderId: reverseShipmentOrder?.consignmentOrderId || '',
                  note: reverseNote,
                })
              }
              disabled={reverseShipmentMutation.isPending || !reverseShipmentOrder}
            >
              {reverseShipmentMutation.isPending ? '處理中...' : '確認回滾出貨'}
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
