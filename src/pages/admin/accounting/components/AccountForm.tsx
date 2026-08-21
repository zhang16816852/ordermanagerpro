import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DialogFooter } from '@/components/ui/dialog';
import { Account } from '../types';

interface AccountFormProps {
  onSubmit: (data: Partial<Account>) => void;
  isLoading: boolean;
}

export function AccountForm({
  onSubmit,
  isLoading,
}: AccountFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('bank');
  const [balance, setBalance] = useState('0');
  const [description, setDescription] = useState('');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="account-name">帳戶名稱</Label>
        <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：玉山銀行" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-type">類型</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger id="account-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">現金</SelectItem>
            <SelectItem value="bank">銀行</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-balance">初始餘額</Label>
        <Input id="account-balance" type="number" value={balance} onChange={(e) => setBalance(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-description">備註</Label>
        <Textarea id="account-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({ name, type, balance: parseFloat(balance), description: description || null })}
          disabled={!name || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
