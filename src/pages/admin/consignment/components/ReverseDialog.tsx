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

interface ReverseDialogProps {
  order: ConsignmentOrder;
  onCancel: () => void;
}

export function ReverseDialog({ order, onCancel }: ReverseDialogProps) {
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