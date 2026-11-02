import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, X, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseOrderItem } from '../types';

interface BatchBindSourceOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PurchaseOrderItem[];
  sourceOrderMap: Record<string, string>;
  sourceOrderStoreMap?: Record<string, string>;
  sourceOrderDateMap?: Record<string, string>;
  onSubmit: (newItems: PurchaseOrderItem[]) => Promise<void>;
  isLoading: boolean;
}

interface CandidateItem {
  _id: string;
  order_id: string;
  order_code: string;
  store_name: string;
  order_date: string;
  order_status: string;
  quantity: number; // 可綁數量
}

type ItemBindState = {
  selected: Set<string>;
  quantities: Record<string, number>;
  existingQtys: Record<string, number>;
};

export function BatchBindSourceOrdersDialog({
  open,
  onOpenChange,
  items,
  sourceOrderMap,
  sourceOrderStoreMap = {},
  sourceOrderDateMap = {},
  onSubmit,
  isLoading,
}: BatchBindSourceOrdersDialogProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(items.map((i) => i.id)));
  const [bindState, setBindState] = useState<Record<string, ItemBindState>>({});

  const { data, isLoading: dataLoading } = useQuery<{ orders: any[]; boundSet: Set<string> }>({
    queryKey: ['batch-bind-candidates', items.map((i) => i.id).join(',')],
    enabled: open && items.length > 0,
    queryFn: async () => {
      const { data: orders, error } = await (supabase as any)
        .from('orders')
        .select(`
          id, code, created_at, store_id, status,
          stores ( id, name ),
          order_items ( id, quantity, shipped_quantity, product_id, variant_id, line_type, is_repair )
        `)
        .in('status', ['pending', 'processing', 'shipped'])
        .order('created_at', { ascending: false });
      if (error) throw error;

      const { data: boundItems } = await (supabase as any)
        .from('purchase_order_items')
        .select('source_order_ids, product_id, variant_id')
        .not('source_order_ids', 'is', null);
      const boundSet = new Set<string>();
      (boundItems || []).forEach((poi: any) => {
        (poi.source_order_ids || []).forEach((oid: string) => {
          boundSet.add(`${oid}|${poi.product_id}|${poi.variant_id || 'null'}`);
        });
      });

      return { orders: orders || [], boundSet };
    },
  });

  // 候選清單 per item
  const candidatesByItem = useMemo<Record<string, CandidateItem[]>>(() => {
    const out: Record<string, CandidateItem[]> = {};
    if (!data) return out;
    const { orders, boundSet } = data;
    for (const item of items) {
      const list: CandidateItem[] = [];
      (orders || []).forEach((order: any) => {
        (order.order_items || []).forEach((oi: any) => {
          if (oi.product_id !== item.product_id) return;
          if ((oi.variant_id || null) !== (item.variant_id || null)) return;
          if (oi.quantity <= 0) return;
          if (oi.line_type === 'return' || oi.line_type === 'defective') return;
          if (oi.line_type === 'exchange' && oi.is_repair) return;
          if (boundSet.has(`${order.id}|${oi.product_id}|${oi.variant_id || 'null'}`)) return;
          const bindableQty =
            order.status === 'shipped'
              ? oi.quantity
              : oi.quantity - (oi.shipped_quantity || 0);
          if (bindableQty <= 0) return;
          list.push({
            _id: oi.id,
            order_id: order.id,
            order_code: order.code,
            store_name: order.stores?.name || '未指定店家',
            order_date: order.created_at,
            order_status: order.status || 'pending',
            quantity: bindableQty,
          });
        });
      });
      out[item.id] = list;
    }
    return out;
  }, [data, items]);

  // 初始化綁定狀態 + 自動建議（僅首次開啟時）
  useEffect(() => {
    if (!open || !data) return;
    const init: Record<string, ItemBindState> = {};
    for (const item of items) {
      const existingIds = item.source_order_ids || [];
      const existingQtysBase = item.source_quantities || {};
      const initExisting: Record<string, number> = {};
      for (const id of existingIds) initExisting[id] = Number(existingQtysBase[id] || 0);

      // 自動建議：對尚未綁定的 candidate，依可綁量由小到大填滿剩餘可綁量
      const existingTotal = Object.values(initExisting).reduce((s, v) => s + (v || 0), 0);
      let remaining = Math.max(0, item.quantity - existingTotal);
      const candidates = (candidatesByItem[item.id] || []).filter((c) => !existingIds.includes(c.order_id));
      // 依可綁量由小到大排序，避免單一 candidate 占滿全部
      const sorted = [...candidates].sort((a, b) => a.quantity - b.quantity);
      const selected = new Set<string>();
      const quantities: Record<string, number> = {};
      for (const c of sorted) {
        if (remaining <= 0) break;
        const take = Math.min(c.quantity, remaining);
        if (take > 0) {
          selected.add(c._id);
          quantities[c._id] = take;
          remaining -= take;
        }
      }

      init[item.id] = {
        selected,
        quantities,
        existingQtys: initExisting,
      };
    }
    setBindState(init);
    setExpanded(new Set(items.map((i) => i.id)));
  }, [open, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const keywords = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const handleToggle = (itemId: string, candId: string, checked: boolean) => {
    setBindState((prev) => {
      const st = prev[itemId];
      if (!st) return prev;
      const next = new Set(st.selected);
      const newQtys = { ...st.quantities };
      if (checked) {
        next.add(candId);
        const cand = (candidatesByItem[itemId] || []).find((c) => c._id === candId);
        // 預設填剩餘可綁量
        const existingTotal = Object.values(st.existingQtys).reduce((s, v) => s + (v || 0), 0);
        const usedNew = Object.entries(newQtys).reduce((s, [k, v]) => (next.has(k) ? s + (v || 0) : s), 0);
        const remaining = Math.max(0, (items.find((i) => i.id === itemId)?.quantity || 0) - existingTotal - usedNew);
        const defaultQty = Math.min(cand?.quantity ?? 1, remaining > 0 ? remaining : (cand?.quantity ?? 1));
        newQtys[candId] = defaultQty > 0 ? defaultQty : 1;
      } else {
        next.delete(candId);
        delete newQtys[candId];
      }
      return { ...prev, [itemId]: { ...st, selected: next, quantities: newQtys } };
    });
  };

  const handleQtyChange = (itemId: string, candId: string, v: number) => {
    setBindState((prev) => {
      const st = prev[itemId];
      if (!st) return prev;
      return { ...prev, [itemId]: { ...st, quantities: { ...st.quantities, [candId]: Math.max(0, v) } } };
    });
  };

  const handleExistingQtyChange = (itemId: string, orderId: string, v: number) => {
    setBindState((prev) => {
      const st = prev[itemId];
      if (!st) return prev;
      return { ...prev, [itemId]: { ...st, existingQtys: { ...st.existingQtys, [orderId]: Math.max(0, v) } } };
    });
  };

  const handleClearSuggest = (itemId: string) => {
    setBindState((prev) => {
      const st = prev[itemId];
      if (!st) return prev;
      return { ...prev, [itemId]: { ...st, selected: new Set(), quantities: {} } };
    });
  };

  const handleSelectAll = (itemId: string) => {
    setBindState((prev) => {
      const st = prev[itemId];
      if (!st) return prev;
      const cands = (candidatesByItem[itemId] || []).filter((c) => !Object.keys(st.existingQtys).includes(c.order_id));
      const selected = new Set(cands.map((c) => c._id));
      const quantities: Record<string, number> = { ...st.quantities };
      for (const c of cands) {
        if (quantities[c._id] == null) quantities[c._id] = c.quantity;
      }
      return { ...prev, [itemId]: { ...st, selected, quantities } };
    });
  };

  // 驗證：每個 item 總綁定量 <= quantity
  const itemTotals = useMemo(() => {
    const out: Record<string, { total: number; max: number; ok: boolean }> = {};
    for (const item of items) {
      const st = bindState[item.id];
      if (!st) { out[item.id] = { total: 0, max: item.quantity, ok: true }; continue; }
      const newTotal = [...st.selected].reduce((s, id) => s + (st.quantities[id] || 0), 0);
      const existTotal = Object.values(st.existingQtys).reduce((s, v) => s + (v || 0), 0);
      const total = newTotal + existTotal;
      out[item.id] = { total, max: item.quantity, ok: total <= item.quantity };
    }
    return out;
  }, [items, bindState]);

  const hasAnyChange = useMemo(() => {
    return items.some((item) => {
      const st = bindState[item.id];
      if (!st) return false;
      const existingIds = item.source_order_ids || [];
      const newIds = Object.keys(st.existingQtys).filter((id) => (st.existingQtys[id] || 0) > 0);
      // existing changed?
      const existingChanged = existingIds.length !== newIds.length || existingIds.some((id) => !newIds.includes(id)) || newIds.some((id) => (st.existingQtys[id] || 0) !== (item.source_quantities?.[id] || 0));
      // new selected?
      const newSelected = st.selected.size > 0;
      return existingChanged || newSelected;
    });
  }, [items, bindState]);

  const allValid = useMemo(() => Object.values(itemTotals).every((t) => t.ok), [itemTotals]);

  const handleConfirm = async () => {
    // 組裝 newItems：更新 source_order_ids / source_quantities
    const newItems: PurchaseOrderItem[] = items.map((item) => {
      const st = bindState[item.id];
      if (!st) return item;
      const newIds: string[] = [];
      const newQtys: Record<string, number> = {};
      // existing
      for (const [orderId, q] of Object.entries(st.existingQtys)) {
        if ((q || 0) > 0) { newIds.push(orderId); newQtys[orderId] = q; }
      }
      // new
      for (const id of st.selected) {
        const cand = (candidatesByItem[item.id] || []).find((c) => c._id === id);
        if (!cand) continue;
        const q = st.quantities[id] || 0;
        if (q <= 0) continue;
        if (!newIds.includes(cand.order_id)) newIds.push(cand.order_id);
        newQtys[cand.order_id] = (newQtys[cand.order_id] || 0) + q;
      }
      return { ...item, source_order_ids: newIds.length > 0 ? newIds : null, source_quantities: Object.keys(newQtys).length > 0 ? newQtys : null };
    });
    await onSubmit(newItems);
  };

  const filteredCandidates = (itemId: string) => {
    const cands = candidatesByItem[itemId] || [];
    if (keywords.length === 0) return cands;
    return cands.filter((c) => {
      const haystack = [c.order_code, c.store_name, sourceOrderMap[c.order_id]].filter(Boolean).join(' ').toLowerCase();
      return keywords.every((kw) => haystack.includes(kw));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> 批次綁定來源訂單
          </DialogTitle>
          <DialogDescription>
            系統已依品項自動建議可綁訂單，請確認或微調數量後送出；整單一次寫入，失敗自動回撤。
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋訂單號 / 店家"
            className="pl-8 pr-8"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {dataLoading ? (
          <div className="py-8 text-center text-muted-foreground">載入候選訂單中...</div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const st = bindState[item.id];
              const cands = filteredCandidates(item.id);
              const total = itemTotals[item.id];
              const isExpanded = expanded.has(item.id);
              const itemName = item.variant?.name || item.product?.name || '未命名品項';
              return (
                <div key={item.id} className="rounded-md border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => setExpanded((prev) => {
                      const n = new Set(prev);
                      if (n.has(item.id)) n.delete(item.id); else n.add(item.id);
                      return n;
                    })}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">{itemName}</span>
                      <Badge variant="outline" className="text-xs">採購 {item.quantity}</Badge>
                      {total && (
                        <Badge variant={total.ok ? 'secondary' : 'destructive'} className="text-xs">
                          已綁 {total.total}/{total.max}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{cands.length} 候選</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t px-3 py-2 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => handleSelectAll(item.id)}>全選</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => handleClearSuggest(item.id)}>清除</Button>
                        {!total?.ok && <span className="text-red-600">綁定量超過採購數量，請調整</span>}
                      </div>
                      {st && (st.existingQtys && Object.keys(st.existingQtys).length > 0) && (
                        <div className="space-y-1 rounded-md border p-2 bg-muted/20">
                          <div className="text-xs font-medium">已綁定來源訂單（可調整，0 = 移除）</div>
                          <Table>
                            <TableBody>
                              {Object.keys(st.existingQtys).map((oid) => (
                                <TableRow key={oid}>
                                  <TableCell className="font-mono text-xs">{sourceOrderMap[oid] || oid.slice(0, 8)}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{sourceOrderDateMap?.[oid] || '—'}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{sourceOrderStoreMap?.[oid] || '—'}</TableCell>
                                  <TableCell className="text-right">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={st.existingQtys[oid] ?? ''}
                                      onChange={(e) => {
                                        const v = parseInt(e.target.value, 10);
                                        handleExistingQtyChange(item.id, oid, Number.isNaN(v) ? 0 : Math.max(0, v));
                                      }}
                                      className="h-7 w-20 text-right ml-auto"
                                    />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {cands.length === 0 ? (
                        <div className="py-4 text-center text-muted-foreground text-sm">沒有可綁訂單</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>訂單號</TableHead>
                              <TableHead>店家</TableHead>
                              <TableHead>狀態</TableHead>
                              <TableHead className="text-right">可綁</TableHead>
                              <TableHead className="text-right">綁定量</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {cands.map((c) => (
                              <TableRow key={c._id}>
                                <TableCell>
                                  <Checkbox
                                    checked={st?.selected.has(c._id) ?? false}
                                    onCheckedChange={(ck) => handleToggle(item.id, c._id, !!ck)}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-xs">{c.order_code}</TableCell>
                                <TableCell className="text-sm">{c.store_name}</TableCell>
                                <TableCell className="text-xs">
                                  <span className={
                                    c.order_status === 'shipped' ? 'text-blue-600' :
                                    c.order_status === 'processing' ? 'text-amber-600' :
                                    'text-muted-foreground'
                                  }>
                                    {c.order_status === 'shipped' ? '已出貨' : c.order_status === 'processing' ? '處理中' : '待處理'}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{c.quantity}</TableCell>
                                <TableCell className="text-right">
                                  {st?.selected.has(c._id) ? (
                                    <Input
                                      type="number"
                                      min={1}
                                      max={c.quantity}
                                      value={st.quantities[c._id] ?? ''}
                                      onChange={(e) => {
                                        const v = parseInt(e.target.value, 10);
                                        handleQtyChange(item.id, c._id, Number.isNaN(v) ? 0 : Math.max(0, Math.min(c.quantity, v)));
                                      }}
                                      className="h-7 w-20 text-right"
                                    />
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || !allValid || !hasAnyChange}>
            {isLoading ? '綁定中...' : '確認綁定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}