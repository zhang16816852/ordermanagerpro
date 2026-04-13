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
import { CreditCard, Edit, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { AccountingEntry, PaymentStatus } from '../types';

interface EntriesTabProps {
  entries: AccountingEntry[];
  isLoading: boolean;
  onEdit: (entry: AccountingEntry) => void;
  onDelete: (id: string) => void;
  onPay: (entry: AccountingEntry) => void;
}

export function EntriesTab({
  entries,
  isLoading,
  onEdit,
  onDelete,
  onPay,
}: EntriesTabProps) {
  const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-600 hover:bg-green-700">已付清</Badge>;
      case 'partial': return <Badge className="bg-amber-500 hover:bg-amber-600">部分付款</Badge>;
      case 'unpaid': return <Badge variant="destructive">未付</Badge>;
    }
  };

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

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>日期</TableHead>
            <TableHead>類型</TableHead>
            <TableHead>分類</TableHead>
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
              <TableCell>
                <Badge variant={entry.type === 'income' ? 'default' : 'secondary'}>
                  {entry.type === 'income' ? '收入' : '支出'}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{entry.category?.name || '-'}</TableCell>
              <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                {entry.description || '-'}
              </TableCell>
              <TableCell className={`text-right font-bold ${entry.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                {entry.type === 'income' ? '+' : '-'}${entry.amount.toLocaleString()}
              </TableCell>
              <TableCell className="text-right text-sm">
                ${entry.paid_amount.toLocaleString()}
              </TableCell>
              <TableCell>{getStatusBadge(entry.payment_status)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {entry.payment_status !== 'paid' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-blue-500"
                      onClick={() => onPay(entry)}
                      title="記錄付款"
                    >
                      <CreditCard className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onEdit(entry)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
