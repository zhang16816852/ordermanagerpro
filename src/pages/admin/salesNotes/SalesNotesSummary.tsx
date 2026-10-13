import { formatCurrency } from "@/lib/formatters";
import type { RepSalesSummary } from "./salesNotesTypes";

interface SalesNotesSummaryProps {
  viewMode: "notes" | "product";
  productCount: number;
  productTotalQty: number;
  productTotalAmount: number;
  totalCount: number;
  unreceivedCount: number;
  receivedCount: number;
  totalAmount: number;
  repSummary: RepSalesSummary | null;
}

export function SalesNotesSummary({
  viewMode,
  productCount,
  productTotalQty,
  productTotalAmount,
  totalCount,
  unreceivedCount,
  receivedCount,
  totalAmount,
  repSummary,
}: SalesNotesSummaryProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 shrink-0 text-xs sm:text-sm leading-4">
      {viewMode === "product" ? (
        <>
          <span>商品: <strong>{productCount}</strong></span>
          <span className="text-muted-foreground">|</span>
          <span>總件數: <strong>{productTotalQty}</strong></span>
          <span className="text-muted-foreground">|</span>
          <span>金額總計: <strong>{formatCurrency(productTotalAmount)}</strong></span>
        </>
      ) : (
        <>
          <span>全部: <strong>{totalCount}</strong> 張</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-amber-600">未收款: <strong>{unreceivedCount}</strong></span>
          <span className="text-muted-foreground">|</span>
          <span className="text-green-600">已收款: <strong>{receivedCount}</strong></span>
          <span className="text-muted-foreground">|</span>
          <span>金額總計: <strong>{formatCurrency(totalAmount)}</strong></span>
          {repSummary && (
            <>
              <span className="text-muted-foreground">|</span>
              <span className="text-emerald-600">業務利潤: <strong>{formatCurrency(repSummary.totalProfit)}</strong></span>
              <span className="text-muted-foreground">|</span>
              <span className="text-amber-600">估佣: <strong>{formatCurrency(repSummary.totalCommission)}</strong></span>
            </>
          )}
        </>
      )}
    </div>
  );
}
