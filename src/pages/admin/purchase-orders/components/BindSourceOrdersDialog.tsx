import { useMemo, useState } from 'react';
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
  quantity: number; // 剩餘需採購數
}

export function BindSourceOrdersDialog({
  open,
  onOpenChange,
  poItem,
  sourceOrderMap,
  onSubmit,
  isLoading,
}: BindSourceOrdersDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');

  const { data: candidates = [], isLoading: dataLoading } = useQuery<CandidateItem[]>({
    queryKey: ['bind-source-candidates', poItem?.product_id, poItem?.variant_id],
    enabled: open && !!poItem,
    queryFn: async () => {
      const { data: orders, error } = await (supabase as any)
        .from('orders')
        .select(`
          id, code, created_at, store_id,
          stores ( id, name ),
          order_items ( id, quantity, shipped_quantity, product_id, variant_id, line_type, is_repair )
        `)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false });
      if (error) throw error;

      const out: CandidateItem[] = [];
      (orders || []).forEach((order: any) => {
        (order.order_items || []).forEach((item: any) => {
          if (item.product_id !== poItem!.product_id) return;
          if ((item.variant_id || null) !== (poItem!.variant_id || null)) return;
          if (item.quantity <= (item.shipped_quantity || 0)) return;
          if (item.line_type === 'return') return;
          if (item.line_type === 'exchange' && item.is_repair) return;
          out.push({
            _id: item.id,
            order_id: order.id,
            order_code: order.code,
            store_name: order.stores?.name || '未指定店家',
            order_date: order.created_at,
            quantity: item.quantity - (item.shipped_quantity || 0),
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
  const available = filtered.filter((c) => !existingIds.includes(c.order_id));

  const handleToggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) {
      next.add(id);
      if (!quantities[id]) {
        const cand = available.find((c) => c._id === id);
        const remaining = maxBindable(poItem, quantities);
        setQuantities((q) => ({ ...q, [id]: Math.min(cand?.quantity ?? 1, remaining) || 1 }));
      }
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
    if (binds.length === 0) {
      toast.error('請至少選擇一筆訂單');
      return;
    }
    // 總綁定量不得超過剩餘可綁量
    const totalBind = binds.reduce((s, b) => s + b.quantity, 0);
    const purchasedTotal = Object.values(poItem?.source_quantities || {}).reduce((s, v) => s + Number(v || 0), 0);
    const maxTotal = (poItem?.quantity || 0) - purchasedTotal;
    if (totalBind > maxTotal) {
      toast.error(`綁定量（${totalBind}）超過剩餘可綁量（${maxTotal}），請先調高品項數量`);
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
              {candidates.length === 0 ? '沒有相符的 pending/processing 訂單品項' : '可綁訂的訂單皆已綁定'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>訂單號</TableHead>
                  <TableHead>店家</TableHead>
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
          <Button onClick={handleConfirm} disabled={isLoading || selected.size === 0}>
            {isLoading ? '綁定中...' : '確認綁定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}