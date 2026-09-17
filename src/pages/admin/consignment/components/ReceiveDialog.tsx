import { useMemo, useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentOrder, ConsignmentOrderItem, ConsignmentOrderItemSummary } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ReceiveDialogProps {
  order: ConsignmentOrder;
  items: ConsignmentOrderItem[];
  summaries: ConsignmentOrderItemSummary[];
  onCancel: () => void;
}

export function ReceiveDialog({ order, items, summaries, onCancel }: ReceiveDialogProps) {
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