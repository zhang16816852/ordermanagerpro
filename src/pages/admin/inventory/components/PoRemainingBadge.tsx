import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function PoRemainingBadge({ purchaseOrderId, variantId }: { purchaseOrderId: string | null; variantId?: string | null }) {
    const { data } = useQuery({
        queryKey: ['po-remaining', purchaseOrderId, variantId],
        enabled: !!purchaseOrderId,
        queryFn: async () => {
            let q: any = (supabase as any)
                .from('purchase_order_items')
                .select('received_quantity, returned_quantity, consumed_quantity, variant_id, purchase_orders:purchase_order_id (supplier_order_number, order_date)')
                .eq('purchase_order_id', purchaseOrderId);
            if (variantId) q = q.eq('variant_id', variantId);
            const { data, error } = await q;
            if (error) throw error;
            const rows = data || [];
            const received = rows.reduce((s: number, i: any) => s + (i.received_quantity || 0), 0);
            const returned = rows.reduce((s: number, i: any) => s + (i.returned_quantity || 0), 0);
            const consumed = rows.reduce((s: number, i: any) => s + (i.consumed_quantity || 0), 0);
            const remaining = received - returned - consumed;
            const po = rows[0]?.purchase_orders;
            const code = po?.supplier_order_number || (purchaseOrderId ? String(purchaseOrderId).slice(0, 8) : null);
            const orderDate = po?.order_date || null;
            return { remaining, received, returned, consumed, code, orderDate };
        },
        staleTime: 60000,
    });
    if (!purchaseOrderId || !data) return null;
    const color = data.remaining > 0 ? 'text-emerald-600' : 'text-muted-foreground';
    const dateStr = data.orderDate ? `採購單日期 ${data.orderDate}` : '';
    return (
        <span
            className={`ml-1 inline-flex items-center rounded px-1 py-0 text-[10px] font-mono tabular-nums ${color}`}
            title={`${dateStr} / 已收 ${data.received} / 已退 ${data.returned} / 已耗 ${data.consumed} / 剩餘 ${data.remaining}`.trim()}
        >
            {data.code} 剩 {data.remaining}
        </span>
    );
}