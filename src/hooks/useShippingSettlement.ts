import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface ShippingSettlementSubmission {
  supplierId: string;
  orderItemIds: string[];
  periodStart: string;
  periodEnd: string;
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
  note?: string;
}

/**
 * 運費月結結帳共用 hook（併入會計模組的「運費結帳」Tab）。
 * 金額一律由後端 RPC 依 order_items 重算，前端不可覆蓋。
 */
export function useShippingSettlement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['shipping-settlements'] });
    queryClient.invalidateQueries({ queryKey: ['shipping-settle-items'] });
  };

  const settleMutation = useMutation({
    mutationFn: async (payload: ShippingSettlementSubmission) => {
      const { data, error } = await (supabase as any).rpc('register_shipping_settlement', {
        p_supplier_id: payload.supplierId,
        p_order_item_ids: payload.orderItemIds,
        p_period_start: payload.periodStart,
        p_period_end: payload.periodEnd,
        p_paid_date: payload.paidDate,
        p_account_id: payload.accountId,
        p_category_id: payload.categoryId || null,
        p_description: payload.description || null,
        p_note: payload.note || null,
        p_created_by: user?.id,
      });
      if (error) throw error;
      return data as { period_id: string; entry_id: string; total_amount: number; order_count: number };
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`已結算運費 ${data?.order_count ?? 0} 單（總計 $${data?.total_amount ?? 0}）`);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (periodId: string) => {
      const { data, error } = await (supabase as any).rpc('revoke_shipping_settlement', {
        p_period_id: periodId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('已撤銷運費結算並回衝帳戶');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  return { settleMutation, revokeMutation };
}