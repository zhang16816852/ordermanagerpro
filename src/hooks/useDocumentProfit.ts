import { useMemo } from 'react';
import { useProductCostMap } from '@/hooks/useProductCost';
import {
  computeProfitLine,
  sumProfit,
  type ProfitLine,
  type ProfitSummary,
} from '@/utils/grossProfit';

export interface DocProfitInputItem {
  /** 單據內唯一的品項鍵（通常為 sales_note_item.id / order_item.id） */
  key: string;
  productId?: string | null;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  /** order_items.unit_cost 快照（>0 時最優先） */
  snapshotCost?: number | null;
  /** 打單性質；'return' 會在數量上以負數傳入，營業額與成本同為負自然對沖 */
  lineType?: string | null;
}

export interface DocumentProfit {
  byKey: Map<string, ProfitLine>;
  summary: ProfitSummary;
  /** 成本表載入中（此時 summary 全部為「未知」，避免閃爍顯示 0） */
  isLoading: boolean;
}

/**
 * 單據層利潤計算（銷貨單／訂單共用）。
 *
 * 成本優先序由 resolveUnitCost 決定：
 *   order_items.unit_cost 快照 → 廠商對照成本 → 最近採購單成本。
 *
 * ⚠️ 退貨列（line_type='return'）數量在呼叫端以負數傳入，
 *    自然使營業額與成本同為負、對沖掉退貨影響。
 */
export function useDocumentProfit(items: DocProfitInputItem[] | undefined): DocumentProfit {
  const { costOf, isLoading } = useProductCostMap();

  return useMemo(() => {
    const list = items || [];
    const lines = list.map((it) => computeProfitLine(it, costOf));
    return {
      byKey: new Map(list.map((it, idx) => [it.key, lines[idx]])),
      summary: sumProfit(lines),
      isLoading,
    };
  }, [items, costOf, isLoading]);
}