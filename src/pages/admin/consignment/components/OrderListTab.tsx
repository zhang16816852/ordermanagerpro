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
  return (
    <div className="border rounded-md">
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
          {isLoading ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8">載入中...</TableCell></TableRow>
          ) : orders.map((order) => (
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
                <Button size="icon" variant="ghost" onClick={() => onView(order)}>
                  <Eye className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {orders.length === 0 && !isLoading && (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground italic">
                目前無寄賣紀錄
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
