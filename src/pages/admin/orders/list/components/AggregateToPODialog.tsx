import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ClipboardList, Plus, ArrowRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface EditableItem {
  key: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  maxQuantity: number;
  unitCost: number;
  productName: string;
  variantName?: string | null;
  sku: string;
  sourceOrderIds: string[];
  sourceQuantities: Record<string, number>;
}

interface AggregateToPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: { productId: string; variantId: string | null; quantity: number; maxQuantity?: number; productName: string; variantName?: string | null; sku: string; sourceOrderIds: string[]; sourceQuantities?: Record<string, number> }[];
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
  const [showAddItem, setShowAddItem] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addVariantId, setAddVariantId] = useState('');
  const [addQuantity, setAddQuantity] = useState('1');
  const [addUnitCost, setAddUnitCost] = useState('');

  // Editable items state — initialized from selectedItems when dialog opens
  const [editableItems, setEditableItems] = useState<EditableItem[]>([]);

  // 使用者手動改過單價的 key 集合（自動帶入價格時不覆寫手動輸入）
  const touchedCostRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setEditableItems(selectedItems.map((item, i) => ({
        key: `sel-${i}-${item.productId}-${item.variantId || 'base'}`,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        maxQuantity: item.maxQuantity ?? item.quantity,
        unitCost: 0,
        productName: item.productName,
        variantName: item.variantName ?? null,
        sku: item.sku,
        sourceOrderIds: item.sourceOrderIds,
        sourceQuantities: item.sourceQuantities ?? {},
      })));
      setShowAddItem(false);
      setAddProductId('');
      setAddVariantId('');
      setAddQuantity('1');
      setAddUnitCost('');
      touchedCostRef.current.clear();
    }
  }, [open, selectedItems]);

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
        .neq('purpose', 'purchase_return') // 退貨單不可作為追加品項的目標
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open && targetMode === 'existing' && !!supplierId,
  });

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

  // All products for the "add item" selector
  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-for-add-po-item'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('products') as any)
        .select('id, name, code, unified_wholesale_price')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: open && showAddItem,
  });

  // Variants for selected product in "add item"
  const { data: addVariants = [] } = useQuery({
    queryKey: ['variants-for-add-po-item', addProductId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('product_variants') as any)
        .select('id, name, sku, wholesale_price')
        .eq('product_id', addProductId);
      if (error) throw error;
      return data || [];
    },
    enabled: open && showAddItem && !!addProductId,
  });

  const selectedProductIds = useMemo(
    () => [...new Set(selectedItems.map((item) => item.productId))],
    [selectedItems]
  );
  const selectedVariantIds = useMemo(
    () => [...new Set(selectedItems.filter((item) => item.variantId).map((item) => item.variantId as string))],
    [selectedItems]
  );

  // 為已選品項撈取批發價，確保單價能正確帶入（不再停留在 0）
  const { data: selectedProductPrices = [] } = useQuery({
    queryKey: ['products-for-po-price', selectedProductIds],
    queryFn: async () => {
      if (selectedProductIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('products')
        .select('id, unified_wholesale_price')
        .in('id', selectedProductIds);
      if (error) throw error;
      return data || [];
    },
    enabled: open && selectedProductIds.length > 0,
  });

  const { data: selectedVariantPrices = [] } = useQuery({
    queryKey: ['variants-for-po-price', selectedVariantIds],
    queryFn: async () => {
      if (selectedVariantIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('product_variants')
        .select('id, wholesale_price')
        .in('id', selectedVariantIds);
      if (error) throw error;
      return data || [];
    },
    enabled: open && selectedVariantIds.length > 0,
  });

  const productWholesaleMap = useMemo(
    () => new Map<string, number>(selectedProductPrices.map((p: any) => [p.id, Number(p.unified_wholesale_price) || 0] as [string, number])),
    [selectedProductPrices]
  );
  const variantWholesaleMap = useMemo(
    () => new Map<string, number>(selectedVariantPrices.map((v: any) => [v.id, Number(v.wholesale_price) || 0] as [string, number])),
    [selectedVariantPrices]
  );

  // 供應商對照或任一批發價來源就緒時，自動補齊尚未手動編輯的單價
  // （解析優先序：供應商對照價 → 變體批發價 → 產品批發價）
  useEffect(() => {
    if (supplierId.length === 0 && supplierMappings.length === 0 && productWholesaleMap.size === 0 && variantWholesaleMap.size === 0) return;
    setEditableItems(prev => prev.map(item => {
      if (touchedCostRef.current.has(item.key)) return item;
      let cost = 0;
      if (supplierId) {
        const mapping = supplierMappings.find(
          (m: any) => m.internal_product_id === item.productId && m.internal_variant_id === item.variantId
        );
        if (mapping?.vendor_unit_cost) cost = mapping.vendor_unit_cost;
      }
      if (cost <= 0 && item.variantId) cost = variantWholesaleMap.get(item.variantId) || 0;
      if (cost <= 0) cost = productWholesaleMap.get(item.productId) || 0;
      if (cost > 0) return { ...item, unitCost: cost };
      return item;
    }));
  }, [supplierId, supplierMappings, productWholesaleMap, variantWholesaleMap]);

  const handleUpdateQuantity = (key: string, qty: number) => {
    setEditableItems(prev => prev.map(item =>
      item.key === key ? { ...item, quantity: Math.max(1, qty) } : item
    ));
  };

  const handleUpdateUnitCost = (key: string, cost: number) => {
    touchedCostRef.current.add(key);
    setEditableItems(prev => prev.map(item =>
      item.key === key ? { ...item, unitCost: Math.max(0, cost) } : item
    ));
  };

  const handleRemoveItem = (key: string) => {
    setEditableItems(prev => prev.filter(item => item.key !== key));
  };

  const handleAddItem = () => {
    if (!addProductId) return;
    const product = allProducts.find((p: any) => p.id === addProductId);
    const variant = addVariants.find((v: any) => v.id === addVariantId);
    const qty = parseInt(addQuantity) || 1;
    const cost = parseFloat(addUnitCost) || variant?.wholesale_price || product?.unified_wholesale_price || 0;

    const newItem: EditableItem = {
      key: `add-${Date.now()}-${addProductId}-${addVariantId || 'base'}`,
      productId: addProductId,
      variantId: addVariantId || null,
      quantity: qty,
      maxQuantity: 9999,
      unitCost: cost,
      productName: product?.name || '',
      variantName: variant?.name || null,
      sku: variant?.sku || product?.code || '',
      sourceOrderIds: [],
      sourceQuantities: {},
    };
    setEditableItems(prev => [...prev, newItem]);
    setShowAddItem(false);
    setAddProductId('');
    setAddVariantId('');
    setAddQuantity('1');
    setAddUnitCost('');
  };

  const totalEstimatedCost = useMemo(() => {
    return editableItems.reduce((sum, item) => sum + item.unitCost * item.quantity, 0);
  }, [editableItems]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('請選擇供應商');
      if (targetMode === 'existing' && !existingPOId) throw new Error('請選擇目標採購單');
      if (editableItems.length === 0) throw new Error('請至少新增一項產品');

      let poId = existingPOId;
      let totalAmount = 0;

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

      for (const item of editableItems) {
        const itemTotal = item.unitCost * item.quantity;
        totalAmount += itemTotal;

        const { error: itemError } = await (supabase as any)
          .from('purchase_order_items')
          .insert({
            purchase_order_id: poId,
            product_id: item.productId,
            variant_id: item.variantId,
            quantity: item.quantity,
            received_quantity: 0,
            unit_cost: item.unitCost,
            source_order_ids: item.sourceOrderIds.length > 0 ? item.sourceOrderIds : null,
            source_quantities: item.sourceOrderIds.length > 0 && Object.keys(item.sourceQuantities).length > 0 ? item.sourceQuantities : null,
          });
        if (itemError) throw itemError;
      }

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
      queryClient.invalidateQueries({ queryKey: ['purchase-order-links'] });
      toast.success(`已建立採購單，含 ${editableItems.length} 項產品`);
      onOpenChange(false);
      onCreated();
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            轉為採購單
          </DialogTitle>
          <DialogDescription>
            將 {selectedItems.length} 項產品轉入採購單，可調整數量與單價
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
                        {formatCurrency(po.total_amount || 0)}
                        {po.notes ? ` - ${po.notes}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Editable Items List */}
          <div className="space-y-2">
            <Label>產品清單（{editableItems.length} 項）</Label>
            <ScrollArea className="h-[320px] rounded-md border">
              <div className="p-2 space-y-1">
                {editableItems.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">無產品，請點擊下方新增</div>
                )}
                {editableItems.map((item) => (
                  <div key={item.key} className="flex flex-col gap-2 text-sm py-2 px-2 rounded bg-muted/30">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <span className="font-medium block break-words">{item.variantName || item.productName}</span>
                        <span className="text-xs text-muted-foreground font-mono block">{item.sku}</span>
                        {item.sourceOrderIds.length > 0 && (
                          <span className="text-[10px] text-muted-foreground/70 block">
                            來源：{item.sourceOrderIds.length} 張訂單
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(item.key)}
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex flex-col flex-1">
                        <span className="text-[10px] text-muted-foreground mb-1">數量</span>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => handleUpdateQuantity(item.key, parseInt(e.target.value) || 1)}
                          className="h-7 text-center text-xs"
                        />
                      </div>
                      <div className="flex flex-col flex-1">
                        <span className="text-[10px] text-muted-foreground mb-1">單價</span>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.unitCost || ''}
                          onChange={(e) => handleUpdateUnitCost(item.key, parseFloat(e.target.value) || 0)}
                          className="h-7 text-right text-xs"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Add Item Section */}
            {showAddItem ? (
              <div className="border rounded-md p-3 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">新增品項</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowAddItem(false)}>取消</Button>
                </div>
                <Select value={addProductId} onValueChange={(v) => { setAddProductId(v); setAddVariantId(''); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="選擇產品" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProducts.map((p: any) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.code} - {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {addVariants.length > 0 && (
                  <Select value={addVariantId} onValueChange={setAddVariantId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="選擇變體（選填）" />
                    </SelectTrigger>
                    <SelectContent>
                      {addVariants.map((v: any) => (
                        <SelectItem key={v.id} value={v.id} className="text-xs">
                          {v.sku} - {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-muted-foreground">數量</span>
                    <Input type="number" min={1} value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">單價</span>
                    <Input type="number" min={0} step={0.01} value={addUnitCost} onChange={(e) => setAddUnitCost(e.target.value)} className="h-8 text-xs" placeholder="0" />
                  </div>
                </div>
                <Button size="sm" className="h-7 text-xs w-full" onClick={handleAddItem} disabled={!addProductId}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> 加入清單
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setShowAddItem(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> 新增品項
              </Button>
            )}

            {totalEstimatedCost > 0 && (
              <div className="text-right text-sm text-muted-foreground">
                預估總金額：<span className="font-bold text-foreground">{formatCurrency(totalEstimatedCost)}</span>
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
            disabled={!supplierId || createMutation.isPending || (targetMode === 'existing' && !existingPOId) || editableItems.length === 0}
          >
            {createMutation.isPending ? '建立中...' : '確認建立'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
