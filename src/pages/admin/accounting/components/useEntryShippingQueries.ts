import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShipItem } from './EntryFormTypes';

interface UseEntryShippingQueriesOptions {
  isShipping: boolean;
  shippingSupplierId: string;
}

export interface ShippingSupplier {
  id: string;
  name: string;
}

export function useEntryShippingQueries({ isShipping, shippingSupplierId }: UseEntryShippingQueriesOptions) {
  const { data: shippingSuppliers = [] } = useQuery<ShippingSupplier[]>({
    queryKey: ['shipping-suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .eq('is_logistics_company', true)
        .order('name');
      if (error) throw error;
      return (data || []).map((s: any) => ({ id: s.id, name: s.name }));
    },
    enabled: isShipping,
  });

  const { data: shipSettleItems = [] } = useQuery<ShipItem[]>({
    queryKey: ['shipping-settle-items', shippingSupplierId],
    queryFn: async () => {
      if (!shippingSupplierId) return [];
      const { data, error } = await (supabase as any).rpc('list_settleable_shipments', {
        p_supplier_id: shippingSupplierId,
      });
      if (error) throw error;
      return ((data as any[]) || []).map((s: any) => ({
        id: s.id,
        docType: s.doc_type || 'order',
        docCode: s.doc_code || s.doc_id?.slice(0, 8) || '—',
        methodTitle: s.method_title || s.method_code || '—',
        trackingCompany: s.tracking_company || '',
        trackingNumber: s.tracking_number || '',
        shippedAt: s.shipped_at || null,
        cost: Number(s.cost) || 0,
        fee: Number(s.fee) || 0,
        amount: Number(s.cost) || 0,
      }));
    },
    enabled: isShipping && !!shippingSupplierId,
  });

  return { shippingSuppliers, shipSettleItems };
}