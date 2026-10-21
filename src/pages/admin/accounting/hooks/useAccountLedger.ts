import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AccountingEntry, AccountingCategory, Account } from '../types';
import { format, startOfMonth, endOfMonth } from 'date-fns';

export interface LedgerMovement {
  id: string;
  account_id: string;
  amount_change: number;
  twd_equivalent: number;
  source_type: string;
  reference_id: string | null;
  transaction_date: string;
  created_at: string;
}

export type LedgerRow =
  | { kind: 'entry'; data: AccountingEntry }
  | { kind: 'movement'; data: LedgerMovement };

export function useAccountLedger(
  accountId: string | null,
  month: string,
  categories: AccountingCategory[],
  accounts: Account[]
) {
  return useQuery({
    queryKey: ['account-ledger', accountId, month],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return [] as LedgerRow[];
      let eq = (supabase as any)
        .from('accounting_entries')
        .select('*')
        .or(`account_id.eq.${accountId},transfer_to_account_id.eq.${accountId}`)
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true });

      let mq = (supabase as any)
        .from('currency_movements')
        .select('*')
        .eq('account_id', accountId)
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (month && month !== 'all') {
        const [y, m] = month.split('-').map(Number);
        const start = format(startOfMonth(new Date(y, m - 1)), 'yyyy-MM-dd');
        const end = format(endOfMonth(new Date(y, m - 1)), 'yyyy-MM-dd');
        eq = eq.gte('transaction_date', start).lte('transaction_date', end);
        mq = mq.gte('transaction_date', start).lte('transaction_date', end);
      }

      const [{ data: entries, error: e1 }, { data: movements, error: e2 }] = await Promise.all([eq, mq]);
      if (e1) throw e1;
      if (e2) throw e2;

      const mappedEntries: LedgerRow[] = (entries || []).map((e: any) => ({
        kind: 'entry' as const,
        data: {
          ...e,
          category: categories.find((c) => c.id === e.category_id),
          account: accounts.find((a) => a.id === e.account_id),
          transferToAccount: accounts.find((a) => a.id === e.transfer_to_account_id),
        } as AccountingEntry,
      }));

      const mappedMovements: LedgerRow[] = (movements || []).map((m: any) => ({
        kind: 'movement' as const,
        data: m as LedgerMovement,
      }));

      const merged = [...mappedEntries, ...mappedMovements].sort((a, b) => {
        const da = new Date(a.kind === 'entry' ? a.data.transaction_date : a.data.transaction_date).getTime();
        const db = new Date(b.kind === 'entry' ? b.data.transaction_date : b.data.transaction_date).getTime();
        if (da !== db) return da - db;
        const ca = a.kind === 'entry' ? a.data.created_at : a.data.created_at;
        const cb = b.kind === 'entry' ? b.data.created_at : b.data.created_at;
        return (ca || '').localeCompare(cb || '');
      });

      return merged;
    },
  });
}