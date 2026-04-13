import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Account, AccountingCategory, AccountingEntry, PaymentStatus } from '../types';

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

  // 3. Entries (Filtered by Month)
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

      return ((data || []) as any[]).map((entry) => ({
        ...entry,
        category: categories.find(c => c.id === entry.category_id),
        account: accounts.find(a => a.id === entry.account_id),
      })) as AccountingEntry[];
    },
    enabled: !!selectedMonth && categories.length >= 0 && accounts.length >= 0,
  });

  // Mutations
  const createEntryMutation = useMutation({
    mutationFn: async (data: Partial<AccountingEntry>) => {
      const { error } = await (supabase as any).from('accounting_entries').insert({
        ...data,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
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
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('accounting_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
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
