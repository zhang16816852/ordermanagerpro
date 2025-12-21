import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Store, Package, ShoppingCart, FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [stores, products, orders, salesNotes] = await Promise.all([
        supabase.from('stores').select('id', { count: 'exact', head: true }),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('sales_notes').select('id', { count: 'exact', head: true }),
      ]);
      return {
        stores: stores.count ?? 0,
        products: products.count ?? 0,
        orders: orders.count ?? 0,
        salesNotes: salesNotes.count ?? 0,
      };
    },
  });

  const statCards = [
    { title: '店鋪總數', value: stats?.stores ?? 0, icon: Store, color: 'text-primary' },
    { title: '產品總數', value: stats?.products ?? 0, icon: Package, color: 'text-success' },
    { title: '訂單總數', value: stats?.orders ?? 0, icon: ShoppingCart, color: 'text-warning' },
    { title: '銷貨單總數', value: stats?.salesNotes ?? 0, icon: FileText, color: 'text-accent' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">管理後台總覽</h1>
        <p className="text-muted-foreground">歡迎回來！以下是系統概況。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
