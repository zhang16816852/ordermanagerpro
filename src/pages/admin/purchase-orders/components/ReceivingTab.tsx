import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PackageCheck, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

interface ReceivingItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  product?: { name: string; sku: string };
  variant?: { name: string; sku: string };
}

interface ReceivingOrder {
  id: string;
  supplier_id: string | null;
  status: string;
  order_date: string;
  total_amount: number;
  supplier_order_number: string | null;
  supplier?: { name: string };
  items: ReceivingItem[];
}

export function ReceivingTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: receivingOrders = [], isLoading } = useQuery({
    queryKey: ['receiving-orders'],
    queryFn: async () => {
      const { data: pos, error: poError } = await (supabase as any)
        .from('purchase_orders')
        .select(`
          id, supplier_id, status, order_date, total_amount, supplier_order_number,
          supplier:suppliers(name),
          items:purchase_order_items(
            id, product_id, variant_id, quantity, received_quantity, unit_cost,
            product:products(name, sku),
            variant:product_variants(name, sku)
          )
        `)
        .in('status', ['ordered', 'partial_received'])
        .order('order_date', { ascending: false });
      if (poError) throw poError;
      return (pos || []) as ReceivingOrder[];
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async (items: { id: string; received_quantity: number }[]) => {
      for (const item of items) {
        const { error } = await (supabase as any)
          .from('purchase_order_items')
          .update({ received_quantity: item.received_quantity })
          .eq('id', item.id);
        if (error) throw error;

        // Update inventory
        const { data: orderItem } = await (supabase as any)
          .from('purchase_order_items')
          .select('product_id, variant_id')
          .eq('id', item.id)
          .single();

        if (orderItem?.product_id) {
          const { data: existing } = await (supabase as any)
            .from('product_inventory')
            .select('quantity')
            .eq('product_id', orderItem.product_id)
            .eq('variant_id', orderItem.variant_id || null)
            .maybeSingle();

          const currentQty = existing?.quantity || 0;
          const newQty = currentQty + item.received_quantity;

          await (supabase as any)
            .from('product_inventory')
            .upsert({
              product_id: orderItem.product_id,
              variant_id: orderItem.variant_id || null,
              quantity: newQty,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'product_id, variant_id' });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items'] });
      toast.success('收貨已記錄，庫存已更新');
      setExpandedPO(null);
      setQuantities({});
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const updatePOStatus = useMutation({
    mutationFn: async ({ poId, items }: { poId: string; items: ReceivingItem[] }) => {
      const allReceived = items.every(i => i.received_quantity >= i.quantity);
      const anyReceived = items.some(i => i.received_quantity > 0);
      const newStatus = allReceived ? 'received' : anyReceived ? 'partial_received' : 'ordered';

      await (supabase as any)
        .from('purchase_orders')
        .update({
          status: newStatus,
          received_date: allReceived ? new Date().toISOString().split('T')[0] : null,
        })
        .eq('id', poId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
  });

  const handleReceive = (po: ReceivingOrder) => {
    const updates = po.items
      .filter(item => {
        const qty = quantities[item.id];
        return qty !== undefined && qty !== item.received_quantity;
      })
      .map(item => ({
        id: item.id,
        received_quantity: quantities[item.id] ?? item.received_quantity,
      }));

    if (updates.length === 0) {
      toast.warning('請先輸入收貨數量');
      return;
    }

    receiveMutation.mutate(updates, {
      onSuccess: () => {
        // After receiving, check if we should update PO status
        const updatedItems = po.items.map(item => {
          const update = updates.find(u => u.id === item.id);
          return update ? { ...item, received_quantity: update.received_quantity } : item;
        });
        updatePOStatus.mutate({ poId: po.id, items: updatedItems });
      },
    });
  };

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">載入中...</div>;
  }

  if (receivingOrders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
        <PackageCheck className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium">目前沒有待收貨的採購單</p>
        <p className="text-sm">將採購單狀態設為「已下單」後，才會出现在此列表</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {receivingOrders.map((po) => {
        const isExpanded = expandedPO === po.id;
        const totalPending = po.items.reduce((sum, i) => sum + (i.quantity - i.received_quantity), 0);
        const totalReceived = po.items.reduce((sum, i) => sum + i.received_quantity, 0);
        const allDone = po.items.every(i => i.received_quantity >= i.quantity);

        return (
          <Card key={po.id} className={allDone ? 'border-green-500/50 bg-green-50/30' : ''}>
            <CardHeader
              className="cursor-pointer py-3"
              onClick={() => {
                setExpandedPO(isExpanded ? null : po.id);
                // Initialize quantities for this PO
                if (!isExpanded) {
                  const init: Record<string, number> = {};
                  po.items.forEach(item => { init[item.id] = item.received_quantity; });
                  setQuantities(prev => ({ ...prev, ...init }));
                }
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div>
                    <CardTitle className="text-base">
                      {po.supplier?.name || '未指定供應商'}
                      {po.supplier_order_number && (
                        <span className="text-muted-foreground font-normal ml-2">({po.supplier_order_number})</span>
                      )}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {po.order_date} · {po.items.length} 項產品
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-sm">
                    <span className="text-muted-foreground">已收 {totalReceived}</span>
                    <span className="mx-1">/</span>
                    <span className="font-medium">{totalPending + totalReceived}</span>
                  </div>
                  {allDone ? (
                    <Badge variant="outline" className="border-green-500 text-green-600">已收貨</Badge>
                  ) : (
                    <Badge variant="outline" className="border-orange-500 text-orange-600">待收貨</Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                <div className="border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-3 font-medium">產品</th>
                        <th className="text-right py-2 px-3 font-medium w-20">訂購</th>
                        <th className="text-right py-2 px-3 font-medium w-20">已收</th>
                        <th className="text-right py-2 px-3 font-medium w-24">本次收貨</th>
                        <th className="text-right py-2 px-3 font-medium w-24">單價</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((item) => {
                        const isItemDone = item.received_quantity >= item.quantity;
                        return (
                          <tr key={item.id} className={`border-b last:border-0 ${isItemDone ? 'bg-green-50/50' : ''}`}>
                            <td className="py-2 px-3">
                              <p className="font-medium">{item.product?.name || '-'}</p>
                              {item.variant?.name && (
                                <p className="text-xs text-muted-foreground">{item.variant.name}</p>
                              )}
                            </td>
                            <td className="text-right py-2 px-3">{item.quantity}</td>
                            <td className="text-right py-2 px-3">
                              <span className={isItemDone ? 'text-green-600 font-bold' : 'text-orange-600'}>
                                {item.received_quantity}
                              </span>
                            </td>
                            <td className="text-right py-2 px-3">
                              <Input
                                type="number"
                                min={0}
                                max={item.quantity}
                                value={quantities[item.id] ?? item.received_quantity}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setQuantities(prev => ({
                                    ...prev,
                                    [item.id]: Math.min(Math.max(0, val), item.quantity),
                                  }));
                                }}
                                className="w-20 h-8 text-right inline-block"
                              />
                            </td>
                            <td className="text-right py-2 px-3 text-muted-foreground">
                              ${item.unit_cost.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end mt-4">
                  <Button
                    onClick={() => handleReceive(po)}
                    disabled={receiveMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    {receiveMutation.isPending ? '處理中...' : '確認收貨'}
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
