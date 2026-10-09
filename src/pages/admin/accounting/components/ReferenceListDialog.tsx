import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import { ViewableReference } from '../types';
import { formatCurrency } from '@/lib/formatters';

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  sales_note: '銷貨單',
  order: '訂單',
  purchase_order: '採購單',
  repair_order: '維修單',
  shipment: '運費包裹',
};

interface ReferenceListDialogProps {
  refs: ViewableReference[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenRef: (ref: ViewableReference) => void;
}

export function ReferenceListDialog({ refs, open, onOpenChange, onOpenRef }: ReferenceListDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>關聯單據</DialogTitle>
          <DialogDescription>共 {refs.length} 筆，點擊查看單據明細</DialogDescription>
        </DialogHeader>
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>類型</TableHead>
                <TableHead>單據</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead className="text-right">查看</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refs.map((ref, i) => (
                <TableRow
                  key={`${ref.reference_type}-${ref.reference_id}-${i}`}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => onOpenRef(ref)}
                >
                  <TableCell>
                    <Badge variant="outline">{REFERENCE_TYPE_LABELS[ref.reference_type] || ref.reference_type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm truncate max-w-[220px]">{ref.item_name || '-'}</TableCell>
                  <TableCell className="text-right text-sm">
                    {typeof ref.amount_applied === 'number' ? (
                      <span style={{ color: ref.amount_applied >= 0 ? '#16a34a' : 'hsl(var(--destructive))' }}>
                        {ref.amount_applied >= 0 ? '+' : ''}{formatCurrency(ref.amount_applied)}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="查看單據" title="查看單據">
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
