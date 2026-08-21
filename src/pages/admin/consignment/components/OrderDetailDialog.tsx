import { useMemo, useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import {
  ConsignmentOrder,
  ConsignmentOrderItem,
  ConsignmentOrderItemSummary,
  NewConsignmentItem,
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
  Pencil,
  RotateCcw,
  Plus,
  Trash2,
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

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
            {receiveItemsMutation.isPending ? '處理中…' : '確認收貨'}
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
            將依剩餘數量出貨至店家（店家寄賣，不開立銷貨單），店家確認收貨後即可回報銷售。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>備註（選填）</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入出貨備註" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSubmit} disabled={shipMutation.isPending}>
            {shipMutation.isPending ? '處理中…' : '確認出貨'}
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
            {returnItemsMutation.isPending ? '處理中…' : '確認退回'}
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
            <span className="font-medium">{formatCurrency(expected)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">已結算金額</span>
            <span className="font-medium">{formatCurrency(settled)}</span>
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
            {settleMutation.isPending ? '處理中…' : '確認結算'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ 回滾出貨 ============ */
interface ReverseDialogProps {
  order: ConsignmentOrder;
  onCancel: () => void;
}

function ReverseDialog({ order, onCancel }: ReverseDialogProps) {
  const { reverseShipmentMutation } = useConsignment();
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    reverseShipmentMutation.mutate({ orderId: order.id, note }, { onSuccess: onCancel });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>回滾出貨（{order.code}）</DialogTitle>
          <DialogDescription>
            將整單出貨回滾：扣回已出貨數量、品項放回出貨池，寄賣單退回草稿狀態，可重新編輯後再出貨。店家尚未確認收貨時才能執行。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>備註（選填）</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入回滾原因" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={reverseShipmentMutation.isPending}>
            {reverseShipmentMutation.isPending ? '處理中…' : '確認回滾出貨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ 編輯品項（draft） ============ */
interface EditItemsDialogProps {
  order: ConsignmentOrder;
  items: ConsignmentOrderItem[];
  onCancel: () => void;
}

interface EditLine {
  quantity: number;
  unit_price: number;
  unit_cost: number;
}

interface EditNewLine extends NewConsignmentItem {
  key: string;
}

function EditItemsDialog({ order, items, onCancel }: EditItemsDialogProps) {
  const { products, addItemMutation, removeItemMutation, updateItemMutation } = useConsignment();
  const isSupplier = order.direction === 'receive_from_supplier';
  const [saving, setSaving] = useState(false);

  const [edits, setEdits] = useState<Record<string, EditLine>>(() => {
    const init: Record<string, EditLine> = {};
    items.forEach(item => {
      init[item.id] = {
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
      };
    });
    return init;
  });

  const [newLines, setNewLines] = useState<EditNewLine[]>([]);

  const addLine = () => {
    setNewLines(prev => [...prev, { key: crypto.randomUUID(), product_id: '', variant_id: null, quantity: 1, unit_price: 0, unit_cost: 0 }]);
  };
  const removeLine = (key: string) => {
    setNewLines(prev => prev.filter(l => l.key !== key));
  };
  const updateLine = (key: string, patch: Partial<EditNewLine>) => {
    setNewLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  };
  const getVariants = (productId: string) => {
    return products.find((p) => p.id === productId)?.variants || [];
  };

  const handleSave = async () => {
    if (newLines.some(l => !l.product_id)) {
      toast.warning('新增品項需選擇商品');
      return;
    }
    const validNew = newLines.filter(l => l.product_id && l.quantity > 0);
    setSaving(true);
    try {
      for (const item of items) {
        const e = edits[item.id];
        if (!e) continue;
        const patch: Partial<{ quantity: number; unit_price: number; unit_cost: number }> = {};
        if (e.quantity !== item.quantity) patch.quantity = e.quantity;
        if (e.unit_price !== item.unit_price) patch.unit_price = e.unit_price;
        if (e.unit_cost !== item.unit_cost) patch.unit_cost = e.unit_cost;
        if (Object.keys(patch).length > 0) {
          await updateItemMutation.mutateAsync({ orderId: order.id, itemId: item.id, patch });
        }
      }
      for (const line of validNew) {
        await addItemMutation.mutateAsync({
          orderId: order.id,
          item: {
            product_id: line.product_id,
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_price: line.unit_price,
            unit_cost: line.unit_cost,
          },
        });
      }
      toast.success('品項已更新');
      onCancel();
    } catch {
      // 錯誤訊息已由 useSupabaseAction 統一顯示
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>編輯品項（{order.code}）</DialogTitle>
          <DialogDescription>
            修改既有品項的數量與價格，或新增/刪除品項。店家寄賣草稿將同步鏡像到來源訂單。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">商品</th>
                  <th className="text-right py-2 px-3 font-medium w-20">數量</th>
                  <th className="text-right py-2 px-3 font-medium w-28">
                    {isSupplier ? '成本價' : '出貨價'}
                  </th>
                  <th className="text-right py-2 px-3 font-medium w-28">
                    {isSupplier ? '建議售價' : '進貨成本'}
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const e = edits[item.id] || { quantity: item.quantity, unit_price: item.unit_price, unit_cost: item.unit_cost };
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-1.5 px-3">
                        <p className="font-medium">{item.product?.name || '-'}</p>
                        {item.variant?.name && (
                          <p className="text-xs text-muted-foreground">{item.variant.name}</p>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={1}
                          className="h-8 text-right text-xs"
                          value={e.quantity}
                          onChange={(ev) => setEdits(prev => ({
                            ...prev,
                            [item.id]: { ...e, quantity: Math.max(1, parseInt(ev.target.value) || 1) },
                          }))}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 text-right text-xs"
                          value={e.unit_price}
                          onChange={(ev) => setEdits(prev => ({
                            ...prev,
                            [item.id]: { ...e, unit_price: parseFloat(ev.target.value) || 0 },
                          }))}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-8 text-right text-xs"
                          value={e.unit_cost}
                          onChange={(ev) => setEdits(prev => ({
                            ...prev,
                            [item.id]: { ...e, unit_cost: parseFloat(ev.target.value) || 0 },
                          }))}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={removeItemMutation.isPending}
                          onClick={() => removeItemMutation.mutate(item.id)}
                          aria-label="刪除品項"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-muted-foreground italic">目前沒有品項</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>新增品項</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> 加入品項
              </Button>
            </div>
            {newLines.length > 0 && (
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 font-medium w-56">商品</th>
                      <th className="text-left py-2 px-3 font-medium w-28">規格</th>
                      <th className="text-right py-2 px-3 font-medium w-20">數量</th>
                      <th className="text-right py-2 px-3 font-medium w-28">
                        {isSupplier ? '成本價' : '出貨價'}
                      </th>
                      <th className="text-right py-2 px-3 font-medium w-28">
                        {isSupplier ? '建議售價' : '進貨成本'}
                      </th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newLines.map(line => (
                      <tr key={line.key} className="border-b last:border-0">
                        <td className="py-1.5 px-2">
                          <Select value={line.product_id} onValueChange={(v) => updateLine(line.key, { product_id: v, variant_id: null })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="選擇商品" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1.5 px-2">
                          {(() => {
                            const variants = getVariants(line.product_id);
                            if (!line.product_id) {
                              return <div className="px-1 text-xs text-muted-foreground">先選擇商品</div>;
                            }
                            if (variants.length === 0) {
                              return <div className="px-1 text-xs text-muted-foreground">無規格</div>;
                            }
                            return (
                              <Select
                                value={line.variant_id || ''}
                                onValueChange={(v) => updateLine(line.key, { variant_id: v })}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="選擇規格" />
                                </SelectTrigger>
                                <SelectContent>
                                  {variants.map((v) => (
                                    <SelectItem key={v.id} value={v.id}>{v.name || v.sku}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })()}
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            type="number"
                            min={1}
                            className="h-8 text-right text-xs"
                            value={line.quantity}
                            onChange={(ev) => updateLine(line.key, { quantity: parseInt(ev.target.value) || 0 })}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-8 text-right text-xs"
                            value={line.unit_cost}
                            onChange={(ev) => updateLine(line.key, { unit_cost: parseFloat(ev.target.value) || 0 })}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-8 text-right text-xs"
                            value={line.unit_price}
                            onChange={(ev) => updateLine(line.key, { unit_price: parseFloat(ev.target.value) || 0 })}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLine(line.key)} aria-label="刪除項目">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存變更'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
