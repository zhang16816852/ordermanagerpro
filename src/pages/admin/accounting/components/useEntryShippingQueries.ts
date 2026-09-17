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
  products: { id: string; name: string }[];
}

export function useEntryShippingQueries({ isShipping, shippingSupplierId }: UseEntryShippingQueriesOptions) {
  const { data: shippingSuppliers = [] } = useQuery<ShippingSupplier[]>({
    queryKey: ['shipping-suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name, products!inner(id, name, item_type)')
        .eq('is_active', true)
        .eq('products.item_type', 'shipping')
        .order('name');
      if (error) throw error;
      return (data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        products: (s.products || []).filter((p: any) => p.item_type === 'shipping'),
      }));
    },
    enabled: isShipping,
  });

  const { data: shipSettleItems = [] } = useQuery<ShipItem[]>({
    queryKey: ['shipping-settle-items', shippingSupplierId],
    queryFn: async () => {
      if (!shippingSupplierId) return [];
      const [{ data: items }, { data: periods }] = await Promise.all([
        (supabase as any)
          .from('order_items')
          .select('id, order_id, quantity, unit_price, order:orders(code, status, created_at), product:products(id, name)')
          .eq('shipping_payment', 'monthly')
          .eq('product.supplier_id', shippingSupplierId),
        (supabase as any)
          .from('shipping_settlement_periods')
          .select('id, supplier_id, is_settled, entry_id, accounting_entry_references(reference_type, reference_id)'),
      ]);

      const settledOrderIds = new Set<string>();
      for (const p of (periods as any[]) || []) {
        if (p.supplier_id !== shippingSupplierId || !p.is_settled) continue;
        for (const r of p.accounting_entry_references || []) {
          if (r.reference_type === 'order') settledOrderIds.add(r.reference_id);
        }
      }

      return ((items as any[]) || [])
        .filter((i: any) => i.order && i.order.status !== 'cancelled' && !settledOrderIds.has(i.order_id))
        .map((i: any) => {
          const qty = Number(i.quantity) || 0;
          const unitPrice = Number(i.unit_price) || 0;
          return {
            id: i.id,
            orderId: i.order_id,
            orderCode: i.order.code || i.order_id.slice(0, 8),
            productName: i.product?.name || '—',
            qty,
            unitPrice,
            amount: qty * unitPrice,
          };
        });
    },
    enabled: isShipping && !!shippingSupplierId,
  });

  return { shippingSuppliers, shipSettleItems };
}