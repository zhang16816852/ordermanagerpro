import type { ResolvedProductCost } from '@/hooks/useProductCost';

export interface ProfitLineInput {
  productId?: string | null;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  /** order_items.unit_cost 快照（>0 時最優先） */
  snapshotCost?: number | null;
}

export interface ProfitLine {
  revenue: number;
  /** 已解析的單位成本；costKnown=false 時為 null（不可當 0） */
  cost: number | null;
  /** 已解析的總成本金額；含未知品項時僅為「已知部分」 */
  costAmount: number;
  /** 毛利 = revenue − costAmount；costKnown=false 時為 null */
  profit: number | null;
  /** 毛利率 0–1；costKnown=false 時為 null */
  marginRate: number | null;
  costKnown: boolean;
  costSource: ResolvedProductCost['source'] | 'snapshot' | null;
}

export interface ProfitSummary {
  revenue: number;
  /** 已知成本合計（僅計有成本的品項） */
  costAmount: number;
  /** 有成本品項的營業額合計；毛利率以此為分母（避免被未知品項稀釋） */
  knownRevenue: number;
  /** 利潤合計；unknownCount>0 時僅代表「已知部分」 */
  profit: number;
  marginRate: number | null;
  /** 成本未知的品項數（以「列」計） */
  unknownCount: number;
  /** 成本未知品項的營業額合計，用於提示被排除的金額 */
  unknownRevenue: number;
  /** 全部品項都有成本時為 true；為 false 時 profit 僅供參考 */
  complete: boolean;
}

export type CostLookup = (
  productId?: string | null,
  variantId?: string | null
) => ResolvedProductCost | undefined;

/**
 * 解析單一列的單位成本。
 *
 * 優先序：order_items.unit_cost 快照（>0）→ 廠商對照成本 → 採購單成本。
 * ⚠️ 刻意不 fallback 批發價（產品決策：毛利只用真實進貨成本）。
 * ⚠️ 取不到回 null，呼叫端必須顯示「成本未知」，不可當 0。
 */
export function resolveUnitCost(
  line: ProfitLineInput,
  lookup: CostLookup
): { cost: number | null; source: ResolvedProductCost['source'] | 'snapshot' | null } {
  const snapshot = Number(line.snapshotCost);
  if (Number.isFinite(snapshot) && snapshot > 0) return { cost: snapshot, source: 'snapshot' };
  const hit = lookup(line.productId, line.variantId);
  if (hit && Number.isFinite(hit.cost) && hit.cost > 0) return { cost: hit.cost, source: hit.source };
  return { cost: null, source: null };
}

export function computeProfitLine(line: ProfitLineInput, lookup: CostLookup): ProfitLine {
  const qty = Number(line.quantity) || 0;
  const unitPrice = Number(line.unitPrice) || 0;
  const revenue = qty * unitPrice;
  const { cost, source } = resolveUnitCost(line, lookup);
  const costKnown = cost !== null;
  const costAmount = costKnown ? qty * cost! : 0;

  return {
    revenue,
    cost,
    costAmount,
    profit: costKnown ? revenue - costAmount : null,
    marginRate: costKnown && revenue !== 0 ? (revenue - costAmount) / revenue : costKnown ? 0 : null,
    costKnown,
    costSource: source,
  };
}

export function sumProfit(lines: ProfitLine[]): ProfitSummary {
  let revenue = 0;
  let costAmount = 0;
  let knownRevenue = 0;
  let profit = 0;
  let unknownCount = 0;
  let unknownRevenue = 0;

  for (const l of lines) {
    revenue += l.revenue;
    costAmount += l.costAmount;
    if (l.costKnown) {
      knownRevenue += l.revenue;
      profit += l.profit!;
    } else {
      unknownCount += 1;
      unknownRevenue += l.revenue;
    }
  }

  return {
    revenue,
    costAmount,
    knownRevenue,
    profit,
    marginRate: knownRevenue !== 0 ? profit / knownRevenue : null,
    unknownCount,
    unknownRevenue,
    complete: unknownCount === 0,
  };
}

/** 毛利率格式化：null（成本未知）顯示為「—」，避免誤導為 0% */
export function formatMarginRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}