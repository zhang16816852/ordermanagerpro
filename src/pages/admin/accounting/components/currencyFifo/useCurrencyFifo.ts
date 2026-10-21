// Currency FIFO Hooks
// src/pages/admin/accounting/components/currencyFifo/useCurrencyFifo.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { CurrencyBatch, CurrencyBatchWithInventory, CurrencyMovement, CurrencyBatchConsumption, CurrencyBatchInventory, FIFOResult, ExchangeResult, TransferResult, ReconcileResult } from './currencyFifoTypes';

export function useCurrencyBatches(accountId: string | null) {
  return useQuery({
    queryKey: ['currency-batches', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('currency_batches')
        .select('*')
        .eq('account_id', accountId)
        .order('transaction_date', { ascending: true });
      if (error) throw error;
      return (data || []) as CurrencyBatch[];
    },
  });
}

export function useCurrencyBatchInventory(accountId: string | null) {
  return useQuery({
    queryKey: ['currency-batch-inventory', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('currency_batch_inventory')
        .select('*')
        .eq('account_id', accountId);
      if (error) throw error;
      return (data || []) as CurrencyBatchInventory[];
    },
  });
}

export function useCurrencyMovements(accountId: string | null) {
  return useQuery({
    queryKey: ['currency-movements', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('currency_movements')
        .select('*')
        .eq('account_id', accountId)
        .order('transaction_date', { ascending: false });
      if (error) throw error;
      return (data || []) as CurrencyMovement[];
    },
  });
}

export function useCurrencyBatchConsumptions(movementId: string | null) {
  return useQuery({
    queryKey: ['currency-batch-consumptions', movementId],
    enabled: !!movementId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('currency_batch_consumptions')
        .select('*')
        .eq('movement_id', movementId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as CurrencyBatchConsumption[];
    },
  });
}

export function useCurrencyBatchesWithInventory(accountId: string | null) {
  const { data: batches = [] } = useCurrencyBatches(accountId);
  const { data: inventory = [] } = useCurrencyBatchInventory(accountId);

  const batchesWithInventory: CurrencyBatchWithInventory[] = batches.map((batch) => {
    const inv = inventory.find((i) => i.batch_id === batch.id);
    const remaining = inv?.remaining_amount ?? 0;
    const consumed = batch.amount - remaining;
    return {
      ...batch,
      remaining_amount: remaining,
      consumed_amount: consumed,
      is_fully_consumed: remaining === 0,
    };
  });

  return { data: batchesWithInventory };
}

export function useCurrencyFifoMutations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const invalidateAll = (accountId: string) => {
    queryClient.invalidateQueries({ queryKey: ['currency-batches', accountId] });
    queryClient.invalidateQueries({ queryKey: ['currency-batch-inventory', accountId] });
    queryClient.invalidateQueries({ queryKey: ['currency-movements', accountId] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  const createInboundMutation = useMutation({
    mutationFn: async (params: {
      accountId: string;
      amount: number;
      exchangeRate: number;
      sourceType: string;
      sourceId?: string;
      transactionDate: string;
      receiptId?: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('create_currency_inbound', {
        p_account_id: params.accountId,
        p_amount: params.amount,
        p_exchange_rate: params.exchangeRate,
        p_source_type: params.sourceType,
        p_source_id: params.sourceId || null,
        p_transaction_date: params.transactionDate,
        p_receipt_id: params.receiptId || null,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: (_, params) => {
      invalidateAll(params.accountId);
      toast.success('外幣入帳成功');
    },
    onError: (error: Error) => toast.error(error.message || '入帳失敗'),
  });

  const consumeMutation = useMutation({
    mutationFn: async (params: {
      accountId: string;
      amount: number;
      sourceType: string;
      referenceId?: string;
      receiptId?: string;
      transactionDate: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('consume_currency_fifo', {
        p_account_id: params.accountId,
        p_amount: params.amount,
        p_source_type: params.sourceType,
        p_reference_id: params.referenceId || null,
        p_receipt_id: params.receiptId || null,
        p_transaction_date: params.transactionDate,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data as FIFOResult;
    },
    onSuccess: (_, params) => {
      invalidateAll(params.accountId);
      toast.success('外幣消耗成功');
    },
    onError: (error: Error) => toast.error(error.message || '消耗失敗'),
  });

  const exchangeMutation = useMutation({
    mutationFn: async (params: {
      fromAccountId: string;
      toAccountId: string;
      amount: number;
      twdGrossReceived: number;
      bankFee: number;
      referenceId?: string;
      receiptId?: string;
      transactionDate: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('exchange_currency_fifo', {
        p_from_account_id: params.fromAccountId,
        p_to_account_id: params.toAccountId,
        p_amount: params.amount,
        p_twd_gross_received: params.twdGrossReceived,
        p_bank_fee: params.bankFee,
        p_reference_id: params.referenceId || null,
        p_receipt_id: params.receiptId || null,
        p_transaction_date: params.transactionDate,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data as ExchangeResult;
    },
    onSuccess: (_, params) => {
      invalidateAll(params.fromAccountId);
      invalidateAll(params.toAccountId);
      toast.success('換匯成功');
    },
    onError: (error: Error) => toast.error(error.message || '換匯失敗'),
  });

  const transferMutation = useMutation({
    mutationFn: async (params: {
      fromAccountId: string;
      toAccountId: string;
      amount: number;
      feeAmount: number;
      referenceId?: string;
      receiptId?: string;
      transactionDate: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('transfer_currency_fifo', {
        p_from_account_id: params.fromAccountId,
        p_to_account_id: params.toAccountId,
        p_amount: params.amount,
        p_fee_amount: params.feeAmount,
        p_reference_id: params.referenceId || null,
        p_receipt_id: params.receiptId || null,
        p_transaction_date: params.transactionDate,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data as TransferResult;
    },
    onSuccess: (_, params) => {
      invalidateAll(params.fromAccountId);
      invalidateAll(params.toAccountId);
      toast.success('轉帳成功');
    },
    onError: (error: Error) => toast.error(error.message || '轉帳失敗'),
  });

  const reverseMutation = useMutation({
    mutationFn: async (params: {
      movementId: string;
      reason: string;
      receiptId?: string;
      transactionDate: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('reverse_currency_fifo', {
        p_movement_id: params.movementId,
        p_reason: params.reason,
        p_receipt_id: params.receiptId || null,
        p_transaction_date: params.transactionDate,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: () => {
      // Invalidate all currency queries
      queryClient.invalidateQueries({ queryKey: ['currency-batches'] });
      queryClient.invalidateQueries({ queryKey: ['currency-batch-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['currency-movements'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('沖銷成功');
    },
    onError: (error: Error) => toast.error(error.message || '沖銷失敗'),
  });

  const refundMutation = useMutation({
    mutationFn: async (params: {
      accountId: string;
      amount: number;
      sourceType: string;
      sourceId?: string;
      originalMovementId?: string;
      receiptId?: string;
      transactionDate: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('refund_currency_fifo', {
        p_account_id: params.accountId,
        p_amount: params.amount,
        p_source_type: params.sourceType,
        p_source_id: params.sourceId || null,
        p_original_movement_id: params.originalMovementId || null,
        p_receipt_id: params.receiptId || null,
        p_transaction_date: params.transactionDate,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: (_, params) => {
      invalidateAll(params.accountId);
      toast.success('退款成功');
    },
    onError: (error: Error) => toast.error(error.message || '退款失敗'),
  });

  const openingBalanceMutation = useMutation({
    mutationFn: async (params: {
      accountId: string;
      amount: number;
      exchangeRate: number;
      sourceType: string;
      transactionDate: string;
      receiptId?: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('import_currency_opening_balance', {
        p_account_id: params.accountId,
        p_amount: params.amount,
        p_exchange_rate: params.exchangeRate,
        p_source_type: params.sourceType,
        p_transaction_date: params.transactionDate,
        p_receipt_id: params.receiptId || null,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: (_, params) => {
      invalidateAll(params.accountId);
      toast.success('期初導入成功');
    },
    onError: (error: Error) => toast.error(error.message || '期初導入失敗'),
  });

  const reconcileMutation = useMutation({
    mutationFn: async (params: { accountId: string; currency: string }) => {
      const { data, error } = await (supabase as any).rpc('reconcile_currency_fifo', {
        p_account_id: params.accountId,
        p_currency: params.currency,
      });
      if (error) throw error;
      return data as ReconcileResult;
    },
    onSuccess: (data) => {
      if (data?.ok) {
        toast.success('驗算通過，無差異');
      } else {
        toast.warning('驗算發現差異，請查看詳情');
      }
    },
    onError: (error: Error) => toast.error(error.message || '驗算失敗'),
  });

  return {
    createInboundMutation,
    consumeMutation,
    exchangeMutation,
    transferMutation,
    reverseMutation,
    refundMutation,
    openingBalanceMutation,
    reconcileMutation,
  };
}