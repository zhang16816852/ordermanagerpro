import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import RepDashboard from './RepDashboard';
import { Store, Package, ShoppingCart, FileText, TrendingUp, Users, DollarSign, AlertTriangle, Trophy, CalendarDays } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendChart } from '@/components/shared/charts/TrendChart';
import { PieDistributionChart } from '@/components/shared/charts/PieDistributionChart';
import { formatCurrency, formatTWD } from '@/lib/formatters';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMarginRate } from '@/utils/grossProfit';

type RangeDays = 7 | 30 | 90;

export default function AdminDashboard() {
    const { isRep } = useAuth();
    return isRep ? <RepDashboard /> : <AdminOverview />;
}

function AdminOverview() {
    const [rangeDays, setRangeDays] = useState<RangeDays>(7);

    // 獲取基礎統計
    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['admin-stats'],
        queryFn: async () => {
            const [stores, products, orders, salesNotes, users, lowStock] = await Promise.all([
                (supabase.from('stores') as any).select('id', { count: 'exact', head: true }),
                (supabase.from('products') as any).select('id', { count: 'exact', head: true }),
                (supabase.from('orders') as any).select('id', { count: 'exact', head: true }).eq('status', 'pending'),
                (supabase.from('sales_notes') as any).select('id', { count: 'exact', head: true }),
                (supabase.from('profiles') as any).select('id', { count: 'exact', head: true }),
                (supabase.from('product_inventory') as any).select('id', { count: 'exact', head: true }).lte('quantity', 5),
            ]);
            return {
                stores: stores.count ?? 0,
                products: products.count ?? 0,
                pendingOrders: orders.count ?? 0,
                salesNotes: salesNotes.count ?? 0,
                users: users.count ?? 0,
                lowStock: lowStock.count ?? 0,
            };
        },
    });

    // 銷售趨勢（依選擇的日期範圍）
    const { data: trendData = [], isLoading: trendLoading } = useQuery({
        queryKey: ['admin-sales-trend', rangeDays],
        queryFn: async () => {
            const since = new Date();
            since.setDate(since.getDate() - rangeDays);
            since.setHours(0, 0, 0, 0);

            const { data, error } = await (supabase
                .from('sales_notes') as any)
                .select(`
                    shipped_at,
                    shipping_fee,
                    sales_note_items(
                        quantity,
                        order_item:order_items(unit_price, unit_cost)
                    )
                `)
                .not('shipped_at', 'is', null)
                .gte('shipped_at', since.toISOString())
                .order('shipped_at', { ascending: true });

            if (error) throw error;

            const dailyMap: Record<string, { revenue: number; cost: number }> = {};
            for (let i = rangeDays - 1; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                dailyMap[date.toISOString().split('T')[0]] = { revenue: 0, cost: 0 };
            }

            (data as any[]).forEach((note: any) => {
                if (!note.shipped_at) return;
                const dateKey = note.shipped_at.split('T')[0];
                if (!dailyMap[dateKey]) return;
                (note.sales_note_items || []).forEach((item: any) => {
                    const qty = Number(item.quantity) || 0;
                    const price = Number(item.order_item?.unit_price) || 0;
                    const cost = Number(item.order_item?.unit_cost) || 0;
                    dailyMap[dateKey].revenue += price * qty;
                    dailyMap[dateKey].cost += cost * qty;
                });
                dailyMap[dateKey].revenue += Number(note.shipping_fee) || 0;
            });

            return Object.entries(dailyMap).map(([date, v]) => ({
                date: date.slice(5),
                amount: v.revenue,
                cost: v.cost,
                profit: v.revenue - v.cost,
            }));
        },
    });

    // 本月銷售總額 + 毛利
    const { data: monthlySummary, isLoading: monthlyLoading } = useQuery({
        queryKey: ['admin-monthly-summary'],
        queryFn: async () => {
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            const { data, error } = await (supabase
                .from('sales_notes') as any)
                .select(`
                    shipping_fee,
                    sales_note_items(
                        quantity,
                        order_item:order_items(unit_price, unit_cost)
                    )
                `)
                .not('shipped_at', 'is', null)
                .gte('shipped_at', monthStart);
            if (error) throw error;

            let revenue = 0;
            let cost = 0;
            let count = 0;
            (data as any[]).forEach((note: any) => {
                count++;
                revenue += Number(note.shipping_fee) || 0;
                (note.sales_note_items || []).forEach((item: any) => {
                    const qty = Number(item.quantity) || 0;
                    revenue += (Number(item.order_item?.unit_price) || 0) * qty;
                    cost += (Number(item.order_item?.unit_cost) || 0) * qty;
                });
            });
            const profit = revenue - cost;
            const margin = revenue > 0 ? profit / revenue : null;
            return { revenue, cost, profit, margin, count };
        },
    });

    // 熱銷商品 Top 5
    const { data: topProducts = [], isLoading: topLoading } = useQuery({
        queryKey: ['admin-top-products'],
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('sales_note_items') as any)
                .select(`
                    quantity,
                    order_item:order_items(
                        unit_price,
                        product:products(name),
                        variant:product_variants(name)
                    )
                `)
                .limit(500);
            if (error) throw error;

            const agg: Record<string, { name: string; qty: number; revenue: number }> = {};
            (data as any[]).forEach((item: any) => {
                const name = item.order_item?.variant?.name || item.order_item?.product?.name || '未知商品';
                const qty = Number(item.quantity) || 0;
                const price = Number(item.order_item?.unit_price) || 0;
                if (!agg[name]) agg[name] = { name, qty: 0, revenue: 0 };
                agg[name].qty += qty;
                agg[name].revenue += price * qty;
            });

            return Object.values(agg)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5);
        },
    });

    // 類別分佈
    const { data: distributionData = [], isLoading: distLoading } = useQuery({
        queryKey: ['admin-category-dist'],
        queryFn: async () => {
            const { data: links, error } = await (supabase
                .from('product_category_links') as any)
                .select('category_id');
            if (error) throw error;

            const catIds = [...new Set((links || []).map((l: any) => l.category_id))];

            let catNames: Record<string, string> = {};
            if (catIds.length > 0) {
                const { data: cats } = await (supabase
                    .from('categories') as any)
                    .select('id, name')
                    .in('id', catIds);
                catNames = Object.fromEntries((cats || []).map((c: any) => [c.id, c.name]));
            }

            const counts: Record<string, number> = {};
            (links || []).forEach((l: any) => {
                const name = catNames[l.category_id] || '未分類';
                counts[name] = (counts[name] || 0) + 1;
            });

            return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, value]) => ({ name, value }));
        },
    });

    const statCards = [
        { title: '店鋪總數', value: stats?.stores ?? 0, icon: Store, colorClass: 'text-blue-500', description: '活躍店鋪' },
        { title: '產品清單', value: stats?.products ?? 0, icon: Package, colorClass: 'text-emerald-500', description: '在售商品' },
        { title: '待處理訂單', value: stats?.pendingOrders ?? 0, icon: ShoppingCart, colorClass: 'text-amber-500', description: '需立即處理' },
        { title: '註冊用戶', value: stats?.users ?? 0, icon: Users, colorClass: 'text-purple-500', description: '系統用戶' },
    ];

    const rangeLabels: Record<RangeDays, string> = { 7: '7 天', 30: '30 天', 90: '90 天' };

    return (
        <div className="space-y-8 pb-10">
            <PageHeader
                title="數據決策中心"
                subtitle="這是基於即時數據生成的系統概況。"
                icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
                actions={
                    <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v) as RangeDays)}>
                            <SelectTrigger className="w-[100px] h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7">7 天</SelectItem>
                                <SelectItem value="30">30 天</SelectItem>
                                <SelectItem value="90">90 天</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                }
            />

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

            {/* 本月銷售 & 毛利摘要 */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="shadow-soft border-none bg-card/60 backdrop-blur-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground/80">本月銷售額</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {monthlyLoading ? (
                            <div className="h-8 w-24 bg-muted animate-pulse rounded" />
                        ) : (
                            <>
                                <div className="text-3xl font-bold tracking-tight">
                                    {formatTWD(monthlySummary?.revenue ?? 0)}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {monthlySummary?.count ?? 0} 張銷貨單
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
                <Card className="shadow-soft border-none bg-card/60 backdrop-blur-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground/80">本月毛利</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {monthlyLoading ? (
                            <div className="h-8 w-24 bg-muted animate-pulse rounded" />
                        ) : (
                            <>
                                <div className="text-3xl font-bold tracking-tight text-emerald-600">
                                    {formatTWD(monthlySummary?.profit ?? 0)}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    毛利率 {formatMarginRate(monthlySummary?.margin ?? null)}
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
                <Card className="shadow-soft border-none bg-card/60 backdrop-blur-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground/80">本月成本</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {monthlyLoading ? (
                            <div className="h-8 w-24 bg-muted animate-pulse rounded" />
                        ) : (
                            <>
                                <div className="text-3xl font-bold tracking-tight text-rose-600">
                                    {formatTWD(monthlySummary?.cost ?? 0)}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    銷售成本合計
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* 低庫存 & 待處理警示 */}
            {(stats?.lowStock ?? 0) > 0 || (stats?.pendingOrders ?? 0) > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                    {(stats?.lowStock ?? 0) > 0 && (
                        <Card className="border-amber-200 bg-amber-50/50 shadow-soft">
                            <CardContent className="flex items-center gap-4 py-4">
                                <div className="p-2 rounded-lg bg-amber-100">
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-amber-800">低庫存警示</p>
                                    <p className="text-xs text-amber-600">
                                        {stats?.lowStock} 項產品庫存 ≤ 5，請盡快補貨
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    {(stats?.pendingOrders ?? 0) > 0 && (
                        <Card className="border-blue-200 bg-blue-50/50 shadow-soft">
                            <CardContent className="flex items-center gap-4 py-4">
                                <div className="p-2 rounded-lg bg-blue-100">
                                    <ShoppingCart className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-blue-800">待處理訂單</p>
                                    <p className="text-xs text-blue-600">
                                        {stats?.pendingOrders} 筆訂單待出貨
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            ) : null}

            {/* 圖表區域 */}
            <div className="grid gap-6 md:grid-cols-3">
                <TrendChart
                    className="md:col-span-2"
                    title={`最近 ${rangeDays} 日銷售趨勢`}
                    subtitle="依銷貨單出貨時間計算的成交總額"
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

            {/* 熱銷商品 Top 5 */}
            <Card className="shadow-soft border-none bg-card/60 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Trophy className="h-4 w-4 text-amber-500" />
                        熱銷商品 Top 5
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {topLoading ? (
                        <div className="space-y-2">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                            ))}
                        </div>
                    ) : topProducts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">尚無銷售資料</p>
                    ) : (
                        <div className="space-y-2">
                            {topProducts.map((p, i) => (
                                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold text-muted-foreground w-6">{i + 1}</span>
                                        <span className="text-sm font-medium truncate max-w-[300px]">{p.name}</span>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-semibold">{formatTWD(p.revenue)}</p>
                                        <p className="text-xs text-muted-foreground">{p.qty} 件</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
