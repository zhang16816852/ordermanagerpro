import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStoreProductCache } from '@/hooks/useProductCache';
import { useStoreDraft } from '@/store/useOrderDraftStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Save, Lock, Unlock, Plus, AlertTriangle, Search, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { OrderItemsTable, OrderItemRow } from '@/components/order/OrderItemsTable';

const statusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
  cancelled: { label: '已取消', className: 'bg-destructive text-destructive-foreground' },
};

export default function AdminOrderForm() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const storeIdFromParam = searchParams.get('storeId') || '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const isEditMode = !!orderId;

  // Edit mode: fetch existing order
  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          stores (name, code, brand),
          order_items (
            id,
            product_id,
            variant_id,
            quantity,
            unit_price,
            shipped_quantity,
            status,
            selected_model_name,
            products (name, sku),
            product_variants (name, option_1, option_2, option_3)
          )
        `)
        .eq('id', orderId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });

  const storeId = isEditMode ? (order?.store_id ?? '') : storeIdFromParam;
  const { products: storeProducts, isLoading: productsLoading } = useStoreProductCache(storeId || null);
  const draft = useStoreDraft(storeId);

  // Fetch store info (create mode)
  const { data: storeInfo } = useQuery({
    queryKey: ['store', storeId],
    queryFn: async () => {
      if (!storeId) return null;
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, code, brand')
        .eq('id', storeId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!storeId && !isEditMode,
  });

  const displayStoreName = isEditMode ? order?.stores?.name : (storeInfo?.name || storeId);
  const displayBrand = isEditMode ? order?.stores?.brand : storeInfo?.brand;

  // Local state
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [priceSyncMap, setPriceSyncMap] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isPendingMode2, setIsPendingMode2] = useState(false);
  const [directShipDialogOpen, setDirectShipDialogOpen] = useState(false);

  // Refs to avoid stale closures in mutations
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const orderRef = useRef(order);
  orderRef.current = order;

  // Edit mode: populate state from fetched order
  useEffect(() => {
    if (!isEditMode || !order) return;
    setNotes(order.notes || '');
    setItems(order.order_items.map((item: any) => ({
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id || undefined,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      selectedModelName: item.selected_model_name || undefined,
      sku: item.products?.sku || '',
      productName: item.products?.name || '',
      variantName: item.product_variants?.name || undefined,
    })));
  }, [isEditMode, order]);

  // Create mode: populate state from draft store on mount
  useEffect(() => {
    if (isEditMode) return;
    setNotes(draft.notes);
    setItems(draft.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.price,
      selectedModelName: item.selectedModelName,
      sku: item.sku,
      productName: item.productName || item.name,
      variantName: item.variantName,
    })));
    setPriceSyncMap(draft.priceSyncMap);
  }, []);

  // Handlers
  const handleQuantityChange = useCallback((index: number, value: number) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: Math.max(1, value) };
      return next;
    });
  }, []);

  const handlePriceChange = useCallback((index: number, value: number) => {
    const itemId = itemsRef.current[index]?.id;
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], unitPrice: Math.max(0, value) };
      return next;
    });
    if (itemId) {
      setPriceSyncMap((prev) => ({ ...prev, [itemId]: true }));
    }
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleTogglePriceSync = useCallback((id: string, checked: boolean) => {
    setPriceSyncMap((prev) => ({ ...prev, [id]: checked }));
  }, []);

  const handleAddProductToItems = useCallback((product: any, variant?: any) => {
    const { id: productId, name, sku, wholesale_price } = product;
    const variantId = variant?.id || undefined;
    const newId = `new-${Date.now()}`;

    const existingIndex = items.findIndex(
      (i) => i.productId === productId && (i.variantId || null) === (variantId || null)
    );

    if (existingIndex >= 0) {
      setItems((prev) => {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], quantity: next[existingIndex].quantity + 1 };
        return next;
      });
    } else {
      const price = variant?.effective_wholesale_price ?? variant?.wholesale_price ?? wholesale_price ?? 0;
      const variantName = variant?.name || undefined;
      const variantSku = variant?.sku || undefined;
      setItems((prev) => [
        ...prev,
        {
          id: newId,
          productId,
          variantId,
          quantity: 1,
          unitPrice: price,
          isNew: true,
          sku: variantSku || sku || '',
          productName: name || '',
          variantName,
        },
      ]);
    }
    setSheetOpen(false);
    setProductSearch('');
    toast.success('已新增產品');
  }, [items]);

  // Sync prices to brand
  const syncPrices = useCallback(async () => {
    const brand = isEditMode ? order?.stores?.brand : storeInfo?.brand;
    if (!brand) {
      toast.info('無法同步：無品牌資訊');
      return;
    }

    const itemsToSync = items
      .filter((i) => priceSyncMap[i.id])
      .map((i) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        wholesale_price: i.unitPrice,
      }));

    if (itemsToSync.length === 0) {
      toast.info('未選取任何需同步的品項');
      return;
    }

    const { error } = await supabase.rpc('upsert_brand_product_prices', {
      p_brand: brand,
      p_products: itemsToSync,
    });

    if (error) {
      console.error('同步價格失敗:', error);
      toast.error('部分價格同步失敗，請至品牌價格管理頁面檢查');
    } else {
      toast.success('價格已同步');
    }
  }, [items, priceSyncMap, order, storeId, storeInfo, isEditMode]);

  // Edit mode: update existing order
  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      const currentOrder = orderRef.current;
      if (!orderId || !currentOrder) throw new Error('訂單不存在');
      await supabase.from('orders').update({ notes: currentNotes || null }).eq('id', orderId);

      for (const item of currentItems) {
        if (item.isNew) {
          const { error } = await supabase.from('order_items').insert({
            order_id: orderId,
            product_id: item.productId,
            variant_id: item.variantId || null,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            selected_model_name: item.selectedModelName || null,
            store_id: currentOrder.store_id,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('order_items')
            .update({ quantity: item.quantity, unit_price: item.unitPrice })
            .eq('id', item.id);
          if (error) throw error;
        }
      }

      const existingIds = currentOrder.order_items.map((i: any) => i.id);
      const currentIds = currentItems.filter((i) => !i.isNew).map((i) => i.id);
      const toDelete = existingIds.filter((id: string) => !currentIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('order_items').delete().in('id', toDelete);
      }
    },
    onSuccess: () => {
      toast.success('訂單已更新');
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/admin/orders');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // Create mode: insert order + items (pending)
  const createPendingMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      if (currentItems.length === 0) throw new Error('訂單項目是空的');
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          store_id: storeId,
          created_by: user?.id,
          source_type: 'admin_proxy',
          notes: currentNotes.trim() || null,
        })
        .select('id')
        .single();
      if (orderError) throw orderError;

      const orderItems = currentItems.map((item) => ({
        order_id: newOrder.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        store_id: storeId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        selected_model_name: item.selectedModelName || null,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) throw itemsError;
      return newOrder;
    },
    onSuccess: () => {
      toast.success('訂單已建立');
      draft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/admin/orders');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // Create mode: insert order + items + sales note (shipped_with_sales_note)
  const handleCreateWithSalesNote = useCallback(async () => {
    if (isEditMode) return;
    setIsPendingMode2(true);
    try {
      const payload = items.map((i) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        selected_model_name: i.selectedModelName || null,
      }));

      const { data, error } = await supabase.rpc('create_order_with_sales_note', {
        p_store_id: storeId,
        p_created_by: user?.id,
        p_notes: notes.trim() || null,
        p_items: payload,
      });
      if (error) throw error;

      const link = `${window.location.origin}/share/sales-note/${data.sales_note_code || data.sales_note_id}?token=${data.access_token}`;
      toast.success('訂單已建立並開立銷貨單！', {
        duration: 10000,
        action: {
          label: '複製連結',
          onClick: () => {
            navigator.clipboard.writeText(link);
            toast.success('連結已複製');
          },
        },
      });

      draft.clearDraft();
      navigate('/admin/orders');
    } catch (err) {
      toast.error(getErrorMessage(err, '建立訂單失敗'));
    } finally {
      setIsPendingMode2(false);
    }
  }, [isEditMode, items, notes, storeId, user, navigate, draft]);

  // Status toggle (edit mode only)
  const toggleStatusMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !order) throw new Error('訂單不存在');
      const newStatus = order.status === 'pending' ? 'processing' : 'pending';
      await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
    },
    onSuccess: () => {
      toast.success('訂單狀態已更新');
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // Direct ship: turn processing order into sales note
  const directShipMutation = useMutation({
    mutationFn: async () => {
      if (!user || !orderId) throw new Error('訂單不存在');
      const { data, error } = await supabase.rpc('direct_ship_order', {
        p_order_id: orderId,
        p_created_by: user.id,
        p_notes: null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      const link = `${window.location.origin}/share/sales-note/${result.sales_note_code || result.sales_note_id}?token=${result.access_token}`;
      toast.success('訂單已轉為銷貨單！', {
        duration: 10000,
        action: {
          label: '複製連結',
          onClick: () => {
            navigator.clipboard.writeText(link);
            toast.success('連結已複製');
          },
        },
      });
      setDirectShipDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/admin/orders');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // Available products for picker
  const availableProducts = useMemo(() => {
    if (!storeProducts) return [];
    const usedKeys = new Set(items.map((i) => `${i.productId}-${i.variantId || ''}`));
    return storeProducts.filter((p) => {
      if (!p.variants || p.variants.length === 0) {
        return !usedKeys.has(`${p.id}-`);
      }
      return p.variants.some((v: any) => !usedKeys.has(`${p.id}-${v.id}`));
    });
  }, [storeProducts, items]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return availableProducts;
    const q = productSearch.toLowerCase();
    return availableProducts.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.variants?.some((v: any) => v.name?.toLowerCase().includes(q) || v.sku?.toLowerCase().includes(q))
    );
  }, [availableProducts, productSearch]);

  const isSubmitting = updateOrderMutation.isPending || createPendingMutation.isPending || isPendingMode2 || directShipMutation.isPending;

  // Loading / empty states
  if (isEditMode && orderLoading) {
    return <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">載入中...</div></div>;
  }
  if (isEditMode && !order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">找不到訂單</p>
        <Button onClick={() => navigate('/admin/orders')}><ArrowLeft className="mr-2 h-4 w-4" />返回訂單列表</Button>
      </div>
    );
  }
  if (!isEditMode && !storeId) {
    return <div className="text-center py-12 text-muted-foreground">請先選擇店鋪再進行結帳</div>;
  }

  const statusInfo = order ? statusLabels[order.status] || { label: order.status, className: 'bg-muted text-muted-foreground' } : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/admin/orders')}>
            <ArrowLeft className="mr-2 h-4 w-4" />返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{isEditMode ? '編輯訂單' : '建立訂單'}</h1>
            <p className="text-muted-foreground font-mono text-sm">
              {isEditMode ? order!.id : `店鋪: ${displayStoreName}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusInfo && <Badge className={statusInfo.className}>{statusInfo.label}</Badge>}
          {isEditMode && order!.status !== 'shipped' && (
            <Button variant="outline" onClick={() => toggleStatusMutation.mutate()} disabled={toggleStatusMutation.isPending}>
              {order!.status === 'pending' ? <><Lock className="mr-2 h-4 w-4" />鎖定訂單</> : <><Unlock className="mr-2 h-4 w-4" />解除鎖定</>}
            </Button>
          )}
        </div>
      </div>

      {/* Warning for non-pending orders */}
      {isEditMode && order!.status !== 'pending' && (
        <Alert variant="default" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800 dark:text-yellow-200">
            此訂單狀態為「{statusInfo?.label}」，部分品項可能已在出貨池或已出貨。修改時請謹慎操作，避免資料不一致。
          </AlertDescription>
        </Alert>
      )}

      {/* Top row: Store info + Notes */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>訂單資訊</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">店鋪：</span>
                <span className="font-medium">{displayStoreName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">品牌：</span>
                <span className="font-medium">{displayBrand || '-'}</span>
              </div>
              {isEditMode && (
                <>
                  <div>
                    <span className="text-muted-foreground">建立時間：</span>
                    <span>{format(new Date(order!.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">來源：</span>
                    <span>{order!.source_type === 'frontend' ? '前台' : '後台'}</span>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>訂單備註</CardTitle></CardHeader>
          <CardContent>
            <Textarea placeholder="輸入訂單備註..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </CardContent>
        </Card>
      </div>

      {/* Add product button + Sheet */}
      <div className="flex justify-start">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />開啟商品目錄</Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-[500px] p-0 flex flex-col">
            <SheetHeader className="p-4 border-b shrink-0">
              <SheetTitle>選擇產品</SheetTitle>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="搜尋產品名稱、SKU..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="pl-9" />
              </div>
            </SheetHeader>
            <ScrollArea className="flex-1 p-4">
              {productsLoading ? (
                <div className="text-center py-8 text-muted-foreground">載入中...</div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {productSearch ? '沒有符合的產品' : '所有產品已加入訂單'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredProducts.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      onAdd={handleAddProductToItems}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      {/* Order items table */}
      <Card>
        <CardHeader><CardTitle>訂單項目</CardTitle></CardHeader>
        <CardContent>
          <OrderItemsTable
            items={items}
            onUpdateQuantity={handleQuantityChange}
            onUpdatePrice={handlePriceChange}
            onRemove={handleRemoveItem}
            isEditable={true}
            priceSyncMap={priceSyncMap}
            onTogglePriceSync={handleTogglePriceSync}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={syncPrices} disabled={isSubmitting}>
          <Save className="mr-2 h-4 w-4" />同步價格
        </Button>
        {isEditMode ? (
          <>
            {order?.status === 'processing' && (
              <Button variant="default" onClick={() => setDirectShipDialogOpen(true)} disabled={isSubmitting}>
                <Send className="mr-2 h-4 w-4" />
                轉銷貨單
              </Button>
            )}
            <Button onClick={() => updateOrderMutation.mutate()} disabled={isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {updateOrderMutation.isPending ? '儲存中...' : '儲存變更'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => createPendingMutation.mutate()} disabled={isSubmitting || items.length === 0}>
              {createPendingMutation.isPending ? '建立中...' : '建立訂單'}
            </Button>
            <Button onClick={handleCreateWithSalesNote} disabled={isSubmitting || items.length === 0} variant="default">
              建立訂單並開立銷貨單
            </Button>
          </>
        )}
      </div>

      {/* Direct Ship Dialog */}
      <Dialog open={directShipDialogOpen} onOpenChange={setDirectShipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              直接轉銷貨單
            </DialogTitle>
            <DialogDescription>
              將此訂單的所有剩餘品項直接出貨，跳過出貨池。
              出貨後訂單狀態將變為「已出貨」。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">訂單：</span><span className="font-medium">{order?.code || orderId}</span></div>
                <div><span className="text-muted-foreground">品項數：</span><span className="font-medium">{items.length}</span></div>
                <div><span className="text-muted-foreground">店鋪：</span><span className="font-medium">{displayStoreName}</span></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDirectShipDialogOpen(false)} disabled={directShipMutation.isPending}>
              取消
            </Button>
            <Button
              onClick={() => directShipMutation.mutate()}
              disabled={directShipMutation.isPending}
            >
              {directShipMutation.isPending ? '處理中...' : '確認轉銷貨單'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductRow({ product, onAdd }: { product: any; onAdd: (product: any, variant?: any) => void }) {
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const hasVariants = product.variants && product.variants.length > 0;
  const selectedVariant = hasVariants ? product.variants.find((v: any) => v.id === selectedVariantId) : undefined;

  return (
    <div className="flex items-start justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors gap-2">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-muted-foreground">{product.sku}</span>
          {product.wholesale_price != null && (
            <Badge variant="outline" className="text-[10px] shrink-0">${product.wholesale_price}</Badge>
          )}
        </div>
        <p className="font-medium text-sm break-words">{product.name}</p>
        {hasVariants && (
          <Select value={selectedVariantId} onValueChange={setSelectedVariantId}>
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="選擇變體" />
            </SelectTrigger>
            <SelectContent>
              {product.variants.map((v: any) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  {v.name} ({v.sku}) - ${v.effective_wholesale_price ?? v.wholesale_price}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Button
        size="sm"
        className="shrink-0 mt-1"
        onClick={() => onAdd(product, selectedVariant)}
        disabled={hasVariants && !selectedVariantId}
      >
        <Plus className="h-4 w-4 mr-1" />新增
      </Button>
    </div>
  );
}
