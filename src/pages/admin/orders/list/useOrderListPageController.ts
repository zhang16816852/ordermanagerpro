import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { Order } from '@/types/order';

import { useOrdersList } from './hooks/useOrdersList';
import { useRepCommission } from '@/hooks/useRepCommission';
import { useOrderListQueries } from './useOrderListQueries';
import { useOrderListDerived } from './useOrderListDerived';
import { useOrderListMutations } from './useOrderListMutations';
import { useOrderListSelections } from './useOrderListSelections';
import { useOrderListExports } from './useOrderListExports';
import { itemStatusLabels } from './orderListTypes';
import type {
  OrderStatusTab,
  OrderViewMode,
} from './orderListTypes';

export const validTabs: OrderStatusTab[] = ['pending', 'processing', 'shipped'];

export function useOrderListPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { defaultWarehouse } = useWarehouses();
  const urlTab = searchParams.get('tab') as OrderStatusTab | null;
  const [statusTab, setStatusTab] = useState<OrderStatusTab>(
    validTabs.includes(urlTab as any) ? (urlTab as OrderStatusTab) : 'pending'
  );
  const [viewMode, setViewMode] = useState<OrderViewMode>(
    searchParams.get('view') === 'items' ? 'items' : searchParams.get('view') === 'aggregate' ? 'aggregate' : 'orders'
  );
  const [search, setSearch] = useState(searchParams.get('id') || searchParams.get('search') || '');
  const [storeFilter, setStoreFilter] = useState<string>(searchParams.get('store') || 'all');
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [poFilter, setPoFilter] = useState<'all' | 'has_po' | 'no_po'>('all');
  const [repFilter, setRepFilter] = useState<string>('all');

  const { repsData, repAssignedStoreIds } = useOrderListQueries(repFilter);

  // 當 URL 參數變動時同步搜尋框
  useEffect(() => {
    const id = searchParams.get('id');
    const q = searchParams.get('search');
    if (id) setSearch(id);
    else if (q) setSearch(q);
  }, [searchParams]);

  const selections = useOrderListSelections();
  const {
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
    directShipNotes,
    setDirectShipNotes,
    directShipAt,
    setDirectShipAt,
    itemWarehouses,
    setItemWarehouses,
    convertToPOOpen,
    setConvertToPOOpen,
    selectedAggregateItems,
    setSelectedAggregateItems,
    groupedSelections,
    handleItemToggleSelection,
    handleItemToggleAll,
    handleUpdateItemQuantity,
    handleToggleAggregateSelection,
    handleToggleAllAggregate,
    handleUpdateAggregateQuantity,
  } = selections;

  const getItemWarehouse = (itemId: string) => itemWarehouses[itemId] || defaultWarehouse?.id || '';

  const { user } = useAuth();

  // Core Hook
  const {
    stores,
    orders,
    isLoading,
    shippingPoolMap,
    poLinkMap,
    purchasedByOrderKey,
    consignmentBySourceOrderId,
    getPendingQuantity,
    syncOrdersMutation,
    confirmOrdersMutation,
    addToShippingPoolMutation,
    cancelItemsMutation,
  } = useOrdersList(storeFilter, statusTab, repFilter !== 'all' ? repAssignedStoreIds : undefined);

  // 業務佣金換算
  const { isRep, computeOrder: computeRepOrder } = useRepCommission();

  const derived = useOrderListDerived({
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
  });

  const {
    filteredOrders,
    sortedOrders,
    allPendingItems,
    allCancelledItems,
    aggregatedItems,
    commissionByOrder,
    orderPoolGroupedItems,
    poItemsSource,
  } = derived;

  const mutations = useOrderListMutations({
    user,
    orders,
    directShipAt,
    getItemWarehouse,
    poLinkMap,
    onDirectShipDone: () => {
      setDirectShipDialogOpen(false);
      setDirectShipNotes('');
      setSelectedOrderIds(new Set());
    },
    onDeleteDone: () => {
      setSelectedOrderIds(new Set());
      setViewingOrder(null);
    },
    onConvertToConsignmentDone: () => {
      setConvertToConsignmentOpen(false);
      setSelectedOrderIds(new Set());
    },
    onUnlinkDone: () => {
      setSelectedOrderIds(new Set());
    },
    onReverseShipmentDone: () => {
      setReverseShipmentOrder(null);
      setReverseNote('');
    },
    setReverseShipmentOrder,
    setReverseNote,
  });

  const {
    directShipMutation,
    deleteOrderMutation,
    convertToConsignmentMutation,
    unlinkOrdersMutation,
    reverseShipmentMutation,
    handleDeleteOrders,
    handleReverseShipment,
  } = mutations;

  // 當訂單列表刷新後（如保存後 invalidate），自動同步 viewingOrder 最新資料
  useEffect(() => {
    if (viewingOrder) {
      const updated = orders.find((o) => o.id === viewingOrder.id);
      if (updated && updated !== viewingOrder) {
        setViewingOrder(updated);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const handleSort = useCallback((field: string) => {
    setSortDirection(prev => sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortField(field);
  }, [sortField]);

  // 出貨前自動帶入庫存非空的倉庫
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directShipDialogOpen, selectedOrderIds, orders, defaultWarehouse]);

  const selectedOrdersArray = Array.from(selectedOrderIds)
    .map((id) => filteredOrders.find((o) => o.id === id))
    .filter((o): o is Order => !!o);
  const hasConsignmentSelection = selectedOrdersArray.some((o) => o.consignment_mode);
  const hasNormalSelection = selectedOrdersArray.some((o) => !o.consignment_mode);
  const allSelectedConsignment =
    selectedOrdersArray.length > 0 && selectedOrdersArray.every((o) => o.consignment_mode);

  const handleStatusTabChange = (v: OrderStatusTab) => {
    setStatusTab(v);
    setSelectedOrderIds(new Set());
    setSelectedItems(new Map());
    setSelectedAggregateItems(new Map());
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", v);
      return next;
    }, { replace: true });
  };

  const handleViewModeChange = (v: OrderViewMode) => {
    setViewMode(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", v);
      return next;
    }, { replace: true });
  };

  const handleStoreFilterChange = (v: string) => {
    setStoreFilter(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v && v !== "all") next.set("store", v);
      else next.delete("store");
      return next;
    }, { replace: true });
  };

  const { handleExportAggregateCSV, handleExportAggregateExcel, handleExportOrdersCSV } =
    useOrderListExports({
      filteredOrders,
      selectedAggregateItems,
      aggregatedItems,
      statusTab,
    });

  return {
    searchParams,
    setSearchParams,
    statusTab,
    setStatusTab,
    handleStatusTabChange,
    handleViewModeChange,
    handleStoreFilterChange,
    handleExportOrdersCSV,
    viewMode,
    setViewMode,
    search,
    setSearch,
    storeFilter,
    setStoreFilter,
    sortField,
    sortDirection,
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
    directShipNotes,
    setDirectShipNotes,
    directShipAt,
    setDirectShipAt,
    itemWarehouses,
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
    itemStatusLabels,
  };
}