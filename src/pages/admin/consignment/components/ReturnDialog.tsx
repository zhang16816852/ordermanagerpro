import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentOrder, ConsignmentOrderItem, ConsignmentOrderItemSummary } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ReturnDialogProps {
  order: ConsignmentOrder;
  items: ConsignmentOrderItem[];
  summaries: ConsignmentOrderItemSummary[];
  onCancel: () => void;
}

export function ReturnDialog({ order, items, summaries, onCancel }: ReturnDialogProps) {
  const { returnItemsMutation } = useConsignment();
  const isSupplier = order.direction === 'receive_from_supplier';
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    items.forEach(item => init[item.id] = 0);
    return init;
  });
  const [note, setNote] = useState('');

  const summaryMap: Record<string, ConsignmentOrderItemSummary> = {};
  summaries.forEach(s => { summaryMap[s.consignment_order_item_id] = s; });

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