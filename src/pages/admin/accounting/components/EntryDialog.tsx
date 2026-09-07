import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { AccountingEntry, AccountingCategory, Account, AccountingEntryReference } from '../types';
import { EntryForm, EntryPrefill, PayoutSubmission, BatchPayoutSubmission, ShippingSettlementSubmission } from './EntryForm';

interface EntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: AccountingEntry | null;
  paymentEntry?: AccountingEntry | null;
  prefill?: EntryPrefill | null;
  categories: AccountingCategory[];
  accounts: Account[];
  isLoading: boolean;
  onSubmit: (data: Partial<AccountingEntry>, references?: AccountingEntryReference[]) => void;
  onRecordPayment?: (data: { entryId: string; amount: number; accountId: string }) => void;
  onPayoutSubmit?: (payload: PayoutSubmission) => void;
  onBatchPayoutSubmit?: (payload: BatchPayoutSubmission) => void;
  onShippingSettleSubmit?: (payload: ShippingSettlementSubmission) => void;
}

export function EntryDialog({
  open,
  onOpenChange,
  entry,
  paymentEntry,
  prefill,
  categories,
  accounts,
  isLoading,
  onSubmit,
  onRecordPayment,
  onPayoutSubmit,
  onBatchPayoutSubmit,
  onShippingSettleSubmit,
}: EntryDialogProps) {
  const title = paymentEntry ? '記錄付款' : entry ? '編輯收支記錄' : '新增收支記錄';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {paymentEntry
              ? '請輸入付款金額並選擇支付帳戶。'
              : '記錄店鋪的收入、支出、帳戶互轉、跨單結帳或佣金發放等明細。'}
          </DialogDescription>
        </DialogHeader>
        <EntryForm
          entry={entry || null}
          paymentEntry={paymentEntry || null}
          prefill={prefill || null}
          categories={categories}
          accounts={accounts}
          isLoading={isLoading}
          onSubmit={onSubmit}
          onRecordPayment={onRecordPayment}
          onPayoutSubmit={onPayoutSubmit}
          onBatchPayoutSubmit={onBatchPayoutSubmit}
          onShippingSettleSubmit={onShippingSettleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
