import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Package, Truck, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function StoreDashboard() {
  const { storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;

  const { data: stats, isLoading } = useQuery({
    queryKey: ['store-stats', storeId],
    queryFn: async () => {
      if (!storeId) return null;

      const [orders, pending, salesNotes] = await Promise.all([
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', storeId),
        supabase
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', storeId)
          .in('status', ['waiting', 'partial']),
        supabase
          .from('sales_notes')
          .select('id', { count: 'exact', head: true })
          .eq('store_id', storeId)
          .eq('status', 'shipped'),
      ]);

      return {
        totalOrders: orders.count ?? 0,
        pendingItems: pending.count ?? 0,
        awaitingReceive: salesNotes.count ?? 0,
      };
    },
    enabled: !!storeId,
  });

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">您尚未被指派到任何店鋪</p>
      </div>
    );
  }

  const statCards = [
    { title: '總訂單數', value: stats?.totalOrders ?? 0, icon: ShoppingCart, color: 'text-primary' },
    { title: '待出貨品項', value: stats?.pendingItems ?? 0, icon: Clock, color: 'text-warning' },
    { title: '待收貨銷貨單', value: stats?.awaitingReceive ?? 0, icon: Truck, color: 'text-accent' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">儀表板</h1>
        <p className="text-muted-foreground">
          歡迎回來，{storeRoles[0]?.store_name}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.title} className="shadow-soft">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-3xl font-bold">{stat.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
