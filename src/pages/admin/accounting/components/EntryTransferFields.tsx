import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CURRENCY_OPTIONS } from '../types';
import { formatCurrency } from '@/lib/formatters';
import { EntryFormController } from './useEntryFormController';

export function EntryTransferFields({ ctl }: { ctl: EntryFormController }) {
  const {
    accounts,
    accountId,
    setAccountId,
    transferToAccountId,
    setTransferToAccountId,
    sourceCurrency,
    destCurrency,
    originalCurrency,
    setOriginalCurrency,
    originalAmount,
    setOriginalAmount,
    exchangeRate,
    setExchangeRate,
    amount,
    setAmount,
  } = ctl;
  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/20">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>來源帳戶</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="選擇來源帳戶" /></SelectTrigger>
            <SelectContent>
              {accounts.map(acc => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {accountId && <p className="text-xs text-muted-foreground">幣別：{sourceCurrency}</p>}
        </div>
        <div className="space-y-2">
          <Label>目的地帳戶</Label>
          <Select value={transferToAccountId} onValueChange={setTransferToAccountId}>
            <SelectTrigger><SelectValue placeholder="選擇目的地帳戶" /></SelectTrigger>
            <SelectContent>
              {accounts.filter(a => a.id !== accountId).map(acc => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {transferToAccountId && <p className="text-xs text-muted-foreground">幣別：{destCurrency}</p>}
        </div>
      </div>

      {accountId && transferToAccountId && sourceCurrency !== destCurrency && (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>原始幣別</Label>
            <Select value={originalCurrency} onValueChange={setOriginalCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>原始金額</Label>
            <Input type="number" value={originalAmount} onChange={e => setOriginalAmount(e.target.value)} placeholder="轉換前金額" />
          </div>
          <div className="space-y-2">
            <Label>匯率（1 {originalCurrency || sourceCurrency} = ? {destCurrency}）</Label>
            <Input type="number" step="0.0001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} placeholder="匯率" />
          </div>
        </div>
      )}

      {accountId && transferToAccountId && sourceCurrency === destCurrency && (
        <div className="space-y-2">
          <Label>金額</Label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="輸入轉帳金額" />
          <p className="text-xs text-muted-foreground">同幣別轉帳，無需匯率</p>
        </div>
      )}

      {accountId && transferToAccountId && sourceCurrency !== destCurrency && exchangeRate && originalAmount && (
        <div className="p-3 bg-background rounded-md border">
          <p className="text-sm text-muted-foreground">換算結果</p>
          <p className="text-lg font-bold">
            {originalAmount} {originalCurrency || sourceCurrency} × {exchangeRate} = {amount} {destCurrency}
          </p>
        </div>
      )}
    </div>
  );
}