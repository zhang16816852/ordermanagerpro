import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/formatters';
import { EntryFormController } from './useEntryFormController';

export function EntryPaymentModeFields({ ctl }: { ctl: EntryFormController }) {
  const { paymentEntry, accounts, accountId, setAccountId, paymentAmount, setPaymentAmount } = ctl;
  if (!paymentEntry) return null;
  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/20">
      <div>
        <Label>待付金額</Label>
        <p className="text-2xl font-bold">
          {formatCurrency(paymentEntry.amount - paymentEntry.paid_amount)}
        </p>
      </div>
      <div className="space-y-2">
        <Label>付款金額</Label>
        <Input
          type="number"
          value={paymentAmount}
          onChange={e => setPaymentAmount(e.target.value)}
          placeholder="輸入付款金額"
        />
      </div>
      <div className="space-y-2">
        <Label>付款帳戶</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger><SelectValue placeholder="選擇帳戶" /></SelectTrigger>
          <SelectContent>
            {accounts.map(acc => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}