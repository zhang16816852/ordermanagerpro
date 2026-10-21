// Currency Opening Balance Dialog
// src/pages/admin/accounting/components/currencyFifo/CurrencyOpeningBalanceDialog.tsx

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface CurrencyOpeningBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  currency: string;
  onSubmit: (params: any) => void;
  isLoading: boolean;
}

export function CurrencyOpeningBalanceDialog({ open, onOpenChange, accountId, currency, onSubmit, isLoading }: CurrencyOpeningBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [sourceType, setSourceType] = useState('initial');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 16));

  const handleSubmit = () => {
    if (!amount || !exchangeRate) return;
    onSubmit({
      accountId,
      amount: parseFloat(amount),
      exchangeRate: parseFloat(exchangeRate),
      sourceType,
      transactionDate,
    });
    setAmount('');
    setExchangeRate('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>外幣期初導入</DialogTitle>
          <DialogDescription>導入外幣帳戶的期初餘額</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>期初金額 ({currency})</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如：5000" />
          </div>
          <div className="space-y-2">
            <Label>匯率 (TWD/{currency})</Label>
            <Input type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="如：4.5" />
          </div>
          <div className="space-y-2">
            <Label>來源類型</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="initial">期初餘額（有歷史資料）</SelectItem>
                <SelectItem value="initial_estimated">期初餘額（估計）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>交易日期</Label>
            <Input type="datetime-local" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
          </div>
          {amount && exchangeRate && (
            <div className="text-sm text-muted-foreground">
              台幣等值：{(parseFloat(amount) * parseFloat(exchangeRate)).toLocaleString()} TWD
            </div>
          )}
          <Button onClick={handleSubmit} disabled={!amount || !exchangeRate || isLoading} className="w-full">
            {isLoading ? '處理中...' : '確認導入'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}