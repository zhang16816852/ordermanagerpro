import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { OrderStatusBadge } from '@/components/order/OrderStatusBadge';
import { Order, OrderItem } from '@/types/order';

interface OrderTableViewProps {
  orders: Order[];
  isLoading: boolean;
  statusTab: string;
  selectedOrderIds: Set<string>;
  onToggleSelection: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onView: (order: Order) => void;
  onEdit: (id: string) => void;
}

export function OrderTableView({
  orders,
  isLoading,
  statusTab,
  selectedOrderIds,
  onToggleSelection,
  onToggleAll,
  onView,
  onEdit,
}: OrderTableViewProps) {
  const getOrderShipmentStatus = (items: OrderItem[]) => {
    if (items.length === 0) return 'waiting';
    const allProcessed = items.every((i) =>
      i.status === 'shipped' || i.status === 'cancelled' || i.status === 'discontinued'
    );
    const someShipped = items.some((i) => i.shipped_quantity > 0);
    if (allProcessed) return 'shipped';
    if (someShipped) return 'partial';
    return 'waiting';
  };

  const getOrderTotal = (items: OrderItem[]) => {
    return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  };

  return (
    <div className="rounded-lg border bg-card shadow-soft flex-1 flex flex-col overflow-hidden">
      <Table containerClassName="h-full">
        <TableHeader className="bg-muted/50">
          <TableRow>
            {statusTab === 'pending' && (
              <TableHead className="w-12">
                <Checkbox
                  checked={orders.length > 0 && selectedOrderIds.size === orders.length}
                  onCheckedChange={(checked) => onToggleAll(!!checked)}
                />
              </TableHead>
            )}
            <TableHead>訂單編號</TableHead>
            <TableHead>店鋪</TableHead>
            <TableHead>品項數</TableHead>
            <TableHead className="text-right">金額</TableHead>
            <TableHead>來源</TableHead>
            <TableHead>出貨狀態</TableHead>
            <TableHead>建立時間</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {statusTab === 'pending' && <TableCell><Skeleton className="h-4 w-4" /></TableCell>}
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
              </TableRow>
            ))
          ) : orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={statusTab === 'pending' ? 9 : 8} className="text-center py-12 text-muted-foreground italic">
                沒有找到符合條件的訂單
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => {
              const itemStatus = getOrderShipmentStatus(order.order_items);
              const orderId = order.code || order.id;
              return (
                <TableRow key={order.id} className={selectedOrderIds.has(orderId) ? 'bg-muted/50' : ''}>
                  {statusTab === 'pending' && (
                    <TableCell>
                      <Checkbox
                        checked={selectedOrderIds.has(orderId)}
                        onCheckedChange={(checked) => onToggleSelection(orderId, !!checked)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs font-medium">{orderId.slice(0, 12)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{order.stores?.name}</div>
                    {order.stores?.code && <div className="text-xs text-muted-foreground">{order.stores.code}</div>}
                  </TableCell>
                  <TableCell>{order.order_items.length}</TableCell>
                  <TableCell className="text-right font-bold">${getOrderTotal(order.order_items).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{order.source_type === 'frontend' ? '前台' : '後台'}</Badge>
                  </TableCell>
                  <TableCell><OrderStatusBadge status={itemStatus} type="shipping" /></TableCell>
                  <TableCell className="text-muted-foreground text-xs uppercase">
                    {format(new Date(order.created_at), 'MM/dd HH:mm', { locale: zhTW })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500" onClick={() => onView(order)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(order.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
