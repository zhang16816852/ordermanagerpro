import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PayoutNote, PayoutRep } from './EntryFormTypes';

interface UseEntryPayoutQueriesOptions {
  isPayout: boolean;
  payoutRepId: string;
}

export function useEntryPayoutQueries({ isPayout, payoutRepId }: UseEntryPayoutQueriesOptions) {
  const { data: payoutReps = [] } = useQuery<PayoutRep[]>({
    queryKey: ['entry-payout-reps'],
    queryFn: async () => {
      const { data: roles, error: rErr } = await (supabase as any)
        .from('user_roles')
        .select('user_id, commission_rate')
        .eq('role', 'rep');
      if (rErr) throw rErr;
      const ids = ((roles as any[]) || []).map(r => r.user_id);
      if (ids.length === 0) return [];
      const { data: profiles } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      return ((roles as any[]) || []).map(r => ({
        user_id: r.user_id,
        commission_rate: Number(r.commission_rate) || 0,
        full_name: ((profiles as any[]) || []).find(p => p.id === r.user_id)?.full_name || null,
        email: ((profiles as any[]) || []).find(p => p.id === r.user_id)?.email || '',
      }));
    },
    enabled: isPayout,
  });

  const { data: payoutNotes = [] } = useQuery<PayoutNote[]>({
    queryKey: ['entry-payout-notes', payoutRepId],
    queryFn: async () => {
      if (!payoutRepId) return [];
      const { data: assigns, error: aErr } = await (supabase as any)
        .from('rep_store_assignments')
        .select('store_id')
        .eq('rep_id', payoutRepId);
      if (aErr) throw aErr;
      const storeIds = ((assigns as any[]) || []).map(a => a.store_id);
      if (storeIds.length === 0) return [];

      const [{ data: costsRes }, { data: payoutsRes }, { data: notesRes }, { data: wholesaleRes }] = await Promise.all([
        (supabase as any).from('rep_product_costs').select('product_id, variant_id, cost').eq('rep_id', payoutRepId),
        (supabase as any).from('rep_commission_payouts').select('sales_note_id').eq('rep_id', payoutRepId),
        (supabase as any)
          .from('sales_notes')
          .select(`
            id, code, shipped_at,
            store:stores(name),
            sales_note_items(quantity, order_item:order_items(product_id, variant_id, unit_price, unit_cost))
          `)
          .in('store_id', storeIds)
          .in('status', ['shipped', 'received'])
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('product_variants')
          .select('id, product_id, wholesale_price')
          .neq('status', 'discontinued'),
      ]);

      const costMap = new Map<string, number>();
      for (const c of (costsRes as any[]) || []) {
        costMap.set(`${c.product_id}|${c.variant_id ?? 'null'}`, Number(c.cost) || 0);
      }
      const wholesaleMap = new Map<string, number>();
      for (const w of (wholesaleRes as any[]) || []) {
        wholesaleMap.set(`${w.product_id}|${w.id}`, Number(w.wholesale_price) || 0);
      }
      const getCost = (pid: string, vid: string | null, unitCost: number) => {
        if (Number(unitCost) > 0) return Number(unitCost);
        const exact = costMap.get(`${pid}|${vid ?? 'null'}`);
        if (exact !== undefined) return exact;
        const productLevel = costMap.get(`${pid}|null`);
        if (productLevel !== undefined) return productLevel;
        return wholesaleMap.get(`${pid}|${vid ?? ''}`) ?? 0;
      };
      const paidSet = new Set(((payoutsRes as any[]) || []).map(p => p.sales_note_id));
      const repRate = (payoutReps.find(r => r.user_id === payoutRepId)?.commission_rate ?? 0) / 100;

      const notes: PayoutNote[] = [];
      for (const n of (notesRes as any[]) || []) {
        if (paidSet.has(n.id)) continue;
        let commission = 0;
        for (const sni of n.sales_note_items || []) {
          const oi = sni.order_item;
          if (!oi) continue;
          const profit = (Number(oi.unit_price) || 0) - getCost(oi.product_id, oi.variant_id ?? null, Number(oi.unit_cost) || 0);
          commission += Math.max(0, profit) * (Number(sni.quantity) || 0) * repRate;
        }
        if (commission <= 0) continue;
        notes.push({
          id: n.id,
          code: n.code || n.id.slice(0, 8),
          storeName: n.store?.name || '—',
          shippedAt: n.shipped_at,
          commission,
        });
      }
      return notes;
    },
    enabled: isPayout && !!payoutRepId,
  });

  return { payoutReps, payoutNotes };
}