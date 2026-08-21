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
import { Eye, Edit, Trash2, Send } from 'lucide-react';
import { PurchaseOrder } from '../types';
import { formatCurrency } from '@/lib/formatters';

interface OrderListTabProps {
  orders: PurchaseOrder[];
  onView: (order: PurchaseOrder) => void;
  onEdit: (order: PurchaseOrder) => void;
  onDelete: (id: string) => void;
  onStatusChange: (orderId: string, status: string) => void;
  isLoading: boolean;
}

export function OrderListTab({
  orders,
  onView,
  onEdit,
  onDelete,
  onStatusChange,
  isLoading
}: OrderListTabProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary">草稿</Badge>;
      case 'ordered': return <Badge variant="outline" className="border-blue-500 text-blue-500">已下單</Badge>;
      case 'partial_received': return <Badge variant="outline" className="border-orange-500 text-orange-500">部分收貨</Badge>;
      case 'received': return <Badge variant="outline" className="border-green-500 text-green-500">已收貨</Badge>;
      case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground italic">目前無採購紀錄</div>
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
              <TableHead>編號</TableHead>
              <TableHead>供應商</TableHead>
              <TableHead>廠商單號</TableHead>
              <TableHead>日期</TableHead>
              <TableHead className="text-right">總額</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                <TableCell>{order.supplier?.name || '-'}</TableCell>
                <TableCell className="text-sm">{order.supplier_order_number || '-'}</TableCell>
                <TableCell>{order.order_date}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(order.total_amount)}</TableCell>
                <TableCell>{getStatusBadge(order.status)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {order.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-blue-600 border-blue-500 hover:bg-blue-50"
                        onClick={() => onStatusChange(order.id, 'ordered')}
                      >
                        <Send className="h-4 w-4 mr-1" />轉為已下單
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => onView(order)} aria-label="檢視採購單">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => onEdit(order)} aria-label="編輯採購單">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => onDelete(order.id)} aria-label="刪除採購單">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
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
                <p className="font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}</p>
                <p className="font-medium truncate">{order.supplier?.name || '-'}</p>
              </div>
              {getStatusBadge(order.status)}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{order.order_date}</span>
              <span className="font-bold">{formatCurrency(order.total_amount)}</span>
            </div>
            {order.supplier_order_number && (
              <p className="text-xs text-muted-foreground">廠商單號：{order.supplier_order_number}</p>
            )}
            <div className="flex items-center gap-2 pt-1 border-t">
              {order.status === 'draft' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-blue-600 border-blue-500 hover:bg-blue-50"
                  onClick={() => onStatusChange(order.id, 'ordered')}
                >
                  <Send className="h-4 w-4 mr-1" />轉為已下單
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => onView(order)} aria-label="檢視採購單">
                <Eye className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onEdit(order)} aria-label="編輯採購單">
                <Edit className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => onDelete(order.id)} aria-label="刪除採購單">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
