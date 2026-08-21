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
import { Eye } from 'lucide-react';
import { ConsignmentOrder, ConsignmentDirection, ConsignmentStatus } from '../types';

interface OrderListTabProps {
  orders: ConsignmentOrder[];
  onView: (order: ConsignmentOrder) => void;
  isLoading: boolean;
}

const directionLabel: Record<ConsignmentDirection, string> = {
  receive_from_supplier: '廠商寄賣',
  send_to_store: '店家寄賣',
};

function getStatusBadge(status: ConsignmentStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary">草稿</Badge>;
    case 'active': return <Badge variant="outline" className="border-blue-500 text-blue-500">進行中</Badge>;
    case 'settled': return <Badge variant="outline" className="border-green-500 text-green-600">已結算</Badge>;
    case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

export function OrderListTab({ orders, onView, isLoading }: OrderListTabProps) {
  if (isLoading) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground" role="status" aria-live="polite">載入中…</div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground italic">目前無寄賣紀錄</div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: Table */}
      <div className="hidden md:block border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>寄賣單號</TableHead>
              <TableHead>方向</TableHead>
              <TableHead>合作對象</TableHead>
              <TableHead>建立日期</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.code}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={
                    order.direction === 'receive_from_supplier'
                      ? 'border-violet-500 text-violet-600'
                      : 'border-orange-500 text-orange-600'
                  }>
                    {directionLabel[order.direction]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {order.supplier?.name || order.store?.name || '-'}
                </TableCell>
                <TableCell className="text-sm">
                  {new Date(order.created_at).toLocaleDateString('zh-TW')}
                </TableCell>
                <TableCell>{getStatusBadge(order.status)}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => onView(order)} aria-label="查看訂單">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: Cards */}
      <div className="md:hidden space-y-3">
        {orders.map((order) => (
          <div key={order.id} className="border rounded-lg p-4 bg-card shadow-soft space-y-3">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">{order.code}</p>
                <p className="font-medium truncate text-sm">
                  {order.supplier?.name || order.store?.name || '-'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className={
                  order.direction === 'receive_from_supplier'
                    ? 'border-violet-500 text-violet-600'
                    : 'border-orange-500 text-orange-600'
                }>
                  {directionLabel[order.direction]}
                </Badge>
                {getStatusBadge(order.status)}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{new Date(order.created_at).toLocaleDateString('zh-TW')}</span>
              <Button size="icon" variant="ghost" onClick={() => onView(order)} aria-label="查看訂單">
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
