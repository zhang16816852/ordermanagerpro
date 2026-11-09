import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { PurchaseOrderItem } from '../types';

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

interface ByStoreRow {
  store: string;
  item: PurchaseOrderItem;
  quantity: number;
  received: number;
  sourceOrderIds: string[];
}

interface Props {
  itemView: 'items' | 'byStore';
  onItemViewChange: (v: 'items' | 'byStore') => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  visibleItems: PurchaseOrderItem[];
  isFiltering: boolean;
  canReorder: boolean;
  canDelete: boolean;
  colSpan: number;
  sensors: any;
  nameSort: 'default' | 'asc' | 'desc';
  renderItemCells: (item: PurchaseOrderItem) => React.ReactNode;
  handleDragEnd: (event: DragEndEvent) => void;
  handleNameHeaderClick: () => void;
  sourceOrderStoreMap: Record<string, string>;
  supplierMappingMap: Record<string, { vendor_product_id?: string; vendor_product_name?: string }>;
}

const getMappingKey = (item: PurchaseOrderItem) => `${item.product_id}_${item.variant_id || 'null'}`;

function buildByStoreRows(items: PurchaseOrderItem[], sourceOrderStoreMap: Record<string, string>): ByStoreRow[] {
  const rows: ByStoreRow[] = [];
  for (const item of items) {
    const sources = item.source_order_ids || [];
    if (sources.length === 0) {
      rows.push({ store: '無來源訂單', item, quantity: item.quantity, received: item.received_quantity, sourceOrderIds: [] });
      continue;
    }
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
      const storeSourceIds = sources.filter((sid) => (sourceOrderStoreMap[sid] || '未指定店家') === store);
      rows.push({
        store,
        item,
        quantity: storeQty[store] || 0,
        received: receivedByStore[store] || 0,
        sourceOrderIds: storeSourceIds,
      });
    }
    const sourceQtyTotal = Object.values(storeQty).reduce((a, b) => a + b, 0);
    const inventoryQty = Math.max(0, item.quantity - sourceQtyTotal);
    if (inventoryQty > 0) {
      rows.push({ store: '庫存', item, quantity: inventoryQty, received: 0, sourceOrderIds: [] });
    }
  }
  return rows;
}

export function PurchaseOrderDetailItemsView(props: Props) {
  const {
    itemView, onItemViewChange, searchQuery, onSearchQueryChange,
    visibleItems, isFiltering, canReorder, canDelete, colSpan,
    sensors, nameSort, renderItemCells, handleDragEnd, handleNameHeaderClick,
    sourceOrderStoreMap, supplierMappingMap,
  } = props;

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Button size="sm" variant={itemView === 'items' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => onItemViewChange('items')}>
            品項
          </Button>
          <Button size="sm" variant={itemView === 'byStore' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => onItemViewChange('byStore')}>
            依店家
          </Button>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="搜尋品項（名稱 / SKU / 廠商 / 來源訂單）"
            className="pl-8"
            aria-label="搜尋品項"
          />
        </div>
        {isFiltering && (
          <span className="text-xs text-muted-foreground">共 {visibleItems.length} 項符合</span>
        )}
      </div>

      {itemView === 'items' ? (
        <div className="border rounded-md">
          {canReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {canReorder && <TableHead className="w-8"></TableHead>}
                    {canReorder ? (
                      <TableHead className="min-w-[220px]">
                        <button type="button" onClick={handleNameHeaderClick} className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground cursor-pointer">
                          產品（SKU / 名稱）
                          {nameSort === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : nameSort === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                        </button>
                      </TableHead>
                    ) : (
                      <TableHead className="min-w-[220px]">產品（SKU / 名稱）</TableHead>
                    )}
                    <TableHead className="min-w-[200px]">廠商（代碼 / 名稱）</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">已收</TableHead>
                    <TableHead className="text-right">進貨價</TableHead>
                    <TableHead className="text-right">總額</TableHead>
                    <TableHead>來源訂單</TableHead>
                    {canDelete && <TableHead className="w-12 text-right">操作</TableHead>}
                  </TableRow>
                </TableHeader>
                <SortableContext items={visibleItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <TableBody>
                    {visibleItems.map((item) => {
                      const boundTotal = Object.values(item.source_quantities || {}).reduce((s, v) => s + Number(v || 0), 0);
                      const fullyBound = boundTotal > 0 && boundTotal === item.quantity;
                      return (
                        <SortableRow key={item.id} item={item} fullyBound={fullyBound}>
                          {renderItemCells(item)}
                        </SortableRow>
                      );
                    })}
                    {visibleItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground italic">
                          {isFiltering ? '查無符合的品項' : '目前無任何品項'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </SortableContext>
              </Table>
            </DndContext>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">產品（SKU / 名稱）</TableHead>
                  <TableHead className="min-w-[200px]">廠商（代碼 / 名稱）</TableHead>
                  <TableHead className="text-right">數量</TableHead>
                  <TableHead className="text-right">已收</TableHead>
                  <TableHead className="text-right">進貨價</TableHead>
                  <TableHead className="text-right">總額</TableHead>
                  <TableHead>來源訂單</TableHead>
                  {canDelete && <TableHead className="w-12 text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => {
                  const boundTotal = Object.values(item.source_quantities || {}).reduce((s, v) => s + Number(v || 0), 0);
                  const fullyBound = boundTotal > 0 && boundTotal === item.quantity;
                  return (
                    <TableRow key={item.id} className={fullyBound ? 'bg-green-50/50 [&>td]:font-semibold [&>td]:border-green-500 [&>td]:border-y-2 [&>td:first-child]:border-l-2 [&>td:last-child]:border-r-2' : ''}>
                      {renderItemCells(item)}
                    </TableRow>
                  );
                })}
                {visibleItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground italic">
                      {isFiltering ? '查無符合的品項' : '目前無任何品項'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      ) : (
        <div className="border rounded-md p-4 space-y-4">
          {(() => {
            const rows = buildByStoreRows(visibleItems, sourceOrderStoreMap);
            const groups: Record<string, ByStoreRow[]> = {};
            for (const r of rows) (groups[r.store] ||= []).push(r);
            const storeNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));
            if (storeNames.length === 0) return <p className="text-center py-8 text-muted-foreground italic">目前無任何品項</p>;
            return storeNames.map((store) => (
              <div key={store} className="space-y-2">
                <h4 className="text-sm font-semibold text-primary">{store}（{groups[store].length} 項）</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">產品（SKU / 名稱）</TableHead>
                      <TableHead className="min-w-[200px]">廠商（代碼 / 名稱）</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">已收</TableHead>
                      <TableHead className="text-right">進貨價</TableHead>
                      <TableHead className="text-right">總額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups[store].map((r, idx) => {
                      const item = r.item;
                      const mapping = supplierMappingMap[getMappingKey(item)];
                      return (
                        <TableRow key={`${item.id}-${store}-${idx}`}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-mono text-xs text-muted-foreground">{item.variant?.sku || item.product?.code}</span>
                              <span className="text-sm">{item.variant?.name || item.product?.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-mono text-xs text-muted-foreground">{mapping?.vendor_product_id || '-'}</span>
                              <span className="text-sm">{mapping?.vendor_product_name || '-'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{r.quantity}</TableCell>
                          <TableCell className="text-right">{r.received}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.unit_cost)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(r.quantity * item.unit_cost)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ));
          })()}
        </div>
      )}
    </>
  );
}

