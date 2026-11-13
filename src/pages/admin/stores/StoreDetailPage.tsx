import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatters';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { ArrowLeft, Store as StoreIcon, Users, Receipt, TrendingUp, Wallet, Calendar } from 'lucide-react';
import { useRepStoreAssignments } from '@/hooks/useRepStoreAssignments';
import { useBusinessProfitCalculator } from '@/hooks/useBusinessProfit';
import { useProductCostMap } from '@/hooks/useProductCost';

interface SalesNoteItemRow {
  id: string;
  quantity: number;
  returned_quantity?: number;
  sort_order?: number;
  order_items: {
    id: string;
    product_id: string | null;
    variant_id: string | null;
    unit_price: number | null;
    unit_cost: number | null;
    line_type: string | null;
  } | null;
}

interface SalesNoteRow {
  id: string;
  code: string | null;
  store_id: string;
  status: string;
  payment_status: string | null;
  shipped_at: string | null;
  created_at: string;
  shipping_fee: number | null;
  sales_note_items: SalesNoteItemRow[];
}

interface StoreRow {
  id: string;
  name: string;
  code: string | null;
  brand: string | null;
  phone: string | null;
  recipient: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  postal_code: string | null;
  store_users?: { count: number }[];
}

type RangeMode = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'all' | 'custom';

function dateOf(sn: SalesNoteRow): string {
  return (sn.shipped_at || sn.created_at || '').slice(0, 10);
}

function monthKeyOf(sn: SalesNoteRow): string {
  return (sn.shipped_at || sn.created_at || '').slice(0, 7);
}

function noteRevenue(sn: SalesNoteRow): number {
  let total = 0;
  for (const it of sn.sales_note_items || []) {
    const oi = it.order_items;
    if (!oi) continue;
    const q = (oi.line_type === 'return' || oi.line_type === 'defective')
      ? -Math.abs(it.quantity || 0)
      : (it.quantity || 0);
    total += q * (Number(oi.unit_price) || 0);
  }
  total += Number(sn.shipping_fee) || 0;
  return total;
}

function noteCost(sn: SalesNoteRow, costOf: (pid?: string | null, vid?: string | null) => { cost: number } | undefined): number {
  let total = 0;
  for (const it of sn.sales_note_items || []) {
    const oi = it.order_items;
    if (!oi) continue;
    const q = (oi.line_type === 'return' || oi.line_type === 'defective')
      ? -Math.abs(it.quantity || 0)
      : (it.quantity || 0);
    const snap = Number(oi.unit_cost) || 0;
    let unitCost = snap > 0 ? snap : 0;
    if (unitCost <= 0) {
      const resolved = costOf(oi.product_id, oi.variant_id);
      if (resolved) unitCost = resolved.cost;
    }
    total += unitCost * q;
  }
  return total;
}

function rangeBounds(mode: RangeMode, customFrom: string, customTo: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstDay = (yy: number, mm: number) => `${yy}-${pad(mm + 1)}-01`;
  const lastDay = (yy: number, mm: number) => {
    const d = new Date(yy, mm + 1, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  switch (mode) {
    case 'thisMonth':
      return { from: firstDay(y, m), to: lastDay(y, m) };
    case 'lastMonth': {
      const d = new Date(y, m - 1, 1);
      return { from: firstDay(d.getFullYear(), d.getMonth()), to: lastDay(d.getFullYear(), d.getMonth()) };
    }
    case 'thisQuarter': {
      const qStart = Math.floor(m / 3) * 3;
      return { from: firstDay(y, qStart), to: lastDay(y, qStart + 2) };
    }
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'all':
      return null;
    case 'custom':
      if (customFrom || customTo) return { from: customFrom || '0000-01-01', to: customTo || '9999-12-31' };
      return null;
  }
}

const PRESET_LABELS: Record<RangeMode, string> = {
  thisMonth: '本月',
  lastMonth: '上月',
  thisQuarter: '本季',
  thisYear: '本年',
  all: '全部',
  custom: '自訂區間',
};

export default function StoreDetailPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const [rangeMode, setRangeMode] = useState<RangeMode>('thisYear');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { data: store, isLoading: storeLoading } = useQuery({
    queryKey: ['store-detail', storeId],
    queryFn: async () => {
      if (!storeId) return null;
      const { data, error } = await (supabase.from('stores') as any)
        .select('id, name, code, brand, phone, recipient, address, city, district, postal_code, store_users(count)')
        .eq('id', storeId)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!storeId,
  });

  const { data: salesNotes = [], isLoading: notesLoading } = useQuery<SalesNoteRow[]>({
    queryKey: ['store-detail-notes', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await (supabase.from('sales_notes') as any)
        .select(`
          id, code, store_id, status, payment_status, shipped_at, created_at, shipping_fee,
          sales_note_items (
            id, quantity, returned_quantity, sort_order,
            order_items ( id, product_id, variant_id, unit_price, unit_cost, line_type )
          )
        `)
        .eq('store_id', storeId)
        .order('shipped_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SalesNoteRow[];
    },
    enabled: !!storeId,
  });

  const { repByStore } = useRepStoreAssignments();
  const repIds = useMemo(() => {
    if (!storeId) return [];
    return (repByStore[storeId] || []).map((a) => a.rep_id);
  }, [storeId, repByStore]);
  const { calcForStore } = useBusinessProfitCalculator(repIds);
  const { costOf, isLoading: costLoading } = useProductCostMap();
  const repInfo = storeId ? (repByStore[storeId] || []) : [];
  const hasRep = repIds.length > 0;

  const bounds = rangeBounds(rangeMode, customFrom, customTo);

  const filteredNotes = useMemo(() => {
    if (!bounds) return salesNotes;
    return salesNotes.filter((sn) => {
      const d = dateOf(sn);
      if (bounds.from && d < bounds.from) return false;
      if (bounds.to && d > bounds.to) return false;
      return true;
    });
  }, [salesNotes, bounds]);

  // 月度聚合
  const monthly = useMemo(() => {
    const map: Record<string, { count: number; revenue: number; cost: number; received: number; unpaid: number; commission: number }> = {};
    for (const sn of filteredNotes) {
      const key = monthKeyOf(sn);
      if (!key) continue;
      if (!map[key]) map[key] = { count: 0, revenue: 0, cost: 0, received: 0, unpaid: 0, commission: 0 };
      const rev = noteRevenue(sn);
      const cst = noteCost(sn, costOf);
      const biz = calcForStore(storeId || null, (sn.sales_note_items || []).map((it) => {
        const oi = it.order_items;
        const q = (oi?.line_type === 'return' || oi?.line_type === 'defective')
          ? -Math.abs(it.quantity || 0)
          : (it.quantity || 0);
        return {
          productId: oi?.product_id ?? null,
          variantId: oi?.variant_id ?? null,
          quantity: q,
          unitPrice: Number(oi?.unit_price) || 0,
          snapshotCost: oi?.unit_cost ?? null,
          lineType: oi?.line_type ?? null,
        };
      }));
      const commission = biz ? biz.commission : 0;
      map[key].count += 1;
      map[key].revenue += rev;
      map[key].cost += cst;
      if (sn.payment_status === 'paid') map[key].received += rev;
      else map[key].unpaid += rev;
      map[key].commission += commission;
    }
    return Object.keys(map).sort().reverse().map((k) => ({ month: k, ...map[k] }));
  }, [filteredNotes, costOf, calcForStore, storeId]);

  const totals = useMemo(() => {
    return monthly.reduce(
      (acc, m) => ({
        count: acc.count + m.count,
        revenue: acc.revenue + m.revenue,
        cost: acc.cost + m.cost,
        received: acc.received + m.received,
        unpaid: acc.unpaid + m.unpaid,
        commission: acc.commission + m.commission,
      }),
      { count: 0, revenue: 0, cost: 0, received: 0, unpaid: 0, commission: 0 }
    );
  }, [monthly]);

  const isLoading = storeLoading || notesLoading || costLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={store ? `${store.name} 詳情` : '店鋪詳情'}
        subtitle={store ? `${store.code || ''} ${store.brand ? '· ' + store.brand : ''}`.trim() : '載入中...'}
        icon={<StoreIcon className="h-5 w-5" />}
        back={
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/stores')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回店鋪管理
          </Button>
        }
      />

      {/* 基本資訊 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本資訊</CardTitle>
        </CardHeader>
        <CardContent>
          {storeLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : store ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">代碼</div>
                <div className="font-mono">{store.code || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">品牌</div>
                <div>{store.brand || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">統一編號</div>
                <div className="font-mono">{store.tax_id || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">成員數</div>
                <div>{store.store_users?.[0]?.count ?? 0}</div>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <div className="text-muted-foreground text-xs">業務</div>
                <div>
                  {repInfo.length > 0
                    ? repInfo.map((r) => r.rep_name).join('、')
                    : <span className="text-muted-foreground">無分配</span>}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">找不到店鋪</p>
          )}
          {store && (store.phone || store.recipient || store.address || store.city) && (
            <details className="mt-3 text-sm border-t pt-3">
              <summary className="cursor-pointer text-muted-foreground text-xs select-none">地址 / 聯絡資訊（點擊展開）</summary>
              <div className="grid gap-2 sm:grid-cols-2 mt-2 text-sm">
                <div><span className="text-muted-foreground text-xs">電話：</span>{store.phone || '-'}</div>
                <div><span className="text-muted-foreground text-xs">收件人：</span>{store.recipient || '-'}</div>
                <div className="sm:col-span-2"><span className="text-muted-foreground text-xs">地址：</span>{[store.postal_code, store.city, store.district, store.address].filter(Boolean).join('') || '-'}</div>
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* 範圍選擇 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" /> 統計範圍
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
            <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="thisMonth">本月</SelectItem>
                <SelectItem value="lastMonth">上月</SelectItem>
                <SelectItem value="thisQuarter">本季</SelectItem>
                <SelectItem value="thisYear">本年</SelectItem>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="custom">自訂區間</SelectItem>
              </SelectContent>
            </Select>
            {rangeMode === 'custom' && (
              <>
                <Input
                  type="date"
                  className="w-40"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  placeholder="起日"
                />
                <span className="text-muted-foreground text-sm">~</span>
                <Input
                  type="date"
                  className="w-40"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  placeholder="迄日"
                />
              </>
            )}
            <span className="text-sm text-muted-foreground">
              共 {filteredNotes.length} 張銷貨單
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Receipt className="h-4 w-4" /> 銷貨單數
            </div>
            <div className="text-2xl font-bold">{isLoading ? '—' : totals.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" /> 營業額
            </div>
            <div className="text-2xl font-bold">{isLoading ? '—' : formatCurrency(totals.revenue)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              成本 {formatCurrency(totals.cost)} · 毛利 {formatCurrency(totals.revenue - totals.cost)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 mb-1">
              <Wallet className="h-4 w-4" /> 已收
            </div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {isLoading ? '—' : formatCurrency(totals.received)}
            </div>
            <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1">
              未收 {formatCurrency(totals.unpaid)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 mb-1">
              <Users className="h-4 w-4" /> 傭金
            </div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              {isLoading ? '—' : (hasRep ? formatCurrency(totals.commission) : '—')}
            </div>
            <div className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">
              {hasRep ? (repInfo.length === 1 ? repInfo[0].rep_name : `${repInfo[0].rep_name} 等 ${repInfo.length} 位`) : '無業務分配'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 月表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">月表</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : monthly.length === 0 || totals.count === 0 ? (
            <p className="text-center text-muted-foreground py-8">此期間無銷貨單資料</p>
          ) : (
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">月份</th>
                    <th className="text-right px-3 py-2 font-medium">單數</th>
                    <th className="text-right px-3 py-2 font-medium">營業額</th>
                    <th className="text-right px-3 py-2 font-medium">成本</th>
                    <th className="text-right px-3 py-2 font-medium">毛利</th>
                    <th className="text-right px-3 py-2 font-medium">已收</th>
                    <th className="text-right px-3 py-2 font-medium">未收</th>
                    {hasRep && <th className="text-right px-3 py-2 font-medium">傭金</th>}
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.month} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{m.month}</td>
                      <td className="text-right px-3 py-2">{m.count}</td>
                      <td className="text-right px-3 py-2">{formatCurrency(m.revenue)}</td>
                      <td className="text-right px-3 py-2 text-muted-foreground">{formatCurrency(m.cost)}</td>
                      <td className={`text-right px-3 py-2 font-medium ${m.revenue - m.cost >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                        {formatCurrency(m.revenue - m.cost)}
                      </td>
                      <td className="text-right px-3 py-2 text-emerald-600">{formatCurrency(m.received)}</td>
                      <td className="text-right px-3 py-2 text-amber-600">{formatCurrency(m.unpaid)}</td>
                      {hasRep && <td className="text-right px-3 py-2">{formatCurrency(m.commission)}</td>}
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/30 font-medium">
                    <td className="px-3 py-2">合計</td>
                    <td className="text-right px-3 py-2">{totals.count}</td>
                    <td className="text-right px-3 py-2">{formatCurrency(totals.revenue)}</td>
                    <td className="text-right px-3 py-2 text-muted-foreground">{formatCurrency(totals.cost)}</td>
                    <td className={`text-right px-3 py-2 ${totals.revenue - totals.cost >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                      {formatCurrency(totals.revenue - totals.cost)}
                    </td>
                    <td className="text-right px-3 py-2 text-emerald-600">{formatCurrency(totals.received)}</td>
                    <td className="text-right px-3 py-2 text-amber-600">{formatCurrency(totals.unpaid)}</td>
                    {hasRep && <td className="text-right px-3 py-2">{formatCurrency(totals.commission)}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {repInfo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">業務分配</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {repInfo.map((r) => (
                <div key={r.rep_id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <span>{r.rep_name}</span>
                  <Badge variant="secondary">{r.commission_rate}%</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}