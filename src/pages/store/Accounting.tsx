import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Calculator, TrendingUp, Package, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function StoreAccounting() {
  const { storeId } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));

  const months = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'yyyy年MM月', { locale: zhTW }),
    };
  });

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ['store-accounting', storeId, selectedMonth],
    queryFn: async () => {
      if (!storeId) return [];

      const [year, month] = selectedMonth.split('-').map(Number);
      const startDate = startOfMonth(new Date(year, month - 1));
      const endDate = endOfMonth(new Date(year, month - 1));

      const { data, error } = await supabase
        .from('sales_notes')
        .select(`
          *,
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
        .eq('store_id', storeId)
        .eq('status', 'received')
        .gte('received_at', startDate.toISOString())
        .lte('received_at', endDate.toISOString())
        .order('received_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!storeId,
  });

  const calculateNoteTotal = (note: any) => {
    return note.sales_note_items.reduce((sum: number, item: any) => {
      const price = item.order_item?.unit_price || 0;
      return sum + item.quantity * price;
    }, 0);
  };

  const totalAmount = salesNotes?.reduce((sum, note) => sum + calculateNoteTotal(note), 0) || 0;
  const totalItems = salesNotes?.reduce((sum, note) => 
    sum + note.sales_note_items.reduce((itemSum: number, item: any) => itemSum + item.quantity, 0), 0) || 0;
  const totalNotes = salesNotes?.length || 0;

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">請先選擇店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">會計報表</h1>
          <p className="text-muted-foreground">查看已收貨的銷貨單統計</p>
        </div>
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

      {/* 統計卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">本月進貨總額</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalAmount.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">進貨品項數</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">銷貨單數量</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalNotes}</div>
          </CardContent>
        </Card>
      </div>

      {/* 詳細列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            銷貨單明細
          </CardTitle>
          <CardDescription>
            {format(new Date(selectedMonth + '-01'), 'yyyy年MM月', { locale: zhTW })} 已收貨的銷貨單
          </CardDescription>
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
              本月沒有已收貨的銷貨單
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>銷貨單編號</TableHead>
                  <TableHead>收貨日期</TableHead>
                  <TableHead className="text-right">品項數</TableHead>
                  <TableHead className="text-right">總件數</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesNotes?.map((note) => {
                  const itemCount = note.sales_note_items.length;
                  const totalQuantity = note.sales_note_items.reduce(
                    (sum: number, item: any) => sum + item.quantity, 0
                  );
                  const amount = calculateNoteTotal(note);

                  return (
                    <TableRow key={note.id}>
                      <TableCell className="font-mono text-sm">
                        {note.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        {note.received_at
                          ? format(new Date(note.received_at), 'MM/dd HH:mm', { locale: zhTW })
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">{itemCount}</TableCell>
                      <TableCell className="text-right">{totalQuantity}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell colSpan={4}>合計</TableCell>
                  <TableCell className="text-right">${totalAmount.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
