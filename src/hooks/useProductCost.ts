import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ProductCostSource = 'snapshot' | 'mapping' | 'purchase';

export interface ResolvedProductCost {
  cost: number;
  source: ProductCostSource;
  /** 該成本的依據日期（採購單收貨／下單日），mapping 為對照更新時間 */
  asOf?: string | null;
}

export type ProductCostMap = Map<string, ResolvedProductCost>;

export const costKey = (productId: string, variantId?: string | null) =>
  `${productId}|${variantId ?? 'null'}`;

/**
 * 真實進貨成本解析（唯讀，全站共用）。
 *
 * 刻意「只認真實進貨成本」，優先序：
 *   1. order_items.unit_cost 快照（由呼叫端以 snapshotCost 傳入，此 hook 不查）
 *   2. supplier_product_mappings.vendor_unit_cost（廠商對照單價）
 *   3. purchase_order_items.unit_cost（最近一筆已收貨的採購單成本）
 *
 * ⚠️ 刻意「不」fallback 到 product_variants.wholesale_price / products.unified_wholesale_price：
 *    批發價是售價基準不是進貨成本，混用會讓毛利率虛高。此為產品決策。
 *
 * ⚠️ 取不到成本時回傳 undefined（呼叫端必須顯示「成本未知」），
 *    絕不可當成 0 —— 0 會讓毛利看起來等於營業額，嚴重誤導。
 *
 * 變體層對照優先於產品層：產品層（internal_variant_id IS NULL）的對照成本
 * 會被該產品底下所有變體採用，變體層有值則以變體層為準。
 */
export function useProductCostMap() {
  const { data, isLoading } = useQuery({
    queryKey: ['product-costs'],
    queryFn: async () => {
      // 廠商對照（多筆時依 is_primary → updated_at 決定勝出者；
      // is_primary 欄位於批次③ 才加入，此處先以 updated_at/created_at 排序）
      const [mappingRes, poRes] = await Promise.all([
        (supabase as any)
          .from('supplier_product_mappings')
          .select('internal_product_id, internal_variant_id, vendor_unit_cost, updated_at, created_at')
          .not('vendor_unit_cost', 'is', null),
        // ⚠️ purchase_order_items 本身「沒有」received_date / order_date 欄位（日期在
        //    purchase_orders 上），選錯欄位會讓 PostgREST 直接回 42703 使整個 cost map 失敗。
        // ⚠️ 必須 inner join purchase_orders 並排除 purpose='purchase_return'：
        //    退貨單品項的 quantity 是負數但帶著真實 unit_cost（見 20261004000002 migration），
        //    若不排除，退貨單（order_date 很新）會贏得「最近一筆成本」而污染毛利。
        (supabase as any)
          .from('purchase_order_items')
          .select(
            'product_id, variant_id, unit_cost, created_at, purchase_orders!inner(purpose, order_date, received_date)',
          )
          .neq('purchase_orders.purpose', 'purchase_return')
          .not('unit_cost', 'is', null)
          .limit(5000),
      ]);
      if (mappingRes.error) throw mappingRes.error;
      if (poRes.error) throw poRes.error;

      const mappings = (mappingRes.data || []) as {
        internal_product_id: string;
        internal_variant_id: string | null;
        vendor_unit_cost: number | string | null;
        updated_at: string | null;
        created_at: string | null;
      }[];
      const pois = (poRes.data || []) as {
        product_id: string;
        variant_id: string | null;
        unit_cost: number | string | null;
        created_at: string | null;
        purchase_orders: {
          purpose: string | null;
          order_date: string | null;
          received_date: string | null;
        } | null;
      }[];

      const map: ProductCostMap = new Map();

      // 同一組 (product, variant) 可能有多筆對照（批次③ 支援一碼多目標後會更常見），
      // 以 updated_at / created_at 遞減排序，先寫入者勝出＝最新那筆。
      const mappingRows = [...mappings].sort((a, b) => {
        const at = a.updated_at || a.created_at || '';
        const bt = b.updated_at || b.created_at || '';
        return bt.localeCompare(at);
      });
      for (const m of mappingRows) {
        const cost = Number(m.vendor_unit_cost);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        const key = costKey(m.internal_product_id, m.internal_variant_id);
        if (map.has(key)) continue;
        map.set(key, { cost, source: 'mapping', asOf: m.updated_at || m.created_at });
      }
      // 註：產品層（internal_variant_id IS NULL）的對照成本會被其底下所有變體採用，
      // 變體層有值則以變體層為準 —— 這個回退由 costOf() 處理

      // PO 成本（同組多筆時取最近一筆；對照已寫入的 key 不覆蓋 → 對照優先於 PO）
      // 日期基準改用 purchase_orders 的 received_date／order_date（item 表本身沒有日期欄）
      const poAsOf = (p: (typeof pois)[number]): string =>
        p.purchase_orders?.received_date || p.purchase_orders?.order_date || p.created_at || '';
      const poRows = [...pois].sort((a, b) => poAsOf(b).localeCompare(poAsOf(a)));
      for (const p of poRows) {
        const cost = Number(p.unit_cost);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        const key = costKey(p.product_id, p.variant_id);
        if (map.has(key)) continue;
        map.set(key, {
          cost,
          source: 'purchase',
          asOf: poAsOf(p),
        });
      }

      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  /** 查單一產品／變體的成本：變體層 → 產品層 → undefined（未知） */
  const costOf = useMemo(() => {
    return (productId?: string | null, variantId?: string | null): ResolvedProductCost | undefined => {
      if (!productId) return undefined;
      if (variantId) {
        const hit = data?.get(costKey(productId, variantId));
        if (hit) return hit;
      }
      return data?.get(costKey(productId, null));
    };
  }, [data]);

  return { costMap: data, costOf, isLoading };
}