import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { OrderItemRow } from '@/components/order/orderItemsTypes';
import { DeliveryType } from '@/components/shipping/DeliveryMethodPicker';
import type { PurchaseOrderPurpose, PurchaseOrderStatus } from '@/pages/admin/purchase-orders/types';

interface OrderFormStateSyncParams {
  isEditMode: boolean;
  order: any;
  isPurchaseEdit: boolean;
  purchaseOrder: any;
  /** 已取消的採購單：商品目錄新增的品項不得併入（RPC 亦拒絕任何 item payload） */
  blockNewItems?: boolean;
  draft: any;
  supplierMappings: any[];
  items: OrderItemRow[];
  notes: string;
  consignmentMode: boolean;
  pendingDeletedIds: string[];
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  setItems: React.Dispatch<React.SetStateAction<OrderItemRow[]>>;
  setPendingDeletedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setPriceSyncMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setDeliveryType: React.Dispatch<React.SetStateAction<DeliveryType | null>>;
  setSupplierId: React.Dispatch<React.SetStateAction<string>>;
  setExpectedDate: React.Dispatch<React.SetStateAction<string>>;
  setSupplierOrderNumber: React.Dispatch<React.SetStateAction<string>>;
  setPurchaseOrderDate: React.Dispatch<React.SetStateAction<string>>;
  setPurchaseStatus: React.Dispatch<React.SetStateAction<PurchaseOrderStatus>>;
  setPurchasePurpose: React.Dispatch<React.SetStateAction<PurchaseOrderPurpose>>;
}

export function useOrderFormStateSync(params: OrderFormStateSyncParams) {
  const {
    isEditMode,
    order,
    isPurchaseEdit,
    purchaseOrder,
    blockNewItems,
    draft,
    supplierMappings,
    items,
    notes,
    consignmentMode,
    pendingDeletedIds,
    setNotes,
    setItems,
    setPendingDeletedIds,
    setPriceSyncMap,
    setDeliveryType,
    setSupplierId,
    setExpectedDate,
    setSupplierOrderNumber,
    setPurchaseOrderDate,
    setPurchaseStatus,
    setPurchasePurpose,
  } = params;

  // Refs to avoid stale closures in mutations
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const consignmentModeRef = useRef(consignmentMode);
  consignmentModeRef.current = consignmentMode;
  const orderRef = useRef(order);
  orderRef.current = order;
  const pendingDeletedIdsRef = useRef(pendingDeletedIds);
  pendingDeletedIdsRef.current = pendingDeletedIds;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const loadedOrderIdRef = useRef<string | null>(null);
  const loadedPurchaseIdRef = useRef<string | null>(null);

  // 採購編輯模式：populate state from fetched purchase order
  useEffect(() => {
    if (!isPurchaseEdit || !purchaseOrder) return;
    if (loadedPurchaseIdRef.current === purchaseOrder.id) return;
    loadedPurchaseIdRef.current = purchaseOrder.id;
    draftRef.current.clearDraft();
    prevDraftItemsRef.current = '[]';
    skipNextDraftSyncRef.current = true;
    setNotes(purchaseOrder.notes || '');
    setPendingDeletedIds([]);
    setSupplierId(purchaseOrder.supplier_id || '');
    setExpectedDate(purchaseOrder.expected_date || '');
    setSupplierOrderNumber(purchaseOrder.supplier_order_number || '');
    setPurchaseOrderDate(purchaseOrder.order_date || '');
    setPurchaseStatus(purchaseOrder.status || 'draft');
    setPurchasePurpose(purchaseOrder.purpose || 'general');
    setItems(
      (purchaseOrder.purchase_order_items || []).map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        variantId: item.variant_id || undefined,
        quantity: item.quantity,
        unitPrice: item.unit_cost,
        receivedQuantity: item.received_quantity ?? 0,
        sku: item.products?.code || '',
        productName: item.products?.name || '',
        variantName: item.product_variants?.name || undefined,
        sort_order: item.sort_order ?? undefined,
      }))
    );
  }, [
    isPurchaseEdit,
    purchaseOrder,
    setNotes,
    setPendingDeletedIds,
    setItems,
    setSupplierId,
    setExpectedDate,
    setSupplierOrderNumber,
    setPurchaseOrderDate,
    setPurchaseStatus,
    setPurchasePurpose,
  ]);

  // Edit mode: populate state from fetched order (once per order id to avoid
  // re-running when `draft` identity changes every render)
  useEffect(() => {
    if (!isEditMode || !order) return;
    if (loadedOrderIdRef.current === order.id) return;
    loadedOrderIdRef.current = order.id;
    draftRef.current.clearDraft();
    prevDraftItemsRef.current = '[]';
    skipNextDraftSyncRef.current = true;
    setNotes(order.notes || '');
    setPendingDeletedIds([]);
    setDeliveryType(order.delivery_type || null);
    setItems(order.order_items.map((item: any) => ({
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id || undefined,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      selectedModelName: item.selected_model_name || undefined,
      sku: item.products?.code || '',
      productName: item.products?.name || '',
      variantName: item.product_variants?.name || undefined,
      lineType: item.line_type || 'sale',
      lineNote: item.line_note || undefined,
      returnStatus: item.return_status || null,
      isRepair: item.is_repair || false,
    })));
  }, [isEditMode, order, setNotes, setPendingDeletedIds, setDeliveryType, setItems]);

  // Sync draft items → local items (ProductCatalog adds to Zustand, we read into local state)
  const prevDraftItemsRef = useRef<string>('[]');
  const skipNextDraftSyncRef = useRef(false);
  // 每次 render 更新：目前 local items 的 id 集合（用來判斷草稿品項是「新增」還是「既有」）
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  knownItemIdsRef.current = new Set(items.map((i) => i.id));
  useEffect(() => {
    if (skipNextDraftSyncRef.current) {
      skipNextDraftSyncRef.current = false;
      return;
    }
    const draftItemsJson = JSON.stringify(draft.items);
    if (draftItemsJson === prevDraftItemsRef.current) return;
    prevDraftItemsRef.current = draftItemsJson;

    const draftItems = draft.items.map((item: any) => {
      const mapping = supplierMappings.find(
        (m) => m.internal_product_id === item.productId &&
          (m.internal_variant_id || null) === (item.variantId || null)
      );
      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: mapping?.vendor_unit_cost ?? item.price,
        unitCost: item.unitCost,
        itemType: item.itemType,
        shippingPayment: item.shippingPayment,
        tempKey: item.tempKey,
        parentTempKey: item.parentTempKey,
        isNew: true,
        selectedModelName: item.selectedModelName,
        sku: item.sku,
        productName: item.productName || item.name,
        variantName: item.variantName,
      };
    });

    // Merge into existing items: update matching id, append new ones (keeps loaded items intact in edit mode)
    // 已取消的採購單只允許同步「既有列」的變更，不接受商品目錄帶入的新品項
    const newIds = new Set(
      draftItems.filter((d) => !knownItemIdsRef.current.has(d.id)).map((d) => d.id)
    );
    if (blockNewItems && newIds.size > 0) {
      toast.error('此採購單已取消，不可新增品項');
    }
    setItems((prev) => {
      const merged = [...prev];
      for (const item of draftItems) {
        const idx = merged.findIndex((i) => i.id === item.id);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], ...item };
        } else if (blockNewItems && newIds.has(item.id)) {
          continue;
        } else {
          merged.push(item);
        }
      }
      return merged;
    });
    setPriceSyncMap(draft.priceSyncMap);
  }, [draft.items, draft.priceSyncMap, isEditMode, supplierMappings, setItems, setPriceSyncMap, blockNewItems]);

  return { itemsRef, notesRef, consignmentModeRef, orderRef, pendingDeletedIdsRef };
}