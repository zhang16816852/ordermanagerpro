import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { OrderItemRow, isReturnLine } from '@/components/order/orderItemsTypes';
import { useStoreDraft } from '@/store/useOrderDraftStore';
import { DeliveryType } from '@/components/shipping/DeliveryMethodPicker';
import type { ShippingAddressValue } from '@/components/shipping/ShippingAddressFields';

export interface DirectShipDelivery {
  deliveryType: DeliveryType | null;
  deliveryMethodId: string | null;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippingAddress?: ShippingAddressValue | null;
  syncToStore?: boolean;
}

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
  getDeliveryType: () => DeliveryType | null;
  onDirectShipDialogClose: () => void;
}

/**
 * line_type / line_note / return_status / is_repair 必須成組送出：
 * 後端 update_order_with_items 對未帶入的 key 會「保留現值」，
 * 若把退貨列改回一般銷售卻漏掉 return_status=null，會殘留舊值並觸發
 * chk_order_item_return_status_scope / chk_order_item_is_repair_scope（23514）。
 */
const lineTypeFields = (item: OrderItemRow) => {
  const isReturn = isReturnLine(item);
  return {
    line_type: item.lineType || 'sale',
    line_note: item.lineNote || null,
    return_status: isReturn ? item.returnStatus || 'pending' : null,
    is_repair: isReturn ? !!item.isRepair : false,
  };
};

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
    getDeliveryType,
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
      ...lineTypeFields(item),
    })), []);

  // 同步勾選品項的價格到品牌：auto 時（儲存送出自動執行）不顯示「無品牌/無勾選」提示
  const syncPrices = useCallback(async (opts?: { auto?: boolean }) => {
    const brand = isEditMode ? order?.stores?.brand : storeInfo?.brand;
    if (!brand) {
      if (!opts?.auto) toast.info('無法同步：無品牌資訊');
      return;
    }

    const itemsToSync = itemsForSync
      .filter((i) => priceSyncMap[i.id] && (i.lineType ?? 'sale') === 'sale')
      .map((i) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        wholesale_price: i.unitPrice,
      }));

    if (itemsToSync.length === 0) {
      if (!opts?.auto) toast.info('未選取任何需同步的品項');
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
  }, [itemsForSync, priceSyncMap, order, storeInfo, isEditMode]);

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

      // 配送類型：RPC 不動 delivery 欄位，另以一般 update 寫入
      const deliveryTypeVal = getDeliveryType();
      const dw = (supabase.from('orders') as any).update({ delivery_type: deliveryTypeVal || null }).eq('id', orderId);
      const snapResult = await dw;
      if (snapResult.error) throw snapResult.error;

      // 勾選「同步價格」的品項，儲存送出時自動同步到品牌價
      await syncPrices({ auto: true });
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
      const deliveryTypeVal = getDeliveryType();
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
          delivery_type: deliveryTypeVal || null,
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
        ...lineTypeFields(item),
      }));

      const { error: itemsError } = await (supabase.from('order_items') as any).insert(orderItems);
      if (itemsError) throw itemsError;

      // 勾選「同步價格」的品項，儲存送出時自動同步到品牌價
      await syncPrices({ auto: true });
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
        ...lineTypeFields(i),
      }));

      const d = getDeliveryType();
      const { data, error } = await supabase.rpc('create_order_with_sales_note', {
        p_store_id: storeId,
        p_created_by: user?.id as string,
        p_notes: currentNotes.trim() || undefined,
        p_items: payload,
        p_shipped_at: shippedAt ? new Date(shippedAt).toISOString() : undefined,
        p_warehouse_id: undefined,
        p_consignment_mode: consignmentModeRef.current,
        p_delivery_method_id: undefined,
        p_shipping_fee: undefined,
        p_shipping_address: undefined,
        p_delivery_type: d || undefined,
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

      // 勾選「同步價格」的品項，儲存送出時自動同步到品牌價
      await syncPrices({ auto: true });

      draft.clearDraft();
      navigate('/admin/orders');
    } catch (err) {
      toast.error(getErrorMessage(err, '建立訂單失敗'));
    } finally {
      setIsPendingMode2(false);
    }
  }, [isEditMode, storeId, user, navigate, draft, itemSources, getItemWarehouse, syncPrices, shippedAt]);

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

  // 編輯模式切換寄賣模式：consignment_mode 非 update_order_with_items 參數，
  // 且 pending 單只翻 flag 沒草稿沒意義，故設計為「點擊即執行」的動作
  const toggleConsignmentModeMutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!orderId || !order) throw new Error('訂單不存在');
      if (!user) throw new Error('未登入');
      if (isRep) throw new Error('業務不可切換寄賣模式');
      if (order.status === 'shipped' || order.status === 'cancelled') {
        throw new Error('已出貨或已取消的訂單無法切換寄賣模式');
      }

      if (next) {
        // 未確認單：轉寄賣草稿（會鏡像品項並回填 source_order_id）
        // 處理中單：僅設旗標，出貨時由 direct_ship_order 的寄賣分支建 active 寄賣單
        if (order.status === 'pending') {
          const { error } = await supabase.rpc('convert_order_to_consignment_draft', {
            p_order_id: orderId,
            p_created_by: user.id,
          });
          if (error) throw error;
          return { next: true, created: true };
        }
        const { error } = await (supabase.from('orders') as any)
          .update({ consignment_mode: true })
          .eq('id', orderId);
        if (error) throw error;
        return { next: true, created: false };
      }

      // 關閉：已有寄賣單（草稿/進行中/已結算）時不可直接關閉，
      // 需先於寄賣管理頁取消該寄賣單（不自動刪除草稿以免誤刪本訂單）
      const { data: related, error: relError } = await (supabase as any)
        .from('consignment_orders')
        .select('id, code, status')
        .eq('source_order_id', orderId)
        .eq('direction', 'send_to_store')
        .in('status', ['draft', 'active', 'settled']);
      if (relError) throw relError;
      if (related && related.length > 0) {
        const codes = related.map((r: any) => r.code).filter(Boolean).join('、');
        throw new Error(`此訂單已有寄賣單（${codes}），請先於寄賣管理頁取消後再關閉寄賣模式`);
      }

      const { error } = await (supabase.from('orders') as any)
        .update({ consignment_mode: false })
        .eq('id', orderId);
      if (error) throw error;
      return { next: false, created: false };
    },
    onSuccess: (result) => {
      toast.success(
        result.next
          ? (result.created ? '已轉為寄賣草稿，可在寄賣管理頁出貨' : '已切換為寄賣模式')
          : '已改回一般出貨'
      );
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['consignment-orders'] });
    },
    onError: (error: Error) => toast.error(getErrorMessage(error)),
  });

  // Direct ship: turn pending/processing order into sales note (direct_ship_order 兩種狀態皆允許)
  const directShipMutation = useMutation({
    mutationFn: async (delivery?: DirectShipDelivery) => {
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

      // 勾選「同步價格」的品項，儲存送出時自動同步到品牌價
      await syncPrices({ auto: true });

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
      const loader = delivery || { deliveryType: getDeliveryType(), deliveryMethodId: null, trackingCompany: null, trackingNumber: null, trackingUrl: null };
      const addr = loader?.deliveryType === 'logistics' && loader.shippingAddress ? loader.shippingAddress : undefined;
      const { data, error } = await supabase.rpc('direct_ship_order', {
        p_order_id: orderId,
        p_created_by: user.id,
        p_notes: undefined,
        p_shipped_at: shippedAt ? new Date(shippedAt).toISOString() : undefined,
        p_warehouse_id: undefined,
        p_warehouse_map: Object.keys(warehouseMap).length > 0 ? warehouseMap : undefined,
        p_source_map: Object.keys(sourceMap).length > 0 ? sourceMap : undefined,
        p_delivery_method_id: loader?.deliveryMethodId || undefined,
        p_shipping_fee: undefined,
        p_shipping_address: addr,
        p_delivery_type: loader?.deliveryType || undefined,
        p_shipping_cost: undefined,
        p_tracking_company: loader?.trackingCompany || undefined,
        p_tracking_number: loader?.trackingNumber || undefined,
        p_tracking_url: loader?.trackingUrl || undefined,
      });
      if (error) throw error;

      // 勾選「同步至店鋪」：出貨後將配送地址回寫店家（僅地址欄位，不含配送類型/方式）
      if (addr && loader?.syncToStore) {
        const targetStoreId = order?.store_id || storeId;
        if (targetStoreId) {
          const { error: sErr } = await (supabase as any)
            .from('stores')
            .update({
              recipient: addr.recipient || null,
              phone: addr.phone || null,
              postal_code: addr.postal_code || null,
              city: addr.city || null,
              district: addr.district || null,
              address: addr.address || null,
            })
            .eq('id', targetStoreId);
          if (sErr) throw sErr;
        }
        queryClient.invalidateQueries({ queryKey: ['stores'] });
      }
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
      if (!targetStoreId) throw new Error('請選擇目標門市');

      // send_to_store 的 CHECK 約束要求 supplier_id IS NULL（結算對象為店家）
      const { data: newCO, error: coError } = await (supabase as any)
        .from('consignment_orders')
        .insert({
          direction: 'send_to_store',
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

  const isSubmitting = updateOrderMutation.isPending || createPendingMutation.isPending || isPendingMode2 || directShipMutation.isPending || createPurchaseOrderMutation.isPending || createConsignmentReceiveMutation.isPending || createConsignmentSendMutation.isPending;

  return {
    updateOrderMutation,
    createPendingMutation,
    handleCreateWithSalesNote,
    toggleStatusMutation,
    toggleConsignmentModeMutation,
    directShipMutation,
    createPurchaseOrderMutation,
    createConsignmentReceiveMutation,
    createConsignmentSendMutation,
    isPendingMode2,
    isSubmitting,
  };
}