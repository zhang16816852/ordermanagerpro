import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DocType } from './EntryFormTypes';

export interface DocCandidate {
  id: string;
  code: string;
  name: string;
  date: string;
  amount: number;
  supplierName?: string;
  customerName?: string;
  deviceModelName?: string;
}

interface UseEntryDocQueriesOptions {
  isList: boolean;
  isRepair: boolean;
  docTab: DocType;
}

export function useEntryDocQueries({ isList, isRepair, docTab }: UseEntryDocQueriesOptions) {
  const { data: salesNotes = [] } = useQuery<DocCandidate[]>({
    queryKey: ['doc-sales-notes'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sales_notes')
        .select(`
          id, code, created_at, status,
          store:stores(name),
          sales_note_items(quantity, order_item:order_items(unit_price))
        `)
        .in('status', ['shipped', 'received'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((n: any) => ({
        id: n.id,
        code: n.code || n.id.slice(0, 8),
        name: n.store?.name || '未知店家',
        date: n.created_at,
        amount: (n.sales_note_items || []).reduce(
          (s: number, i: any) => s + (i.quantity * (i.order_item?.unit_price || 0)), 0
        ),
      }));
    },
    enabled: isList && docTab === 'sales_note',
  });

  const { data: purchaseOrders = [] } = useQuery<DocCandidate[]>({
    queryKey: ['doc-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, supplier_order_number, total_amount, order_date, status, supplier:suppliers(name)')
        .neq('status', 'cancelled')
        .order('order_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((po: any) => ({
        id: po.id,
        code: po.supplier_order_number || po.id.slice(0, 8),
        name: po.supplier?.name || '未知供應商',
        date: po.order_date,
        amount: Number(po.total_amount) || 0,
        supplierName: po.supplier?.name || '',
      }));
    },
    enabled: (isList && docTab === 'purchase_order') || isRepair,
  });

  const { data: repairOrders = [] } = useQuery<DocCandidate[]>({
    queryKey: ['doc-repair-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('repair_orders')
        .select('id, code, created_at, status, customer_name, total_price, reported_issue, device_model:device_model_id(name)')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((ro: any) => ({
        id: ro.id,
        code: ro.code || ro.id.slice(0, 8),
        name: `${ro.code || '維修單'}${ro.customer_name ? ` - ${ro.customer_name}` : ''}${ro.device_model?.name ? ` (${ro.device_model.name})` : ''}`,
        date: ro.created_at,
        amount: Number(ro.total_price) || 0,
        customerName: ro.customer_name || '',
        deviceModelName: ro.device_model?.name || '',
      }));
    },
    enabled: (isList && docTab === 'repair_order') || isRepair,
  });

  return { salesNotes, purchaseOrders, repairOrders };
}