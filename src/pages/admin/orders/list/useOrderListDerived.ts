import { useCallback, useMemo } from 'react';
import { Order, OrderItem } from '@/types/order';
import { AggregatedItem } from './components/AggregateTableView';
import { getDisplayProductName, getOrderTotal } from './orderListUtils';
import type { AggregateSelectionItem, OrderViewMode } from './orderListTypes';

export interface UseOrderListDerivedParams {
  orders: Order[];
  viewMode: OrderViewMode;
  search: string;
  dateFrom: string;
  dateTo: string;
  poFilter: 'all' | 'has_po' | 'no_po';
  poLinkMap: Map<string, { poCount: number; poIds: string[] }>;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  getPendingQuantity: (item: OrderItem) => number;
  purchasedByOrderKey: Map<string, number>;
  selectedOrderIds: Set<string>;
  selectedItems: Map<string, any>;
  selectedAggregateItems: Map<string, AggregateSelectionItem>;
  isRep: boolean;
  computeRepOrder: (items: { productId: string; variantId?: string | null; unitPrice: number; quantity: number }[]) => {
    totalProfit: number;
    totalCommission: number;
  };
  itemStatusLabels: Record<string, { label: string; className: string }>;
}

export interface UseOrderListDerivedResult {
  itemMatchesSearch: (item: OrderItem) => boolean | undefined;
  matchesSearch: (order: Order) => boolean;
  filteredOrders: Order[];
  sortedOrders: Order[];
  allPendingItems: any[];
  allCancelledItems: any[];
  aggregatedItems: AggregatedItem[];
  commissionByOrder: Map<string, { totalProfit: number; totalCommission: number }> | undefined;
  orderPoolGroupedItems: Record<string, { storeName: string; items: any[] }>;
  poItemsFromOrders: AggregateSelectionItem[];
  poItemsSource: AggregateSelectionItem[];
  getOrderShipmentStatus: (items: OrderItem[]) => 'waiting' | 'partial' | 'shipped';
  getItemStatusLabel: (status: string) => { label: string; className: string };
}

export function useOrderListDerived(params: UseOrderListDerivedParams): UseOrderListDerivedResult {
  const {
    orders,
    viewMode,
    search,
    dateFrom,
    dateTo,
    poFilter,
    poLinkMap,
    sortField,
    sortDirection,
    getPendingQuantity,
    purchasedByOrderKey,
    selectedOrderIds,
    selectedItems,
    selectedAggregateItems,
    isRep,
    computeRepOrder,
    itemStatusLabels,
  } = params;

  // 業務佣金換算
  const commissionByOrder = useMemo(() => {
    if (!isRep) return undefined;
    const map = new Map<string, { totalProfit: number; totalCommission: number }>();
    for (const order of orders) {
      map.set(order.id, computeRepOrder(
        order.order_items.map(i => ({
          productId: i.product_id,
          variantId: i.variant_id,
          unitPrice: i.unit_price,
          quantity: i.quantity,
        }))
      ));
    }
    return map;
  }, [isRep, orders, computeRepOrder]);

  // Filtering Logic (Orders)
  const itemMatchesSearch = useCallback((item: OrderItem) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      item.product?.name?.toLowerCase().includes(searchLower) ||
      item.product?.code?.toLowerCase().includes(searchLower) ||
      item.product_variant?.name?.toLowerCase().includes(searchLower)
    );
  }, [search]);

  const matchesSearch = useCallback((order: Order) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    const matchesDirect = (
      order.stores?.name.toLowerCase().includes(searchLower) ||
      order.stores?.code?.toLowerCase().includes(searchLower) ||
      order.id.toLowerCase().includes(searchLower) ||
      (order.code && order.code.toLowerCase().includes(searchLower))
    );
    if (matchesDirect) return true;
    // 同時搜尋訂單內的商品（名稱/代碼/變體值），讓「商品搜尋 → 訂單」跨模式一致
    return (order.order_items || []).some(item => itemMatchesSearch(item));
  }, [search, itemMatchesSearch]);

  const filteredOrders = useMemo(() => {
    return orders?.filter((order) => {
      if (viewMode !== 'orders') return true;
      if (!matchesSearch(order)) return false;
      // 日期範圍篩選
      if (dateFrom) {
        const d = new Date(order.created_at);
        const from = new Date(dateFrom + 'T00:00:00');
        if (d < from) return false;
      }
      if (dateTo) {
        const d = new Date(order.created_at);
        const to = new Date(dateTo + 'T23:59:59');
        if (d > to) return false;
      }
      // 採購狀態篩選
      if (poFilter !== 'all') {
        const hasPO = poLinkMap.has(order.id);
        if (poFilter === 'has_po' && !hasPO) return false;
        if (poFilter === 'no_po' && hasPO) return false;
      }
      return true;
    }) || [];
  }, [orders, viewMode, matchesSearch, dateFrom, dateTo, poFilter, poLinkMap]);

  const sortedOrders = useMemo(() => {
    const arr = [...filteredOrders];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'code':
          cmp = (a.code || a.id).localeCompare(b.code || b.id);
          break;
        case 'store_name':
          cmp = (a.stores?.name || '').localeCompare(b.stores?.name || '');
          break;
        case 'item_count':
          cmp = a.order_items.length - b.order_items.length;
          break;
        case 'total_amount':
          cmp = getOrderTotal(a.order_items) - getOrderTotal(b.order_items);
          break;
        default:
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredOrders, sortField, sortDirection]);

  // Filtering Logic (Items - Flattened)
  const allPendingItems = useMemo(() => {
    if (viewMode !== 'items') return [];
    return orders?.flatMap(order =>
      order.order_items
        .filter(item => getPendingQuantity(item) > 0 && item.status !== 'cancelled' && item.status !== 'discontinued')
        .filter(item => itemMatchesSearch(item))
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
  }, [orders, viewMode, getPendingQuantity, itemMatchesSearch]);

  const allCancelledItems = useMemo(() => {
    if (viewMode !== 'items') return [];
    return orders?.flatMap(order =>
      order.order_items
        .filter(item => item.status === 'cancelled' || item.status === 'discontinued')
        .filter(item => itemMatchesSearch(item))
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
  }, [orders, viewMode, itemMatchesSearch]);

  // Aggregation logic: group pending items by product_id + variant_id across all stores
  const aggregatedItems = useMemo((): AggregatedItem[] => {
    if (viewMode !== 'aggregate') return [];

    const allItems = orders?.flatMap(order =>
      order.order_items
        .filter(item => getPendingQuantity(item) > 0 && item.status !== 'cancelled' && item.status !== 'discontinued')
        .filter(item => itemMatchesSearch(item))
        .map(item => ({
          ...item,
          orderId: order.id,
          storeName: order.stores?.name || '',
          storeCode: order.stores?.code || '',
          storeId: order.store_id,
          pendingQuantity: getPendingQuantity(item),
        }))
    ) || [];

    const grouped = new Map<string, AggregatedItem>();
    for (const item of allItems) {
      const key = `${item.product_id}_${item.variant_id || 'null'}`;
      const purchasedKey = `${item.orderId}|${item.product_id}|${item.variant_id || 'null'}`;
      const alreadyPurchased = purchasedByOrderKey.get(purchasedKey) || 0;
      const remaining = Math.max(0, item.pendingQuantity - alreadyPurchased);
      if (remaining <= 0) continue;

      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.totalPendingQuantity += remaining;
        if (!existing.sourceOrderIds.includes(item.orderId)) {
          existing.sourceOrderIds.push(item.orderId);
        }
        existing.sourceQuantities[item.orderId] = (existing.sourceQuantities[item.orderId] || 0) + remaining;
        const existingStore = existing.storeBreakdown.find(s => s.storeId === item.storeId);
        if (existingStore) {
          existingStore.quantity += remaining;
        } else {
          existing.storeBreakdown.push({
            storeId: item.storeId,
            storeName: item.storeName,
            storeCode: item.storeCode,
            quantity: remaining,
          });
        }
      } else {
        grouped.set(key, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          productName: getDisplayProductName(item.product?.name, item.product_variant?.name),
          variantName: item.product_variant?.name || null,
          sku: item.product?.code || '',
          totalPendingQuantity: remaining,
          sourceOrderIds: [item.orderId],
          sourceQuantities: { [item.orderId]: remaining },
          storeBreakdown: [{
            storeId: item.storeId,
            storeName: item.storeName,
            storeCode: item.storeCode,
            quantity: remaining,
          }],
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [orders, viewMode, getPendingQuantity, itemMatchesSearch, purchasedByOrderKey]);

  // 從選取的訂單彙整品項，供「轉採購單」使用（扣除已採購量，避免重複採購）
  const poItemsFromOrders = useMemo(() => {
    if (viewMode !== 'orders') return [] as AggregateSelectionItem[];
    const grouped = new Map<string, AggregateSelectionItem>();
    for (const order of orders.filter(o => selectedOrderIds.has(o.id))) {
      for (const item of order.order_items) {
        if (item.status === 'cancelled' || item.status === 'discontinued') continue;
        const pending = item.quantity - item.shipped_quantity;
        if (pending <= 0) continue;
        const purchasedKey = `${order.id}|${item.product_id}|${item.variant_id || 'null'}`;
        const alreadyPurchased = purchasedByOrderKey.get(purchasedKey) || 0;
        const remaining = Math.max(0, pending - alreadyPurchased);
        if (remaining <= 0) continue;
        const key = `${item.product_id}_${item.variant_id || 'null'}`;
        if (grouped.has(key)) {
          const g = grouped.get(key)!;
          g.quantity += remaining;
          g.maxQuantity += remaining;
          if (!g.sourceOrderIds.includes(order.id)) g.sourceOrderIds.push(order.id);
          g.sourceQuantities[order.id] = (g.sourceQuantities[order.id] || 0) + remaining;
        } else {
          grouped.set(key, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            quantity: remaining,
            maxQuantity: remaining,
            productName: getDisplayProductName(item.product?.name, item.product_variant?.name),
            variantName: (item as any).product_variant?.name || null,
            sku: (item as any).product?.code || '',
            sourceOrderIds: [order.id],
            sourceQuantities: { [order.id]: remaining },
          });
        }
      }
    }
    return Array.from(grouped.values());
  }, [orders, selectedOrderIds, viewMode, purchasedByOrderKey]);

  // 決定傳給 AggregateToPODialog 的品項來源
  const poItemsSource = useMemo((): AggregateSelectionItem[] => {
    if (viewMode === 'orders') return poItemsFromOrders;
    if (viewMode === 'aggregate') return Array.from(selectedAggregateItems.values());
    // 商品（items）tab：從選取的單筆品項彙整成採購明細，扣除已採購量避免重複採購
    const grouped = new Map<string, AggregateSelectionItem>();
    for (const sel of selectedItems.values()) {
      const order = orders.find(o => o.id === sel.orderId);
      const item = order?.order_items.find(i => i.id === sel.itemId);
      if (!item) continue;
      const purchasedKey = `${sel.orderId}|${item.product_id}|${item.variant_id || 'null'}`;
      const alreadyPurchased = purchasedByOrderKey.get(purchasedKey) || 0;
      const remaining = Math.max(0, sel.quantity - alreadyPurchased);
      if (remaining <= 0) continue;
      const key = `${item.product_id}_${item.variant_id || 'null'}`;
      if (grouped.has(key)) {
        const g = grouped.get(key)!;
        g.quantity += remaining;
        g.maxQuantity += remaining;
        if (!g.sourceOrderIds.includes(sel.orderId)) g.sourceOrderIds.push(sel.orderId);
        g.sourceQuantities[sel.orderId] = (g.sourceQuantities[sel.orderId] || 0) + remaining;
      } else {
        grouped.set(key, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          quantity: remaining,
          maxQuantity: remaining,
          productName: getDisplayProductName(item.product?.name, item.product_variant?.name),
          variantName: item.product_variant?.name || null,
          sku: item.product?.code || '',
          sourceOrderIds: [sel.orderId],
          sourceQuantities: { [sel.orderId]: remaining },
        });
      }
    }
    return Array.from(grouped.values());
  }, [viewMode, poItemsFromOrders, selectedAggregateItems, selectedItems, orders, purchasedByOrderKey]);

  // 出貨池整單轉移用的 grouped（依店家分組）
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
          productName: getDisplayProductName(item.product?.name, item.product_variant?.name),
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

  return {
    itemMatchesSearch,
    matchesSearch,
    filteredOrders,
    sortedOrders,
    allPendingItems,
    allCancelledItems,
    aggregatedItems,
    commissionByOrder,
    orderPoolGroupedItems,
    poItemsFromOrders,
    poItemsSource,
    getOrderShipmentStatus: (items: OrderItem[]) => {
      if (items.length === 0) return 'waiting';
      const allProcessed = items.every((i) =>
        i.status === 'shipped' || i.status === 'cancelled' || i.status === 'discontinued'
      );
      const someShipped = items.some((i) => i.shipped_quantity > 0);
      if (allProcessed) return 'shipped';
      if (someShipped) return 'partial';
      return 'waiting';
    },
    getItemStatusLabel: (status: string) => itemStatusLabels[status],
  };
}