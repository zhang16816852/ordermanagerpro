import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calculator, TrendingUp, Store, DollarSign, Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function AdminAccounting() {
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [selectedStore, setSelectedStore] = useState<string>('all');

  const months = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'yyyy年MM月', { locale: zhTW }),
    };
  });

  const { data: stores } = useQuery({
    queryKey: ['stores-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, code, brand')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ['admin-accounting', selectedMonth, selectedStore],
    queryFn: async () => {
      const [year, month] = selectedMonth.split('-').map(Number);
      const startDate = startOfMonth(new Date(year, month - 1));
      const endDate = endOfMonth(new Date(year, month - 1));

      let query = supabase
        .from('sales_notes')
        .select(`
          *,
          stores (id, name, code, brand),
          sales_note_items (
            id,
            quantity,
            order_item:order_items (
              id,
              unit_price,
              product:products (name, sku)
            )
          )
        `)
        .eq('status', 'received')
        .gte('received_at', startDate.toISOString())
        .lte('received_at', endDate.toISOString())
        .order('received_at', { ascending: false });

      if (selectedStore !== 'all') {
        query = query.eq('store_id', selectedStore);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const calculateNoteTotal = (note: any) => {
    return note.sales_note_items.reduce((sum: number, item: any) => {
      const price = item.order_item?.unit_price || 0;
      return sum + item.quantity * price;
    }, 0);
  };

  // 依店鋪分組統計
  const storeStats = salesNotes?.reduce((acc: Record<string, { 
    storeName: string; 
    brand: string | null;
    amount: number; 
    items: number;
    notes: number;
  }>, note) => {
    const storeId = note.stores?.id || 'unknown';
    if (!acc[storeId]) {
      acc[storeId] = {
        storeName: note.stores?.name || '未知店鋪',
        brand: note.stores?.brand || null,
        amount: 0,
        items: 0,
        notes: 0,
      };
    }
    acc[storeId].amount += calculateNoteTotal(note);
    acc[storeId].items += note.sales_note_items.reduce(
      (sum: number, item: any) => sum + item.quantity, 0
    );
    acc[storeId].notes += 1;
    return acc;
  }, {}) || {};

  const totalAmount = salesNotes?.reduce((sum, note) => sum + calculateNoteTotal(note), 0) || 0;
  const totalItems = salesNotes?.reduce((sum, note) => 
    sum + note.sales_note_items.reduce((itemSum: number, item: any) => itemSum + item.quantity, 0), 0) || 0;
  const totalNotes = salesNotes?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">會計報表</h1>
          <p className="text-muted-foreground">查看所有店鋪的銷貨統計</p>
        </div>
        <div className="flex gap-4">
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="選擇店鋪" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部店鋪</SelectItem>
              {stores?.map(store => (
                <SelectItem key={store.id} value={store.id}>
                  {store.code ? `${store.code} - ${store.name}` : store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map(month => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總銷售額</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalAmount.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總品項數</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">銷貨單數</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalNotes}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">活躍店鋪</CardTitle>
            <Store className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Object.keys(storeStats).length}</div>
          </CardContent>
        </Card>
      </div>

      {/* 店鋪統計 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            店鋪銷售統計
          </CardTitle>
          <CardDescription>
            {format(new Date(selectedMonth + '-01'), 'yyyy年MM月', { locale: zhTW })} 各店鋪銷售情況
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : Object.keys(storeStats).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              本月沒有已收貨的銷貨單
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>店鋪</TableHead>
                  <TableHead>品牌</TableHead>
                  <TableHead className="text-right">銷貨單數</TableHead>
                  <TableHead className="text-right">總件數</TableHead>
                  <TableHead className="text-right">銷售額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(storeStats)
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([storeId, stats]) => (
                    <TableRow key={storeId}>
                      <TableCell className="font-medium">{stats.storeName}</TableCell>
                      <TableCell>{stats.brand || '-'}</TableCell>
                      <TableCell className="text-right">{stats.notes}</TableCell>
                      <TableCell className="text-right">{stats.items}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${stats.amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell colSpan={4}>合計</TableCell>
                  <TableCell className="text-right">${totalAmount.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 詳細列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            銷貨單明細
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : salesNotes?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              沒有銷貨單記錄
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>銷貨單編號</TableHead>
                  <TableHead>店鋪</TableHead>
                  <TableHead>收貨日期</TableHead>
                  <TableHead className="text-right">品項數</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesNotes?.map((note) => {
                  const amount = calculateNoteTotal(note);
                  return (
                    <TableRow key={note.id}>
                      <TableCell className="font-mono text-sm">
                        {note.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>{note.stores?.name}</TableCell>
                      <TableCell>
                        {note.received_at
                          ? format(new Date(note.received_at), 'MM/dd HH:mm', { locale: zhTW })
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">{note.sales_note_items.length}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
