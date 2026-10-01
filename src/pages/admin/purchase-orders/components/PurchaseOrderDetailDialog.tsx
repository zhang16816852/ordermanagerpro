import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { Plus, PackageCheck, CreditCard, Download, FileSpreadsheet, X, GripVertical, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Search, Pencil } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { PurchaseOrder, PurchaseOrderItem, ProductWithPrice, type PoItemWritePayload, type PoUpdateItemPayload } from '../types';
import { PurchaseProductPicker } from './PurchaseProductPicker';
import { ImportFromOrdersDialog } from './ImportFromOrdersDialog';
import { ReceiveForm } from './ReceiveForm';
import { PaymentForm } from './PaymentForm';
import { ExcelImportDialog } from './ExcelImportDialog';
import { exportToCSV } from '@/lib/exportUtils';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';


function SortableRow({ item, children }: { item: PurchaseOrderItem; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };
  return (
    <TableRow ref={setNodeRef} style={style} {...attributes}>
      <TableCell {...listeners} className="cursor-grab active:cursor-grabbing w-8 text-center text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4 mx-auto" />
      </TableCell>
      {children}
    </TableRow>
  );
}

interface PurchaseOrderDetailDialogProps {
  order: PurchaseOrder;
  orderItems: PurchaseOrderItem[];
  products: ProductWithPrice[];
  accounts: any[];
  sourceOrderMap: Record<string, string>;
  supplierMappingMap: Record<string, { vendor_product_id: string; vendor_product_name: string }>;
  /** 匯入／追加品項：items 為「既有品項 + 新品項（id: null）」的整單清單 */
  onImportItems: (data: { purchaseOrderId: string; items: PoUpdateItemPayload[] }) => Promise<unknown>;
  onReceiveItems: (data: any) => void;
  onMakePayment: (data: any) => void;
  onUnlinkOrder: (orderId: string) => void;
  /** 導向統一採購編輯頁（/admin/purchase-orders/:id/edit） */
  onEditOrder?: () => void;
  /** 品項數量／單價更新：items 為整單品項（已帶 id），由伺服端依序重編 sort_order 並重算總額 */
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
  sourceOrderMap,
  supplierMappingMap,
  onImportItems,
  onReceiveItems,
  onMakePayment,
  onUnlinkOrder,
  onEditOrder,
  onUpdateItem,
  onDeleteItem,
  onReorder,
  isLoading
}: PurchaseOrderDetailDialogProps) {
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [excelImportOpen, setExcelImportOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const [localItems, setLocalItems] = useState<PurchaseOrderItem[]>(orderItems);
  const [nameSort, setNameSort] = useState<'default' | 'asc' | 'desc'>('default');
  const manualOrderRef = useRef<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // 數量 / 單價 的行內編輯暫存值
  const [rowDrafts, setRowDrafts] = useState<Record<string, { quantity: number; unit_cost: number }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

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

  // 依目前行內編輯值（含未儲存的草稿）動態計算總額
  const liveTotal = useMemo(() => {
    return localItems.reduce((sum, item) => {
      const d = draftOf(item);
      return sum + d.quantity * d.unit_cost;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localItems, rowDrafts]);

  const isFiltering = searchQuery.trim() !== '';

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
        <TableCell className="font-mono text-xs">{item.variant?.sku || item.product?.code}</TableCell>
        <TableCell>
          <p className="text-sm font-medium">{item.variant?.name || item.product?.name}</p>
        </TableCell>
        <TableCell className="font-mono text-xs">{mapping?.vendor_product_id || '-'}</TableCell>
        <TableCell className="text-sm">{mapping?.vendor_product_name || '-'}</TableCell>
        <TableCell>
          {(item.source_order_ids || []).length > 0 ? (
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
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
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
              aria-label={`${item.variant?.name || item.product?.name || ''} 單價`}
            />
          ) : (
            formatCurrency(item.unit_cost)
          )}
        </TableCell>
        <TableCell className="text-right font-bold">{formatCurrency(draftOf(item).quantity * draftOf(item).unit_cost)}</TableCell>
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
        '單價': item.unit_cost,
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
        '單價': item.unit_cost,
        '總額': item.quantity * item.unit_cost,
        '來源訂單': (item.source_order_ids || []).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(', '),
      };
    });
    const xlsx = await import('xlsx');
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '採購單');
    xlsx.writeFile(wb, `採購單_${order.id.slice(0, 8)}_${Date.now()}.xlsx`);
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

  const colSpan = (canReorder ? 1 : 0) + 9 + (canDelete ? 1 : 0);

  return (
    <div className="space-y-6 py-4">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">採購單 #{order.id.slice(0, 8)}</h2>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-sm text-muted-foreground">供應商: {order.supplier?.name || '未指定'}</p>
          {order.supplier_order_number && (
            <p className="text-sm text-muted-foreground">廠商單號: {order.supplier_order_number}</p>
          )}
          <p className="text-sm text-muted-foreground">日期: {order.order_date}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={onEditOrder}>
            <Pencil className="h-4 w-4 mr-1" />編輯
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-1" />匯出 CSV
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
                  請挑選預算外需額外採購的品項，可調整數量與單價後一次加入。
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
              <ImportFromOrdersDialog products={products} isLoading={isLoading} onSubmit={async (items) => { if (await submitNewItems(items)) setImportOpen(false); }} />
            </DialogContent>
          </Dialog>

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

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋品項（名稱 / SKU / 廠商 / 來源訂單）"
            className="pl-8"
            aria-label="搜尋品項"
          />
        </div>
        {isFiltering && (
          <span className="text-xs text-muted-foreground">
            共 {visibleItems.length} 項符合
          </span>
        )}
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              {canReorder && <TableHead className="w-8"></TableHead>}
              <TableHead>SKU</TableHead>
              {canReorder ? (
                <TableHead>
                  <button
                    type="button"
                    onClick={handleNameHeaderClick}
                    className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    產品名稱
                    {nameSort === 'asc' ? (
                      <ArrowUp className="h-3.5 w-3.5" />
                    ) : nameSort === 'desc' ? (
                      <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                    )}
                  </button>
                </TableHead>
              ) : (
                <TableHead>產品名稱</TableHead>
              )}
              <TableHead>廠商代碼</TableHead>
              <TableHead>廠商名稱</TableHead>
              <TableHead>來源訂單</TableHead>
              <TableHead className="text-right">數量</TableHead>
              <TableHead className="text-right">已收</TableHead>
              <TableHead className="text-right">單價</TableHead>
              <TableHead className="text-right">總額</TableHead>
              {canDelete && <TableHead className="w-12 text-right">操作</TableHead>}
            </TableRow>
          </TableHeader>
          {canReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visibleItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <TableBody>
                  {visibleItems.map((item) => (
                    <SortableRow key={item.id} item={item}>
                      {renderItemCells(item)}
                    </SortableRow>
                  ))}
                  {visibleItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground italic">
                        {isFiltering ? '查無符合的品項' : '目前無任何品項'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </SortableContext>
            </DndContext>
          ) : (
            <TableBody>
              {visibleItems.map((item) => (
                <TableRow key={item.id}>
                  {renderItemCells(item)}
                </TableRow>
              ))}
              {visibleItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground italic">
                    {isFiltering ? '查無符合的品項' : '目前無任何品項'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          )}
        </Table>
      </div>

      <div className="flex justify-between items-end bg-muted/30 p-4 rounded-lg">
        <div className="flex gap-3">
          <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
            <DialogTrigger asChild>
              <Button variant="default" className="bg-green-600 hover:bg-green-700">
                <PackageCheck className="h-4 w-4 mr-2" /> 收貨錄入
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>記錄收貨</DialogTitle>
                <DialogDescription>
                  請核對收到的實物數量，錄入系統以增加庫存。支援部分收貨。
                </DialogDescription>
              </DialogHeader>
              <ReceiveForm items={localItems} isLoading={isLoading} onSubmit={(data) => { onReceiveItems({ items: data }); setReceiveOpen(false); }} />
            </DialogContent>
          </Dialog>

          <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-blue-500 text-blue-500 hover:bg-blue-50">
                <CreditCard className="h-4 w-4 mr-2" /> 付款對帳
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>記錄付款</DialogTitle>
                <DialogDescription>
                  記錄對供應商的付款流水，關聯至特定帳戶以進行對帳。
                </DialogDescription>
              </DialogHeader>
              <PaymentForm accounts={accounts} amount={order.total_amount} isLoading={isLoading} onSubmit={(data) => { onMakePayment(data); setPaymentOpen(false); }} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="text-right space-y-1">
          <p className="text-sm text-muted-foreground">總計金額</p>
          <p className="text-3xl font-bold text-primary">{formatCurrency(liveTotal)}</p>
        </div>
      </div>
    </div>
  );
}
