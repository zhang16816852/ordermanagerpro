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
import { AccountingCategory, EntryType, ENTRY_TYPE_LABELS } from '../types';

interface CategoryFormProps {
  onSubmit: (data: Partial<AccountingCategory>) => void;
  isLoading: boolean;
}

const CATEGORY_TYPE_OPTIONS: EntryType[] = ['income', 'expense', 'transfer', 'settlement', 'topup', 'currency_exchange'];

export function CategoryForm({
  onSubmit,
  isLoading,
}: CategoryFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<EntryType>('expense');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="category-name">類型名稱</Label>
        <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：運費" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="category-type">分類類型</Label>
        <Select value={type} onValueChange={(v: EntryType) => setType(v)}>
          <SelectTrigger id="category-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_TYPE_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>{ENTRY_TYPE_LABELS[t]}</SelectItem>
            ))}
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
