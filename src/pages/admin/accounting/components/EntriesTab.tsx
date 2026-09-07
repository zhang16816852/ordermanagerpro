import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, Edit, Trash2, Eye, ArrowRight, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { AccountingEntry, EntryType, PaymentStatus, ENTRY_TYPE_LABELS } from '../types';
import { formatCurrency } from '@/lib/formatters';

interface EntriesTabProps {
  entries: AccountingEntry[];
  isLoading: boolean;
  onEdit: (entry: AccountingEntry) => void;
  onDelete: (entry: AccountingEntry) => void;
  onPay: (entry: AccountingEntry) => void;
  onViewReference?: (referenceType: string, referenceId: string) => void;
}

function getEntryTypeBadge(type: EntryType) {
  switch (type) {
    case 'income':
      return <Badge className="bg-green-600 hover:bg-green-700">收入</Badge>;
    case 'expense':
      return <Badge variant="destructive">支出</Badge>;
    case 'transfer':
      return <Badge className="bg-blue-600 hover:bg-blue-700">互轉</Badge>;
    case 'settlement':
      return <Badge className="bg-purple-600 hover:bg-purple-700">結帳</Badge>;
    case 'topup':
      return <Badge className="bg-amber-500 hover:bg-amber-600">儲值</Badge>;
    case 'currency_exchange':
      return <Badge className="bg-cyan-600 hover:bg-cyan-700">換匯</Badge>;
    default:
      return <Badge variant="secondary">{type}</Badge>;
  }
}

function getStatusBadge(status: PaymentStatus) {
  switch (status) {
    case 'paid': return <Badge className="bg-green-600 hover:bg-green-700">已付清</Badge>;
    case 'partial': return <Badge className="bg-amber-500 hover:bg-amber-600">部分付款</Badge>;
    case 'unpaid': return <Badge variant="destructive">未付</Badge>;
  }
}

function EntryDescription({ entry, onViewReference }: { entry: AccountingEntry; onViewReference?: (type: string, id: string) => void }) {
  const isTransfer = entry.type === 'transfer' || entry.type === 'currency_exchange' || entry.type === 'topup';

  if (isTransfer && entry.transferToAccount) {
    return (
      <div className="flex items-center gap-1 text-sm">
        <span className="font-medium">{entry.account?.name || '?'}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{entry.transferToAccount.name}</span>
        {entry.original_currency && entry.exchange_rate && (
          <span className="text-xs text-muted-foreground ml-1">
            ({entry.original_amount} {entry.original_currency} × {entry.exchange_rate})
          </span>
        )}
      </div>
    );
  }

  if (entry.references && entry.references.length > 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-sm">
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span>關聯 {entry.references.length} 筆單據</span>
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          {entry.references.slice(0, 5).map((ref, i) => (
            <div key={i} className="flex items-center gap-1">
              <span>{ref.item_name}</span>
              <span style={{ color: ref.amount_applied >= 0 ? '#16a34a' : 'hsl(var(--destructive))' }}>
                {ref.amount_applied >= 0 ? '+' : ''}{formatCurrency(ref.amount_applied)}
              </span>
              {onViewReference && ref.reference_id && (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => { e.stopPropagation(); onViewReference(ref.reference_type, ref.reference_id); }}
                  title="查看單據"
                >
                  <Eye className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {entry.references.length > 5 && <span>...等 {entry.references.length} 筆</span>}
        </div>
      </div>
    );
  }

  return (
    <span className="text-sm text-muted-foreground truncate block max-w-[200px]">
      {entry.description || '-'}
    </span>
  );
}

export function EntriesTab({
  entries,
  isLoading,
  onEdit,
  onDelete,
  onPay,
  onViewReference,
}: EntriesTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-muted/20 text-muted-foreground italic">
        本月沒有收支記錄
      </div>
    );
  }

  const getAmountDisplay = (entry: AccountingEntry) => {
    const isTransfer = entry.type === 'transfer' || entry.type === 'currency_exchange' || entry.type === 'topup';
    if (isTransfer) {
      return <span className="font-bold">{formatCurrency(entry.amount)}</span>;
    }
    return (
      <span className={`font-bold ${entry.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
        {entry.type === 'income' ? '+' : '-'}{formatCurrency(entry.amount)}
      </span>
    );
  };

  return (
    <>
      {/* Desktop: Table */}
      <div className="hidden md:block border rounded-md overflow-hidden bg-background">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>分類</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>說明</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead className="text-right">已付/已收</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-medium">{format(new Date(entry.transaction_date), 'MM/dd')}</TableCell>
                <TableCell>{getEntryTypeBadge(entry.type)}</TableCell>
                <TableCell className="text-sm">{entry.category?.name || '-'}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate" title={entry.counterparty_name || ''}>{entry.counterparty_name || '-'}</TableCell>
                <TableCell><EntryDescription entry={entry} onViewReference={onViewReference} /></TableCell>
                <TableCell className="text-right">{getAmountDisplay(entry)}</TableCell>
                <TableCell className="text-right text-sm">
                  {formatCurrency(entry.paid_amount)}
                </TableCell>
                <TableCell>{getStatusBadge(entry.payment_status)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {entry.reference_type && entry.reference_id && onViewReference && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onViewReference(entry.reference_type!, entry.reference_id!)}
                        aria-label="查看單據"
                        title="查看來源單據"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    {entry.payment_status !== 'paid' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-blue-500"
                        onClick={() => onPay(entry)}
                        aria-label="記錄付款"
                      >
                        <CreditCard className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onEdit(entry)}
                      aria-label="編輯"
                    >
                      <Edit className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => onDelete(entry)}
                      aria-label="刪除"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: Cards */}
      <div className="md:hidden space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="border rounded-lg p-4 bg-card shadow-soft space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{format(new Date(entry.transaction_date), 'MM/dd')}</span>
                {getEntryTypeBadge(entry.type)}
                {getStatusBadge(entry.payment_status)}
              </div>
              {getAmountDisplay(entry)}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{entry.category?.name || '-'}</span>
              {entry.counterparty_name && (
                <span className="text-muted-foreground ml-2">· {entry.counterparty_name}</span>
              )}
            </div>
            <EntryDescription entry={entry} onViewReference={onViewReference} />
            <div className="flex items-center gap-1 pt-1 border-t">
              {entry.reference_type && entry.reference_id && onViewReference && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onViewReference(entry.reference_type!, entry.reference_id!)}
                  aria-label="查看單據"
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {entry.payment_status !== 'paid' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-blue-500"
                  onClick={() => onPay(entry)}
                  aria-label="記錄付款"
                >
                  <CreditCard className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onEdit(entry)}
                aria-label="編輯"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => onDelete(entry)}
                aria-label="刪除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
