import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRepCommission } from '@/hooks/useRepCommission';
import { Store, ClipboardList, FileText, TrendingUp, Percent, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/charts/StatCard';
import { formatCurrency } from '@/lib/formatters';

export default function RepDashboard() {
  const { user, repAssignedStores, commissionRate } = useAuth();
  const { isRep, computeOrder } = useRepCommission();

  // 名下店家
  const assignedStoreIds = repAssignedStores.map(s => s.store_id);

  // 統計：訂單數 / 銷貨單數 / 佣金（依 rep_product_costs 成本精算）
  const { data: stats, isLoading } = useQuery({
    queryKey: ['rep-stats', user?.id, assignedStoreIds.join(',')],
    queryFn: async () => {
      if (!user) return { orders: 0, salesNotes: 0, earnings: 0, totalProfit: 0 };

      // 我的訂單（含品項，供精算佣金）
      const { data: myOrders } = await (supabase
        .from('orders') as any)
        .select(`
          id,
          order_items (product_id, variant_id, unit_price, quantity)
        `)
        .eq('sales_rep_id', user.id);

      const lines: { productId: string; variantId?: string | null; unitPrice: number; quantity: number }[] = [];
      for (const o of (myOrders || [])) {
        for (const it of o.order_items || []) {
          lines.push({
            productId: it.product_id,
            variantId: it.variant_id ?? null,
            unitPrice: it.unit_price || 0,
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
        orders: (myOrders || []).length,
        salesNotes: salesRes.count ?? 0,
        earnings: summary.totalCommission,
        totalProfit: summary.totalProfit,
      };
    },
    enabled: !!user && isRep,
  });

  const statCards = [
    { title: '業務佣金比例', value: `${commissionRate}%`, icon: Percent, colorClass: 'text-purple-500', description: '由管理員設定' },
    { title: '我的訂單', value: stats?.orders ?? 0, icon: ClipboardList, colorClass: 'text-blue-500' },
    { title: '名下店家銷貨單', value: stats?.salesNotes ?? 0, icon: FileText, colorClass: 'text-emerald-500' },
    { title: '估佣金額', value: stats ? formatCurrency(stats.earnings) : formatCurrency(0), icon: Wallet, colorClass: 'text-amber-500', description: `利潤 ${stats ? formatCurrency(stats.totalProfit) : formatCurrency(0)}` },
  ];

  return (
    <div className="space-y-8 pb-10">
      <PageHeader
        title="業務儀表板"
        subtitle={`負責 ${repAssignedStores.length} 家店家，佣金比例 ${commissionRate}%`}
        icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
      />

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
