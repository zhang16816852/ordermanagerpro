import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRepCommission } from '@/hooks/useRepCommission';
import { Store, ClipboardList, FileText, TrendingUp, Percent, Wallet, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/charts/StatCard';
import { formatCurrency } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function RepDashboard() {
  const { user, repAssignedStores, commissionRate } = useAuth();
  const { isRep, computeOrder } = useRepCommission();
  const navigate = useNavigate();

  // 名下店家
  const assignedStoreIds = repAssignedStores.map(s => s.store_id);

  // 統計：訂單數 / 銷貨單數 / 佣金（依 rep_product_costs 成本精算）
  const { data: stats, isLoading } = useQuery({
    queryKey: ['rep-stats', user?.id, assignedStoreIds.join(',')],
    queryFn: async () => {
      if (!user) return { orders: 0, salesNotes: 0, earnings: 0, totalProfit: 0 };

      // 名下店家的銷貨單（依店家分配自動歸屬）
      const { data: mySalesNotes } = await (supabase
        .from('sales_notes') as any)
        .select(`
          id,
          sales_note_items(
            quantity,
            order_item:order_items(product_id, variant_id, unit_price)
          )
        `)
        .in('store_id', assignedStoreIds.length > 0 ? assignedStoreIds : ['00000000-0000-0000-0000-000000000000'])
        .in('status', ['shipped', 'received'])
        .order('sort_order', { foreignTable: 'sales_note_items', ascending: true });

      const lines: { productId: string; variantId?: string | null; unitPrice: number; quantity: number }[] = [];
      for (const sn of (mySalesNotes || [])) {
        for (const it of sn.sales_note_items || []) {
          if (!it.order_item) continue;
          lines.push({
            productId: it.order_item.product_id,
            variantId: it.order_item.variant_id ?? null,
            unitPrice: it.order_item.unit_price || 0,
            quantity: it.quantity || 0,
          });
        }
      }
      const summary = computeOrder(lines);

      const [salesRes] = await Promise.all([
        (supabase.from('sales_notes') as any)
          .select('id', { count: 'exact', head: true })
          .in('store_id', assignedStoreIds.length > 0 ? assignedStoreIds : ['00000000-0000-0000-0000-000000000000']),
      ]);

      return {
        orders: (mySalesNotes || []).length,
        salesNotes: salesRes.count ?? 0,
        earnings: summary.totalCommission,
        totalProfit: summary.totalProfit,
      };
    },
    enabled: !!user && isRep,
  });

  // 發放統計
  const { data: payoutStats } = useQuery({
    queryKey: ['rep-payout-stats', user?.id],
    queryFn: async () => {
      if (!user) return { paidTotal: 0 };
      const { data } = await (supabase
        .from('rep_commission_payouts') as any)
        .select('amount')
        .eq('rep_id', user.id);
      const paidTotal = (data || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
      return { paidTotal };
    },
    enabled: !!user && isRep,
  });

  const totalEarnings = stats?.earnings ?? 0;
  const paidTotal = payoutStats?.paidTotal ?? 0;
  const pendingTotal = Math.max(0, totalEarnings - paidTotal);

  const statCards = [
    { title: '業務佣金比例', value: `${commissionRate}%`, icon: Percent, colorClass: 'text-purple-500', description: '由管理員設定' },
    { title: '名下店家銷貨單', value: stats?.salesNotes ?? 0, icon: FileText, colorClass: 'text-emerald-500' },
    { title: '估佣總額', value: formatCurrency(totalEarnings), icon: Wallet, colorClass: 'text-amber-500', description: `利潤 ${stats ? formatCurrency(stats.totalProfit) : formatCurrency(0)}` },
    { title: '已發放分潤', value: formatCurrency(paidTotal), icon: CheckCircle2, colorClass: 'text-emerald-600' },
    { title: '待發放分潤', value: formatCurrency(pendingTotal), icon: Wallet, colorClass: 'text-amber-600' },
  ];

  return (
    <div className="space-y-8 pb-10">
      <PageHeader
        title="業務儀表板"
        subtitle={`負責 ${repAssignedStores.length} 家店家，佣金比例 ${commissionRate}%`}
        icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
        actions={
          <Button onClick={() => navigate('/admin/my-commission')} size="sm">
            查看我的分潤明細
          </Button>
        }
      />

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((stat, i) => (
          <StatCard key={i} {...stat} isLoading={isLoading} />
        ))}
      </div>

      {/* 名下店家 */}
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-lg font-semibold mb-3">
          <Store className="h-5 w-5 text-muted-foreground" />名下店家
        </h3>
        {repAssignedStores.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚未分配任何店家，請聯繫管理員。</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {repAssignedStores.map((s) => (
              <li key={s.store_id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {s.store_name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
