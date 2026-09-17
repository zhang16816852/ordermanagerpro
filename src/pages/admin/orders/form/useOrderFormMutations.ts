import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { OrderItemRow } from '@/components/order/orderItemsTypes';
import { useStoreDraft } from '@/store/useOrderDraftStore';

export interface OrderFormMutationParams {
  orderId?: string;
  user: { id: string } | null;
  isRep: boolean;
  isEditMode: boolean;
  storeId: string;
  order?: any;
  storeInfo?: any;
  supplierId: string;
  targetStoreId: string;
  expectedDate: string;
  supplierOrderNumber: string;
  shippedAt: string;
  itemSources: Record<string, string>;
  getItemWarehouse: (id: string) => string;
  draft: ReturnType<typeof useStoreDraft>;
  itemsRef: { current: OrderItemRow[] };
  notesRef: { current: string };
  consignmentModeRef: { current: boolean };
  pendingDeletedIdsRef: { current: string[] };
  priceSyncMap: Record<string, boolean>;
  itemsForSync: OrderItemRow[];
  onDirectShipDialogClose: () => void;
}

export function useOrderFormMutations(params: OrderFormMutationParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    orderId,
    user,
    isRep,
    isEditMode,
    storeId,
    order,
    storeInfo,
    supplierId,
    targetStoreId,
    expectedDate,
    supplierOrderNumber,
    shippedAt,
    itemSources,
    getItemWarehouse,
    draft,
    itemsRef,
    notesRef,
    consignmentModeRef,
    pendingDeletedIdsRef,
    priceSyncMap,
    itemsForSync,
    onDirectShipDialogClose,
  } = params;

  const buildItemsPayload = useCallback((currentItems: OrderItemRow[]) =>
    currentItems.map((item, index) => ({
      id: item.isNew ? null : item.id,
      product_id: item.productId,
      variant_id: item.variantId || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      unit_cost: item.unitCost ?? undefined,
      selected_model_name: item.selectedModelName || undefined,
      shipping_payment: item.shippingPayment ?? undefined,
      temp_key: item.isNew ? (item.tempKey ?? `temp-${Date.now().toString(36)}-${index}`) : undefined,
      parent_temp_key: item.parentTempKey ?? undefined,
      sort_order: index + 1,
    })), []);

  const [isPendingMode2, setIsPendingMode2] = useState(false);

  // Edit mode: update existing order
  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      const currentDeletedIds = pendingDeletedIdsRef.current;
      if (!orderId) throw new Error('訂單不存在');

      const payload = buildItemsPayload(currentItems);

      const { data, error } = await supabase.rpc('update_order_with_items', {
        p_order_id: orderId,
        p_notes: currentNotes || undefined,
        p_items: payload,
        p_deleted_item_ids: currentDeletedIds.length > 0 ? currentDeletedIds : undefined,
      });
      if (error) throw error;
      const result = data as { ok?: boolean; reason?: string; adopted_by?: Array<{ label?: string }> } | null;
      if (result && result.ok === false) {
        const err = new Error(result.reason || '儲存失敗') as any;
        const labels = (result.adopted_by || []).map((b: any) => b?.label).filter(Boolean).join('、');
        err.hint = labels ? `被引用：${labels}` : '';
        err.reason = result.reason;
        throw err;
      }
    },
    onSuccess: () => {
      toast.success('訂單已更新');
      pendingDeletedIdsRef.current = [];
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      navigate('/admin/orders');
    },
    onError: (error: any) => {
      if (error?.reason) {
        toast.error(`儲存失敗：${error.reason}`, { description: error?.hint || undefined });
      } else {
        toast.error(getErrorMessage(error));
      }
    },
  });

  // Create mode: insert order + items (pending)
  const createPendingMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      if (currentItems.length === 0) throw new Error('訂單項目是空的');
      if (!storeId) throw new Error('請先選擇店鋪');
      const { data: newOrder, error: orderError } = await (supabase
        .from('orders') as any)
        .insert({
          store_id: storeId,
          created_by: user?.id,
          sales_rep_id: isRep ? user?.id : null,
          source_type: 'admin_proxy',
          notes: currentNotes.trim() || null,
          consignment_mode: consignmentModeRef.current,
          access_token: crypto.randomUUID(),
        })
        .select('id')
        .single();
      if (orderError) throw orderError;

      const orderItems = currentItems.map((item, index) => ({
        order_id: newOrder.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        store_id: storeId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unit_cost: item.unitCost ?? 0,
        selected_model_name: item.selectedModelName || null,
        shipping_payment: item.shippingPayment ?? null,
        sort_order: index + 1,
      }));

      const { error: itemsError } = await (supabase.from('order_items') as any).insert(orderItems);
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
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      if (currentItems.length === 0) throw new Error('訂單項目是空的');
      if (!storeId) throw new Error('請先選擇店鋪');

      const payload = currentItems.map((i, index) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        unit_cost: i.unitCost ?? undefined,
        selected_model_name: i.selectedModelName || null,
        warehouse_id: getItemWarehouse(i.id) || null,
        inventory_source_type: itemSources[i.id] || "self",
        shipping_payment: i.shippingPayment ?? undefined,
        temp_key: i.tempKey ?? `temp-${Date.now().toString(36)}-${index}`,
        parent_temp_key: i.parentTempKey ?? undefined,
        sort_order: index + 1,
      }));

      const { data, error } = await supabase.rpc('create_order_with_sales_note', {
        p_store_id: storeId,
        p_created_by: user?.id as string,
        p_notes: currentNotes.trim() || undefined,
        p_items: payload,
        p_shipped_at: shippedAt ? new Date(shippedAt).toISOString() : undefined,
        p_warehouse_id: undefined,
        p_consignment_mode: consignmentModeRef.current,
      });
      if (error) throw error;

      if (consignmentModeRef.current) {
        toast.success('訂單已建立並以店家寄賣方式出貨，確認售出後才開立銷貨單');
      } else {
        const link = `${window.location.origin}/share/sale/${(data as any).sales_note_code || (data as any).sales_note_id}?token=${(data as any).access_token}`;
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
      }

      draft.clearDraft();
      navigate('/admin/orders');
    } catch (err) {
      toast.error(getErrorMessage(err, '建立訂單失敗'));
    } finally {
      setIsPendingMode2(false);
    }
  }, [isEditMode, storeId, user, navigate, draft, itemSources, getItemWarehouse, shippedAt]);

  // Status toggle (edit mode only)
  const toggleStatusMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !order) throw new Error('訂單不存在');
      const newStatus = order.status === 'pending' ? 'processing' : 'pending';
      await (supabase.from('orders') as any).update({ status: newStatus }).eq('id', orderId);
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
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      const currentDeletedIds = pendingDeletedIdsRef.current;

      // 先持久化本地的拆分/編輯結果（direct_ship_order 只讀 DB order_items）
      const prePayload = buildItemsPayload(currentItems);
      const { data: preSaveData, error: preSaveError } = await supabase.rpc('update_order_with_items', {
        p_order_id: orderId,
        p_notes: currentNotes || undefined,
        p_items: prePayload,
        p_deleted_item_ids: currentDeletedIds.length > 0 ? currentDeletedIds : undefined,
      });
      if (preSaveError) throw preSaveError;
      const preSaveResult = preSaveData as { ok?: boolean; reason?: string; adopted_by?: Array<{ label?: string }> } | null;
      if (preSaveResult && preSaveResult.ok === false) {
        const err = new Error(preSaveResult.reason || '儲存失敗') as any;
        const labels = (preSaveResult.adopted_by || []).map((b: any) => b?.label).filter(Boolean).join('、');
        err.hint = labels ? `被引用：${labels}` : '';
        err.reason = preSaveResult.reason;
        throw err;
      }

      const warehouseMap = currentItems.reduce((acc, i) => {
        const wh = getItemWarehouse(i.id);
        if (wh) acc[i.id] = wh;
        return acc;
      }, {} as Record<string, string>);
      const sourceMap = currentItems.reduce((acc, i) => {
        const src = itemSources[i.id];
        if (src) acc[i.id] = src;
        return acc;
      }, {} as Record<string, string>);
      const { data, error } = await supabase.rpc('direct_ship_order', {
        p_order_id: orderId,
        p_created_by: user.id,
        p_notes: undefined,
        p_shipped_at: shippedAt ? new Date(shippedAt).toISOString() : undefined,
        p_warehouse_id: undefined,
        p_warehouse_map: Object.keys(warehouseMap).length > 0 ? warehouseMap : undefined,
        p_source_map: Object.keys(sourceMap).length > 0 ? sourceMap : undefined,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      if (result?.sales_note_id) {
        const link = `${window.location.origin}/share/sale/${result.sales_note_code || result.sales_note_id}?token=${result.access_token}`;
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
      } else {
        toast.success('訂單已以店家寄賣方式出貨，確認售出後才開立銷貨單');
      }
      onDirectShipDialogClose();
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      navigate('/admin/orders');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // --- Purchase Order mutation ---
  const createPurchaseOrderMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      if (currentItems.length === 0) throw new Error('請至少新增一項產品');
      if (!supplierId) throw new Error('請選擇供應商');

      const totalAmount = currentItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      const { data: newPO, error: poError } = await (supabase as any)
        .from('purchase_orders')
        .insert({
          supplier_id: supplierId,
          status: 'draft',
          order_date: new Date().toISOString().split('T')[0],
          expected_date: expectedDate || null,
          supplier_order_number: supplierOrderNumber || null,
          total_amount: totalAmount,
          notes: currentNotes.trim() || null,
          created_by: user?.id,
        })
        .select('id')
        .single();
      if (poError) throw poError;

      const poItems = currentItems.map((item) => ({
        purchase_order_id: newPO.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        quantity: item.quantity,
        received_quantity: 0,
        unit_cost: item.unitPrice,
      }));
      const { error: itemsError } = await (supabase as any).from('purchase_order_items').insert(poItems);
      if (itemsError) throw itemsError;

      return newPO;
    },
    onSuccess: () => {
      toast.success('採購單已建立');
      draft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate('/admin/purchase-orders');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '建立採購單失敗')),
  });

  // --- Consignment Order mutations ---
  const createConsignmentReceiveMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      if (currentItems.length === 0) throw new Error('請至少新增一項產品');
      if (!supplierId) throw new Error('請選擇供應商');

      const { data: newCO, error: coError } = await (supabase as any)
        .from('consignment_orders')
        .insert({
          direction: 'receive_from_supplier',
          supplier_id: supplierId,
          status: 'draft',
          note: currentNotes.trim() || null,
          created_by: user?.id,
        })
        .select('id, code')
        .single();
      if (coError) throw coError;

      const coItems = currentItems.map((item) => ({
        consignment_order_id: newCO.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unit_cost: item.unitPrice,
      }));
      const { error: itemsError } = await (supabase as any).from('consignment_order_items').insert(coItems);
      if (itemsError) throw itemsError;

      return newCO;
    },
    onSuccess: () => {
      toast.success('寄賣收貨單已建立');
      draft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      navigate('/admin/consignment');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '建立寄賣收貨單失敗')),
  });

  const createConsignmentSendMutation = useMutation({
    mutationFn: async () => {
      const currentItems = itemsRef.current;
      const currentNotes = notesRef.current;
      if (currentItems.length === 0) throw new Error('請至少新增一項產品');
      if (!supplierId) throw new Error('請選擇供應商');
      if (!targetStoreId) throw new Error('請選擇目標門市');

      const { data: newCO, error: coError } = await (supabase as any)
        .from('consignment_orders')
        .insert({
          direction: 'send_to_store',
          supplier_id: supplierId,
          store_id: targetStoreId,
          status: 'draft',
          note: currentNotes.trim() || null,
          created_by: user?.id,
        })
        .select('id, code')
        .single();
      if (coError) throw coError;

      const coItems = currentItems.map((item) => ({
        consignment_order_id: newCO.id,
        product_id: item.productId,
        variant_id: item.variantId || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unit_cost: item.unitPrice,
      }));
      const { error: itemsError } = await (supabase as any).from('consignment_order_items').insert(coItems);
      if (itemsError) throw itemsError;

      return newCO;
    },
    onSuccess: () => {
      toast.success('寄賣出貨單已建立');
      draft.clearDraft();
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
      navigate('/admin/consignment');
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '建立寄賣出貨單失敗')),
  });

  const syncPrices = useCallback(async () => {
    const brand = isEditMode ? order?.stores?.brand : storeInfo?.brand;
    if (!brand) {
      toast.info('無法同步：無品牌資訊');
      return;
    }

    const itemsToSync = itemsForSync
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
  }, [itemsForSync, priceSyncMap, order, storeId, storeInfo, isEditMode]);

  const isSubmitting = updateOrderMutation.isPending || createPendingMutation.isPending || isPendingMode2 || directShipMutation.isPending || createPurchaseOrderMutation.isPending || createConsignmentReceiveMutation.isPending || createConsignmentSendMutation.isPending;

  return {
    updateOrderMutation,
    createPendingMutation,
    handleCreateWithSalesNote,
    toggleStatusMutation,
    directShipMutation,
    createPurchaseOrderMutation,
    createConsignmentReceiveMutation,
    createConsignmentSendMutation,
    syncPrices,
    isPendingMode2,
    isSubmitting,
  };
}