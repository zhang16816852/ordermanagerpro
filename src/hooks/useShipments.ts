import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export type ShipmentDocType = 'order' | 'sales_note' | 'consignment_order';

export interface ShipmentRow {
  id: string;
  doc_type: ShipmentDocType;
  doc_id: string;
  delivery_method_id: string | null;
  delivery_method_title: string | null;
  delivery_method_code: string | null;
  fee: number;
  cost: number;
  fee_payment: string;
  tracking_company: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentUpsertPayload {
  deliveryMethodId?: string | null;
  fee?: number | null;
  cost?: number | null;
  feePayment?: string;
  trackingCompany?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippedAt?: string | null;
  note?: string | null;
}

// 依 doc_type/doc_id 抓取包裹清單
export function useShipments(docType: ShipmentDocType | null, docId: string | null) {
  return useQuery({
    queryKey: ['shipments', docType, docId],
    queryFn: async () => {
      let q = (supabase as any)
        .from('shipments')
        .select('*')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (docType) q = q.eq('doc_type', docType);
      if (docId) q = q.eq('doc_id', docId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ShipmentRow[];
    },
    enabled: !!docType && !!docId,
  });
}

// 包裹 CRUD：upsert_shipment / delete_shipment（admin 限定，RPC 已守門）
export function useShipmentMutations(docType: ShipmentDocType, docId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shipments', docType, docId] });
    queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
    queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
    queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
  };

  const upsertMutation = useMutation({
    mutationFn: async (payload: ShipmentUpsertPayload & { shipmentId?: string | null }) => {
      const { data, error } = await (supabase as any).rpc('upsert_shipment', {
        p_doc_type: docType,
        p_doc_id: docId,
        p_delivery_method_id: payload.deliveryMethodId ?? null,
        p_fee: payload.fee ?? null,
        p_cost: payload.cost ?? null,
        p_fee_payment: payload.feePayment || 'one_time',
        p_tracking_company: payload.trackingCompany || null,
        p_tracking_number: payload.trackingNumber || null,
        p_tracking_url: payload.trackingUrl || null,
        p_shipped_at: payload.shippedAt || null,
        p_note: payload.note || null,
        p_created_by: user?.id || null,
        p_shipment_id: payload.shipmentId || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (shipmentId: string) => {
      const { data, error } = await (supabase as any).rpc('delete_shipment', {
        p_shipment_id: shipmentId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  return { upsertMutation, deleteMutation };
}