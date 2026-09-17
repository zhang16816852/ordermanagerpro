import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { X, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/formatters';
import { EntryType } from '../types';
import { DOC_TYPE_LABELS } from './EntryFormTypes';
import { EntryFormController } from './useEntryFormController';
import { DocType } from './EntryFormTypes';

export function EntryDocListFields({ ctl }: { ctl: EntryFormController }) {
  const {
    accounts,
    accountId,
    setAccountId,
    allCategories,
    categoryId,
    setCategoryId,
    docItems,
    docTab,
    setDocTab,
    currentDocList,
    addDocItem,
    removeDocItem,
    updateDocAmount,
    totalAmount,
    autoType,
  } = ctl;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>帳戶</Label>
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
        {allCategories.length > 0 && (
          <div className="space-y-2">
            <Label>分類</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="選擇分類（選填）" /></SelectTrigger>
              <SelectContent>
                {allCategories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {cat.type === 'income' ? '收入' : '支出'}
                    </Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {docItems.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">自動判定：</span>
          <Badge variant={autoType === 'income' ? 'default' : 'destructive'}>
            {autoType === 'income' ? '收入' : '支出'}
          </Badge>
          <span className="text-sm font-bold" style={{ color: autoType === 'income' ? '#16a34a' : 'hsl(var(--destructive))' }}>
            {autoType === 'income' ? '+' : ''}{formatCurrency(totalAmount)}
          </span>
        </div>
      )}

      <div className="space-y-2">
        <Label>選擇單據</Label>
        <div className="flex gap-2">
          {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map(dt => (
            <Button
              key={dt}
              variant={docTab === dt ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDocTab(dt)}
            >
              {DOC_TYPE_LABELS[dt]}
            </Button>
          ))}
        </div>

        <div className="border rounded-md max-h-[180px] overflow-y-auto bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>單號</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>日期</TableHead>
                <TableHead className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentDocList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">無資料</TableCell>
                </TableRow>
              ) : (
                currentDocList.map(item => {
                  const alreadyAdded = docItems.some(d => d.docType === docTab && d.docId === item.id);
                  return (
                    <TableRow key={item.id} className={alreadyAdded ? 'opacity-40' : ''}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => addDocItem(item)}
                          disabled={alreadyAdded}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>
                      <TableCell className="text-sm line-clamp-1">{item.name}</TableCell>
                      <TableCell className="text-xs">{format(new Date(item.date), 'MM/dd')}</TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {docItems.length > 0 && (
        <div className="space-y-2">
          <Label>已加入單據（可調整金額）</Label>
          <div className="border rounded-md bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>類型</TableHead>
                  <TableHead>項目</TableHead>
                  <TableHead className="text-right w-[120px]">金額</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docItems.map((d, i) => (
                  <TableRow key={`${d.docType}-${d.docId}`}>
                    <TableCell><Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[d.docType]}</Badge></TableCell>
                    <TableCell className="text-sm">{d.code} {d.name}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={d.amountApplied}
                        onChange={e => updateDocAmount(i, e.target.value)}
                        className="h-8 text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => removeDocItem(i)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>合計</TableCell>
                  <TableCell className="text-right">
                    <span style={{ color: totalAmount >= 0 ? '#16a34a' : 'hsl(var(--destructive))' }}>
                      {totalAmount >= 0 ? '+' : ''}{formatCurrency(totalAmount)}
                    </span>
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}