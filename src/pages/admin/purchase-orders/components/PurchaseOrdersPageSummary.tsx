import { formatCurrency } from '@/lib/formatters';

interface Props {
  count: number;
  total: number;
  paid: number;
  unpaid: number;
  unpaidCount: number;
  canSeePayments: boolean;
}

export function PurchaseOrdersPageSummary({ count, total, paid, unpaid, unpaidCount, canSeePayments }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs sm:text-sm leading-4">
      <span>採購單: <strong>{count}</strong> 張</span>
      <span className="text-muted-foreground">|</span>
      <span>總金額: <strong>{formatCurrency(total)}</strong></span>
      {canSeePayments && (
        <>
          <span className="text-muted-foreground">|</span>
          <span className="text-green-600">已付: <strong>{formatCurrency(paid)}</strong></span>
          <span className="text-muted-foreground">|</span>
          <span className="text-amber-600">
            未付: <strong>{formatCurrency(unpaid)}</strong>
            <span className="text-muted-foreground">（{unpaidCount} 張未付清）</span>
          </span>
        </>
      )}
    </div>
  );
}