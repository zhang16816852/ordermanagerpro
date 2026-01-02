import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, Eye } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface OrderWithItems {
  id: string;
  created_at: string;
  notes: string | null;
  order_items: {
    id: string;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    status: string;
    products: { name: string; sku: string } | null;
  }[];
}

const statusLabels: Record<string, { label: string; className: string }> = {
  waiting: { label: '待出貨', className: 'bg-status-waiting text-warning-foreground' },
  partial: { label: '部分出貨', className: 'bg-status-partial text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-status-shipped text-success-foreground' },
  out_of_stock: { label: '缺貨', className: 'bg-status-out-of-stock text-destructive-foreground' },
  discontinued: { label: '已停售', className: 'bg-status-discontinued text-muted-foreground' },
};

export default function StoreOrders() {
  const { storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['store-orders', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          created_at,
          notes,
          order_items (
            id,
            quantity,
            shipped_quantity,
            unit_price,
            status,
            products (name, sku)
          )
        `)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OrderWithItems[];
    },
    enabled: !!storeId,
  });

  const filteredOrders = orders?.filter((order) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      order.id.toLowerCase().includes(searchLower) ||
      order.order_items.some((item) =>
        item.products?.name.toLowerCase().includes(searchLower) ||
        item.products?.sku.toLowerCase().includes(searchLower)
      )
    );
  });

  const getOrderStatus = (items: OrderWithItems['order_items']) => {
    if (items.length === 0) return 'waiting';
    const allShipped = items.every((i) => i.status === 'shipped');
    const someShipped = items.some((i) => i.shipped_quantity > 0);
    if (allShipped) return 'shipped';
    if (someShipped) return 'partial';
    return 'waiting';
  };

  const getOrderTotal = (items: OrderWithItems['order_items']) => {
    return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  };

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">您尚未被指派到任何店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">我的訂單</h1>
        <p className="text-muted-foreground">查看您的所有訂單</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋訂單編號或產品..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>訂單編號</TableHead>
              <TableHead>品項數</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>建立時間</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : filteredOrders?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  沒有找到訂單
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders?.map((order) => {
                const status = getOrderStatus(order.order_items);
                const statusInfo = statusLabels[status];
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-sm">
                      {order.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{order.order_items.length}</TableCell>
                    <TableCell className="text-right font-medium">
                      ${getOrderTotal(order.order_items).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusInfo.className}>
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(order.created_at), 'MM/dd HH:mm', { locale: zhTW })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>訂單詳情</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">訂單編號：</span>
                  <span className="font-mono">{selectedOrder.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">建立時間：</span>
                  <span>
                    {format(new Date(selectedOrder.created_at), 'yyyy/MM/dd HH:mm', {
                      locale: zhTW,
                    })}
                  </span>
                </div>
              </div>
              {selectedOrder.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">備註：</span>
                  <span>{selectedOrder.notes}</span>
                </div>
              )}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>產品名稱</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">已出貨</TableHead>
                      <TableHead>狀態</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.order_items.map((item) => {
                      const itemStatus = statusLabels[item.status];
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm">
                            {item.products?.sku}
                          </TableCell>
                          <TableCell>{item.products?.name}</TableCell>
                          <TableCell className="text-right">
                            ${item.unit_price.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                          <TableCell>
                            <Badge className={itemStatus.className} variant="secondary">
                              {itemStatus.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end text-lg font-semibold">
                總計：${getOrderTotal(selectedOrder.order_items).toFixed(2)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
