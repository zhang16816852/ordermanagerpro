import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type RepCostMap = Record<string, number>;

/**
 * 業務佣金換算工具。
 * 佣金 = (售價 - 業務成本) × commission_rate / 100
 * 供業務身分在儀表板、訂單/銷貨單列表與詳情顯示利潤與佣金。
 */
export function useRepCommission() {
  const { user, isRep, commissionRate } = useAuth();

  const { data: costRows = [] } = useQuery({
    queryKey: ['rep-commission-costs', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase
        .from('rep_product_costs') as any)
        .select('product_id, variant_id, cost')
        .eq('rep_id', user.id);
      if (error) throw error;
      return (data || []) as { product_id: string; variant_id: string | null; cost: number }[];
    },
    enabled: isRep && !!user,
  });

  const costMap = useMemo<RepCostMap>(() => {
    const map: RepCostMap = {};
    for (const row of costRows) {
      map[`${row.product_id}|${row.variant_id ?? 'null'}`] = Number(row.cost) || 0;
    }
    return map;
  }, [costRows]);

  const rate = isRep ? (Number(commissionRate) || 0) / 100 : 0;

  /** 取得單品成本 */
  function getItemCost(productId: string, variantId?: string | null): number {
    if (!isRep) return 0;
    const exact = costMap[`${productId}|${variantId ?? 'null'}`];
    if (exact !== undefined) return exact;
    const productLevel = costMap[`${productId}|null`];
    return productLevel !== undefined ? productLevel : 0;
  }

  /** 計算單一明細的利潤與佣金 */
  function computeLine(item: {
    productId: string;
    variantId?: string | null;
    unitPrice: number;
    quantity: number;
  }) {
    const unitCost = getItemCost(item.productId, item.variantId);
    const unitProfit = (Number(item.unitPrice) || 0) - unitCost;
    const qty = Number(item.quantity) || 0;
    return {
      unitCost,
      unitProfit,
      profit: unitProfit * qty,
      commission: unitProfit * qty * rate,
    };
  }

  /** 計算整單（多明細）的利潤與佣金 */
  function computeOrder(items: {
    productId: string;
    variantId?: string | null;
    unitPrice: number;
    quantity: number;
  }[]) {
    if (!isRep) return { totalProfit: 0, totalCommission: 0, lines: [] };
    const lines = items.map(computeLine);
    const totalProfit = lines.reduce((s, l) => s + l.profit, 0);
    const totalCommission = lines.reduce((s, l) => s + l.commission, 0);
    return { totalProfit, totalCommission, lines };
  }

  return { isRep, commissionRate: Number(commissionRate) || 0, getItemCost, computeLine, computeOrder };
}
