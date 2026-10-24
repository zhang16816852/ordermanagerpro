import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import type { PurchaseOrderItem } from '@/pages/admin/purchase-orders/types';

const FREIGHT_TYPES = [
  { value: 'international', label: '國際運輸' },
  { value: 'customs', label: '關稅' },
  { value: 'domestic', label: '國內段' },
  { value: 'insurance', label: '保險' },
  { value: 'other', label: '其他' },
];

const EMPTY_NEW_FREIGHT = {
  freight_type: 'domestic',
  amount: '',
  currency: 'TWD',
  exchange_rate: '1',
  note: '',
};

interface PurchaseFreightSectionProps {
  purchaseOrderId: string;
  freightAllocationMethod: string;
  freightActualWeight: number | null;
  freightAllocationStale: boolean;
  landedTotalAmount: number | null;
  totalAmount: number;
  items?: PurchaseOrderItem[];
}

export function PurchaseFreightSection({
  purchaseOrderId,
  freightAllocationMethod,
  freightActualWeight,
  freightAllocationStale,
  landedTotalAmount,
  totalAmount,
  items = [],
}: PurchaseFreightSectionProps) {
  const queryClient = useQueryClient();
  const [allocMethod, setAllocMethod] = useState(freightAllocationMethod || 'by_value');
  const [weightInput, setWeightInput] = useState(freightActualWeight != null ? String(freightActualWeight) : '');
  const [allocResult, setAllocResult] = useState<any>(null);
  const [newFreight, setNewFreight] = useState({ ...EMPTY_NEW_FREIGHT });

  useEffect(() => {
    setAllocMethod(freightAllocationMethod || 'by_value');
  }, [freightAllocationMethod]);

  useEffect(() => {
    setWeightInput(freightActualWeight != null ? String(freightActualWeight) : '');
  }, [freightActualWeight]);

  const { data: freights = [] } = useQuery({
    queryKey: ['po-freights', purchaseOrderId],
    enabled: !!purchaseOrderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('purchase_freight_costs')
        .select('*')
        .eq('purchase_order_id', purchaseOrderId)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const freightTotal = (freights as any[]).reduce((s: number, f: any) => s + (f.amount_twd || 0), 0);

  const invalidatePurchaseOrder = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-order-detail', purchaseOrderId] });
  };

  const upsertMut = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await (supabase as any).rpc('upsert_purchase_freight_cost', payload);
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason ?? '失敗');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-freights', purchaseOrderId] });
      invalidatePurchaseOrder();
      toast.success('已儲存運費');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc('delete_purchase_freight_cost', { p_id: id });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason ?? '失敗');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-freights', purchaseOrderId] });
      invalidatePurchaseOrder();
      toast.success('已刪除');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMethodMut = useMutation({
    mutationFn: async ({ method, actualWeight, poId }: { method: string; actualWeight?: number | null; poId: string }) => {
      const update: any = { freight_allocation_method: method };
      if (actualWeight !== undefined) update.freight_actual_weight = actualWeight;
      const { error } = await (supabase as any).from('purchase_orders')
        .update(update)
        .eq('id', poId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      invalidatePurchaseOrder();
      toast.success('已更新均攤方式');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const allocMut = useMutation({
    mutationFn: async (apply: boolean) => {
      const { data, error } = await (supabase as any).rpc('allocate_purchase_freight', {
        p_purchase_order_id: purchaseOrderId, p_apply: apply,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason ?? '失敗');
      return data;
    },
    onSuccess: (d: any) => {
      setAllocResult(d);
      if (!d?.dry_run) invalidatePurchaseOrder();
      toast.success(d?.dry_run ? '預覽完成' : '已套用分攤');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const commitActualWeight = () => {
    const raw = weightInput.trim();
    const v = raw === '' ? null : Number(raw);
    if (raw !== '' && (Number.isNaN(v!) || v! < 0)) {
      setWeightInput(freightActualWeight != null ? String(freightActualWeight) : '');
      toast.error('請輸入有效的總重');
      return;
    }
    if (v === (freightActualWeight ?? null)) return;
    updateMethodMut.mutate({ method: 'by_weight', actualWeight: v, poId: purchaseOrderId });
  };

  const itemLabel = (itemId?: string | null) => {
    if (!itemId) return '—';
    const item = items.find(i => i.id === itemId);
    if (!item) return itemId.slice(0, 8);
    return item.variant?.name || item.product?.name || itemId.slice(0, 8);
  };

  const handleAddFreight = () => {
    if (!newFreight.amount) { toast.error('請輸入金額'); return; }
    const rate = Number(newFreight.exchange_rate) || 1;
    upsertMut.mutate({
      p_purchase_order_id: purchaseOrderId,
      p_freight_type: newFreight.freight_type,
      p_amount: Number(newFreight.amount),
      p_currency: newFreight.currency,
      p_exchange_rate: rate,
      p_note: newFreight.note || null,
    }, {
      onSuccess: () => setNewFreight({ ...EMPTY_NEW_FREIGHT }),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">運費與落地成本</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-muted-foreground">商品總額：</span>{formatCurrency(totalAmount, 'TWD')}</div>
          <div><span className="text-muted-foreground">落地總額：</span>{landedTotalAmount != null ? formatCurrency(landedTotalAmount, 'TWD') : '—'}</div>
          <div><span className="text-muted-foreground">運費合計：</span>{formatCurrency(freightTotal, 'TWD')}</div>
          <div><span className="text-muted-foreground">分攤狀態：</span>{freightAllocationStale ? <span className="text-orange-500">待重算</span> : '已分攤'}</div>
        </div>

        {/* Freight lines table */}
        {(freights as any[]).length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">類型</TableHead>
                <TableHead className="text-right text-xs">金額</TableHead>
                <TableHead className="text-right text-xs">台幣</TableHead>
                <TableHead className="text-xs">狀態</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(freights as any[]).map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs">{FREIGHT_TYPES.find(t => t.value === f.freight_type)?.label ?? f.freight_type}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(f.amount, f.currency)} {f.currency !== 'TWD' && f.currency}</TableCell>
                  <TableCell className="text-right text-xs">{f.amount_twd != null ? formatCurrency(f.amount_twd, 'TWD') : '—'}</TableCell>
                  <TableCell><Badge variant={f.payment_status === 'paid' ? 'default' : 'secondary'} className="text-xs">{f.payment_status}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => deleteMut.mutate(f.id)} disabled={deleteMut.isPending}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Add freight form */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t">
          <div>
            <Label className="text-xs">類型</Label>
            <Select value={newFreight.freight_type} onValueChange={v => setNewFreight(s => ({ ...s, freight_type: v }))}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{FREIGHT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">金額</Label>
            <Input type="number" step="0.01" className="h-8" value={newFreight.amount} onChange={e => setNewFreight(s => ({ ...s, amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <Label className="text-xs">幣別</Label>
            <Select
              value={newFreight.currency}
              onValueChange={v => setNewFreight(s => ({ ...s, currency: v, exchange_rate: v === 'TWD' ? '1' : s.exchange_rate }))}
            >
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TWD">TWD</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="JPY">JPY</SelectItem>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="HKD">HKD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">匯率</Label>
            <Input
              type="number"
              step="0.0001"
              className="h-8"
              value={newFreight.exchange_rate}
              onChange={e => setNewFreight(s => ({ ...s, exchange_rate: e.target.value }))}
              placeholder="1"
              disabled={newFreight.currency === 'TWD'}
            />
          </div>
          <div>
            <Label className="text-xs">備註</Label>
            <Input className="h-8" value={newFreight.note} onChange={e => setNewFreight(s => ({ ...s, note: e.target.value }))} placeholder="選填" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="h-8" onClick={handleAddFreight} disabled={upsertMut.isPending}>
            <Plus className="h-3 w-3 mr-1" />新增運費
          </Button>
        </div>

        {/* Allocation method selector */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t">
          <div>
            <Label>均攤方式</Label>
            <Select value={allocMethod} onValueChange={v => setAllocMethod(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="by_quantity">數量均攤</SelectItem>
                <SelectItem value="by_weight">重量均攤</SelectItem>
                <SelectItem value="by_volume">體積均攤</SelectItem>
                <SelectItem value="by_value">金額均攤</SelectItem>
                <SelectItem value="manual">手動權重</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {allocMethod === 'by_weight' && (
            <div>
              <Label>實際總重（kg）</Label>
              <Input
                type="number"
                step="0.001"
                value={weightInput}
                onChange={e => setWeightInput(e.target.value)}
                onBlur={commitActualWeight}
              />
            </div>
          )}
          <div className="flex items-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                updateMethodMut.mutate({ method: allocMethod, actualWeight: allocMethod === 'by_weight' ? (weightInput.trim() === '' ? null : Number(weightInput)) : null, poId: purchaseOrderId }, {
                  onSuccess: () => allocMut.mutate(true),
                });
              }}
              disabled={allocMut.isPending || updateMethodMut.isPending}
            >
              儲存並分攤
            </Button>
            <Button size="sm" variant="outline" onClick={() => allocMut.mutate(false)} disabled={allocMut.isPending}>
              預覽
            </Button>
          </div>
        </div>

        {allocResult?.changes?.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">品項</TableHead>
                <TableHead className="text-right text-xs">原分攤</TableHead>
                <TableHead className="text-right text-xs">新分攤</TableHead>
                <TableHead className="text-right text-xs">原落地單價</TableHead>
                <TableHead className="text-right text-xs">新落地單價</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocResult.changes.map((c: any) => (
                <TableRow key={c.purchase_order_item_id}>
                  <TableCell className="text-xs">{itemLabel(c.purchase_order_item_id)}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(c.old_allocated_freight, 'TWD')}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(c.new_allocated_freight, 'TWD')}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(c.old_landed_unit_cost, 'TWD')}</TableCell>
                  <TableCell className="text-right text-xs">{formatCurrency(c.new_landed_unit_cost, 'TWD')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
