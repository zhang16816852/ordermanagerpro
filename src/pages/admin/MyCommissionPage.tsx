import { useState, useMemo, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVariantWholesale } from '@/hooks/useVariantWholesale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { ArrowLeft, Search, ChevronRight, ChevronDown, Wallet, Percent, FileText, Store, CheckCircle2, Banknote, CalendarClock } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { Skeleton } from '@/components/ui/skeleton';

type SalesNoteItem = {
  quantity: number;
  order_item: {
    product_id: string;
    variant_id: string | null;
    unit_price: number;
    product: { name: string; code: string | null } | null;
    product_variant: { name: string | null } | null;
  } | null;
};

type SalesNoteRecord = {
  id: string;
  code: string | null;
  store_id: string;
  status: string;
  payment_status: string;
  shipped_at: string | null;
  created_at: string;
  store: { name: string; code: string | null } | null;
  sales_note_items: SalesNoteItem[];
};

type PaymentEntry = {
  id: string;
  reference_id: string;
  transaction_date: string;
  paid_amount: number;
  account: { name: string } | null;
};

type PayoutRecord = {
  id: string;
  rep_id: string;
  sales_note_id: string;
  paid_date: string;
  amount: number;
  note: string | null;
};

export default function MyCommissionPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [paymentDateFrom, setPaymentDateFrom] = useState('');
  const [paymentDateTo, setPaymentDateTo] = useState('');
  const [payoutDateFrom, setPayoutDateFrom] = useState('');
  const [payoutDateTo, setPayoutDateTo] = useState('');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // 業務角色與佣金比例
  const { data: repRole } = useQuery({
    queryKey: ['my-rep-detail', userId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('user_roles') as any)
        .select('user_id, commission_rate')
        .eq('user_id', userId)
        .eq('role', 'rep')
        .single();
      if (error) throw error;
      return data as { user_id: string; commission_rate: number };
    },
    enabled: !!userId,
  });

  // 業務成本
  const { data: repCosts = [] } = useQuery<{ product_id: string; variant_id: string | null; cost: number }[]>({
    queryKey: ['my-rep-costs', userId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('rep_product_costs') as any)
        .select('product_id, variant_id, cost')
        .eq('rep_id', userId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const costLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of repCosts) {
      map.set(`${row.product_id}|${row.variant_id ?? 'null'}`, Number(row.cost) || 0);
    }
    return map;
  }, [repCosts]);

  const { wholesaleMap } = useVariantWholesale();

  const getCost = useCallback((productId: string, variantId: string | null) => {
    const exact = costLookup.get(`${productId}|${variantId ?? 'null'}`);
    if (exact !== undefined) return exact;
    const productLevel = costLookup.get(`${productId}|null`);
    if (productLevel !== undefined) return productLevel;
    return wholesaleMap.get(`${productId}|${variantId ?? ''}`) ?? 0;
  }, [costLookup, wholesaleMap]);

  // 名下店家
  const { data: repAssignments = [] } = useQuery<{ store_id: string }[]>({
    queryKey: ['my-rep-assignments', userId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('rep_store_assignments') as any)
        .select('store_id')
        .eq('rep_id', userId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const assignedStoreIds = useMemo(() => repAssignments.map(a => a.store_id), [repAssignments]);

  // 銷貨單（含品項明細）
  const { data: salesNotes = [], isLoading: notesLoading } = useQuery<SalesNoteRecord[]>({
    queryKey: ['my-commission-notes', userId, assignedStoreIds.join(',')],
    queryFn: async () => {
      if (assignedStoreIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('sales_notes') as any)
        .select(`
          id, code, store_id, status, payment_status, shipped_at, created_at,
          store:stores(name, code),
          sales_note_items(
            quantity,
            order_item:order_items(
              product_id, variant_id, unit_price,
              product:products(name, code),
              product_variant:product_variants(name)
            )
          )
        `)
        .in('store_id', assignedStoreIds)
        .in('status', ['shipped', 'received'])
        .order('created_at', { ascending: false })
        .order('sort_order', { foreignTable: 'sales_note_items', ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId && assignedStoreIds.length > 0,
  });

  const salesNoteIds = useMemo(() => salesNotes.map(sn => sn.id), [salesNotes]);

  // 登記收款時間（會計分錄）
  const { data: paymentEntries = [] } = useQuery<PaymentEntry[]>({
    queryKey: ['my-commission-payments', userId, salesNoteIds.join(',')],
    queryFn: async () => {
      if (salesNoteIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('accounting_entries') as any)
        .select(`
          id, reference_id, transaction_date, paid_amount,
          account:accounts(name)
        `)
        .eq('reference_type', 'sales_note')
        .eq('type', 'income')
        .in('reference_id', salesNoteIds)
        .gt('paid_amount', 0);
      if (error) throw error;
      return (data || []) as PaymentEntry[];
    },
    enabled: salesNoteIds.length > 0,
  });

  const paymentDateMap = useMemo(() => {
    const map = new Map<string, PaymentEntry>();
    for (const e of paymentEntries) {
      const existing = map.get(e.reference_id);
      if (!existing || new Date(e.transaction_date) > new Date(existing.transaction_date)) {
        map.set(e.reference_id, e);
      }
    }
    return map;
  }, [paymentEntries]);

  // 分潤發放登記（業務可讀取自己的發放記錄）
  const { data: payouts = [] } = useQuery<PayoutRecord[]>({
    queryKey: ['my-commission-payouts', userId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('rep_commission_payouts') as any)
        .select('id, rep_id, sales_note_id, paid_date, amount, note')
        .eq('rep_id', userId!)
        .order('paid_date', { ascending: false });
      if (error) throw error;
      return (data || []) as PayoutRecord[];
    },
    enabled: !!userId,
  });

  const payoutMap = useMemo(() => {
    const map = new Map<string, PayoutRecord>();
    for (const p of payouts) map.set(p.sales_note_id, p);
    return map;
  }, [payouts]);

  // 篩選
  const filteredNotes = useMemo(() => {
    const q = search.toLowerCase();
    return salesNotes.filter(sn => {
      if (statusFilter === 'paid' && sn.payment_status !== 'paid') return false;
      if (statusFilter === 'unpaid' && sn.payment_status !== 'unpaid') return false;
      const payout = payoutMap.get(sn.id);
      if (payoutStatusFilter === 'paid' && !payout) return false;
      if (payoutStatusFilter === 'unpaid' && payout) return false;
      const payEntry = paymentDateMap.get(sn.id);
      if (paymentDateFrom) {
        if (!payEntry || payEntry.transaction_date < paymentDateFrom) return false;
      }
      if (paymentDateTo) {
        if (!payEntry || payEntry.transaction_date > paymentDateTo) return false;
      }
      if (payoutDateFrom) {
        if (!payout || payout.paid_date < payoutDateFrom) return false;
      }
      if (payoutDateTo) {
        if (!payout || payout.paid_date > payoutDateTo) return false;
      }
      if (q) {
        const code = (sn.code || sn.id).toLowerCase();
        const storeName = (sn.store?.name || '').toLowerCase();
        if (!code.includes(q) && !storeName.includes(q)) return false;
      }
      return true;
    });
  }, [salesNotes, search, statusFilter, payoutStatusFilter, paymentDateFrom, paymentDateTo, payoutDateFrom, payoutDateTo, paymentDateMap, payoutMap]);

  // 計算每筆銷貨單的利潤/佣金
  const noteStats = useMemo(() => {
    return filteredNotes.map(sn => {
      let totalSales = 0;
      let totalProfit = 0;
      let totalCommission = 0;
      for (const item of sn.sales_note_items || []) {
        const oi = item.order_item;
        if (!oi) continue;
        const cost = getCost(oi.product_id, oi.variant_id ?? null);
        const unitProfit = (Number(oi.unit_price) || 0) - cost;
        const qty = Number(item.quantity) || 0;
        totalSales += (Number(oi.unit_price) || 0) * qty;
        totalProfit += unitProfit * qty;
        totalCommission += Math.max(0, unitProfit * qty) * ((repRole?.commission_rate || 0) / 100);
      }
      return {
        ...sn,
        totalSales,
        totalProfit,
        totalCommission,
        paymentEntry: paymentDateMap.get(sn.id) || null,
        payout: payoutMap.get(sn.id) || null,
      };
    });
  }, [filteredNotes, repRole, getCost, paymentDateMap, payoutMap]);

  // 彙總
  const summary = useMemo(() => {
    const totalSales = noteStats.reduce((s, n) => s + n.totalSales, 0);
    const totalProfit = noteStats.reduce((s, n) => s + n.totalProfit, 0);
    const totalCommission = noteStats.reduce((s, n) => s + n.totalCommission, 0);
    const totalPaid = noteStats.reduce((s, n) => s + (n.payout ? (Number(n.payout.amount) || 0) : 0), 0);
    const paidCount = noteStats.filter(n => n.payout).length;
    const payableCount = noteStats.filter(n => n.totalCommission > 0 && !n.payout).length;
    return {
      totalSales,
      totalProfit,
      totalCommission,
      noteCount: noteStats.length,
      totalPaid,
      pendingCommission: Math.max(0, totalCommission - totalPaid),
      paidCount,
      payableCount,
    };
  }, [noteStats]);

  const commissionRate = repRole?.commission_rate ?? 0;

  if (!userId) return null;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="我的分潤與佣金明細"
        subtitle="檢視您的名下銷貨單佣金與發放狀態（唯讀）"
        icon={<Wallet className="h-5 w-5 text-amber-500" />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回儀表板
          </Button>
        }
      />

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Percent className="h-4 w-4" /> 佣金比例
            </div>
            <div className="text-2xl font-bold">{commissionRate}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <FileText className="h-4 w-4" /> 銷貨單數
            </div>
            <div className="text-2xl font-bold">{summary.noteCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Store className="h-4 w-4" /> 名下店家
            </div>
            <div className="text-2xl font-bold">{assignedStoreIds.length}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 mb-1">
              <CheckCircle2 className="h-4 w-4" /> 已發放分潤
            </div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(summary.totalPaid)}</div>
            <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
              {summary.paidCount} 單已發放
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 mb-1">
              <Wallet className="h-4 w-4" /> 待發放分潤
            </div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{formatCurrency(summary.pendingCommission)}</div>
            <div className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">
              {summary.payableCount} 單待發放
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 銷貨單列表 */}
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>銷貨單與分潤狀態</CardTitle>
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <TabsList>
                <TabsTrigger value="all">收款全部</TabsTrigger>
                <TabsTrigger value="unpaid">未收款</TabsTrigger>
                <TabsTrigger value="paid">已收款</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={payoutStatusFilter} onValueChange={(v) => setPayoutStatusFilter(v as any)}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue placeholder="發放狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">發放全部</SelectItem>
                <SelectItem value="unpaid">未發放</SelectItem>
                <SelectItem value="paid">已發放</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                type="date"
                className="w-36 h-9 border-muted text-xs"
                value={paymentDateFrom}
                onChange={(e) => setPaymentDateFrom(e.target.value)}
              />
              <span className="text-muted-foreground text-xs">~</span>
              <Input
                type="date"
                className="w-36 h-9 border-muted text-xs"
                value={paymentDateTo}
                onChange={(e) => setPaymentDateTo(e.target.value)}
              />
              <span className="text-muted-foreground text-xs">收款登記</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Banknote className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                type="date"
                className="w-36 h-9 border-muted text-xs"
                value={payoutDateFrom}
                onChange={(e) => setPayoutDateFrom(e.target.value)}
              />
              <span className="text-muted-foreground text-xs">~</span>
              <Input
                type="date"
                className="w-36 h-9 border-muted text-xs"
                value={payoutDateTo}
                onChange={(e) => setPayoutDateTo(e.target.value)}
              />
              <span className="text-muted-foreground text-xs">發放</span>
            </div>
            <div className="relative w-full lg:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜尋單號或店鋪"
                className="pl-10 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {notesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredNotes.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">無銷貨單</p>
          ) : (
            <div className="overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>銷貨單號</TableHead>
                    <TableHead>店鋪</TableHead>
                    <TableHead>收款</TableHead>
                    <TableHead>出貨日期</TableHead>
                    <TableHead>登記收款時間</TableHead>
                    <TableHead>分潤發放狀態</TableHead>
                    <TableHead className="text-right">銷售額</TableHead>
                    <TableHead className="text-right">利潤</TableHead>
                    <TableHead className="text-right">估計佣金</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noteStats.map((sn) => {
                    const isExpanded = expandedNotes.has(sn.id);
                    return (
                      <Fragment key={sn.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            const next = new Set(expandedNotes);
                            if (next.has(sn.id)) next.delete(sn.id); else next.add(sn.id);
                            setExpandedNotes(next);
                          }}
                        >
                          <TableCell>
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="font-medium">{sn.code || sn.id.slice(0, 8)}</TableCell>
                          <TableCell>{sn.store?.name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={sn.payment_status === 'paid' ? 'default' : 'secondary'}>
                              {sn.payment_status === 'paid' ? '已收款' : '未收款'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {sn.shipped_at ? new Date(sn.shipped_at).toLocaleDateString('zh-TW') : '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {sn.paymentEntry ? (
                              <div>
                                <div className="flex items-center gap-1">
                                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                                  {new Date(sn.paymentEntry.transaction_date).toLocaleDateString('zh-TW')}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {sn.paymentEntry.account?.name || '—'} {formatCurrency(sn.paymentEntry.paid_amount)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">未登記收款</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {sn.payout ? (
                              <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                                已發放 {new Date(sn.payout.paid_date).toLocaleDateString('zh-TW')} ({formatCurrency(sn.payout.amount)})
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-muted-foreground">
                                未發放
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(sn.totalSales)}</TableCell>
                          <TableCell className="text-right">
                            <span className={sn.totalProfit >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                              {formatCurrency(sn.totalProfit)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(sn.totalCommission)}
                          </TableCell>
                        </TableRow>
                        {isExpanded && sn.sales_note_items?.map((item, idx) => {
                          const oi = item.order_item;
                          if (!oi) return null;
                          const cost = getCost(oi.product_id, oi.variant_id ?? null);
                          const unitPrice = Number(oi.unit_price) || 0;
                          const unitProfit = unitPrice - cost;
                          const qty = Number(item.quantity) || 0;
                          const lineSales = unitPrice * qty;
                          const lineProfit = unitProfit * qty;
                          const lineCommission = Math.max(0, lineProfit) * (commissionRate / 100);
                          return (
                            <TableRow key={`${sn.id}-item-${idx}`} className="bg-muted/20">
                              <TableCell />
                              <TableCell className="pl-8">
                                <div className="text-sm">
                                  {oi.product_variant?.name || oi.product?.name || '—'}
                                </div>
                                {oi.product?.code && (
                                  <div className="text-xs text-muted-foreground">{oi.product.code}</div>
                                )}
                              </TableCell>
                              <TableCell colSpan={5} className="text-xs text-muted-foreground">
                                數量 ×{qty} ・ 單價 {formatCurrency(unitPrice)} ・ 成本 {formatCurrency(cost)}
                              </TableCell>
                              <TableCell className="text-right text-sm">{formatCurrency(lineSales)}</TableCell>
                              <TableCell className="text-right text-sm">
                                <span className={lineProfit >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                                  {formatCurrency(lineProfit)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium">{formatCurrency(lineCommission)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {/* 彙總列 */}
                  <TableRow className="bg-muted/30 font-medium">
                    <TableCell colSpan={7} className="text-right">合計</TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.totalSales)}</TableCell>
                    <TableCell className="text-right">
                      <span className={summary.totalProfit >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                        {formatCurrency(summary.totalProfit)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.totalCommission)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
