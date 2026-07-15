import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ClipboardList, Plus, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface AggregateToPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: { productId: string; variantId: string | null; quantity: number; productName: string; sku: string; sourceOrderIds: string[] }[];
  onCreated: () => void;
}

export function AggregateToPODialog({
  open,
  onOpenChange,
  selectedItems,
  onCreated,
}: AggregateToPODialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState<string>('');
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [existingPOId, setExistingPOId] = useState<string>('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: draftPOs = [] } = useQuery({
    queryKey: ['purchase-orders-draft', supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, order_date, notes, total_amount')
        .eq('status', 'draft')
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open && targetMode === 'existing' && !!supplierId,
  });

  // Fetch supplier mappings to get vendor_unit_cost if available
  const { data: supplierMappings = [] } = useQuery({
    queryKey: ['supplier-mappings-for-po', supplierId],
    queryFn: async () => {
      if (!supplierId) return [];
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('internal_product_id, internal_variant_id, vendor_unit_cost')
        .eq('supplier_id', supplierId);
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!supplierId,
  });

  // Fetch product wholesale prices for cost estimation
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-aggregate-po'],
    queryFn: async () => {
      const productIds = [...new Set(selectedItems.map(i => i.productId))];
      const { data, error } = await supabase
        .from('products')
        .select('id, base_wholesale_price')
        .in('id', productIds);
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const getUnitCost = (productId: string, variantId: string | null): number => {
    // Prefer supplier-specific price from mappings
    if (supplierId) {
      const mapping = supplierMappings.find(
        (m: any) => m.internal_product_id === productId && m.internal_variant_id === variantId
      );
      if (mapping?.vendor_unit_cost) return mapping.vendor_unit_cost;
    }
    // Fallback to product base wholesale price
    const product = products.find((p: any) => p.id === productId);
    return product?.base_wholesale_price || 0;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('請選擇供應商');
      if (targetMode === 'existing' && !existingPOId) throw new Error('請選擇目標採購單');

      let poId = existingPOId;
      let totalAmount = 0;

      // Create new PO if needed
      if (targetMode === 'new') {
        const { data: newPO, error: poError } = await (supabase as any)
          .from('purchase_orders')
          .insert({
            supplier_id: supplierId,
            status: 'draft',
            order_date: new Date().toISOString().split('T')[0],
            total_amount: 0,
            supplier_order_number: null,
            created_by: user?.id,
          })
          .select()
          .single();
        if (poError) throw poError;
        poId = newPO.id;
      }

      // Add items to PO
      for (const item of selectedItems) {
        const unitCost = getUnitCost(item.productId, item.variantId);
        const itemTotal = unitCost * item.quantity;
        totalAmount += itemTotal;

        const { error: itemError } = await (supabase as any)
          .from('purchase_order_items')
          .insert({
            purchase_order_id: poId,
            product_id: item.productId,
            variant_id: item.variantId,
            quantity: item.quantity,
            received_quantity: 0,
            unit_cost: unitCost,
            source_order_ids: item.sourceOrderIds,
          });
        if (itemError) throw itemError;
      }

      // Update PO total if adding to existing
      if (targetMode === 'existing') {
        const { data: existingPO } = await (supabase as any)
          .from('purchase_orders')
          .select('total_amount')
          .eq('id', poId)
          .single();
        totalAmount += existingPO?.total_amount || 0;
      }

      await (supabase as any)
        .from('purchase_orders')
        .update({ total_amount: totalAmount })
        .eq('id', poId);

      return poId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success(`已建立採購單，含 ${selectedItems.length} 項產品`);
      onOpenChange(false);
      onCreated();
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  const totalEstimatedCost = selectedItems.reduce((sum, item) => {
    return sum + getUnitCost(item.productId, item.variantId) * item.quantity;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            轉為採購單
          </DialogTitle>
          <DialogDescription>
            將 {selectedItems.length} 項產品轉入採購單
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Supplier Selection */}
          <div className="space-y-2">
            <Label>供應商</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇供應商" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target Mode */}
          <div className="space-y-2">
            <Label>目標</Label>
            <div className="flex gap-2">
              <Button
                variant={targetMode === 'new' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTargetMode('new')}
                className="flex-1"
              >
                <Plus className="h-4 w-4 mr-1" /> 建立新採購單
              </Button>
              <Button
                variant={targetMode === 'existing' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTargetMode('existing')}
                className="flex-1"
              >
                <ArrowRight className="h-4 w-4 mr-1" /> 匯入現有採購單
              </Button>
            </div>
          </div>

          {/* Existing PO Selection */}
          {targetMode === 'existing' && (
            <div className="space-y-2">
              <Label>選擇 Draft 採購單</Label>
              <Select value={existingPOId} onValueChange={setExistingPOId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇採購單" />
                </SelectTrigger>
                <SelectContent>
                  {draftPOs.length === 0 ? (
                    <SelectItem value="none" disabled>無 Draft 狀態的採購單</SelectItem>
                  ) : (
                    draftPOs.map((po: any) => (
                      <SelectItem key={po.id} value={po.id}>
                        ${po.total_amount?.toLocaleString() || 0}
                        {po.notes ? ` - ${po.notes}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Items Preview */}
          <div className="space-y-2">
            <Label>產品清單</Label>
            <ScrollArea className="max-h-[50vh] rounded-md border">
              <div className="p-2 space-y-1">
                {selectedItems.map((item, i) => {
                  const cost = getUnitCost(item.productId, item.variantId);
                  return (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/30">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium truncate block">{item.productName}</span>
                        <span className="text-xs text-muted-foreground font-mono">{item.sku}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <Badge variant="secondary">x{item.quantity}</Badge>
                        {cost > 0 && (
                          <span className="text-xs text-muted-foreground block mt-0.5">
                            ${cost.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
            {totalEstimatedCost > 0 && (
              <div className="text-right text-sm text-muted-foreground">
                預估總金額：<span className="font-bold text-foreground">${totalEstimatedCost.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!supplierId || createMutation.isPending || (targetMode === 'existing' && !existingPOId)}
          >
            {createMutation.isPending ? '建立中...' : '確認建立'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
