import { useMemo, useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import {
  ConsignmentOrder,
  ConsignmentOrderItem,
  ConsignmentOrderItemSummary,
} from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  PackageCheck,
  Truck,
  Undo2,
  Wallet,
  Ban,
  Pencil,
  RotateCcw,
  Share2,
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

import { ReceiveDialog } from './ReceiveDialog';
import { ShipDialog } from './ShipDialog';
import { ReturnDialog } from './ReturnDialog';
import { SettleDialog } from './SettleDialog';
import { ReverseDialog } from './ReverseDialog';
import { EditItemsDialog } from './EditItemsDialog';

interface OrderDetailDialogProps {
  order: ConsignmentOrder | null;
  onClose: () => void;
}

type ActionType = 'receive' | 'ship' | 'return' | 'settle' | 'reverse' | 'edit';

export function OrderDetailDialog({ order, onClose }: OrderDetailDialogProps) {
  const { useOrderDetail, accounts, cancelOrderMutation, warehouses } = useConsignment();
  const detail = useOrderDetail(order?.id || null);
  const [action, setAction] = useState<ActionType | null>(null);

  const isSupplier = order?.direction === 'receive_from_supplier';
  const canAct = order?.status === 'draft' || order?.status === 'active';

  const items = detail.data?.items || [];
  const summaries = detail.data?.summaries || [];
  const settlements = detail.data?.settlements || [];

  const summaryMap = useMemo(() => {
    const map: Record<string, ConsignmentOrderItemSummary> = {};
    (detail.data?.summaries || []).forEach(s => { map[s.consignment_order_item_id] = s; });
    return map;
  }, [detail.data?.summaries]);

  const expectedSettlement = useMemo(() => {
    if (!order) return 0;
    return (detail.data?.sales || []).reduce((sum, s) =>
      sum + s.quantity * (isSupplier ? s.unit_cost : s.unit_price), 0
    );
  }, [detail.data?.sales, order, isSupplier]);

  const settledAmount = (detail.data?.settlements || []).filter(s => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);

  if (!order) return null;

  const statusBadge = (() => {
    switch (order.status) {
      case 'draft': return <Badge variant="secondary">草稿</Badge>;
      case 'active': return <Badge variant="outline" className="border-blue-500 text-blue-500">進行中</Badge>;
      case 'settled': return <Badge variant="outline" className="border-green-500 text-green-600">已結算</Badge>;
      case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
      default: return <Badge variant="secondary">{order.status}</Badge>;
    }
  })();

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            寄賣單 {order.code} {statusBadge}
            {order.access_token && (
              <button
                type="button"
                onClick={() => {
                  const link = `${window.location.origin}/share/consignment/${order.code || order.id}?token=${order.access_token}`;
                  navigator.clipboard?.writeText(link).then(() => toast.success('分享連結已複製'));
                }}
                className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                title="複製分享連結"
              >
                <Share2 className="h-3.5 w-3.5" /> 分享
              </button>
            )}
          </DialogTitle>
          <DialogDescription>
            {isSupplier
              ? `廠商寄賣：${order.supplier?.name || '-'}`
              : `店家寄賣：${order.store?.name || '-'}`}
            {order.note && <> · {order.note}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!isSupplier && order.received_at && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              店家已於 {new Date(order.received_at).toLocaleString('zh-TW')} 確認收貨，可進行銷售回報。
            </div>
          )}
          {/* 品項表 */}
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">商品</th>
                  <th className="text-right py-2 px-3 font-medium w-16">訂量</th>
                  <th className="text-right py-2 px-3 font-medium w-20">
                    {isSupplier ? '已收' : '已出'}
                  </th>
                  <th className="text-right py-2 px-3 font-medium w-20">已售</th>
                  <th className="text-right py-2 px-3 font-medium w-20">已退</th>
                  <th className="text-right py-2 px-3 font-medium w-20">剩餘</th>
                  <th className="text-right py-2 px-3 font-medium w-24">
                    {isSupplier ? '成本' : '出貨價'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground" role="status" aria-live="polite">載入中…</td></tr>
                ) : items.map((item: ConsignmentOrderItem) => {
                  const s = summaryMap[item.id];
                  const remaining = s?.remaining_quantity ?? 0;
                  const returned = s
                    ? (isSupplier ? s.returned_to_supplier : s.returned_from_store)
                    : 0;
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2 px-3">
                        <p className="font-medium">{item.variant?.name || item.product?.name || '-'}</p>
                      </td>
                      <td className="text-right py-2 px-3">{item.quantity}</td>
                      <td className="text-right py-2 px-3">
                        {isSupplier ? s?.received_quantity ?? 0 : s?.shipped_quantity ?? 0}
                      </td>
                      <td className="text-right py-2 px-3">{s?.sold_quantity ?? 0}</td>
                      <td className="text-right py-2 px-3 text-destructive">{returned}</td>
                      <td className="text-right py-2 px-3 font-medium">{remaining}</td>
                      <td className="text-right py-2 px-3 text-muted-foreground">
                        {formatCurrency(isSupplier ? item.unit_cost : item.unit_price)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 動作區 */}
          {canAct && (
            <div className="flex flex-wrap gap-2">
              {isSupplier ? (
                <Button onClick={() => setAction('receive')} className="bg-green-600 hover:bg-green-700">
                  <PackageCheck className="h-4 w-4 mr-1" /> 收貨
                </Button>
              ) : (
                <Button onClick={() => setAction('ship')} className="bg-blue-600 hover:bg-blue-700">
                  <Truck className="h-4 w-4 mr-1" /> 出貨
                </Button>
              )}
              {!isSupplier && order.status === 'active' && !order.received_at && (
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setAction('reverse')}
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> 回滾出貨
                </Button>
              )}
              {order.status === 'draft' && (
                <Button variant="outline" onClick={() => setAction('edit')}>
                  <Pencil className="h-4 w-4 mr-1" /> 編輯品項
                </Button>
              )}
              <Button variant="outline" onClick={() => setAction('return')}>
                <Undo2 className="h-4 w-4 mr-1" /> 退回
              </Button>
              <Button variant="outline" onClick={() => setAction('settle')}>
                <Wallet className="h-4 w-4 mr-1" /> 結算
              </Button>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  if (confirm('確定要取消此寄賣單嗎？')) cancelOrderMutation.mutate(order.id);
                }}
              >
                <Ban className="h-4 w-4 mr-1" /> 取消
              </Button>
            </div>
          )}

          {/* 結算紀錄 */}
          {settlements.length > 0 && (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium">結算類型</th>
                    <th className="text-right py-2 px-3 font-medium">金額</th>
                    <th className="text-right py-2 px-3 font-medium">日期</th>
                    <th className="text-left py-2 px-3 font-medium">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 px-3">
                        {s.settlement_type === 'supplier_payment' ? '應付廠商' : '店家應收'}
                      </td>
                      <td className="text-right py-2 px-3 font-medium">{formatCurrency(s.amount)}</td>
                      <td className="text-right py-2 px-3">
                        {s.settled_at ? new Date(s.settled_at).toLocaleDateString('zh-TW') : '-'}
                      </td>
                      <td className="py-2 px-3">
                        {s.status === 'paid'
                          ? <Badge variant="outline" className="border-green-500 text-green-600">已付款</Badge>
                          : <Badge variant="secondary">待付款</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-3 text-sm flex justify-end gap-4">
                <span className="text-muted-foreground">應結算 {formatCurrency(expectedSettlement)}</span>
                <span className="font-medium">已結算 {formatCurrency(settledAmount)}</span>
              </div>
            </div>
          )}
        </div>

        {action === 'receive' && (
          <ReceiveDialog
            order={order}
            items={items}
            summaries={summaries}
            onCancel={() => setAction(null)}
          />
        )}
        {action === 'ship' && (
          <ShipDialog
            order={order}
            onCancel={() => setAction(null)}
          />
        )}
        {action === 'return' && (
          <ReturnDialog
            order={order}
            items={items}
            summaries={summaries}
            onCancel={() => setAction(null)}
          />
        )}
        {action === 'reverse' && (
          <ReverseDialog
            order={order}
            onCancel={() => setAction(null)}
          />
        )}
        {action === 'edit' && (
          <EditItemsDialog
            order={order}
            items={items}
            onCancel={() => setAction(null)}
          />
        )}
        {action === 'settle' && (
          <SettleDialog
            order={order}
            accounts={accounts}
            expected={expectedSettlement}
            settled={settledAmount}
            onCancel={() => setAction(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}