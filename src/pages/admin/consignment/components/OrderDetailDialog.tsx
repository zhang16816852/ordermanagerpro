import { useMemo, useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import {
  ConsignmentOrder,
  ConsignmentOrderItem,
  ConsignmentOrderItemSummary,
} from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  PackageCheck,
  Truck,
  Undo2,
  Wallet,
  Ban,
} from 'lucide-react';

interface OrderDetailDialogProps {
  order: ConsignmentOrder | null;
  onClose: () => void;
}

type ActionType = 'receive' | 'ship' | 'return' | 'settle';

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
          </DialogTitle>
          <DialogDescription>
            {isSupplier
              ? `廠商寄賣：${order.supplier?.name || '-'}`
              : `店家寄賣：${order.store?.name || '-'}`}
            {order.note && <> · {order.note}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
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
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
                ) : items.map((item: ConsignmentOrderItem) => {
                  const s = summaryMap[item.id];
                  const remaining = s?.remaining_quantity ?? 0;
                  const returned = s
                    ? (isSupplier ? s.returned_to_supplier : s.returned_from_store)
                    : 0;
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2 px-3">
                        <p className="font-medium">{item.product?.name || '-'}</p>
                        {item.variant?.name && (
                          <p className="text-xs text-muted-foreground">{item.variant.name}</p>
                        )}
                      </td>
                      <td className="text-right py-2 px-3">{item.quantity}</td>
                      <td className="text-right py-2 px-3">
                        {isSupplier ? s?.received_quantity ?? 0 : s?.shipped_quantity ?? 0}
                      </td>
                      <td className="text-right py-2 px-3">{s?.sold_quantity ?? 0}</td>
                      <td className="text-right py-2 px-3 text-destructive">{returned}</td>
                      <td className="text-right py-2 px-3 font-medium">{remaining}</td>
                      <td className="text-right py-2 px-3 text-muted-foreground">
                        ${(isSupplier ? item.unit_cost : item.unit_price).toLocaleString()}
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
                      <td className="text-right py-2 px-3 font-medium">${s.amount.toLocaleString()}</td>
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
                <span className="text-muted-foreground">應結算 ${expectedSettlement.toLocaleString()}</span>
                <span className="font-medium">已結算 ${settledAmount.toLocaleString()}</span>
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

/* ============ 收貨 ============ */
interface ReceiveDialogProps {
  order: ConsignmentOrder;
  items: ConsignmentOrderItem[];
  summaries: ConsignmentOrderItemSummary[];
  onCancel: () => void;
}

function ReceiveDialog({ order, items, summaries, onCancel }: ReceiveDialogProps) {
  const { receiveItemsMutation } = useConsignment();
  const summaryMap = useMemo(() => {
    const map: Record<string, ConsignmentOrderItemSummary> = {};
    summaries.forEach(s => { map[s.consignment_order_item_id] = s; });
    return map;
  }, [summaries]);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    items.forEach(item => {
      const s = summaryMap[item.id];
      init[item.id] = s ? Math.max(0, item.quantity - s.received_quantity) : 0;
    });
    return init;
  });

  const handleSubmit = () => {
    const payload = items.map(item => ({
      consignment_order_item_id: item.id,
      received_quantity: quantities[item.id] || 0,
    })).filter(i => i.received_quantity > 0);
    if (payload.length === 0) {
      toast.warning('請輸入收貨數量');
      return;
    }
    receiveItemsMutation.mutate({ orderId: order.id, items: payload }, { onSuccess: onCancel });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>收貨（{order.code}）</DialogTitle>
          <DialogDescription>輸入實際收貨數量，將進入供應商寄賣倉。</DialogDescription>
        </DialogHeader>
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3 font-medium">商品</th>
                <th className="text-right py-2 px-3 font-medium w-16">訂量</th>
                <th className="text-right py-2 px-3 font-medium w-16">已收</th>
                <th className="text-right py-2 px-3 font-medium w-24">本次收貨</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const s = summaryMap[item.id];
                const received = s?.received_quantity ?? 0;
                const max = Math.max(0, item.quantity - received);
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 px-3">{item.product?.name || '-'}</td>
                    <td className="text-right py-2 px-3">{item.quantity}</td>
                    <td className="text-right py-2 px-3">{received}</td>
                    <td className="py-2 px-3">
                      <Input
                        type="number"
                        min={0}
                        max={max}
                        className="h-8 text-right text-xs"
                        value={quantities[item.id] ?? 0}
                        onChange={(e) => setQuantities(prev => ({
                          ...prev,
                          [item.id]: Math.min(Math.max(0, parseInt(e.target.value) || 0), max),
                        }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button className="bg-green-600 hover:bg-green-700" onClick={handleSubmit} disabled={receiveItemsMutation.isPending}>
            {receiveItemsMutation.isPending ? '處理中...' : '確認收貨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ 出貨 ============ */
interface ShipDialogProps {
  order: ConsignmentOrder;
  onCancel: () => void;
}

function ShipDialog({ order, onCancel }: ShipDialogProps) {
  const { shipMutation } = useConsignment();
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    shipMutation.mutate({ orderId: order.id, note }, { onSuccess: onCancel });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>出貨（{order.code}）</DialogTitle>
          <DialogDescription>
            將依剩餘數量出貨至店家並建立銷貨單，店家可透過收貨流程確認入庫。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>備註（選填）</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入出貨備註" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSubmit} disabled={shipMutation.isPending}>
            {shipMutation.isPending ? '處理中...' : '確認出貨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ 退回 ============ */
interface ReturnDialogProps {
  order: ConsignmentOrder;
  items: ConsignmentOrderItem[];
  summaries: ConsignmentOrderItemSummary[];
  onCancel: () => void;
}

function ReturnDialog({ order, items, summaries, onCancel }: ReturnDialogProps) {
  const { returnItemsMutation } = useConsignment();
  const isSupplier = order.direction === 'receive_from_supplier';
  const summaryMap = useMemo(() => {
    const map: Record<string, ConsignmentOrderItemSummary> = {};
    summaries.forEach(s => { map[s.consignment_order_item_id] = s; });
    return map;
  }, [summaries]);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    items.forEach(item => init[item.id] = 0);
    return init;
  });
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    const payload = items.map(item => ({
      consignment_order_item_id: item.id,
      quantity: quantities[item.id] || 0,
    })).filter(i => i.quantity > 0);
    if (payload.length === 0) {
      toast.warning('請輸入退回數量');
      return;
    }
    returnItemsMutation.mutate({ orderId: order.id, items: payload, note }, { onSuccess: onCancel });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>退回（{order.code}）</DialogTitle>
          <DialogDescription>
            {isSupplier ? '退回未銷售的寄賣商品給供應商。' : '退回店家未售出的寄賣商品。'}
          </DialogDescription>
        </DialogHeader>
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3 font-medium">商品</th>
                <th className="text-right py-2 px-3 font-medium w-20">可退回</th>
                <th className="text-right py-2 px-3 font-medium w-24">退回數量</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const s = summaryMap[item.id];
                const max = s?.remaining_quantity ?? 0;
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 px-3">{item.product?.name || '-'}</td>
                    <td className="text-right py-2 px-3">{max}</td>
                    <td className="py-2 px-3">
                      <Input
                        type="number"
                        min={0}
                        max={max}
                        className="h-8 text-right text-xs"
                        value={quantities[item.id] ?? 0}
                        onChange={(e) => setQuantities(prev => ({
                          ...prev,
                          [item.id]: Math.min(Math.max(0, parseInt(e.target.value) || 0), max),
                        }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <Label>備註（選填）</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入退回原因" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={handleSubmit} disabled={returnItemsMutation.isPending}>
            {returnItemsMutation.isPending ? '處理中...' : '確認退回'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ 結算 ============ */
interface SettleDialogProps {
  order: ConsignmentOrder;
  accounts: { id: string; name: string }[];
  expected: number;
  settled: number;
  onCancel: () => void;
}

function SettleDialog({ order, accounts, expected, settled, onCancel }: SettleDialogProps) {
  const { settleMutation } = useConsignment();
  const isSupplier = order.direction === 'receive_from_supplier';
  const [amount, setAmount] = useState<number>(expected);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    if (amount <= 0) {
      toast.warning('請輸入結算金額');
      return;
    }
    settleMutation.mutate(
      {
        orderId: order.id,
        settlementType: isSupplier ? 'supplier_payment' : 'store_receivable',
        amount,
        accountId: accountId || undefined,
        note,
      },
      { onSuccess: onCancel }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>結算（{order.code}）</DialogTitle>
          <DialogDescription>
            {isSupplier ? '結算應付供應商的寄賣貨款。' : '結算店家應收的寄賣貨款。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">應結算金額</span>
            <span className="font-medium">${expected.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">已結算金額</span>
            <span className="font-medium">${settled.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            <Label>本次結算金額</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>帳戶（選填）</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇帳戶" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>備註（選填）</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入結算備註" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={handleSubmit} disabled={settleMutation.isPending}>
            {settleMutation.isPending ? '處理中...' : '確認結算'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
