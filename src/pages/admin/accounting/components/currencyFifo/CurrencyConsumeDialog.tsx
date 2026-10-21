// Currency Consume Dialog
// src/pages/admin/accounting/components/currencyFifo/CurrencyConsumeDialog.tsx

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface CurrencyConsumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  currency: string;
  onSubmit: (params: any) => void;
  isLoading: boolean;
}

export function CurrencyConsumeDialog({ open, onOpenChange, accountId, currency, onSubmit, isLoading }: CurrencyConsumeDialogProps) {
  const [amount, setAmount] = useState('');
  const [sourceType, setSourceType] = useState('exchange');
  const [referenceId, setReferenceId] = useState('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 16));

  const handleSubmit = () => {
    if (!amount) return;
    onSubmit({
      accountId,
      amount: parseFloat(amount),
      sourceType,
      referenceId: referenceId || undefined,
      transactionDate,
    });
    setAmount('');
    setReferenceId('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>外幣消耗</DialogTitle>
          <DialogDescription>消耗外幣（FIFO 消耗）</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>金額 ({currency})</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如：800" />
          </div>
          <div className="space-y-2">
            <Label>消耗類型</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
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
            <Label>關聯單據 ID（選填）</Label>
            <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="space-y-2">
            <Label>交易日期</Label>
            <Input type="datetime-local" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
          </div>
          <Button onClick={handleSubmit} disabled={!amount || isLoading} className="w-full">
            {isLoading ? '處理中...' : '確認消耗'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}