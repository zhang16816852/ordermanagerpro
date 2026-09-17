import { useEffect, useRef } from 'react';
import { OrderItemRow } from '@/components/order/orderItemsTypes';

interface OrderFormStateSyncParams {
  isEditMode: boolean;
  order: any;
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
}

export function useOrderFormStateSync(params: OrderFormStateSyncParams) {
  const {
    isEditMode,
    order,
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

  // Edit mode: populate state from fetched order
  useEffect(() => {
    if (!isEditMode || !order) return;
    draft.clearDraft();
    prevDraftItemsRef.current = '[]';
    skipNextDraftSyncRef.current = true;
    setNotes(order.notes || '');
    setPendingDeletedIds([]);
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
    })));
  }, [isEditMode, order]);

  // Sync draft items → local items (ProductCatalog adds to Zustand, we read into local state)
  const prevDraftItemsRef = useRef<string>('[]');
  const skipNextDraftSyncRef = useRef(false);
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
    setItems((prev) => {
      const merged = [...prev];
      for (const item of draftItems) {
        const idx = merged.findIndex((i) => i.id === item.id);
        if (idx >= 0) {
          merged[idx] = item;
        } else {
          merged.push(item);
        }
      }
      return merged;
    });
    setPriceSyncMap(draft.priceSyncMap);
  }, [draft.items, draft.priceSyncMap, isEditMode, supplierMappings]);

  return { itemsRef, notesRef, consignmentModeRef, orderRef, pendingDeletedIdsRef };
}