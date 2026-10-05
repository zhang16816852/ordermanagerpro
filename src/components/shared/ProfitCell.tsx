import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { formatMarginRate, type ProfitSummary } from '@/utils/grossProfit';

export type ProfitMode = 'gross' | 'business';

export interface ProfitCellProps {
  summary: ProfitSummary;
  /** 'gross'＝毛利（無業務單據）；'business'＝業務利潤／估佣 */
  mode: ProfitMode;
  /** 業務模式下顯示佣金金額（估佣） */
  commission?: number | null;
  /** 業務模式下顯示負責業務姓名（多筆時為「A 等 N 位」） */
  repName?: string | null;
  /** 帶單價的表格欄位用 compact 模式（利潤／率 兩行） */
  compact?: boolean;
  className?: string;
}

/**
 * 利潤呈現元件——全站統一「毛利 vs 業務利潤」互斥顯示。
 *
 * 設計決策（不可混用）：
 *   - 有業務門市的單據 → 只顯示「業務利潤」與「估佣」（沿用 rep 既有計算），
 *     不再同時列出毛利，避免同一單出現兩套互相衝突的利潤數字。
 *   - 無業務門市的單據 → 只顯示「毛利」與「毛利率」（真實進貨成本口徑）。
 *   - 成本無法解析時顯示「成本未知」並標示警示，絕不以 0 代入。
 */
export function ProfitCell({
  summary,
  mode,
  commission,
  repName,
  compact = false,
  className,
}: ProfitCellProps) {
  const isBusiness = mode === 'business';
  const partial = !summary.complete;

  const title = partial
    ? `${summary.unknownCount} 個品項無進貨成本，${isBusiness ? '佣金' : '毛利'}僅含可計算部分（缺 ${summary.unknownRevenue.toLocaleString()} 營業額）`
    : undefined;

  if (partial && summary.knownRevenue === 0) {
    return (
      <div className={cn('flex items-center justify-end gap-1 text-xs text-muted-foreground', className)} title={title}>
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
        <span>成本未知</span>
      </div>
    );
  }

  return (
    <div className={cn('text-right leading-tight', className)} title={title}>
      {isBusiness ? (
        <>
          <div className="text-sm font-medium text-emerald-600">
            {formatCurrency(summary.profit)}
          </div>
          <div className="text-xs text-muted-foreground">
            估佣{' '}
            {commission === null || commission === undefined
              ? '—'
              : formatCurrency(commission)}
            {repName ? `・${repName}` : ''}
          </div>
        </>
      ) : (
        <>
          <div className={cn('text-sm font-medium', summary.profit >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {formatCurrency(summary.profit)}
          </div>
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            {partial && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="部分品項成本未知" />}
            <span>毛利率 {formatMarginRate(summary.marginRate)}</span>
          </div>
        </>
      )}
      {compact && partial && summary.knownRevenue > 0 && (
        <div className="text-[10px] text-amber-600">部分品項成本未知</div>
      )}
    </div>
  );
}