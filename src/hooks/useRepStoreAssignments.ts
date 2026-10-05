import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RepStoreAssignment {
  store_id: string;
  rep_id: string;
  rep_name: string;
  /** 業務分潤比例（百分比，來自 user_roles.commission_rate） */
  commission_rate: number;
  assigned_at: string | null;
}

/**
 * 後台用：列出所有「門市 ↔ 業務」分配，用來判定單據屬於有業務／無業務。
 *
 * 為什麼以 rep_store_assignments 判定「有業務」而不是 orders.sales_rep_id：
 *   佣金實際歸屬機制是「依店家分配自動歸屬」（見 AGENTS.md），且實測
 *   orders.sales_rep_id 全站 0 筆有值、rep_store_assignments 有 9 家門市，
 *   故以店家分配為準才與佣金計算一致。
 *
 * 同一門市可能有多位業務（schema 允許），回傳全部，由呼叫端決定呈現方式。
 */
export function useRepStoreAssignments() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['rep-store-assignments'],
    queryFn: async () => {
      const { data: rows, error } = await (supabase
        .from('rep_store_assignments') as any)
        .select('store_id, rep_id, assigned_at')
        .order('assigned_at', { ascending: true });
      if (error) throw error;
      const list = (rows || []) as { store_id: string; rep_id: string; assigned_at: string | null }[];
      if (list.length === 0) return [] as RepStoreAssignment[];

      const repIds = [...new Set(list.map((r) => r.rep_id))];
      const [profilesRes, rolesRes] = await Promise.all([
        (supabase.from('profiles') as any)
          .select('id, full_name')
          .in('id', repIds),
        (supabase.from('user_roles') as any)
          .select('user_id, commission_rate')
          .in('user_id', repIds),
      ]);
      const nameMap: Record<string, string> = {};
      for (const p of (profilesRes.data || []) as { id: string; full_name: string | null }[]) {
        nameMap[p.id] = p.full_name || '';
      }
      const rateMap: Record<string, number> = {};
      for (const r of (rolesRes.data || []) as { user_id: string; commission_rate: number | null }[]) {
        rateMap[r.user_id] = Number(r.commission_rate) || 0;
      }

      return list.map((r) => ({
        store_id: r.store_id,
        rep_id: r.rep_id,
        rep_name: nameMap[r.rep_id] || '未命名業務',
        commission_rate: rateMap[r.rep_id] ?? 0,
        assigned_at: r.assigned_at,
      })) satisfies RepStoreAssignment[];
    },
  });

  /** 有業務的門市 ID 集合 */
  const repStoreIds = [...new Set(data.map((a) => a.store_id))];

  /** store_id → 業務清單（依 assigned_at 遞增，指派最早的為主要負責人） */
  const repByStore = data.reduce<Record<string, RepStoreAssignment[]>>((acc, a) => {
    (acc[a.store_id] ||= []).push(a);
    return acc;
  }, {});

  const isRepStore = (storeId?: string | null) =>
    !!storeId && repByStore[storeId] !== undefined;

  const repNameOf = (storeId?: string | null) => {
    const list = storeId ? repByStore[storeId] : undefined;
    if (!list || list.length === 0) return null;
    return list.length === 1 ? list[0].rep_name : `${list[0].rep_name} 等 ${list.length} 位`;
  };

  return { assignments: data, repStoreIds, repByStore, isRepStore, repNameOf, isLoading };
}