import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { Truck, Undo2, PlusCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { format } from 'date-fns';
import { useShippingSettlement } from '@/hooks/useShippingSettlement';
import { EntryDialog } from '@/pages/admin/accounting/components/EntryDialog';
import { Account, AccountingCategory } from '@/pages/admin/accounting/types';

interface SettlementPeriod {
  id: string;
  period_start: string;
  period_end: string;
  is_settled: boolean;
  paid_date: string | null;
  created_at: string;
  entry_id: string | null;
  supplier: { name: string } | null;
  entry: {
    transaction_date: string;
    amount: number;
    account: { name: string } | null;
  } | null;
}

export default function ShippingSettlementsPage() {
  const { settleMutation, revokeMutation } = useShippingSettlement();
  const [settleDialogOpen, setSettleDialogOpen] = useState(false);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['shipping-settlements-accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounts')
        .select('id, name, currency, balance')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: categories = [] } = useQuery<AccountingCategory[]>({
    queryKey: ['shipping-settlements-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounting_categories')
        .select('id, name, type, description, is_active')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: periods = [], isLoading } = useQuery<any[]>({
    queryKey: ['shipping-settlements'],
    queryFn: async () => {
      const { data: periodRows, error } = await (supabase as any)
        .from('shipping_settlement_periods')
        .select(`
          id, period_start, period_end, is_settled, paid_date, created_at, entry_id,
          supplier:suppliers(name),
          entry:accounting_entries(transaction_date, amount, account:accounts(name))
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = (periodRows || []) as any[];
      const entryIds = rows.map(r => r.entry_id).filter(Boolean);
      let refsMap: Record<string, { reference_id: string }[]> = {};
      if (entryIds.length > 0) {
        const { data: refs, error: refsErr } = await (supabase as any)
          .from('accounting_entry_references')
          .select('entry_id, reference_id, amount_applied')
          .eq('reference_type', 'order')
          .in('entry_id', entryIds);
        if (refsErr) throw refsErr;
        refsMap = ((refs as any[]) || []).reduce((acc, r) => {
          (acc[r.entry_id] = acc[r.entry_id] || []).push(r);
          return acc;
        }, {} as Record<string, { reference_id: string }[]>);
      }

      const orderIds = Object.values(refsMap).flat().map(r => r.reference_id);
      let codeMap: Record<string, string> = {};
      if (orderIds.length > 0) {
        const { data: orders, error: ordersErr } = await (supabase as any)
          .from('orders')
          .select('id, code')
          .in('id', orderIds);
        if (ordersErr) throw ordersErr;
        codeMap = ((orders as any[]) || []).reduce((acc, o) => { acc[o.id] = o.code || o.id.slice(0, 8); return acc; }, {} as Record<string, string>);
      }

      return rows.map(r => ({
        ...r,
        orderRefs: (refsMap[r.entry_id] || []) as { reference_id: string }[],
        orderCodes: ((refsMap[r.entry_id] || []) as { reference_id: string }[]).map(ref => codeMap[ref.reference_id] || ref.reference_id.slice(0, 8)),
      }));
    },
  });

  const summary = useMemo(() => {
    const settledCount = periods.filter(p => p.is_settled).length;
    const totalAmount = periods.filter(p => p.is_settled).reduce((s, p) => s + Number(p.entry?.amount || 0), 0);
    const orderCount = periods.reduce((s, p) => s + (p.orderRefs?.length || 0), 0);
    return { settledCount, totalAmount, orderCount };
  }, [periods]);

  const expenseCategoryId = useMemo(
    () => categories.find(c => c.type === 'expense' && c.name.includes('運'))?.id
      || categories.find(c => c.type === 'expense')?.id
      || '',
    [categories],
  );

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="運費月結結算"
        subtitle="將月結運費出貨品項彙總開立支出分錄（連動會計模組）"
        icon={<Truck className="h-5 w-5 text-orange-500" />}
        actions={
          <Button size="sm" onClick={() => setSettleDialogOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-1" /> 運費結帳
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Badge variant="secondary" className="text-xs">期間</Badge> 已結算
            </div>
            <div className="text-2xl font-bold">{summary.settledCount} 期</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Truck className="h-4 w-4" /> 涵蓋訂單
            </div>
            <div className="text-2xl font-bold">{summary.orderCount} 單</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              結算總支出
            </div>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(summary.totalAmount)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>結算紀錄</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">載入中...</p>
          ) : periods.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              尚無結算紀錄。請先建立「運費」型商品並設定訂單品項為「月結」，再由「運費結帳」開立。
            </p>
          ) : (
            <div className="overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>物流商</TableHead>
                    <TableHead>結算期間</TableHead>
                    <TableHead>付款日期</TableHead>
                    <TableHead>帳戶</TableHead>
                    <TableHead>涵蓋訂單</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.supplier?.name || '—'}</TableCell>
                      <TableCell className="text-sm">
                        {p.period_start ? format(new Date(p.period_start), 'yyyy/MM/dd') : '—'}
                        {' ~ '}
                        {p.period_end ? format(new Date(p.period_end), 'yyyy/MM/dd') : '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.paid_date ? format(new Date(p.paid_date), 'yyyy/MM/dd') : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{p.entry?.account?.name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.orderCodes?.length > 0
                          ? <span className="font-mono text-xs">{p.orderCodes.slice(0, 4).join('、')}{p.orderCodes.length > 4 ? ` 等 ${p.orderCodes.length} 單` : ''}</span>
                          : <span className="text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right">{(p.entry?.amount ?? 0) !== 0 ? formatCurrency(p.entry?.amount || 0) : '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          title="撤銷結算（刪除支出分錄並回衝帳戶）"
                          onClick={() => {
                            if (window.confirm('確定撤銷此期運費結算？將刪除對應支出分錄並回衝帳戶餘額。')) {
                              revokeMutation.mutate(p.id);
                            }
                          }}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 運費結帳 Dialog（統一 EntryDialog「運費結帳」Tab） */}
      <EntryDialog
        open={settleDialogOpen}
        onOpenChange={(o) => setSettleDialogOpen(o)}
        categories={categories}
        accounts={accounts}
        isLoading={settleMutation.isPending}
        prefill={{
          shipping: {},
          transactionDate: format(new Date(), 'yyyy-MM-dd'),
          description: '運費月結支出',
          categoryId: expenseCategoryId || undefined,
        }}
        onSubmit={() => {}}
        onShippingSettleSubmit={(payload) => settleMutation.mutate(payload, {
          onSuccess: () => setSettleDialogOpen(false),
        })}
      />
    </div>
  );
}