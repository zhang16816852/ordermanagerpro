import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useVariantWholesale } from '@/hooks/useVariantWholesale';
import { useRepStoreAssignments } from '@/hooks/useRepStoreAssignments';
import type { ProfitSummary } from '@/utils/grossProfit';

export interface BusinessProfitLineInput {
  productId?: string | null;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  /** order_items.unit_cost 快照（>0 時最優先，與 rep 既有口徑一致） */
  snapshotCost?: number | null;
  lineType?: string | null;
}

export interface BusinessProfitResult {
  profit: number;
  commission: number;
  repName: string | null;
  repCount: number;
  /** 成本為 0（無快照、無業務成本、無批發價）的品項數 */
  unknownCount: number;
  /** 上述未知成本品項的營業額（絕不視為 0 利潤，只標示「部分未知」） */
  unknownRevenue: number;
  /** 有營業額且成本完全未知的品項數（全部未知 → 顯示「成本未知」） */
  fullyUnknown: boolean;
}

/**
 * 以營業額（沿用毛利口徑：退貨列已以負數對沖）包裝業務利潤為 ProfitSummary。
 *
 * ⚠️ 成本／利潤口徑與 useRepCommission 及後端發放 RPC 一致：**退貨列貢獻 0**（calcForStore 略過），
 *    營業額則沿用毛利口徑含退貨負數。costAmount 為差額推導值，僅供顯示，不作為成本來源。
 *
 * ⚠️ 業務成本無法解析的品項**不可視為 0 利潤**：一律標為 `complete: false` 並帶
 *    `unknownRevenue`，讓 ProfitCell 顯示「成本未知／部分品項成本未知」警示。
 *    全站（訂單／銷貨單／門市銷貨單）共用此函式，避免各頁成本口徑漂移。
 */
export function businessProfitSummary(
  revenue: number,
  biz: BusinessProfitResult
): ProfitSummary {
  return {
    revenue,
    costAmount: revenue - biz.profit,
    knownRevenue: revenue - biz.unknownRevenue,
    profit: biz.profit,
    marginRate: revenue !== 0 ? biz.profit / revenue : null,
    unknownCount: biz.unknownCount,
    unknownRevenue: biz.unknownRevenue,
    complete: biz.unknownCount === 0,
  };
}

/** 業務利潤／估佣（供「非業務身分」檢視有業務門市的單據時顯示）。
 *
 * ⚠️ 成本口徑**刻意不變**，與 useRepCommission 及後端發放 RPC 一致：
 *   order_items.unit_cost 快照 → rep_product_costs（該業務設定） → 變體批發價。
 *   這裡**不使用**廠商對照／採購單成本——那是毛利口徑，兩者不可混用，
 *   否則同一張單的「業務利潤」會與業務本人看到的不一致。
 *
 * ⚠️ 多位業務分配同一家門市時，採 assigned_at 最早者為主（列表顯示「A 等 N 位」）。
 *   這是呈現上的取捨；實際佣金歸屬仍以後端 register_*_payout 為準。
 */
export function useBusinessProfitCalculator(repIds: string[]) {
  const { repByStore } = useRepStoreAssignments();
  const { wholesaleMap } = useVariantWholesale();

  const repIdKey = [...new Set(repIds)].sort().join(',');

  const { data: repCostRows = [] } = useQuery({
    queryKey: ['business-profit-rep-costs', repIdKey],
    queryFn: async () => {
      if (repIds.length === 0) return [];
      const { data, error } = await (supabase
        .from('rep_product_costs') as any)
        .select('rep_id, product_id, variant_id, cost')
        .in('rep_id', repIds);
      if (error) throw error;
      return (data || []) as {
        rep_id: string;
        product_id: string;
        variant_id: string | null;
        cost: number;
      }[];
    },
    enabled: repIds.length > 0,
  });

  const costByRep = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of repCostRows) {
      map.set(`${r.rep_id}|${r.product_id}|${r.variant_id ?? 'null'}`, Number(r.cost) || 0);
    }
    return map;
  }, [repCostRows]);

  /**
   * 品項層業務成本解析（與 calcForStore 同一優先序，供單據明細逐列顯示成本）。
   * 未知成本回傳 `costKnown: false` 且 `unitCost: null`——**不可回傳 0**。
   */
  const costOf = useMemo(() => {
    return (storeId: string | null | undefined, item: BusinessProfitLineInput): { unitCost: number | null; costKnown: boolean; source: string } => {
      const reps = storeId ? repByStore[storeId] : undefined;
      if (!reps || reps.length === 0) return { unitCost: null, costKnown: false, source: 'none' };
      const primary = reps[0];
      const snapshot = Number(item.snapshotCost) || 0;
      if (snapshot > 0) return { unitCost: snapshot, costKnown: true, source: 'snapshot' };
      if (item.productId) {
        const exact = costByRep.get(`${primary.rep_id}|${item.productId}|${item.variantId ?? 'null'}`);
        const productLevel = costByRep.get(`${primary.rep_id}|${item.productId}|null`);
        const repCost = exact ?? productLevel;
        if (repCost !== undefined && repCost > 0) {
          return { unitCost: repCost, costKnown: true, source: exact !== undefined ? 'rep_variant' : 'rep_product' };
        }
        if (item.variantId) {
          const wholesale = wholesaleMap.get(`${item.productId}|${item.variantId}`);
          if (wholesale !== undefined) return { unitCost: wholesale, costKnown: true, source: 'wholesale' };
        }
      }
      return { unitCost: null, costKnown: false, source: 'none' };
    };
  }, [repByStore, costByRep, wholesaleMap]);

  /** 單一門市的業務利潤／估佣；非業務門市回傳 null */
  const calcForStore = useMemo(() => {
    return (storeId: string | null | undefined, items: BusinessProfitLineInput[]): BusinessProfitResult | null => {
      const reps = storeId ? repByStore[storeId] : undefined;
      if (!reps || reps.length === 0) return null;
      const primary = reps[0];
      const rate = (Number(primary.commission_rate) || 0) / 100;

      let profit = 0;
      let unknownCount = 0;
      let unknownRevenue = 0;
      let lineCount = 0;
      for (const it of items) {
        if (it.lineType === 'return') continue;
        lineCount += 1;
        const resolved = costOf(storeId, it);
        const unitCost = resolved.unitCost ?? 0;
        const qty = Number(it.quantity) || 0;
        if (!resolved.costKnown) {
          unknownCount += 1;
          unknownRevenue += Math.abs(qty * (Number(it.unitPrice) || 0));
        }
        profit += ((Number(it.unitPrice) || 0) - unitCost) * qty;
      }

      return {
        profit,
        // 佣金下限 0：虧損不產生負佣金（與後端 max(0, ...) 一致）
        commission: Math.max(0, profit) * rate,
        repName: reps.length === 1 ? primary.rep_name : `${primary.rep_name} 等 ${reps.length} 位`,
        repCount: reps.length,
        unknownCount,
        unknownRevenue,
        // 全部有營業額的品項成本皆未知時不可顯示數字（等同毛利口徑的「成本未知」）
        fullyUnknown: lineCount > 0 && unknownCount === lineCount,
      };
    };
  }, [repByStore, costOf]);

  return { calcForStore, costOf };
}