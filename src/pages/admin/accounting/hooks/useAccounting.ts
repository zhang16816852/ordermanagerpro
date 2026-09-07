import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Account, AccountingCategory, AccountingEntry, AccountingEntryReference, PaymentStatus } from '../types';

interface CreateEntryPayload {
  data: Partial<AccountingEntry>;
  references?: AccountingEntryReference[];
}

export function useAccounting(selectedMonth?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // 1. Accounts
  const { data: accounts = [], isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounts')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Account[];
    },
  });

  // 2. Categories
  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ['accounting-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounting_categories')
        .select('*')
        .eq('is_active', true)
        .order('type')
        .order('name');
      if (error) throw error;
      return (data || []) as AccountingCategory[];
    },
  });

  // 3. Entries (Filtered by Month) with references
  const { data: entries = [], isLoading: isLoadingEntries } = useQuery({
    queryKey: ['accounting-entries', selectedMonth, categories, accounts],
    queryFn: async () => {
      if (!selectedMonth) return [];
      const [year, month] = selectedMonth.split('-').map(Number);
      const startDate = startOfMonth(new Date(year, month - 1));
      const endDate = endOfMonth(new Date(year, month - 1));

      const { data, error } = await (supabase as any)
        .from('accounting_entries')
        .select('*')
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: false });

      if (error) throw error;

      const entriesWithRefs = await Promise.all(
        (data || []).map(async (entry: any) => {
          let references: AccountingEntryReference[] = [];
          const { data: refs } = await (supabase as any)
            .from('accounting_entry_references')
            .select('*')
            .eq('entry_id', entry.id);
          references = refs || [];
          return {
            ...entry,
            category: categories.find(c => c.id === entry.category_id),
            account: accounts.find(a => a.id === entry.account_id),
            transferToAccount: accounts.find(a => a.id === entry.transfer_to_account_id),
            references,
          } as AccountingEntry;
        })
      );

      return entriesWithRefs;
    },
    enabled: !!selectedMonth && categories.length >= 0 && accounts.length >= 0,
  });

  // Mutations
  const createEntryMutation = useMutation({
    mutationFn: async ({ data, references }: CreateEntryPayload) => {
      const { data: newEntry, error } = await (supabase as any)
        .from('accounting_entries')
        .insert({ ...data, created_by: user?.id })
        .select('id')
        .single();
      if (error) throw error;

      if (references && references.length > 0 && newEntry) {
        const refsToInsert = references.map(ref => ({
          entry_id: newEntry.id,
          reference_type: ref.reference_type,
          reference_id: ref.reference_id,
          item_name: ref.item_name,
          amount_applied: ref.amount_applied,
        }));
        const { error: refError } = await (supabase as any)
          .from('accounting_entry_references')
          .insert(refsToInsert);
        if (refError) throw refError;
      }

      // For income/expense: adjust account balance by signed amount
      if (data.type === 'income' || data.type === 'expense') {
        if (data.account_id) {
          const account = accounts.find(a => a.id === data.account_id);
          if (account) {
            const signedAmount = data.type === 'income' ? (data.amount || 0) : -(data.amount || 0);
            const { error: e } = await (supabase as any)
              .from('accounts')
              .update({ balance: account.balance + signedAmount })
              .eq('id', data.account_id);
            if (e) throw e;
          }
        }
      }

      // For transfers: adjust both account balances
      if (data.type === 'transfer' || data.type === 'currency_exchange' || data.type === 'topup') {
        if (data.account_id) {
          const sourceAccount = accounts.find(a => a.id === data.account_id);
          if (sourceAccount) {
            const { error: e } = await (supabase as any)
              .from('accounts')
              .update({ balance: sourceAccount.balance - (data.amount || 0) })
              .eq('id', data.account_id);
            if (e) throw e;
          }
        }
        if (data.transfer_to_account_id) {
          const destAccount = accounts.find(a => a.id === data.transfer_to_account_id);
          if (destAccount) {
            const receivedAmount = data.type === 'currency_exchange' && data.exchange_rate
              ? (data.original_amount || 0) * data.exchange_rate
              : (data.amount || 0);
            const { error: e } = await (supabase as any)
              .from('accounts')
              .update({ balance: destAccount.balance + receivedAmount })
              .eq('id', data.transfer_to_account_id);
            if (e) throw e;
          }
        }
      }

      // 同步銷貨單收款狀態（entry row 有 reference 或 references 子表有記錄時）
      if (data.reference_type === 'sales_note' && data.reference_id) {
        await (supabase as any).rpc('sync_sales_note_payment_status', { p_sales_note_id: data.reference_id });
      }
      // 也檢查 references 子表（無 entry row 綁定但有 docItems 的歷史路徑）
      if (references && references.length > 0) {
        for (const ref of references) {
          if (ref.reference_type === 'sales_note' && ref.reference_id) {
            await (supabase as any).rpc('sync_sales_note_payment_status', { p_sales_note_id: ref.reference_id });
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
      queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
      queryClient.invalidateQueries({ queryKey: ['sales-note-payment'] });
      toast.success('記錄已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<AccountingEntry> & { id: string }) => {
      const { error } = await (supabase as any).from('accounting_entries').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      toast.success('記錄已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (entry: AccountingEntry) => {
      // Reverse account balance changes
      if (entry.type === 'transfer' || entry.type === 'currency_exchange' || entry.type === 'topup') {
        if (entry.account_id) {
          const sourceAccount = accounts.find(a => a.id === entry.account_id);
          if (sourceAccount) {
            await (supabase as any)
              .from('accounts')
              .update({ balance: sourceAccount.balance + entry.amount })
              .eq('id', entry.account_id);
          }
        }
        if (entry.transfer_to_account_id) {
          const destAccount = accounts.find(a => a.id === entry.transfer_to_account_id);
          if (destAccount) {
            const receivedAmount = entry.type === 'currency_exchange' && entry.exchange_rate
              ? (entry.original_amount || 0) * entry.exchange_rate
              : entry.amount;
            await (supabase as any)
              .from('accounts')
              .update({ balance: destAccount.balance - receivedAmount })
              .eq('id', entry.transfer_to_account_id);
          }
        }
      } else if (entry.type === 'income' || entry.type === 'expense') {
        // Reverse the signed balance change
        if (entry.account_id) {
          const account = accounts.find(a => a.id === entry.account_id);
          if (account) {
            const signedAmount = entry.type === 'income' ? entry.amount : -entry.amount;
            const { error: accountError } = await (supabase as any)
              .from('accounts')
              .update({ balance: account.balance - signedAmount })
              .eq('id', entry.account_id);
            if (accountError) throw accountError;
          }
        }
      }

      // 收集 references 中的銷貨單 IDs（刪除前先取）
      const salesNoteIdsFromRefs: string[] = [];
      if (entry.references && entry.references.length > 0) {
        for (const ref of entry.references) {
          if (ref.reference_type === 'sales_note' && ref.reference_id) {
            salesNoteIdsFromRefs.push(ref.reference_id);
          }
        }
      }

      // Delete references (CASCADE will handle this, but explicit for clarity)
      await (supabase as any).from('accounting_entry_references').delete().eq('entry_id', entry.id);

      const { error } = await (supabase as any).from('accounting_entries').delete().eq('id', entry.id);
      if (error) throw error;

      // 同步銷貨單收款狀態（entry row 或 references 子表中的銷貨單）
      const salesNoteIds = new Set<string>();
      if (entry.reference_type === 'sales_note' && entry.reference_id) {
        salesNoteIds.add(entry.reference_id);
      }
      for (const id of salesNoteIdsFromRefs) {
        salesNoteIds.add(id);
      }
      for (const noteId of salesNoteIds) {
        const { error: noteError } = await (supabase as any)
          .rpc('sync_sales_note_payment_status', { p_sales_note_id: noteId });
        if (noteError) throw noteError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
      queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
      toast.success('記錄已刪除');
    },
    onError: () => toast.error('刪除失敗'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async ({ entryId, amount, accountId }: { entryId: string; amount: number; accountId: string }) => {
      const entry = entries.find(e => e.id === entryId);
      if (!entry) throw new Error('Entry not found');

      const newPaidAmount = entry.paid_amount + amount;
      const newStatus: PaymentStatus = newPaidAmount >= entry.amount ? 'paid' : 'partial';

      const { error: entryError } = await (supabase as any)
        .from('accounting_entries')
        .update({ paid_amount: newPaidAmount, payment_status: newStatus, account_id: accountId })
        .eq('id', entryId);
      if (entryError) throw entryError;

      const account = accounts.find(a => a.id === accountId);
      if (account) {
        const balanceChange = entry.type === 'income' ? amount : -amount;
        const { error: accountError } = await (supabase as any)
          .from('accounts')
          .update({ balance: account.balance + balanceChange })
          .eq('id', accountId);
        if (accountError) throw accountError;
      }

      // 同步銷貨單收款狀態
      const salesNoteIds = new Set<string>();
      if (entry.reference_type === 'sales_note' && entry.reference_id) {
        salesNoteIds.add(entry.reference_id);
      }
      if (entry.references) {
        for (const ref of entry.references) {
          if (ref.reference_type === 'sales_note' && ref.reference_id) {
            salesNoteIds.add(ref.reference_id);
          }
        }
      }
      for (const noteId of salesNoteIds) {
        const { error: noteError } = await (supabase as any)
          .rpc('sync_sales_note_payment_status', { p_sales_note_id: noteId });
        if (noteError) throw noteError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
      queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
      toast.success('付款已記錄');
    },
    onError: () => toast.error('記錄付款失敗'),
  });

  const createAccountMutation = useMutation({
    mutationFn: async (data: Partial<Account>) => {
      const { error } = await (supabase as any).from('accounts').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('帳戶已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: Partial<AccountingCategory>) => {
      const { error } = await (supabase as any).from('accounting_categories').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-categories'] });
      toast.success('類型已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  return {
    accounts,
    isLoadingAccounts,
    categories,
    isLoadingCategories,
    entries,
    isLoadingEntries,
    createEntryMutation,
    updateEntryMutation,
    deleteEntryMutation,
    recordPaymentMutation,
    createAccountMutation,
    createCategoryMutation,
  };
}
