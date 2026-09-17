import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { EntryFormController } from './useEntryFormController';

export function EntryCommonFields({ ctl }: { ctl: EntryFormController }) {
  const {
    description,
    setDescription,
    transactionDate,
    setTransactionDate,
    dueDate,
    setDueDate,
    canSubmit,
    isLoading,
    isPaymentMode,
    isPayout,
    isShipping,
    isRepair,
    repairMode,
    entry,
    handleSubmit,
  } = ctl;

  return (
    <>
      <div className="space-y-2">
        <Label>說明</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="輸入說明" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>交易日期</Label>
          <Input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>到期日（選填）</Label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isLoading}
        >
          {isLoading
            ? '處理中...'
            : isPaymentMode
            ? '確認付款'
            : isPayout
            ? '確認發放'
            : isShipping
            ? '確認結帳'
            : isRepair
            ? (repairMode === 'income_repair' ? '確認維修收款' : repairMode === 'expense_part' ? '確認支付零件款' : '確認支付服務費')
            : entry
            ? '更新'
            : '新增'}
        </Button>
      </DialogFooter>
    </>
  );
}