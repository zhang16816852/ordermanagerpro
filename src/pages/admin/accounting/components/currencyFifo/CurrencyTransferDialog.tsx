// Currency Transfer Dialog
// src/pages/admin/accounting/components/currencyFifo/CurrencyTransferDialog.tsx

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Account } from '../../types';

interface CurrencyTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromAccountId: string;
  toAccountId: string;
  fromCurrency: string;
  accounts: Account[];
  onSubmit: (params: any) => void;
  isLoading: boolean;
}

export function CurrencyTransferDialog({ open, onOpenChange, fromAccountId, toAccountId: initialToAccountId, fromCurrency, accounts, onSubmit, isLoading }: CurrencyTransferDialogProps) {
  const [amount, setAmount] = useState('');
  const [feeAmount, setFeeAmount] = useState('0');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 16));
  const [selectedToAccountId, setSelectedToAccountId] = useState(initialToAccountId);

  // Filter accounts with same currency, excluding source account
  const availableToAccounts = accounts.filter((a) => a.id !== fromAccountId && a.currency === fromCurrency);

  const handleSubmit = () => {
    if (!amount || !selectedToAccountId) return;
    onSubmit({
      fromAccountId,
      toAccountId: selectedToAccountId,
      amount: parseFloat(amount),
      feeAmount: parseFloat(feeAmount || '0'),
      transactionDate,
    });
    setAmount('');
    setFeeAmount('0');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>外幣轉帳</DialogTitle>
          <DialogDescription>將 {fromCurrency} 從來源帳戶轉到目標帳戶（FIFO 消耗）</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>轉入帳戶</Label>
            <Select value={selectedToAccountId} onValueChange={setSelectedToAccountId}>
              <SelectTrigger><SelectValue placeholder="選擇目標帳戶" /></SelectTrigger>
              <SelectContent>
                {availableToAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableToAccounts.length === 0 && (
              <p className="text-xs text-rose-500">無同幣別的其他帳戶可轉入</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>轉帳金額 ({fromCurrency})</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如：800" />
          </div>
          <div className="space-y-2">
            <Label>手續費 ({fromCurrency})</Label>
            <Input type="number" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="0" />
            <p className="text-xs text-muted-foreground">手續費為額外扣款（情境 B）</p>
          </div>
          <div className="space-y-2">
            <Label>交易日期</Label>
            <Input type="datetime-local" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
          </div>
          {amount && (
            <div className="text-sm text-muted-foreground space-y-1">
              <p>來源帳戶總扣款：{(parseFloat(amount) + parseFloat(feeAmount || '0')).toLocaleString()} {fromCurrency}</p>
              <p>目標帳戶收到：{parseFloat(amount).toLocaleString()} {fromCurrency}</p>
              <p>手續費：{parseFloat(feeAmount || '0').toLocaleString()} {fromCurrency}</p>
            </div>
          )}
          <Button onClick={handleSubmit} disabled={!amount || !selectedToAccountId || isLoading} className="w-full">
            {isLoading ? '處理中...' : '確認轉帳'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}