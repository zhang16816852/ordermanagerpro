import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountingEntry, Account } from '../types';

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: AccountingEntry | null;
  accounts: Account[];
  onSubmit: (data: { entryId: string; amount: number; accountId: string }) => void;
  isLoading: boolean;
}

export function PaymentDialog({
  open,
  onOpenChange,
  entry,
  accounts,
  onSubmit,
  isLoading,
}: PaymentDialogProps) {
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');

  // Initial balance when entry changes
  useEffect(() => {
    if (entry) {
      setAmount((entry.amount - entry.paid_amount).toString());
    }
  }, [entry]);

  const handleConfirm = () => {
    if (entry && amount && accountId) {
      onSubmit({
        entryId: entry.id,
        amount: parseFloat(amount),
        accountId: accountId,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>記錄付款</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>待付金額</Label>
            <p className="text-2xl font-bold">
              ${entry ? (entry.amount - entry.paid_amount).toLocaleString() : 0}
            </p>
          </div>
          <div className="space-y-2">
            <Label>付款金額</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="輸入付款金額"
            />
          </div>
          <div className="space-y-2">
            <Label>付款帳戶</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇帳戶" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} (${account.balance.toLocaleString()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={!amount || !accountId || isLoading}
          >
            {isLoading ? '處理中...' : '確認付款'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
