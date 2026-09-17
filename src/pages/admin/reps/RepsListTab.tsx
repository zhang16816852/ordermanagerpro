import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Pencil } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import type { RepRecord, RepSummary } from '../repsTypes';

interface RepsListTabProps {
  filteredReps: RepRecord[];
  repsLoading: boolean;
  profileOf: (userId: string) => { id: string; email: string; full_name: string | null } | undefined;
  assignmentCount: (userId: string) => number;
  repCommissionSummary: RepSummary;
  repSearch: string;
  setRepSearch: (v: string) => void;
  onEditCommission: (r: RepRecord) => void;
  onViewCommission: (userId: string) => void;
}

export function RepsListTab({
  filteredReps,
  repsLoading,
  profileOf,
  assignmentCount,
  repCommissionSummary,
  repSearch,
  setRepSearch,
  onEditCommission,
  onViewCommission,
}: RepsListTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>業務帳號</CardTitle>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋姓名 / Email"
            className="pl-10"
            value={repSearch}
            onChange={(e) => setRepSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>佣金比例</TableHead>
              <TableHead>名下店家數</TableHead>
              <TableHead className="text-right">應發分潤</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repsLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">載入中…</TableCell></TableRow>
            ) : filteredReps.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">尚無業務帳號</TableCell></TableRow>
            ) : (
              filteredReps.map((r) => {
                const p = profileOf(r.user_id);
                const summary = repCommissionSummary[r.user_id];
                return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{p?.full_name || '—'}</TableCell>
                    <TableCell>{p?.email || r.user_id}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.commission_rate ?? 0}%</Badge>
                    </TableCell>
                    <TableCell>{assignmentCount(r.user_id)} 家</TableCell>
                    <TableCell className="text-right">
                      {summary ? (
                        <button
                          className="text-left hover:underline cursor-pointer"
                          onClick={() => onViewCommission(r.user_id)}
                        >
                          <div className="font-medium">{formatCurrency(summary.totalCommission)}</div>
                          <div className="text-xs text-muted-foreground">{summary.noteCount} 單</div>
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => onEditCommission(r)}>
                        <Pencil className="mr-2 h-4 w-4" />設定佣金
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-2">
          提示：業務身分需先在「店鋪管理 → 人員管理」將使用者設定為業務（system_role = rep），再於本站分配店家與佣金。
        </p>
      </CardContent>
    </Card>
  );
}