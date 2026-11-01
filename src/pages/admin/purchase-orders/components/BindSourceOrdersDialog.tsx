import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseOrderItem } from '../types';

interface BindSourceOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poItem: PurchaseOrderItem | null;
  /** 既有來源訂單 id → 單號對照（顯示用） */
  sourceOrderMap: Record<string, string>;
  /** 既有來源訂單 id → 店家名稱對照（顯示用） */
  sourceOrderStoreMap?: Record<string, string>;
  /** 既有來源訂單 id → 日期對照（顯示用） */
  sourceOrderDateMap?: Record<string, string>;
  /** 提交綁定：orderId → 數量 */
  onSubmit: (binds: { orderId: string; quantity: number }[]) => Promise<void>;
  isLoading: boolean;
}

interface CandidateItem {
  _id: string;
  order_id: string;
  order_code: string;
  store_name: string;
  order_date: string;
  order_status: string;
  quantity: number; // 剩餘需採購數
}

export function BindSourceOrdersDialog({
  open,
  onOpenChange,
  poItem,
  sourceOrderMap,
  sourceOrderStoreMap = {},
  sourceOrderDateMap = {},
  onSubmit,
  isLoading,
}: BindSourceOrdersDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // 已綁定訂單的編輯數量（key = orderId）
  const [existingQtys, setExistingQtys] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');

  const { data: candidates = [], isLoading: dataLoading } = useQuery<CandidateItem[]>({
    queryKey: ['bind-source-candidates', poItem?.product_id, poItem?.variant_id],
    enabled: open && !!poItem,
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

      // 查詢所有已綁定到任何採購單的 (order_id, product_id, variant_id) 組合，
      // 避免同一訂單品項被重複綁定到多張採購單
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

      const out: CandidateItem[] = [];
      (orders || []).forEach((order: any) => {
        (order.order_items || []).forEach((item: any) => {
          if (item.product_id !== poItem!.product_id) return;
          if ((item.variant_id || null) !== (poItem!.variant_id || null)) return;
          if (item.quantity <= 0) return;
          if (item.line_type === 'return' || item.line_type === 'defective') return;
          if (item.line_type === 'exchange' && item.is_repair) return;
          // 排除已綁定到任何採購單的品項（避免重複採購）
          if (boundSet.has(`${order.id}|${item.product_id}|${item.variant_id || 'null'}`)) return;
          // 已出貨訂單：bindable 數量用原始 quantity（用於歷史紀錄重新綁定）
          // 待處理/處理中訂單：bindable 數量用剩餘 quantity（quantity - shipped_quantity）
          const bindableQty = order.status === 'shipped'
            ? item.quantity
            : item.quantity - (item.shipped_quantity || 0);
          if (bindableQty <= 0) return;
          out.push({
            _id: item.id,
            order_id: order.id,
            order_code: order.code,
            store_name: order.stores?.name || '未指定店家',
            order_date: order.created_at,
            order_status: order.status || 'pending',
            quantity: bindableQty,
          });
        });
      });
      return out;
    },
  });

  const keywords = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const filtered = useMemo(() => {
    if (keywords.length === 0) return candidates;
    return candidates.filter((c) => {
      const haystack = [c.order_code, c.store_name, sourceOrderMap[c.order_id]].filter(Boolean).join(' ').toLowerCase();
      return keywords.every((kw) => haystack.includes(kw));
    });
  }, [candidates, keywords, sourceOrderMap]);

  // 已綁訂的訂單不應再次綁（避免重複），但允許調整數量 → 這裡排除已綁定
  const existingIds = poItem?.source_order_ids || [];
  const existingQtysBase = poItem?.source_quantities || {};

  // 初始化已綁定數量（當 poItem 變更時同步）
  useEffect(() => {
    const init: Record<string, number> = {};
    for (const id of existingIds) {
      init[id] = Number(existingQtysBase[id] || 0);
    }
    setExistingQtys(init);
    setSelected(new Set());
    setQuantities({});
  }, [poItem?.id]);

  const available = filtered.filter((c) => !existingIds.includes(c.order_id));

  const handleToggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) {
      next.add(id);
      const cand = available.find((c) => c._id === id);
      const remaining = maxBindable(poItem, quantities);
      const defaultQty = Math.min(cand?.quantity ?? 1, remaining);
      setQuantities((q) => ({ ...q, [id]: defaultQty > 0 ? defaultQty : 1 }));
    } else {
      next.delete(id);
      setQuantities((q) => {
        const n = { ...q };
        delete n[id];
        return n;
      });
    }
    setSelected(next);
  };

  const maxBindable = (item: PurchaseOrderItem | null, q: Record<string, number>) => {
    if (!item) return 0;
    const purchasedTotal = Object.values(item.source_quantities || {}).reduce((s, v) => s + Number(v || 0), 0);
    const used = Object.values(q).reduce((s, v) => s + (v || 0), 0);
    return Math.max(0, item.quantity - purchasedTotal - used);
  };

  const handleConfirm = async () => {
    const binds: { orderId: string; quantity: number }[] = [];
    // 已綁定訂單：使用編輯後的數量（0 = 移除）
    for (const orderId of existingIds) {
      const q = existingQtys[orderId] ?? existingQtysBase[orderId] ?? 0;
      binds.push({ orderId, quantity: q });
    }
    // 新增綁定
    for (const id of selected) {
      const cand = available.find((c) => c._id === id);
      if (!cand) continue;
      const q = quantities[id] || 0;
      if (q <= 0) {
        toast.error(`「${cand.order_code}」的綁定量必須大於 0`);
        return;
      }
      binds.push({ orderId: cand.order_id, quantity: q });
    }
    const hasAny = binds.some((b) => b.quantity > 0);
    if (!hasAny) {
      toast.error('請至少保留一筆綁定');
      return;
    }
    // 總綁定量不得超過剩餘可綁量
    const totalBind = binds.reduce((s, b) => s + b.quantity, 0);
    // 已綁定的可調整，所以 maxTotal = PO 品項數量（existing 也算在 totalBind 裡）
    const maxTotal = poItem?.quantity || 0;
    if (totalBind > maxTotal) {
      toast.error(`綁定量（${totalBind}）超過採購數量（${maxTotal}），請調整`);
      return;
    }
    await onSubmit(binds);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>綁訂來源訂單</DialogTitle>
          <DialogDescription>
            品項：{poItem?.variant?.name || poItem?.product?.name}（採購數量 {poItem?.quantity}，已綁 {Object.values(poItem?.source_quantities || {}).reduce((s, v) => s + Number(v || 0), 0)}）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 已綁定來源訂單：可編輯數量（0 = 移除） */}
          {existingIds.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">已綁定來源訂單（可調整數量，0 = 移除）</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>訂單號</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead>店家</TableHead>
                    <TableHead className="text-right">綁定量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingIds.map((oid) => {
                    const isRemoved = (existingQtys[oid] ?? existingQtysBase[oid] ?? 0) === 0;
                    return (
                    <TableRow key={oid} className={isRemoved ? 'opacity-60' : ''}>
                      <TableCell className={`font-mono text-xs ${isRemoved ? 'line-through text-red-600' : ''}`}>{sourceOrderMap[oid] || oid.slice(0, 8)}</TableCell>
                      <TableCell className={`text-xs ${isRemoved ? 'line-through text-red-600' : 'text-muted-foreground'}`}>{sourceOrderDateMap?.[oid] || '—'}</TableCell>
                      <TableCell className={`text-xs ${isRemoved ? 'line-through text-red-600' : 'text-muted-foreground'}`}>{sourceOrderStoreMap?.[oid] || '—'}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          value={existingQtys[oid] ?? ''}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            setExistingQtys((q) => ({ ...q, [oid]: Number.isNaN(v) ? 0 : Math.max(0, v) }));
                          }}
                          className="h-7 w-20 text-right ml-auto"
                        />
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋訂單號"
              className="pl-8 pr-8"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {dataLoading ? (
            <div className="py-8 text-center text-muted-foreground">載入中...</div>
          ) : available.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {candidates.length === 0 ? '沒有相符的訂單品項（含已完成訂單）' : '可綁訂的訂單皆已綁定'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>訂單號</TableHead>
                  <TableHead>店家</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">可綁數量</TableHead>
                  <TableHead className="text-right">綁定量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {available.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(c._id)}
                        onCheckedChange={(ck) => handleToggle(c._id, !!ck)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.order_code}</TableCell>
                    <TableCell className="text-sm">{c.store_name}</TableCell>
                    <TableCell className="text-xs">
                      <span className={
                        c.order_status === 'received' ? 'text-green-600' :
                        c.order_status === 'shipped' ? 'text-blue-600' :
                        c.order_status === 'processing' ? 'text-amber-600' :
                        'text-muted-foreground'
                      }>
                        {c.order_status === 'shipped' ? '已出貨' :
                         c.order_status === 'processing' ? '處理中' :
                         c.order_status === 'pending' ? '待處理' : c.order_status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.quantity}</TableCell>
                    <TableCell className="text-right">
                      {selected.has(c._id) ? (
                        <Input
                          type="number"
                          min={1}
                          max={c.quantity}
                          value={quantities[c._id] ?? ''}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            setQuantities((q) => ({ ...q, [c._id]: Number.isNaN(v) ? 0 : Math.max(0, Math.min(c.quantity, v)) }));
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? '綁定中...' : '確認綁定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}