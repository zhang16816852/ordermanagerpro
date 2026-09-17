import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentOrder } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { formatCurrency } from '@/lib/formatters';

interface SettleDialogProps {
  order: ConsignmentOrder;
  accounts: { id: string; name: string }[];
  expected: number;
  settled: number;
  onCancel: () => void;
}

export function SettleDialog({ order, accounts, expected, settled, onCancel }: SettleDialogProps) {
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