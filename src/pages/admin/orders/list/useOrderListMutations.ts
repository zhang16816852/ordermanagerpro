import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Order } from '@/types/order';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface UseOrderListMutationsParams {
  user: { id: string } | null;
  orders: Order[];
  directShipAt: string;
  getItemWarehouse: (itemId: string) => string;
  poLinkMap: Map<string, { poCount: number; poIds: string[] }>;
  onDirectShipDone: () => void;
  onDeleteDone: () => void;
  onConvertToConsignmentDone: () => void;
  onUnlinkDone: () => void;
  onReverseShipmentDone: () => void;
  setReverseShipmentOrder: (v: { order: Order; consignmentOrderId: string } | null) => void;
  setReverseNote: (v: string) => void;
}

export interface UseOrderListMutationsResult {
  directShipMutation: ReturnType<typeof useMutation<any, any, { orderIds: string[]; notes: string }>>;
  deleteOrderMutation: ReturnType<typeof useMutation<any, any, string[]>>;
  convertToConsignmentMutation: ReturnType<typeof useMutation<any, any, string[]>>;
  unlinkOrdersMutation: ReturnType<typeof useMutation<any, any, string[]>>;
  reverseShipmentMutation: ReturnType<typeof useMutation<any, any, { consignmentOrderId: string; note: string }>>;
  handleDeleteOrders: (orderIds: string[]) => void;
  handleReverseShipment: (order: Order) => Promise<void>;
}

export function useOrderListMutations(params: UseOrderListMutationsParams): UseOrderListMutationsResult {
  const { user, orders, directShipAt, getItemWarehouse, poLinkMap } = params;
  const queryClient = useQueryClient();

  const directShipMutation = useMutation({
    mutationFn: async ({
      orderIds, notes,
    }: { orderIds: string[]; notes: string }) => {
      if (!user) throw new Error('未登入');
      const results: any[] = [];
      for (const orderId of orderIds) {
        const order = orders.find(o => o.id === orderId);
        const warehouseMap: Record<string, string> = {};
        if (order?.order_items) {
          for (const item of order.order_items) {
            const wh = getItemWarehouse(item.id);
            if (wh) warehouseMap[item.id] = wh;
          }
        }
        const { data, error } = await supabase.rpc('direct_ship_order', {
          p_order_id: orderId,
          p_created_by: user.id,
          p_notes: notes || undefined,
          p_shipped_at: directShipAt ? new Date(directShipAt).toISOString() : undefined,
          p_warehouse_id: undefined,
          p_warehouse_map: warehouseMap as any,
        });
        if (error) throw error;
        results.push(data as any);
      }
      return results;
    },
    onSuccess: (results, variables) => {
      const count = variables.orderIds.length;
      const isConsignmentShip = Array.from(variables.orderIds).every(
        (id) => orders.find((o) => o.id === id)?.consignment_mode
      );
      toast.success(isConsignmentShip ? `已寄賣出貨 ${count} 個訂單` : `已將 ${count} 個訂單轉為銷貨單`, {
        action: count === 1 && !isConsignmentShip ? {
          label: '複製連結',
          onClick: () => {
            const r = results[0] as any;
            const link = `${window.location.origin}/share/sale/${r.sales_note_code || r.sales_note_id}?token=${r.access_token}`;
            navigator.clipboard.writeText(link);
            toast.success('連結已複製');
          },
        } : undefined,
        duration: 10000,
      });
      params.onDirectShipDone();
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      if (!user) throw new Error('未登入');
      const okIds: string[] = [];
      const reasons: string[] = [];
      for (const orderId of orderIds) {
        const { data, error } = await supabase.rpc('delete_order_if_unadopted', { p_order_id: orderId });
        if (error) {
          reasons.push(getErrorMessage(error));
          continue;
        }
        const r = data as any;
        if (r?.ok) okIds.push(orderId);
        else {
          let reason = r?.reason || '無法刪除';
          const blocks = r?.adopted_by as Array<{ label?: string }> | undefined;
          if (Array.isArray(blocks) && blocks.length > 0) {
            reason = `${reason}（${blocks.map((b: { label?: string }) => b?.label).filter(Boolean).join('、')}）`;
          }
          reasons.push(reason);
        }
      }
      return { okIds, reasons };
    },
    onSuccess: ({ okIds, reasons }) => {
      if (okIds.length > 0) toast.success(`已刪除 ${okIds.length} 個訂單`);
      if (reasons.length > 0) {
        const unique = Array.from(new Set(reasons));
        toast.error(unique.slice(0, 3).join('；') + (unique.length > 3 ? ` 等 ${unique.length} 筆無法刪除` : ''));
      }
      params.onDeleteDone();
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const convertToConsignmentMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      if (!user) throw new Error('未登入');
      const failed: string[] = [];
      for (const orderId of orderIds) {
        const { data, error } = await supabase.rpc('convert_order_to_consignment_draft', {
          p_order_id: orderId,
          p_created_by: user.id,
        });
        if (error) {
          failed.push(orderId);
          continue;
        }
        if (data?.ok === false) failed.push(orderId);
      }
      if (failed.length > 0) {
        throw new Error(`有 ${failed.length} 個訂單無法轉寄賣，可能是非 pending 或已無未出貨品項`);
      }
      return orderIds;
    },
    onSuccess: (orderIds) => {
      toast.success(`已將 ${orderIds.length} 個訂單轉為寄賣草稿（未出貨），可至寄賣管理調整後再出貨`);
      params.onConvertToConsignmentDone();
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const unlinkOrdersMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      // 依 poLinkMap 分組：將所選訂單自其關聯的採購單解除
      const byPO = new Map<string, string[]>();
      for (const orderId of orderIds) {
        const poIds = poLinkMap.get(orderId)?.poIds || [];
        for (const poId of poIds) {
          if (!byPO.has(poId)) byPO.set(poId, []);
          byPO.get(poId)!.push(orderId);
        }
      }
      const results: any[] = [];
      for (const [poId, ids] of byPO) {
        const { data, error } = await (supabase as any).rpc('unlink_orders_from_purchase_order', {
          p_purchase_order_id: poId,
          p_order_ids: ids,
        });
        if (error) throw error;
        results.push(data as any);
      }
      return results;
    },
    onSuccess: (results) => {
      const removed = results.reduce((s, r) => s + (r?.removed_item_count ?? 0), 0);
      const updated = results.reduce((s, r) => s + (r?.updated_item_count ?? 0), 0);
      toast.success(`已解除採購關聯（移除 ${removed} 筆、更新 ${updated} 筆）`);
      params.onUnlinkDone();
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const reverseShipmentMutation = useMutation({
    mutationFn: async ({ consignmentOrderId, note }: { consignmentOrderId: string; note: string }) => {
      if (!user) throw new Error('未登入');
      const { data, error } = await supabase.rpc('reverse_consignment_shipment', {
        p_consignment_order_id: consignmentOrderId,
        p_created_by: user.id,
        p_note: note || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('已回滾出貨，品項已放回出貨池');
      params.onReverseShipmentDone();
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool'] });
      queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const handleDeleteOrders = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const label = orderIds.length === 1 ? '此訂單' : `這 ${orderIds.length} 個訂單`;
    if (confirm(`確定要完整刪除 ${label} 嗎？\n已被銷貨單／寄賣單／採購單／會計分錄採用的訂單將無法刪除。`)) {
      deleteOrderMutation.mutate(orderIds);
    }
  };

  const handleReverseShipment = async (order: Order) => {
    if (!user) {
      toast.error('未登入');
      return;
    }
    const { data, error } = await (supabase.from('consignment_orders') as any)
      .select('id')
      .eq('source_order_id', order.id)
      .eq('direction', 'send_to_store')
      .eq('status', 'active')
      .maybeSingle();
    if (error) {
      toast.error(getErrorMessage(error));
      return;
    }
    if (!data) {
      toast.error('找不到對應的寄賣單');
      return;
    }
    params.setReverseShipmentOrder({ order, consignmentOrderId: data.id });
    params.setReverseNote('');
  };

  return {
    directShipMutation,
    deleteOrderMutation,
    convertToConsignmentMutation,
    unlinkOrdersMutation,
    reverseShipmentMutation,
    handleDeleteOrders,
    handleReverseShipment,
  };
}