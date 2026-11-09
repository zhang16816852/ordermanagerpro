import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Plus, PackageCheck, CreditCard, Download, FileSpreadsheet, X, GripVertical, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Search, Pencil, Link2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { PurchaseOrder, PurchaseOrderItem, ProductWithPrice, type PoItemWritePayload, type PoUpdateItemPayload } from '../types';
import { PurchaseProductPicker } from './PurchaseProductPicker';
import { PurchaseFreightSection } from '@/components/purchase/PurchaseFreightSection';
import { PurchaseOrderDetailQuickCopyDialog } from './PurchaseOrderDetailQuickCopyDialog';
import { PurchaseOrderDetailItemsView } from './PurchaseOrderDetailItemsView';
import { MappedRuleEditDialog } from './mapping/MappedRuleEditDialog';
import { ImportFromOrdersDialog } from './ImportFromOrdersDialog';
import { BindSourceOrdersDialog } from './BindSourceOrdersDialog';
import { BatchBindSourceOrdersDialog } from './BatchBindSourceOrdersDialog';
import { ReceiveForm } from './ReceiveForm';
import { EntryDialog } from '@/pages/admin/accounting/components/EntryDialog';
import { poPaymentDocLine } from '../batchActions';
import type { AccountingEntry, AccountingEntryReference, AccountingCategory, Account } from '@/pages/admin/accounting/types';
import { ExcelImportDialog } from './ExcelImportDialog';
import { exportToCSV } from '@/lib/exportUtils';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';


function SortableRow({ item, children, fullyBound }: { item: PurchaseOrderItem; children: React.ReactNode; fullyBound?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };
  return (
    <TableRow ref={setNodeRef} style={style} {...attributes} className={fullyBound ? 'bg-green-50/50 [&>td]:font-semibold [&>td]:border-green-500 [&>td]:border-y-2 [&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2' : ''}>
      <TableCell {...listeners} className="cursor-grab active:cursor-grabbing w-8 text-center text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4 mx-auto" />
      </TableCell>
      {children}
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// 依店家檢視：把品項依來源訂單（source_order_ids / source_quantities）拆成
// 「每店家一列」。同一品項若來自多個店家，依 source_quantities 比例拆分數量；
// 已收數量（received_quantity）依數量占比拆分（餘數補給第一個店家）。
// ---------------------------------------------------------------------------
interface ByStoreRow {
  store: string;
  item: PurchaseOrderItem;
  quantity: number;
  received: number;
  /** 該列所屬店家的來源訂單 id 清單 */
  sourceOrderIds: string[];
}

function buildByStoreRows(
  items: PurchaseOrderItem[],
  sourceOrderStoreMap: Record<string, string>,
): ByStoreRow[] {
  const rows: ByStoreRow[] = [];
  for (const item of items) {
    const sources = item.source_order_ids || [];
    if (sources.length === 0) {
      rows.push({ store: '無來源訂單', item, quantity: item.quantity, received: item.received_quantity, sourceOrderIds: [] });
      continue;
    }
    // 各店家數量（同店家多張來源訂單合併加總）
    const storeQty: Record<string, number> = {};
    const storeOrder: string[] = [];
    const sq = item.source_quantities;
    const hasQty = !!sq && sources.some((sid) => sq[sid] != null);
    if (hasQty) {
      for (const sid of sources) {
        const store = sourceOrderStoreMap[sid] || '未指定店家';
        if (!(store in storeQty)) storeOrder.push(store);
        storeQty[store] = (storeQty[store] || 0) + (sq![sid] ?? 0);
      }
    } else {
      // 舊資料無 source_quantities：依不重複店家數平均拆分，餘數給第一個店家
      const seen = new Set<string>();
      for (const sid of sources) {
        const store = sourceOrderStoreMap[sid] || '未指定店家';
        if (seen.has(store)) continue;
        seen.add(store);
        storeOrder.push(store);
      }
      const n = storeOrder.length || 1;
      const base = Math.floor(item.quantity / n);
      let rem = item.quantity - base * n;
      for (const store of storeOrder) {
        storeQty[store] = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
      }
    }
    // 已收依數量占比拆分（餘數補給第一個店家）
    const total = Object.values(storeQty).reduce((a, b) => a + b, 0);
    const receivedByStore: Record<string, number> = {};
    if (total > 0 && item.received_quantity > 0) {
      let allocated = 0;
      for (const store of storeOrder) {
        const q = storeQty[store] || 0;
        const r = Math.floor((item.received_quantity * q) / total);
        receivedByStore[store] = r;
        allocated += r;
      }
      let remR = item.received_quantity - allocated;
      for (const store of storeOrder) {
        if (remR <= 0) break;
        receivedByStore[store] += 1;
        remR -= 1;
      }
    } else {
      for (const store of storeOrder) receivedByStore[store] = 0;
      if (storeOrder.length > 0) receivedByStore[storeOrder[0]] = item.received_quantity;
    }
    for (const store of storeOrder) {
      // 該店家所屬的來源訂單 id（依 sourceOrderStoreMap 歸屬）
      const storeSourceIds = sources.filter((sid) => (sourceOrderStoreMap[sid] || '未指定店家') === store);
      rows.push({
        store,
        item,
        quantity: storeQty[store] || 0,
        received: receivedByStore[store] || 0,
        sourceOrderIds: storeSourceIds,
      });
    }
    // 庫存虛擬行：PO 品項數量高於所有來源訂單已採購總和時，差額歸屬「庫存」
    const sourceQtyTotal = Object.values(storeQty).reduce((a, b) => a + b, 0);
    const inventoryQty = Math.max(0, item.quantity - sourceQtyTotal);
    if (inventoryQty > 0) {
      rows.push({
        store: '庫存',
        item,
        quantity: inventoryQty,
        received: 0,
        sourceOrderIds: [],
      });
    }
  }
  return rows;
}

interface PurchaseOrderDetailDialogProps {
  order: PurchaseOrder;
  orderItems: PurchaseOrderItem[];
  products: ProductWithPrice[];
  accounts: Account[];
  categories: AccountingCategory[];
  /** 該單已付金額（絕對值）；未提供則視為 0 */
  paidAmount?: number;
  sourceOrderMap: Record<string, string>;
  sourceOrderStoreMap?: Record<string, string>;
  sourceOrderDateMap?: Record<string, string>;
  supplierMappingMap: Record<string, { id?: string; supplier_id?: string; vendor_product_id: string; vendor_product_name: string; vendor_unit_cost?: number | null; is_primary?: boolean }>;
  canEditVendorMapping?: boolean;
  onSaveVendorMapping?: (payload: {
    mappingId?: string;
    supplierId: string;
    vendorProductId: string;
    vendorProductName: string | null;
    productId: string;
    variantId: string | null;
    vendorUnitCost?: number | null;
  }) => Promise<unknown>;
  /** 匯入／追加品項：items 為「既有品項 + 新品項（id: null）」的整單清單 */
  onImportItems: (data: { purchaseOrderId: string; items: PoUpdateItemPayload[] }) => Promise<unknown>;
  onReceiveItems: (data: any) => void;
  /** 記錄付款：改走統一會計 EntryDialog（data + references 一起建立分錄與單據關聯） */
  onMakePayment: (data: Partial<AccountingEntry>, references?: AccountingEntryReference[]) => void;
  onUnlinkOrder: (orderId: string) => void;
  /** 導向統一採購編輯頁（/admin/purchase-orders/:id/edit） */
  onEditOrder?: () => void;
  /** 快速更新採購單表頭（例如廠商單號），不需進入編輯頁 */
  onUpdateOrder?: (id: string, data: Partial<PurchaseOrder>) => Promise<unknown>;
  /** 品項數量／進貨價更新：items 為整單品項（已帶 id），由伺服端依序重編 sort_order 並重算總額 */
  onUpdateItem?: (data: { purchaseOrderId: string; items: PoItemWritePayload[] }) => Promise<unknown>;
  /** 刪除品項：items 為刪除後的整單品項，deletedItemIds 為要移除的品項 */
  onDeleteItem?: (data: { purchaseOrderId: string; items: PoItemWritePayload[]; deletedItemIds: string[] }) => Promise<unknown>;
  onReorder?: (items: PurchaseOrderItem[]) => Promise<unknown>;
  isLoading: boolean;
}

export function PurchaseOrderDetailDialog({
  order,
  orderItems,
  products,
  accounts,
  categories,
  paidAmount,
  sourceOrderMap,
  sourceOrderStoreMap = {},
  sourceOrderDateMap = {},
  supplierMappingMap,
  canEditVendorMapping = false,
  onSaveVendorMapping,
  onImportItems,
  onReceiveItems,
  onMakePayment,
  onUnlinkOrder,
  onEditOrder,
  onUpdateOrder,
  onUpdateItem,
  onDeleteItem,
  onReorder,
  isLoading
}: PurchaseOrderDetailDialogProps) {
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bindItem, setBindItem] = useState<PurchaseOrderItem | null>(null);
  const [batchBindOpen, setBatchBindOpen] = useState(false);
  const [excelImportOpen, setExcelImportOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const [localItems, setLocalItems] = useState<PurchaseOrderItem[]>(orderItems);
  const [nameSort, setNameSort] = useState<'default' | 'asc' | 'desc'>('default');
  const manualOrderRef = useRef<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemView, setItemView] = useState<'items' | 'byStore'>('items');
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  // 數量 / 進貨價 的行內編輯暫存值
  const [rowDrafts, setRowDrafts] = useState<Record<string, { quantity: number; unit_cost: number }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const [vendorEditOpen, setVendorEditOpen] = useState(false);
  const [vendorEditRule, setVendorEditRule] = useState<any>(null);

  // 廠商單號快速編輯
  const [editingSupplierOrderNo, setEditingSupplierOrderNo] = useState(false);
  const [supplierOrderNoDraft, setSupplierOrderNoDraft] = useState('');
  const [savingSupplierOrderNo, setSavingSupplierOrderNo] = useState(false);

  // 快速複製（廠商代碼,數量）
  const [quickCopyOpen, setQuickCopyOpen] = useState(false);

  // 廠商代碼/名稱行內編輯
  const [editingVendorKey, setEditingVendorKey] = useState<string | null>(null);
  const [vendorDraft, setVendorDraft] = useState<{ id: string; name: string }>({ id: '', name: '' });

  useEffect(() => {
    setLocalItems(orderItems);
    const drafts: Record<string, { quantity: number; unit_cost: number }> = {};
    for (const it of orderItems) {
      drafts[it.id] = { quantity: it.quantity, unit_cost: Number(it.unit_cost) || 0 };
    }
    setRowDrafts(drafts);
    setEditingId(null);
  }, [orderItems]);

  const canEdit = !!onUpdateItem && order.status !== 'cancelled';
  const canDelete = !!onDeleteItem && order.status !== 'cancelled';

  const draftOf = (item: PurchaseOrderItem) => rowDrafts[item.id] || { quantity: item.quantity, unit_cost: Number(item.unit_cost) || 0 };

  // 品項寫入一律送出整單品項：伺服端依收到的順序重編 sort_order 並重算 total_amount
  const toWritePayload = (items: PurchaseOrderItem[]): PoItemWritePayload[] =>
    items.map((i) => ({
      id: i.id,
      product_id: i.product_id || '',
      variant_id: i.variant_id || null,
      quantity: i.quantity,
      unit_cost: Number(i.unit_cost) || 0,
      source_order_ids: (i.source_order_ids || []).filter((id) => !!id && id !== order.id).length > 0
        ? (i.source_order_ids || []).filter((id) => !!id && id !== order.id)
        : null,
      source_quantities: i.source_quantities ?? null,
    }));

  /** 本地先樂觀套用、伺服器拒絕時回滾，避免畫面停留在未存下的值（toast 由 mutation 顯示） */
  const commitRow = async (id: string) => {
    if (!onUpdateItem || !editingId) return;
    const d = rowDrafts[id];
    if (!d) return;
    const prev = localItems;
    const next = localItems.map((i) =>
      i.id === id ? { ...i, quantity: Math.max(1, d.quantity || 1), unit_cost: Math.max(0, d.unit_cost || 0) } : i
    );
    setLocalItems(next);
    setEditingId(null);
    try {
      await onUpdateItem({ purchaseOrderId: order.id, items: toWritePayload(next) });
    } catch {
      setLocalItems(prev);
    }
  };

  /** 追加新品項：既有品項在前（保留 id），新品項 id 為 null 由伺服端建立 */
  const submitNewItems = async (newItems: Array<Omit<PoUpdateItemPayload, 'id'>>) => {
    const merged: PoUpdateItemPayload[] = [
      ...toWritePayload(localItems),
      ...newItems.map((i) => ({ ...i, id: null })),
    ];
    // 成功後由 refetch 帶回真實 id 與 sort_order，這裡不先行樂觀寫入
    try {
      await onImportItems({ purchaseOrderId: order.id, items: merged });
      return true;
    } catch {
      return false;
    }
  };

  const handleDeleteItem = async (item: PurchaseOrderItem) => {
    if (!onDeleteItem) return;
    if (item.received_quantity > 0 || (item.consumed_quantity || 0) > 0) {
      toast.error('已收貨／已使用品項無法刪除，請改用採購退貨');
      return;
    }
    if (!window.confirm('確定要從此採購單移除該品項嗎？')) return;
    const prev = localItems;
    const remaining = localItems.filter((i) => i.id !== item.id);
    setLocalItems(remaining);
    try {
      await onDeleteItem({ purchaseOrderId: order.id, items: toWritePayload(remaining), deletedItemIds: [item.id] });
    } catch {
      setLocalItems(prev);
    }
  };

  const handleBindSources = async (binds: { orderId: string; quantity: number }[]) => {
    if (!bindItem || !onUpdateItem) return;
    const item = bindItem;
    // binds 為最終狀態：quantity > 0 保留/新增，quantity = 0 移除
    const newIds: string[] = [];
    const newQtys: Record<string, number> = {};
    for (const b of binds) {
      if (b.quantity > 0) {
        newIds.push(b.orderId);
        newQtys[b.orderId] = b.quantity;
      }
    }
    const prev = localItems;
    const next = localItems.map((i) =>
      i.id === item.id ? { ...i, source_order_ids: newIds, source_quantities: newQtys } : i,
    );
    setLocalItems(next);
    try {
      await onUpdateItem({ purchaseOrderId: order.id, items: toWritePayload(next) });
      setBindItem(null);
    } catch {
      setLocalItems(prev);
    }
  };

  const handleBatchBindSources = async (newItems: PurchaseOrderItem[]) => {
    if (!onUpdateItem) return;
    // 整單樂觀更新：失敗時整單回撤，避免半套狀態
    const prev = localItems;
    setLocalItems(newItems);
    try {
      await onUpdateItem({ purchaseOrderId: order.id, items: toWritePayload(newItems) });
      setBatchBindOpen(false);
    } catch {
      setLocalItems(prev);
    }
  };

  // 依目前行內編輯值（含未儲存的草稿）動態計算總額
  const liveTotal = useMemo(() => {
    return localItems.reduce((sum, item) => {
      const d = draftOf(item);
      return sum + d.quantity * d.unit_cost;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localItems, rowDrafts]);

  const isFiltering = searchQuery.trim() !== '';

  /**
   * 付款對帳的單據行。
   *
   * ⚠️ 以**資料庫的 `total_amount`** 為分攤基礎（而非 `liveTotal`），因為已過帳的
   * 會計分錄與 `poPaymentSummary` 都以落庫金額為準；若用未儲存的行內編輯值會與
   * 既有 `paidAmountMap` 不同基準而算出錯誤的未付餘額。
   */
  const paymentLine = useMemo(
    () =>
      poPaymentDocLine(
        {
          id: order.id,
          supplier_order_number: order.supplier_order_number,
          total_amount: order.total_amount,
        },
        paidAmount,
      ),
    [order.id, order.total_amount, order.supplier_order_number, paidAmount],
  );

  const getMappingKey = (item: PurchaseOrderItem) => `${item.product_id}_${item.variant_id || 'null'}`;

  const visibleItems = useMemo(() => {
    if (!isFiltering) return localItems;
    const q = searchQuery.trim().toLowerCase();
    return localItems.filter((item) => {
      const mapping = supplierMappingMap[getMappingKey(item)];
      const sourceCodes = (item.source_order_ids || []).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(' ');
      const haystack = [
        item.product?.name,
        item.variant?.name,
        item.variant?.sku,
        item.product?.code,
        mapping?.vendor_product_id,
        mapping?.vendor_product_name,
        sourceCodes,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localItems, searchQuery, supplierMappingMap, sourceOrderMap]);

  const canReorder = !!onReorder && order.status !== 'cancelled';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const getItemName = (item: PurchaseOrderItem) => item.variant?.name || item.product?.name || '';

  const compareByName = (a: PurchaseOrderItem, b: PurchaseOrderItem) => {
    return getItemName(a).localeCompare(getItemName(b), 'zh-Hant-TW', { sensitivity: 'base' });
  };

  const applyOrder = (next: PurchaseOrderItem[]) => {
    const prev = localItems;
    setLocalItems(next);
    onReorder?.(next).catch(() => setLocalItems(prev));
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (isFiltering) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localItems.findIndex(i => i.id === active.id);
    const newIndex = localItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyOrder(arrayMove(localItems, oldIndex, newIndex));
    setNameSort('default');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localItems, onReorder, isFiltering]);

  const handleNameHeaderClick = () => {
    if (!canReorder || isFiltering) return;
    if (nameSort === 'default') {
      manualOrderRef.current = localItems.map(i => i.id);
      applyOrder([...localItems].sort(compareByName));
      setNameSort('asc');
    } else if (nameSort === 'asc') {
      applyOrder([...localItems].sort((a, b) => compareByName(b, a)));
      setNameSort('desc');
    } else {
      const manualIds = manualOrderRef.current;
      const manualItems = manualIds
        .map(id => localItems.find(i => i.id === id))
        .filter((i): i is PurchaseOrderItem => !!i);
      const rest = localItems.filter(i => !manualIds.includes(i.id));
      applyOrder([...manualItems, ...rest]);
      setNameSort('default');
    }
  };

  const renderItemCells = (item: PurchaseOrderItem) => {
    const mapping = supplierMappingMap[getMappingKey(item)];
    return (
      <>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-mono text-xs text-muted-foreground">{item.variant?.sku || item.product?.code}</span>
            <span className="text-sm font-medium">{item.variant?.name || item.product?.name}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-mono text-xs text-muted-foreground">{mapping?.vendor_product_id || '-'}</span>
            <span className="text-sm">{mapping?.vendor_product_name || '-'}</span>
            {canEditVendorMapping && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1 self-start"
                onClick={() => {
                  const pseudo: any = {
                    id: mapping?.id || '',
                    supplier_id: mapping?.supplier_id || order.supplier_id,
                    vendor_product_id: mapping?.vendor_product_id || '',
                    vendor_product_name: mapping?.vendor_product_name || null,
                    internal_product_id: item.product_id,
                    internal_variant_id: item.variant_id || null,
                    vendor_unit_cost: mapping?.vendor_unit_cost ?? null,
                    is_primary: mapping?.is_primary ?? false,
                    internal_product: { name: item.product?.name || '' },
                    internal_variant: item.variant ? { name: item.variant.name } : null,
                  };
                  setVendorEditRule(pseudo);
                  setVendorEditOpen(true);
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        </TableCell>

        <TableCell className="text-right">
          {canEdit && item.received_quantity <= 0 ? (
            <Input
              type="number"
              min={1}
              value={draftOf(item).quantity}
              onFocus={() => setEditingId(item.id)}
              onBlur={() => commitRow(item.id)}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setRowDrafts(prev => ({ ...prev, [item.id]: { ...draftOf(item), quantity: Number.isNaN(v) ? 1 : Math.max(1, v) } }));
              }}
              className="h-7 w-16 text-right"
              aria-label={`${item.variant?.name || item.product?.name || ''} 數量`}
            />
          ) : (
            <span className="font-medium">{item.quantity}</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          <span className={item.received_quantity >= item.quantity ? 'text-green-600 font-bold' : 'text-orange-600'}>
            {item.received_quantity}
          </span>
        </TableCell>
        <TableCell className="text-right">
          {canEdit ? (
            <Input
              type="number"
              min={0}
              step={0.01}
              value={draftOf(item).unit_cost}
              onFocus={() => setEditingId(item.id)}
              onBlur={() => commitRow(item.id)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setRowDrafts(prev => ({ ...prev, [item.id]: { ...draftOf(item), unit_cost: Number.isNaN(v) ? 0 : Math.max(0, v) } }));
              }}
              className="h-7 w-24 text-right"
              aria-label={`${item.variant?.name || item.product?.name || ''} 進貨價`}
            />
          ) : (
            formatCurrency(item.unit_cost)
          )}
        </TableCell>

        <TableCell className="text-right font-bold">{formatCurrency(draftOf(item).quantity * draftOf(item).unit_cost)}</TableCell>
                <TableCell>
          {(item.source_order_ids || []).length > 0 ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="text-xs text-primary hover:underline text-left"
                onClick={() => setExpandedSources((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })}
              >
                {item.source_order_ids!.length} 筆來源訂單 {expandedSources.has(item.id) ? '▴' : '▾'}
              </button>
              {expandedSources.has(item.id) && (
                <div className="flex flex-wrap gap-1">
                  {item.source_order_ids!.map(id => (
                    <span key={id} className="inline-flex items-center gap-1">
                      <Badge variant="outline" className="text-xs">
                        {sourceOrderMap[id] || id.slice(0, 8)}
                      </Badge>
                      <button
                        type="button"
                        title="解除與此訂單的採購關聯"
                        onClick={() => onUnlinkOrder(id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* 庫存差額：PO 數量高於所有來源訂單已採購總和 */}
              {(() => {
                const sq = item.source_quantities || {};
                const purchasedTotal = Object.values(sq).reduce((sum, v) => sum + Number(v || 0), 0);
                const inventoryQty = Math.max(0, item.quantity - purchasedTotal);
                return inventoryQty > 0 ? (
                  <span key="inventory" className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">
                    庫存 {inventoryQty}
                  </span>
                ) : null;
              })()}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1 mt-1 self-start"
              onClick={() => setBindItem(item)}
              title="綁訂來源訂單"
            >
              <Plus className="h-3 w-3 mr-1" /> 綁訂
            </Button>
          )}
        </TableCell>
        {canDelete && (
          <TableCell className="text-right">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={item.received_quantity > 0 || (item.consumed_quantity || 0) > 0}
              title={item.received_quantity > 0 || (item.consumed_quantity || 0) > 0 ? '已收貨／已使用品項不可刪除（請改用採購退貨）' : '刪除品項'}
              onClick={() => handleDeleteItem(item)}
              aria-label="刪除品項"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TableCell>
        )}
      </>
    );
  };

  const handleExportCSV = async () => {
    const data = localItems.map(item => {
      const mapping = supplierMappingMap[getMappingKey(item)];
      return {
        'SKU': item.variant?.sku || item.product?.code || '',
        '產品名稱': item.product?.name || '',
        '變體': item.variant?.name || '',
        '廠商代碼': mapping?.vendor_product_id || '',
        '廠商名稱': mapping?.vendor_product_name || '',
        '數量': item.quantity,
        '已收': item.received_quantity,
        '進貨價': item.unit_cost,
        '總額': item.quantity * item.unit_cost,
        '來源訂單': (item.source_order_ids || []).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(', '),
      };
    });
    await exportToCSV(data, `採購單_${order.id.slice(0, 8)}`);
  };

  const handleExportExcel = async () => {
    const data = localItems.map(item => {
      const mapping = supplierMappingMap[getMappingKey(item)];
      return {
        'SKU': item.variant?.sku || item.product?.code || '',
        '產品名稱': item.product?.name || '',
        '變體': item.variant?.name || '',
        '廠商代碼': mapping?.vendor_product_id || '',
        '廠商名稱': mapping?.vendor_product_name || '',
        '數量': item.quantity,
        '已收': item.received_quantity,
        '進貨價': item.unit_cost,
        '總額': item.quantity * item.unit_cost,
        '來源訂單': (item.source_order_ids || []).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(', '),
      };
    });
    const xlsx = await import('xlsx');
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '採購單');

    // 依店家分頁：同一品項若來自多個店家，依來源訂單數量拆成多列
    const byStoreRows = buildByStoreRows(localItems, sourceOrderStoreMap);
    const storeRows: any[] = byStoreRows.map((r) => {
      const item = r.item;
      const mapping = supplierMappingMap[getMappingKey(item)];
      const sources = item.source_order_ids || [];
      return {
        '店家': r.store,
        'SKU': item.variant?.sku || item.product?.code || '',
        '產品名稱': item.product?.name || '',
        '變體': item.variant?.name || '',
        '廠商代碼': mapping?.vendor_product_id || '',
        '廠商名稱': mapping?.vendor_product_name || '',
        '數量': r.quantity,
        '已收': r.received,
        '進貨價': item.unit_cost,
        '總額': r.quantity * item.unit_cost,
        '來源訂單': (r.sourceOrderIds.length > 0 ? r.sourceOrderIds : sources).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(', '),
      };
    });
    // 依店家名稱排序，方便檢視
    storeRows.sort((a, b) => String(a['店家']).localeCompare(String(b['店家']), 'zh-Hant-TW'));
    const wsByStore = xlsx.utils.json_to_sheet(storeRows);
    xlsx.utils.book_append_sheet(wb, wsByStore, '依店家');

    xlsx.writeFile(wb, `採購單_${order.id.slice(0, 8)}_${Date.now()}.xlsx`);
  };

  const handleSaveSupplierOrderNo = async () => {
    if (!onUpdateOrder) return;
    setSavingSupplierOrderNo(true);
    try {
      await onUpdateOrder(order.id, { supplier_order_number: supplierOrderNoDraft.trim() });
      setEditingSupplierOrderNo(false);
      toast.success('廠商單號已更新');
    } catch (e: any) {
      toast.error(e?.message || '更新失敗');
    } finally {
      setSavingSupplierOrderNo(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary">草稿</Badge>;
      case 'ordered': return <Badge variant="outline" className="border-blue-500 text-blue-500">已下單</Badge>;
      case 'partial_received': return <Badge variant="outline" className="border-orange-500 text-orange-500">部分收貨</Badge>;
      case 'received': return <Badge variant="outline" className="border-green-500 text-green-500">已收貨</Badge>;
      case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const colSpan = (canReorder ? 1 : 0) + 7 + (canDelete ? 1 : 0);

  return (
    <div className="space-y-6 py-4">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">採購單 #{order.id.slice(0, 8)}</h2>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-sm text-muted-foreground">供應商: {order.supplier?.name || '未指定'}</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>廠商單號:</span>
            {editingSupplierOrderNo ? (
              <>
                <Input
                  className="h-7 w-40"
                  value={supplierOrderNoDraft}
                  onChange={(e) => setSupplierOrderNoDraft(e.target.value)}
                  placeholder="（選填）"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveSupplierOrderNo();
                    if (e.key === 'Escape') setEditingSupplierOrderNo(false);
                  }}
                />
                <Button size="sm" variant="outline" className="h-7" onClick={handleSaveSupplierOrderNo} disabled={savingSupplierOrderNo}>
                  {savingSupplierOrderNo ? '儲存中…' : '儲存'}
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingSupplierOrderNo(false)} disabled={savingSupplierOrderNo}>
                  取消
                </Button>
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{order.supplier_order_number || '（未填）'}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => {
                    setSupplierOrderNoDraft(order.supplier_order_number || '');
                    setEditingSupplierOrderNo(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />{order.supplier_order_number ? '編輯' : '新增'}
                </Button>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground">日期: {order.order_date}</p>
          <p className="text-sm text-muted-foreground">
            品項/總數: <strong>{localItems.length}</strong> 項 / <strong>{localItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0)}</strong> 件
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={onEditOrder}>
            <Pencil className="h-4 w-4 mr-1" />編輯
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-1" />匯出 CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => setQuickCopyOpen(true)}>
            <Download className="h-4 w-4 mr-1" />快速複製
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />匯出 Excel
          </Button>
          <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />預算外品項</Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>新增品項</DialogTitle>
                <DialogDescription>
                  請挑選預算外需額外採購的品項，可調整數量與進貨價後一次加入。
                </DialogDescription>
              </DialogHeader>
              <PurchaseProductPicker
                purchaseOrderId={order.id}
                supplierId={order.supplier_id}
                isLoading={isLoading}
                onSubmit={async (items) => { if (await submitNewItems(items)) setAddItemOpen(false); }}
              />
            </DialogContent>
          </Dialog>

          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setBatchBindOpen(true)}>
              <Link2 className="h-4 w-4 mr-1" /> 批次綁定來源訂單
            </Button>
          )}
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />匯入銷售需求</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>匯入待採購品項</DialogTitle>
                <DialogDescription>
                  從現有的銷售訂單中選取待採購的需求，自動填入採購清單。
                </DialogDescription>
              </DialogHeader>
              <ImportFromOrdersDialog products={products} supplierId={order.supplier_id || undefined} isLoading={isLoading} onSubmit={async (items) => { if (await submitNewItems(items)) setImportOpen(false); }} />
            </DialogContent>
          </Dialog>

          <BindSourceOrdersDialog
            open={!!bindItem}
            onOpenChange={(open) => { if (!open) setBindItem(null); }}
            poItem={bindItem}
            sourceOrderMap={sourceOrderMap}
            sourceOrderStoreMap={sourceOrderStoreMap}
            sourceOrderDateMap={sourceOrderDateMap}
            isLoading={isLoading}
            onSubmit={handleBindSources}
          />

          <BatchBindSourceOrdersDialog
            open={batchBindOpen}
            onOpenChange={setBatchBindOpen}
            items={localItems}
            sourceOrderMap={sourceOrderMap}
            sourceOrderStoreMap={sourceOrderStoreMap}
            sourceOrderDateMap={sourceOrderDateMap}
            isLoading={isLoading}
            onSubmit={handleBatchBindSources}
          />

          <Dialog open={excelImportOpen} onOpenChange={setExcelImportOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={!order.supplier_id}
                title={!order.supplier_id ? "請先在編輯中指定供應商" : "從供應商格式的 Excel 匯入"}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                廠商格式匯入
              </Button>
            </DialogTrigger>
            {order.supplier_id && (
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>從廠商 Excel 匯入</DialogTitle>
                  <DialogDescription>
                    上傳供應商提供的特定格式 Excel 檔案，系統將自動解析並載入採購品項。
                  </DialogDescription>
                </DialogHeader>
                <ExcelImportDialog
                  supplierId={order.supplier_id}
                  supplierName={order.supplier?.name || '未知供應商'}
                  isLoading={isLoading}
                  onImport={async (items) => { if (await submitNewItems(items)) setExcelImportOpen(false); }}
                />
              </DialogContent>
            )}
          </Dialog>
        </div>
      </div>

      <PurchaseOrderDetailItemsView
        itemView={itemView}
        onItemViewChange={setItemView}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        visibleItems={visibleItems}
        isFiltering={isFiltering}
        canReorder={canReorder}
        canDelete={canDelete}
        colSpan={colSpan}
        sensors={sensors}
        nameSort={nameSort}
        renderItemCells={renderItemCells}
        handleDragEnd={handleDragEnd}
        handleNameHeaderClick={handleNameHeaderClick}
        sourceOrderStoreMap={sourceOrderStoreMap}
        supplierMappingMap={supplierMappingMap}
      />

      <PurchaseFreightSection
        purchaseOrderId={order.id}
        freightAllocationMethod={order.freight_allocation_method || 'by_value'}
        freightActualWeight={order.freight_actual_weight ?? null}
        freightAllocationStale={order.freight_allocation_stale ?? false}
        landedTotalAmount={order.landed_total_amount ?? null}
        totalAmount={Number(order.total_amount)}
        items={localItems}
      />

      <div className="flex justify-between items-end bg-muted/30 p-4 rounded-lg">
        <div className="flex gap-3">
          <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
            <DialogTrigger asChild>
              <Button variant="default" className="bg-green-600 hover:bg-green-700">
                <PackageCheck className="h-4 w-4 mr-2" /> 收貨錄入
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>記錄收貨</DialogTitle>
                <DialogDescription>
                  請核對收到的實物數量，錄入系統以增加庫存。支援部分收貨。
                </DialogDescription>
              </DialogHeader>
              <ReceiveForm items={localItems} isLoading={isLoading} onSubmit={(data) => { onReceiveItems({ items: data }); setReceiveOpen(false); }} />
            </DialogContent>
          </Dialog>

          {/* 付款對帳 — 統一走會計 EntryDialog，建立真正的會計分錄與單據關聯 */}
          <Button
            variant="outline"
            className="border-blue-500 text-blue-500 hover:bg-blue-50"
            onClick={() => setPaymentOpen(true)}
            disabled={!paymentLine}
          >
            <CreditCard className="h-4 w-4 mr-2" /> 付款對帳
          </Button>
        </div>

        <div className="text-right space-y-1">
          <p className="text-sm text-muted-foreground">總計金額</p>
          <p className="text-3xl font-bold text-primary">{formatCurrency(liveTotal)}</p>
        </div>
      </div>

      <EntryDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        categories={categories}
        accounts={accounts}
        isLoading={isLoading}
        prefill={
          paymentLine
            ? {
              amount: Math.abs(paymentLine.amountApplied),
              categoryId: (() => {
                const wantType = paymentLine.amountApplied < 0 ? 'expense' : 'income';
                const wantName = paymentLine.amountApplied < 0 ? '採購' : '退貨';
                const hit = categories.find(
                  (c) => c.type === wantType && (c.name.includes(wantName) || c.name.includes('供應商')),
                );
                return hit?.id || categories.find((c) => c.type === wantType)?.id;
              })(),
              description: paymentLine.isCredit
                ? `採購退貨沖帳: ${paymentLine.supplierOrderNumber || order.id.slice(0, 8)}`
                : `採購單付款: ${paymentLine.supplierOrderNumber || order.id.slice(0, 8)}`,
              referenceType: 'purchase_order',
              referenceId: order.id,
              transactionDate: order.order_date || undefined,
              markAsPaid: true,
              docItems: [
                {
                  docType: 'purchase_order',
                  docId: order.id,
                  code: paymentLine.supplierOrderNumber || order.id.slice(0, 8),
                  name: order.supplier?.name || '未知供應商',
                  date: order.order_date || order.created_at,
                  originalAmount: paymentLine.totalAmount,
                  // 退貨為正收入、一般採購為負支出，與 batchActions 同一規則
                  amountApplied: paymentLine.amountApplied,
                },
              ],
            }
            : undefined
        }
        onSubmit={(data, references) => {
          onMakePayment(data, references);
          setPaymentOpen(false);
        }}
      />
      <MappedRuleEditDialog
        open={vendorEditOpen}
        onOpenChange={setVendorEditOpen}
        rule={vendorEditRule}
        isSaving={false}
        onSave={async (data) => {
          if (!onSaveVendorMapping) return;
          try {
            await onSaveVendorMapping({
              mappingId: data.id || undefined,
              supplierId: data.supplier_id,
              vendorProductId: data.vendor_product_id,
              vendorProductName: data.vendor_product_name,
              productId: data.internal_product_id,
              variantId: data.internal_variant_id,
              vendorUnitCost: data.vendor_unit_cost,
            });
            // 只更新該單：把廠商對照的進貨價同步回此採購單品項的進貨價（僅未收貨品項）
            if (data.vendor_unit_cost != null && onUpdateItem) {
              const newCost = Number(data.vendor_unit_cost);
              const affected = localItems.filter(
                (i) => i.product_id === data.internal_product_id && (i.variant_id || null) === (data.internal_variant_id || null) && (i.received_quantity || 0) <= 0,
              );
              if (affected.length > 0) {
                const next = localItems.map((i) =>
                  affected.some((a) => a.id === i.id) ? { ...i, unit_cost: newCost } : i,
                );
                setLocalItems(next);
                try {
                  await onUpdateItem({ purchaseOrderId: order.id, items: next.map((i) => ({
                    id: i.id,
                    product_id: i.product_id || '',
                    variant_id: i.variant_id || null,
                    quantity: i.quantity,
                    unit_cost: Number(i.unit_cost) || 0,
                  })) });
                } catch {
                  setLocalItems(localItems);
                }
              }
            }
          } catch {
            // toast 由 mutation 顯示
          }
        }}
      />
      <PurchaseOrderDetailQuickCopyDialog
        open={quickCopyOpen}
        onOpenChange={setQuickCopyOpen}
        localItems={localItems}
        sourceOrderStoreMap={sourceOrderStoreMap}
        supplierMappingMap={supplierMappingMap}
      />
    </div>
  );
}
