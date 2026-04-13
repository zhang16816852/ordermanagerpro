import { useState } from 'react';
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
import { DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';

interface PaymentFormProps {
  accounts: any[];
  amount: number;
  onSubmit: (data: { accountId: string; amount: number; date: string }) => void;
  isLoading: boolean;
}

export function PaymentForm({
  accounts,
  amount: initialAmount,
  onSubmit,
  isLoading,
}: PaymentFormProps) {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(initialAmount.toString());
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>付款帳戶</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger>
            <SelectValue placeholder="選擇帳戶" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.name} (餘額: ${acc.balance.toLocaleString()})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>金額</Label>
        <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>付款日期</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({ accountId, amount: parseFloat(amount), date })}
          disabled={!accountId || !amount || isLoading}
        >
          {isLoading ? '處理中...' : '確認付款'}
        </Button>
      </DialogFooter>
    </div>
  );
}
