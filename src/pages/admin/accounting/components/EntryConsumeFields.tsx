import { useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntryDocListFields } from './EntryDocListFields';
import { useEntryFormController } from './useEntryFormController';

export function EntryConsumeFields({ ctl }: { ctl: ReturnType<typeof useEntryFormController> }) {
  const foreignAccounts = ctl.accounts.filter((a) => a.currency !== 'TWD');

  useEffect(() => {
    if (ctl.docTab !== 'purchase_order') ctl.setDocTab('purchase_order');
  }, [ctl]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>外幣帳戶</Label>
          <Select value={ctl.accountId} onValueChange={ctl.setAccountId}>
            <SelectTrigger><SelectValue placeholder="選擇帳戶" /></SelectTrigger>
            <SelectContent>
              {foreignAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>金額</Label>
          <Input type="number" value={ctl.amount} onChange={(e) => ctl.setAmount(e.target.value)} placeholder="如：800" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>消耗類型</Label>
          <Select value={ctl.consumeSourceType} onValueChange={ctl.setConsumeSourceType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exchange">外幣換匯</SelectItem>
              <SelectItem value="purchase_payment">支付採購單</SelectItem>
              <SelectItem value="freight_payment">支付運費</SelectItem>
              <SelectItem value="transfer">外幣轉帳</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>交易日期</Label>
          <Input type="date" value={ctl.transactionDate} onChange={(e) => ctl.setTransactionDate(e.target.value)} />
        </div>
      </div>

      <EntryDocListFields ctl={ctl} />
    </div>
  );
}