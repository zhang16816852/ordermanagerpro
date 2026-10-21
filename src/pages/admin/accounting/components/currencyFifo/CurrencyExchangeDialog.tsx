// Currency Exchange Dialog
// src/pages/admin/accounting/components/currencyFifo/CurrencyExchangeDialog.tsx

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

interface CurrencyExchangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromAccountId: string;
  toAccountId: string;
  fromCurrency: string;
  onSubmit: (params: any) => void;
  isLoading: boolean;
}

export function CurrencyExchangeDialog({ open, onOpenChange, fromAccountId, toAccountId, fromCurrency, onSubmit, isLoading }: CurrencyExchangeDialogProps) {
  const [amount, setAmount] = useState('');
  const [twdGrossReceived, setTwdGrossReceived] = useState('');
  const [bankFee, setBankFee] = useState('0');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 16));

  const netReceived = twdGrossReceived ? parseFloat(twdGrossReceived) - parseFloat(bankFee || '0') : 0;
  const fifoCost = amount ? parseFloat(amount) * 4.5 : 0; // placeholder rate
  const gainLoss = netReceived - fifoCost;

  const handleSubmit = () => {
    if (!amount || !twdGrossReceived) return;
    onSubmit({
      fromAccountId,
      toAccountId,
      amount: parseFloat(amount),
      twdGrossReceived: parseFloat(twdGrossReceived),
      bankFee: parseFloat(bankFee || '0'),
      transactionDate,
    });
    setAmount('');
    setTwdGrossReceived('');
    setBankFee('0');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>外幣換匯</DialogTitle>
          <DialogDescription>將 {fromCurrency} 換為 TWD（FIFO 消耗）</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>換匯金額 ({fromCurrency})</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如：800" />
          </div>
          <div className="space-y-2">
            <Label>台幣毛額收入 (TWD)</Label>
            <Input type="number" value={twdGrossReceived} onChange={(e) => setTwdGrossReceived(e.target.value)} placeholder="如：3530" />
          </div>
          <div className="space-y-2">
            <Label>銀行手續費 (TWD)</Label>
            <Input type="number" value={bankFee} onChange={(e) => setBankFee(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-2">
            <Label>交易日期</Label>
            <Input type="datetime-local" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
          </div>

          {/* Preview */}
          {amount && twdGrossReceived && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">台幣淨收款</span>
                  <span className="font-medium">{netReceived.toLocaleString()} TWD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">FIFO 歷史成本</span>
                  <span className="font-medium">{fifoCost.toLocaleString()} TWD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">匯兌損益</span>
                  <span className={`font-bold ${gainLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {gainLoss >= 0 ? '+' : ''}{gainLoss.toLocaleString()} TWD
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <Button onClick={handleSubmit} disabled={!amount || !twdGrossReceived || isLoading} className="w-full">
            {isLoading ? '處理中...' : '確認換匯'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}