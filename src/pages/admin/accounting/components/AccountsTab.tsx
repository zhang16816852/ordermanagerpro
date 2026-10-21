import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, Building, Plus, ArrowLeft, FileText } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { format, subMonths } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Account, AccountingCategory, AccountingEntry, EntryType } from '../types';
import { formatCurrency } from '@/lib/formatters';
import { useAccountLedger, LedgerRow } from '../hooks/useAccountLedger';

interface AccountsTabProps {
  accounts: Account[];
  categories: AccountingCategory[];
  selectedMonth: string;
  onAdd: () => void;
  isLoading: boolean;
}

const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '互轉',
  settlement: '結帳',
  topup: '儲值',
  currency_exchange: '換匯',
};

function rowSignedAmount(row: LedgerRow, accountId: string): number {
  if (row.kind === 'movement') {
    return row.data.amount_change;
  }
  const entry = row.data;
  const isIncoming = entry.transfer_to_account_id === accountId && entry.account_id !== accountId;
  if (isIncoming) {
    if (entry.type === 'currency_exchange' && entry.exchange_rate && entry.original_amount) {
      return entry.original_amount * entry.exchange_rate;
    }
    return entry.amount;
  }
  if (entry.type === 'income') return entry.amount;
  return -entry.amount;
}

function rowDate(row: LedgerRow): string {
  return row.kind === 'entry' ? row.data.transaction_date : row.data.transaction_date;
}
function rowCreated(row: LedgerRow): string {
  return row.kind === 'entry' ? row.data.created_at : row.data.created_at;
}

export function AccountsTab({ accounts, categories, selectedMonth, onAdd, isLoading }: AccountsTabProps) {
  const [viewingAccountId, setViewingAccountId] = useState<string | null>(null);
  const [ledgerMonth, setLedgerMonth] = useState<string>(selectedMonth || 'all');

  const viewingAccount = accounts.find((a) => a.id === viewingAccountId) || null;
  const { data: ledgerRows = [], isLoading: isLoadingLedger } = useAccountLedger(viewingAccountId, ledgerMonth, categories, accounts);

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const date = subMonths(new Date(), i);
      return { value: format(date, 'yyyy-MM'), label: format(date, 'yyyy年MM月', { locale: zhTW }) };
    });
  }, []);

  // 累計（由舊到新）
  const runningMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!viewingAccountId) return map;
    const asc = [...ledgerRows].sort((a, b) => {
      const da = new Date(rowDate(a)).getTime();
      const db = new Date(rowDate(b)).getTime();
      if (da !== db) return da - db;
      return (a.kind === 'entry' ? a.data.id : a.data.id).localeCompare(b.kind === 'entry' ? b.data.id : b.data.id);
    });
    let acc = 0;
    for (const r of asc) {
      const key = r.kind === 'entry' ? `e-${r.data.id}` : `m-${r.data.id}`;
      acc += rowSignedAmount(r, viewingAccountId);
      map.set(key, acc);
    }
    return map;
  }, [ledgerRows, viewingAccountId]);

  const descRows = useMemo(() => {
    return [...ledgerRows].sort((a, b) => {
      const da = new Date(rowDate(b)).getTime();
      const db = new Date(rowDate(a)).getTime();
      if (da !== db) return da - db;
      return (b.kind === 'entry' ? b.data.id : b.data.id).localeCompare(a.kind === 'entry' ? a.data.id : a.data.id);
    });
  }, [ledgerRows]);

  if (viewingAccount) {
    const totalIn = ledgerRows.reduce((s, r) => {
      const v = rowSignedAmount(r, viewingAccount.id);
      return v > 0 ? s + v : s;
    }, 0);
    const totalOut = ledgerRows.reduce((s, r) => {
      const v = rowSignedAmount(r, viewingAccount.id);
      return v < 0 ? s + Math.abs(v) : s;
    }, 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewingAccountId(null)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回帳戶列表
          </Button>
          <h2 className="text-lg font-bold">帳戶進出記錄</h2>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{viewingAccount.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono">{viewingAccount.currency}</Badge>
              {viewingAccount.type === 'cash' ? (
                <Wallet className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Building className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(viewingAccount.balance, viewingAccount.currency)}</div>
            <p className="text-xs text-muted-foreground">
              {viewingAccount.type === 'cash' ? '現金' : '銀行帳戶'} ・ 進 {formatCurrency(totalIn, viewingAccount.currency)} / 出 {formatCurrency(totalOut, viewingAccount.currency)}
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground">月份</Label>
          <Select value={ledgerMonth} onValueChange={setLedgerMonth}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoadingLedger ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : descRows.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-muted/20 text-muted-foreground italic">
            此期間沒有進出記錄
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block border rounded-md overflow-hidden bg-background">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>來源</TableHead>
                    <TableHead>類型</TableHead>
                    <TableHead>分類</TableHead>
                    <TableHead>說明</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                    <TableHead className="text-right">台幣等值</TableHead>
                    <TableHead className="text-right">累計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {descRows.map((row) => {
                    const v = rowSignedAmount(row, viewingAccount.id);
                    const key = row.kind === 'entry' ? `e-${row.data.id}` : `m-${row.data.id}`;
                    return (
                      <TableRow key={key} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-medium">{format(new Date(rowDate(row)), 'MM/dd')}</TableCell>
                        <TableCell>
                          <Badge variant={row.kind === 'entry' ? 'default' : 'secondary'} className="text-xs">
                            {row.kind === 'entry' ? '收支' : '外幣FIFO'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.kind === 'entry' ? (
                            <Badge variant={row.data.type === 'income' ? 'default' : row.data.type === 'expense' ? 'destructive' : 'secondary'} className="text-xs">
                              {ENTRY_TYPE_LABELS[row.data.type]}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">{row.data.source_type}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.kind === 'entry' ? (row.data.category?.name || '-') : (row.data.reference_id ? row.data.reference_id.slice(0, 8) : '-')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {row.kind === 'entry' ? (row.data.description || row.data.counterparty_name || '-') : row.data.source_type}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${v >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                          {v >= 0 ? '+' : ''}{formatCurrency(v, viewingAccount.currency)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {row.kind === 'movement' ? formatCurrency(row.data.twd_equivalent, 'TWD') : '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatCurrency(runningMap.get(key) ?? 0, viewingAccount.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3">
              {descRows.map((row) => {
                const v = rowSignedAmount(row, viewingAccount.id);
                const key = row.kind === 'entry' ? `e-${row.data.id}` : `m-${row.data.id}`;
                return (
                  <div key={key} className="border rounded-lg p-4 bg-card shadow-soft space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{format(new Date(rowDate(row)), 'MM/dd')}</span>
                        <Badge variant="outline" className="text-xs">
                          {row.kind === 'entry' ? '收支' : '外幣FIFO'}
                        </Badge>
                      </div>
                      <span className={`font-bold ${v >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {v >= 0 ? '+' : ''}{formatCurrency(v, viewingAccount.currency)}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {row.kind === 'entry' ? (row.data.category?.name || '-') : row.data.source_type}
                    </div>
                    <div className="text-xs text-muted-foreground flex justify-between border-t pt-1">
                      <span>累計 {formatCurrency(runningMap.get(key) ?? 0, viewingAccount.currency)}</span>
                      <span>{row.kind === 'movement' ? `台幣 ${formatCurrency(row.data.twd_equivalent, 'TWD')}` : (row.data.payment_status === 'paid' ? '已付' : row.data.payment_status === 'partial' ? '部分' : '未付')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  const loading = isLoading;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">帳戶列表 ({accounts.length})</h2>
        <Button onClick={onAdd} size="sm">
          <Plus className="h-4 w-4 mr-2" /> 新增帳戶
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {isLoading ? (
          <p className="col-span-full text-center py-12 text-muted-foreground italic">載入中...</p>
        ) : accounts.map((account) => (
          <Card key={account.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{account.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono">{account.currency}</Badge>
                {account.type === 'cash' ? (
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Building className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(account.balance, account.currency)}</div>
              <p className="text-xs text-muted-foreground">
                {account.type === 'cash' ? '現金' : '銀行帳戶'}
              </p>
              <div className="mt-3">
                <Button variant="outline" size="sm" className="w-full" onClick={() => setViewingAccountId(account.id)}>
                  <FileText className="h-4 w-4 mr-1" /> 查看進出記錄
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {accounts.length === 0 && !isLoading && (
          <div className="col-span-full border-2 border-dashed rounded-lg p-12 text-center text-muted-foreground">
            尚未建立任何帳戶。
          </div>
        )}
      </div>
    </div>
  );
}