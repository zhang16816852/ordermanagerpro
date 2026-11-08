import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { usePurchaseOrders, PurchaseOrderFilters } from './usePurchaseOrders';
import { poPaymentSummary } from '../paymentSummary';
import {
  canSubmitBatchPayment,
  isBatchOrderable,
  isBatchReceivable,
  poBatchPaymentPlan,
} from '../batchActions';
import {
  parsePoSort,
  sortPurchaseOrders,
  defaultPoSortDir,
  type PoSortField,
} from '../orderSort';
import type { PurchaseOrder, Supplier } from '../types';
import type { AccountingEntry, AccountingEntryReference } from '@/pages/admin/accounting/types';
import type { DocItem } from '@/pages/admin/accounting/components/EntryFormTypes';

export function usePurchaseOrdersPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'orders');
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'purchase' | 'returns'>('purchase');
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchReceiveOpen, setBatchReceiveOpen] = useState(false);
  const [batchPayOpen, setBatchPayOpen] = useState(false);

  const [filters, setFilters] = useState<PurchaseOrderFilters>({
    supplierId: searchParams.get('supplier') || undefined,
    purpose: searchParams.get('purpose') || undefined,
    status: searchParams.get('status') || undefined,
    dateFrom: searchParams.get('from') || undefined,
    dateTo: searchParams.get('to') || undefined,
  });

  const [paidFilter, setPaidFilter] = useState<'all' | 'paid' | 'unpaid'>(
    (searchParams.get('paid') as 'paid' | 'unpaid') || 'all',
  );

  const setPaidFilterUrl = (v: 'all' | 'paid' | 'unpaid') => {
    setPaidFilter(v);
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      if (v === 'all') sp.delete('paid');
      else sp.set('paid', v);
      return sp;
    }, { replace: true });
  };

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

  const handleSort = (field: PoSortField) => {
    if (field === sortField) {
      writeSortUrl({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      writeSortUrl({ sortField: field, sortDir: defaultPoSortDir(field) });
    }
  };

  const handleSortFieldChange = (field: PoSortField) => {
    writeSortUrl({ sortField: field, sortDir: defaultPoSortDir(field) });
  };

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

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', v);
      return next;
    }, { replace: true });
  };

  const po = usePurchaseOrders(viewingOrder?.id, filters);

  const visibleOrders = useMemo(() => {
    if (paidFilter === 'all') return po.orders;
    return po.orders.filter((o) => {
      const s = poPaymentSummary(o.total_amount, po.paidAmountMap[o.id]);
      const isPaid = s.unpaid <= 0;
      return paidFilter === 'paid' ? isPaid : !isPaid;
    });
  }, [po.orders, paidFilter, po.paidAmountMap]);

  const paymentSummary = useMemo(() => {
    let total = 0;
    let paid = 0;
    let unpaid = 0;
    let unpaidCount = 0;
    for (const order of visibleOrders) {
      const s = poPaymentSummary(order.total_amount, po.paidAmountMap[order.id]);
      const sign = s.isCredit ? -1 : 1;
      total += sign * s.payable;
      paid += sign * s.paid;
      unpaid += sign * s.unpaid;
      if (s.unpaid > 0) unpaidCount += 1;
    }
    return { total, paid, unpaid, unpaidCount };
  }, [visibleOrders, po.paidAmountMap]);

  const sortedOrders = useMemo(
    () => sortPurchaseOrders(visibleOrders, sortField, sortDir),
    [visibleOrders, sortField, sortDir],
  );

  const selectedOrders = useMemo(() => {
    const set = new Set(selectedIds);
    return visibleOrders.filter((o) => set.has(o.id));
  }, [visibleOrders, selectedIds]);

  const orderableOrders = useMemo(() => selectedOrders.filter(isBatchOrderable), [selectedOrders]);
  const receivableOrders = useMemo(() => selectedOrders.filter(isBatchReceivable), [selectedOrders]);

  const batchPaymentPlan = useMemo(
    () => poBatchPaymentPlan(selectedOrders, po.paidAmountMap),
    [selectedOrders, po.paidAmountMap],
  );
  const canBatchPay = po.canSeePayments && canSubmitBatchPayment(batchPaymentPlan);

  const batchPending =
    po.batchOrderMutation.isPending || po.batchReceiveItemsMutation.isPending || po.recordPaymentMutation.isPending;

  const batchPaymentDocItems: DocItem[] = useMemo(
    () =>
      batchPaymentPlan.lines.map((l) => {
        const order = selectedOrders.find((o) => o.id === l.orderId);
        return {
          docType: 'purchase_order',
          docId: l.orderId,
          code: l.supplierOrderNumber || l.orderId.slice(0, 8),
          name: order?.supplier?.name || batchPaymentPlan.supplierName || '未知供應商',
          date: order?.order_date || order?.created_at || '',
          originalAmount: l.totalAmount,
          amountApplied: l.amountApplied,
        };
      }),
    [batchPaymentPlan, selectedOrders],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearSelection = () => setSelectedIds([]);

  const handleBatchModeChange = (on: boolean) => {
    setBatchMode(on);
    if (!on) clearSelection();
  };

  const handleBatchOrder = () => {
    const ids = orderableOrders.map((o) => o.id);
    po.batchOrderMutation.mutate(ids, { onSuccess: clearSelection });
  };

  const handleBatchReceive = () => {
    if (receivableOrders.length === 0) return;
    setBatchReceiveOpen(true);
  };

  const handleBatchReceiveConfirm = (orderIds: string[], warehouseId: string) => {
    po.batchReceiveItemsMutation.mutate(
      { orderIds, warehouseId },
      {
        onSuccess: () => {
          clearSelection();
          setBatchReceiveOpen(false);
        },
      },
    );
  };

  const handleBatchPay = () => {
    if (!canBatchPay) return;
    setBatchPayOpen(true);
  };

  const handleBatchPaySubmit = (
    data: Partial<AccountingEntry>,
    references?: AccountingEntryReference[],
  ) => {
    po.recordPaymentMutation.mutate(
      {
        orderIds: batchPaymentPlan.lines.map((l) => l.orderId),
        data,
        references,
      },
      {
        onSuccess: () => {
          setBatchPayOpen(false);
          clearSelection();
        },
      },
    );
  };

  const handleUpdateOrder = async (id: string, data: Partial<PurchaseOrder>) => {
    const res = await po.updateOrderMutation.mutateAsync({ id, ...data });
    setViewingOrder((prev) => (prev && prev.id === id ? { ...prev, ...data } : prev));
    return res;
  };

  const handleDeleteOrder = (id: string) => {
    if (!window.confirm('確定要刪除此採購單嗎？')) return;
    po.deleteOrderMutation.mutate(id);
  };

  const handleStatusChange = (id: string, status: any) => {
    po.updateOrderMutation.mutate({ id, status });
  };

  const handleEditOrder = (order: PurchaseOrder) => {
    navigate(`/admin/purchase-orders/${order.id}/edit`);
  };

  const handleViewOrder = (order: PurchaseOrder) => {
    setViewingOrder(order);
  };

  return {
    // state
    activeTab,
    viewingOrder,
    createSupplierOpen,
    importOpen,
    importMode,
    editingSupplier,
    batchMode,
    selectedIds,
    setSelectedIds,
    batchReceiveOpen,
    batchPayOpen,
    filters,
    paidFilter,
    sortField,
    sortDir,
    // setters
    setViewingOrder,
    setCreateSupplierOpen,
    setImportOpen,
    setImportMode,
    setEditingSupplier,
    setBatchReceiveOpen,
    setBatchPayOpen,
    // handlers
    handleTabChange,
    handleSort,
    handleSortFieldChange,
    handleToggleSortDir,
    updateFilterUrl,
    setPaidFilterUrl,
    toggleSelect,
    clearSelection,
    handleBatchModeChange,
    handleBatchOrder,
    handleBatchReceive,
    handleBatchReceiveConfirm,
    handleBatchPay,
    handleBatchPaySubmit,
    handleUpdateOrder,
    handleDeleteOrder,
    handleStatusChange,
    handleEditOrder,
    handleViewOrder,
    // derived
    visibleOrders,
    paymentSummary,
    sortedOrders,
    selectedOrders,
    orderableOrders,
    receivableOrders,
    batchPaymentPlan,
    canBatchPay,
    batchPaymentDocItems,
    batchPending,
    // query
    ...po,
    navigate,
  };
}