// Currency Inbound Dialog
// src/pages/admin/accounting/components/currencyFifo/CurrencyInboundDialog.tsx

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SOURCE_TYPE_LABELS } from './currencyFifoTypes';

interface CurrencyInboundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  currency: string;
  onSubmit: (params: any) => void;
  isLoading: boolean;
}

export function CurrencyInboundDialog({ open, onOpenChange, accountId, currency, onSubmit, isLoading }: CurrencyInboundDialogProps) {
  const [amount, setAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [sourceType, setSourceType] = useState('sales');
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
          <DialogTitle>外幣入帳</DialogTitle>
          <DialogDescription>建立新的外幣批次（入帳）</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>金額 ({currency})</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如：1000" />
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
                <SelectItem value="sales">客戶外幣收款</SelectItem>
                <SelectItem value="transfer_in">轉帳轉入</SelectItem>
                <SelectItem value="initial">期初餘額</SelectItem>
                <SelectItem value="manual">人工調整</SelectItem>
                <SelectItem value="purchase_refund">採購取消退款</SelectItem>
                <SelectItem value="sales_refund">客戶退貨退款</SelectItem>
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
            {isLoading ? '處理中...' : '確認入帳'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}