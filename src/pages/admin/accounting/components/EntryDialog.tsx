import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { AccountingEntry, AccountingCategory, Account } from '../types';
import { EntryForm } from './EntryForm';

interface EntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: AccountingEntry | null;
  categories: AccountingCategory[];
  accounts: Account[];
  isLoading: boolean;
  onSubmit: (data: Partial<AccountingEntry>) => void;
}

export function EntryDialog({
  open,
  onOpenChange,
  entry,
  categories,
  accounts,
  isLoading,
  onSubmit,
}: EntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? '編輯收支記錄' : '新增收支記錄'}</DialogTitle>
          <DialogDescription>
            記錄店鋪的日常收入或支出明細，包含日期、類型、帳戶以及金額。
          </DialogDescription>
        </DialogHeader>
        <EntryForm
          entry={entry}
          categories={categories}
          accounts={accounts}
          isLoading={isLoading}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
