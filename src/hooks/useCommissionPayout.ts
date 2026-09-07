import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface RegisterPayoutPayload {
  repId: string;
  salesNoteId: string;
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
  note?: string;
}

export interface BatchRegisterPayoutPayload {
  repId: string;
  salesNoteIds: string[];
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
}

/**
 * 業務分潤發放的共用 hook（併入會計模組）。
 * 金額一律由後端 RPC 依 rep_product_costs 與 commission_rate 重算，前端無法覆蓋。
 */
export function useCommissionPayout() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-rep-commission-payouts'] });
    queryClient.invalidateQueries({ queryKey: ['admin-rep-commission-notes'] });
    queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  const registerPayout = useMutation({
    mutationFn: async (payload: RegisterPayoutPayload) => {
      const { data, error } = await (supabase as any).rpc('register_rep_commission_payout', {
        p_rep_id: payload.repId,
        p_sales_note_id: payload.salesNoteId,
        p_paid_date: payload.paidDate,
        p_note: payload.note || null,
        p_account_id: payload.accountId,
        p_category_id: payload.categoryId || null,
        p_description: payload.description || null,
        p_created_by: user?.id,
      });
      if (error) throw error;
      return data as { payout_id: string; amount: number };
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`已登記發放 ${data?.amount != null ? `（$${data.amount}）` : ''}`);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  const revokePayout = useMutation({
    mutationFn: async (payoutId: string) => {
      const { error } = await (supabase as any).rpc('revoke_rep_commission_payout', {
        p_payout_id: payoutId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('已撤銷發放並回衝帳戶');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  const bulkRegisterPayout = useMutation({
    mutationFn: async (payload: BatchRegisterPayoutPayload) => {
      const { data, error } = await (supabase as any).rpc('register_batch_rep_commission_payout', {
        p_rep_id: payload.repId,
        p_sales_note_ids: payload.salesNoteIds,
        p_paid_date: payload.paidDate,
        p_account_id: payload.accountId,
        p_category_id: payload.categoryId || null,
        p_description: payload.description || null,
        p_created_by: user?.id,
      });
      if (error) throw error;
      return data as { entry_id: string; total_amount: number; count: number };
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`已批次登記發放 ${data?.count || 0} 筆（總計 $${data?.total_amount || 0}）`);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  return { registerPayout, revokePayout, bulkRegisterPayout };
}
