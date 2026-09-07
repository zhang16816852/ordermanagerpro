import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type WholesaleRow = { product_id: string; variant_id: string; wholesale_price: number };

/**
 * 進貨成本（變體批發價）查詢。
 * 業務成本未設定時的預設 fallback：成本 = rep_product_costs → 進貨成本。
 */
export function useVariantWholesale() {
  const { data = [], ...rest } = useQuery<WholesaleRow[]>({
    queryKey: ['variant-wholesale-prices'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('product_variants') as any)
        .select('id, product_id, wholesale_price')
        .neq('status', 'discontinued');
      if (error) throw error;
      return ((data as any[]) || []).map(v => ({
        product_id: v.product_id,
        variant_id: v.id,
        wholesale_price: Number(v.wholesale_price) || 0,
      }));
    },
  });

  const wholesaleMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data) {
      map.set(`${row.product_id}|${row.variant_id}`, row.wholesale_price);
    }
    return map;
  }, [data]);

  return { data, wholesaleMap, ...rest };
}