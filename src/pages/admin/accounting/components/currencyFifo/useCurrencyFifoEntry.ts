// Currency FIFO Entry Integration
// src/pages/admin/accounting/components/currencyFifo/useCurrencyFifoEntry.ts

import { useQueryClient } from '@tanstack/react-query';
import { useCurrencyFifoMutations } from './useCurrencyFifo';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface CurrencyFifoEntryParams {
  view: string;
  accountId: string;
  transferToAccountId: string;
  amount: string;
  originalCurrency: string;
  originalAmount: string;
  exchangeRate: string;
  description: string;
  transactionDate: string;
  accounts: any[];
}

export function useCurrencyFifoEntry() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const mutations = useCurrencyFifoMutations();

  const isForeignCurrencyAccount = (accountId: string, accounts: any[]) => {
    const account = accounts.find((a: any) => a.id === accountId);
    return account && account.currency !== 'TWD';
  };

  const isCurrencyExchange = (params: CurrencyFifoEntryParams) => {
    const sourceIsForeign = isForeignCurrencyAccount(params.accountId, params.accounts);
    const destIsForeign = params.transferToAccountId ? isForeignCurrencyAccount(params.transferToAccountId, params.accounts) : false;
    const isTwdToForeign = !sourceIsForeign && destIsForeign;
    const isForeignToTwd = sourceIsForeign && !destIsForeign;
    return isTwdToForeign || isForeignToTwd;
  };

  const isForeignTransfer = (params: CurrencyFifoEntryParams) => {
    const sourceIsForeign = isForeignCurrencyAccount(params.accountId, params.accounts);
    const destIsForeign = params.transferToAccountId ? isForeignCurrencyAccount(params.transferToAccountId, params.accounts) : false;
    return sourceIsForeign && destIsForeign;
  };

  const submitCurrencyExchange = async (params: CurrencyFifoEntryParams & { createEntry?: () => Promise<void> }) => {
    const sourceIsForeign = isForeignCurrencyAccount(params.accountId, params.accounts);
    const destIsForeign = params.transferToAccountId ? isForeignCurrencyAccount(params.transferToAccountId, params.accounts) : false;

    if (sourceIsForeign && !destIsForeign) {
      // Foreign → TWD (sell foreign currency)
      const twdGrossReceived = parseFloat(params.amount) || 0;
      const bankFee = 0; // Can be added as a field
      await mutations.exchangeMutation.mutateAsync({
        fromAccountId: params.accountId,
        toAccountId: params.transferToAccountId,
        amount: parseFloat(params.originalAmount) || parseFloat(params.amount) || 0,
        twdGrossReceived,
        bankFee,
        transactionDate: params.transactionDate,
      });
    } else if (!sourceIsForeign && destIsForeign) {
      // TWD → Foreign (buy foreign currency)
      const foreignAmount = parseFloat(params.originalAmount) || parseFloat(params.amount) || 0;
      const twdAmount = parseFloat(params.amount) || 0;
      const exchangeRate = parseFloat(params.exchangeRate) || 1;
      // Use create_currency_inbound to create the foreign batch
      await mutations.createInboundMutation.mutateAsync({
        accountId: params.transferToAccountId,
        amount: foreignAmount,
        exchangeRate: exchangeRate,
        sourceType: 'exchange_buy',
        transactionDate: params.transactionDate,
      });
      // Also create accounting entry for TWD deduction
      if (params.createEntry) {
        await params.createEntry();
      }
      toast.success('外幣買入已建立，會計分錄已同步');
    }
  };

  const submitForeignTransfer = async (params: CurrencyFifoEntryParams) => {
    await mutations.transferMutation.mutateAsync({
      fromAccountId: params.accountId,
      toAccountId: params.transferToAccountId,
      amount: parseFloat(params.amount) || 0,
      feeAmount: 0,
      transactionDate: params.transactionDate,
    });
  };

  const submitForeignConsume = async (params: CurrencyFifoEntryParams) => {
    await mutations.consumeMutation.mutateAsync({
      accountId: params.accountId,
      amount: parseFloat(params.amount) || 0,
      sourceType: 'purchase_payment',
      transactionDate: params.transactionDate,
    });
  };

  return {
    isForeignCurrencyAccount,
    isCurrencyExchange,
    isForeignTransfer,
    submitCurrencyExchange,
    submitForeignTransfer,
    submitForeignConsume,
  };
}