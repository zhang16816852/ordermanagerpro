import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentOrder } from '../types';
import { Button } from '@/components/ui/button';
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

interface ShipDialogProps {
  order: ConsignmentOrder;
  onCancel: () => void;
}

export function ShipDialog({ order, onCancel }: ShipDialogProps) {
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