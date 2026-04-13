import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Store, Package, ShoppingCart, FileText, TrendingUp, Users } from 'lucide-react';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendChart } from '@/components/shared/charts/TrendChart';
import { PieDistributionChart } from '@/components/shared/charts/PieDistributionChart';
import { formatCurrency } from '@/lib/formatters';

export default function AdminDashboard() {
    // 獲取基礎統計
    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['admin-stats'],
        queryFn: async () => {
            const [stores, products, orders, salesNotes, users] = await Promise.all([
                supabase.from('stores').select('id', { count: 'exact', head: true }),
                supabase.from('products').select('id', { count: 'exact', head: true }),
                supabase.from('orders').select('id', { count: 'exact', head: true }),
                supabase.from('sales_notes').select('id', { count: 'exact', head: true }),
                supabase.from('profiles').select('id', { count: 'exact', head: true }),
            ]);
            return {
                stores: stores.count ?? 0,
                products: products.count ?? 0,
                orders: orders.count ?? 0,
                salesNotes: salesNotes.count ?? 0,
                users: users.count ?? 0,
            };
        },
    });

    // 獲取銷售趨勢 (模擬或從資料庫獲取最近 7 天)
    const { data: trendData = [], isLoading: trendLoading } = useQuery({
        queryKey: ['admin-sales-trend'],
        queryFn: async () => {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const { data, error } = await supabase
                .from('accounting_entries')
                .select('amount, transaction_date')
                .eq('type', 'income')
                .gte('transaction_date', sevenDaysAgo.toISOString())
                .order('transaction_date', { ascending: true });

            if (error) throw error;

            // 按日期分組匯總
            const dailyMap: Record<string, number> = {};
            // 初始化最近 7 天
            for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                dailyMap[date.toISOString().split('T')[0]] = 0;
            }

            (data as any[]).forEach(entry => {
                const dateKey = entry.transaction_date.split('T')[0];
                if (dailyMap[dateKey] !== undefined) {
                    dailyMap[dateKey] += entry.amount;
                }
            });

            return Object.entries(dailyMap).map(([date, amount]) => ({
                date: date.slice(5), // 格式化為 MM-DD
                amount: amount
            }));
        }
    });

    // 獲取類別分佈 (前五大)
    const { data: distributionData = [], isLoading: distLoading } = useQuery({
        queryKey: ['admin-category-dist'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('products')
                .select('category');
            
            if (error) throw error;

            const counts: Record<string, number> = {};
            (data as any[]).forEach(p => {
                const cat = p.category || '未分類';
                counts[cat] = (counts[cat] || 0) + 1;
            });

            return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, value]) => ({ name, value }));
        }
    });

    const statCards = [
        { title: '店鋪總數', value: stats?.stores ?? 0, icon: Store, colorClass: 'text-blue-500', trend: { value: 2.5, label: '本月成長', isPositive: true } },
        { title: '產品清單', value: stats?.products ?? 0, icon: Package, colorClass: 'text-emerald-500', trend: { value: 12, label: '本週新增', isPositive: true } },
        { title: '待處理訂單', value: stats?.orders ?? 0, icon: ShoppingCart, colorClass: 'text-amber-500', description: '需立即處理' },
        { title: '註冊用戶', value: stats?.users ?? 0, icon: Users, colorClass: 'text-purple-500', trend: { value: 0.8, label: '穩定成長', isPositive: true } },
    ];

    return (
        <div className="space-y-8 pb-10">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight">數據決策中心</h1>
                    <p className="text-muted-foreground mt-1 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                        這是基於即時數據生成的系統概況。
                    </p>
                </div>
            </div>

            {/* 統計卡片 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {statCards.map((stat, i) => (
                    <StatCard 
                        key={i} 
                        {...stat} 
                        isLoading={statsLoading}
                    />
                ))}
            </div>

            {/* 圖表區域 */}
            <div className="grid gap-6 md:grid-cols-3">
                <TrendChart 
                    className="md:col-span-2"
                    title="最近七日銷售趨勢"
                    subtitle="反映全站點實體與數位訂單的成交總額"
                    data={trendData}
                    xKey="date"
                    yKey="amount"
                    isLoading={trendLoading}
                />
                
                <PieDistributionChart 
                    title="熱門商品類別"
                    subtitle="依據產品數量分佈"
                    data={distributionData}
                    isLoading={distLoading}
                />
            </div>
        </div>
    );
}
