import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/formatters';
import { EntryFormController } from './useEntryFormController';

export function EntryPayoutFields({ ctl }: { ctl: EntryFormController }) {
  const {
    payoutReps,
    payoutRepId,
    setPayoutRepId,
    setSelectedPayoutNoteIds,
    payoutNotes,
    selectedPayoutNoteIds,
    togglePayoutNote,
    toggleAllPayoutNotes,
    selectedPayoutTotal,
    accounts,
    accountId,
    setAccountId,
    payoutCategories,
    categoryId,
    setCategoryId,
  } = ctl;

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/20">
      <div className="space-y-2">
        <Label>業務</Label>
        <Select value={payoutRepId} onValueChange={v => { setPayoutRepId(v); setSelectedPayoutNoteIds([]); }}>
          <SelectTrigger><SelectValue placeholder="選擇業務" /></SelectTrigger>
          <SelectContent>
            {payoutReps.map(r => (
              <SelectItem key={r.user_id} value={r.user_id}>
                {r.full_name || r.email || r.user_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {payoutReps.length === 0 && (
          <p className="text-xs text-muted-foreground">尚無業務身分使用者</p>
        )}
      </div>

      {payoutRepId && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>選擇待發放銷貨單（佣金由系統計算，可複選批次發放）</Label>
              {payoutNotes.length > 0 && (
                <Button variant="ghost" size="sm" onClick={toggleAllPayoutNotes}>
                  全選 / 取消全選
                </Button>
              )}
            </div>
            <div className="border rounded-md max-h-[240px] overflow-y-auto bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>單號</TableHead>
                    <TableHead>店鋪</TableHead>
                    <TableHead>出貨日期</TableHead>
                    <TableHead className="text-right">佣金</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payoutNotes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                        無待發放銷貨單
                      </TableCell>
                    </TableRow>
                  ) : (
                    payoutNotes.map(note => (
                      <TableRow
                        key={note.id}
                        className={`cursor-pointer ${selectedPayoutNoteIds.includes(note.id) ? 'bg-muted' : 'hover:bg-muted/50'}`}
                        onClick={() => togglePayoutNote(note.id)}
                      >
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedPayoutNoteIds.includes(note.id)}
                            onCheckedChange={() => togglePayoutNote(note.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{note.code}</TableCell>
                        <TableCell className="text-sm">{note.storeName}</TableCell>
                        <TableCell className="text-xs">
                          {note.shippedAt ? format(new Date(note.shippedAt), 'MM/dd') : '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(note.commission)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {selectedPayoutNoteIds.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-md border bg-background">
              <span className="text-sm text-muted-foreground">
                已選 {selectedPayoutNoteIds.length} 筆發放金額（系統計算，不可更改）：
              </span>
              <span className="font-bold">{formatCurrency(selectedPayoutTotal)}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label>付款帳戶</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="選擇帳戶" /></SelectTrigger>
              <SelectContent>
                {accounts.map(acc => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>分類（選填）</Label>
            <Select value={categoryId || ''} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="選擇分類" /></SelectTrigger>
              <SelectContent>
                {payoutCategories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}