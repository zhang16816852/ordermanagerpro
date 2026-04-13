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
import { AccountingCategory } from '../types';

interface CategoryFormProps {
  onSubmit: (data: Partial<AccountingCategory>) => void;
  isLoading: boolean;
}

export function CategoryForm({
  onSubmit,
  isLoading,
}: CategoryFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>類型名稱</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：運費" />
      </div>
      <div className="space-y-2">
        <Label>收支類型</Label>
        <Select value={type} onValueChange={(v: 'income' | 'expense') => setType(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">收入</SelectItem>
            <SelectItem value="expense">支出</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({ name, type })}
          disabled={!name || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
