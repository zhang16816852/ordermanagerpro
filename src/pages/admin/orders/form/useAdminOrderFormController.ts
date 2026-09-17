import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useStoreProductCache } from '@/hooks/useProductCache';
import { useStoreDraft } from '@/store/useOrderDraftStore';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { OrderItemRow } from '@/components/order/orderItemsTypes';
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";

import { useOrderFormQueries } from './useOrderFormQueries';
import { useCatalogFilters } from './useCatalogFilters';
import { useOrderFormMutations } from './useOrderFormMutations';
import { useOrderFormStateSync } from './useOrderFormStateSync';

export function useAdminOrderFormController() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const storeIdFromParam = searchParams.get('storeId') || '';
  const [selectedStoreId, setSelectedStoreId] = useState(storeIdFromParam);
  const navigate = useNavigate();
  const { user, isRep } = useAuth();

  const isEditMode = !!orderId;

  // Unified order type
  const [orderType, setOrderType] = useState<'sales' | 'purchase' | 'consignment_receive' | 'consignment_send'>(
    (searchParams.get('type') as any) || 'sales'
  ); const [supplierId, setSupplierId] = useState('');
  const [targetStoreId, setTargetStoreId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [supplierOrderNumber, setSupplierOrderNumber] = useState('');

  const {
    order,
    orderLoading,
    storeInfo,
    displayStoreName,
    displayBrand,
    categories,
    categoryHierarchy,
    brandMap,
    suppliersList,
    storesList,
    supplierMappings,
  } = useOrderFormQueries({
    orderId,
    isEditMode,
    storeId: selectedStoreId,
    orderType,
    isRep,
    user,
    supplierId,
    storeIdFromParam,
  });

  const storeId = isEditMode ? (order?.store_id ?? '') : selectedStoreId;
  const draftKey = storeId || '_admin_new_order';

  const { products: storeProducts, isLoading: productsLoading, templates } = useStoreProductCache(
    orderType !== 'purchase' ? (storeId || null) : null,
    displayBrand || null,
    { includeShipping: true },
  );
  const draft = useStoreDraft(draftKey);

  // Local state
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [priceSyncMap, setPriceSyncMap] = useState<Record<string, boolean>>({});
  // 軟刪除：已移除的既有品項 id，待儲存時再一次提交給 update_order_with_items
  const [pendingDeletedIds, setPendingDeletedIds] = useState<string[]>([]);
  const { defaultWarehouse, warehouses } = useWarehouses();
  const [directShipDialogOpen, setDirectShipDialogOpen] = useState(false);
  const [shippedAt, setShippedAt] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [itemWarehouses, setItemWarehouses] = useState<Record<string, string>>({});
  const [itemSources, setItemSources] = useState<Record<string, string>>({});
  const [consignmentMode, setConsignmentMode] = useState(false);

  // Product browsing state
  const [activePanel, setActivePanel] = useState<'information' | 'items' | 'products' | null>(null);
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const [desktopCatalogOpen, setDesktopCatalogOpen] = useState(true);
  const [productSearch, setProductSearch] = useState('');
  const [viewMode, setViewMode] = useState<'products' | 'variants' | 'gallery' | 'table'>('products');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const {
    selectedBrandsParam,
    selectedSpecs,
    selectedCategory,
    filteredProducts,
    handleCategoryChange,
    handleBrandsChange,
    handleSpecChange,
    handleClearFilters,
  } = useCatalogFilters({
    categories,
    categoryHierarchy,
    brandMap,
    storeProducts,
    productSearch,
  });

  // Re-price items when store products change (brand-specific pricing)
  useEffect(() => {
    if (!storeProducts || storeProducts.length === 0 || isEditMode) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (priceSyncMap[item.id]) return item;
        const product = storeProducts.find((p) => p.id === item.productId);
        if (!product) return item;
        const variant = item.variantId
          ? product.variants?.find((v: any) => v.id === item.variantId)
          : undefined;
        const newPrice = (variant as any)?.effective_wholesale_price ?? product.wholesale_price ?? item.unitPrice;
        if (newPrice !== item.unitPrice) {
          changed = true;
          return { ...item, unitPrice: newPrice };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [storeProducts, isEditMode]);

  // Re-price items from supplier mappings (purchase/consignment)
  useEffect(() => {
    if (!supplierMappings || supplierMappings.length === 0 || isEditMode) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (priceSyncMap[item.id]) return item;
        const mapping = supplierMappings.find(
          (m) => m.internal_product_id === item.productId &&
            (m.internal_variant_id || null) === (item.variantId || null)
        );
        if (mapping?.vendor_unit_cost != null && mapping.vendor_unit_cost !== item.unitPrice) {
          changed = true;
          return { ...item, unitPrice: mapping.vendor_unit_cost };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [supplierMappings, isEditMode]);

  useEffect(() => {
    if (defaultWarehouse && !warehouseId) setWarehouseId(defaultWarehouse.id);
  }, [defaultWarehouse]);

  const getItemWarehouse = (id: string) => itemWarehouses[id] || warehouseId || defaultWarehouse?.id || '';

  const { itemsRef, notesRef, consignmentModeRef, orderRef, pendingDeletedIdsRef } = useOrderFormStateSync({
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
  });

  // Handlers
  const handleQuantityChange = useCallback((index: number, value: number) => {
    const itemId = itemsRef.current[index]?.id;
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: Math.max(1, value) };
      return next;
    });
    if (itemId) draft.updateQuantity(itemId, Math.max(1, value));
  }, [draft]);

  const handlePriceChange = useCallback((index: number, value: number) => {
    const itemId = itemsRef.current[index]?.id;
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], unitPrice: Math.max(0, value) };
      return next;
    });
    if (itemId) {
      draft.updateItemPrice(itemId, Math.max(0, value));
      const nextMap = { ...priceSyncMap, [itemId]: true };
      setPriceSyncMap(nextMap);
      draft.setPriceSyncMap(nextMap);
    }
  }, [draft, priceSyncMap]);

  const handleRemoveItem = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!item) return;

    if (item.isNew) {
      // 本次新加的品項（來自商品目錄）→ 直接移除，無需還原
      setItems((prev) => prev.filter((_, i) => i !== index));
      draft.removeItem(item.id);
      return;
    }

    // 既有品項 → 軟刪除（隱藏 + toast 還原），儲存時再一次提交
    setItems((prev) => prev.filter((_, i) => i !== index));
    setPendingDeletedIds((prev) => [...prev, item.id]);

    toast.success('已移除品項', {
      action: {
        label: '還原',
        onClick: () => {
          // 還原：插回原位並移出 pending deleted
          setItems((prev) => {
            const next = [...prev];
            next.splice(index, 0, item);
            return next;
          });
          setPendingDeletedIds((prev) => prev.filter((id) => id !== item.id));
        },
      },
      duration: 8000,
    });
  }, [draft]);

  const handleReorder = useCallback((newItems: OrderItemRow[]) => {
    setItems(newItems);
  }, []);

  // 拆分行：原行減 1、插入數量 1 的新行（同變體多列，如單價 0 補寄/換貨）
  const handleSplitItem = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!item || item.quantity <= 1) return;

    setItems((prev) => {
      const next = [...prev];
      const base = next[index];
      if (!base || base.quantity <= 1) return prev;
      next[index] = { ...base, quantity: base.quantity - 1 };
      const splitRow: OrderItemRow = {
        ...base,
        id: `${base.id}__split-${Date.now()}`,
        quantity: 1,
        isNew: true,
        sort_order: undefined,
      };
      next.splice(index + 1, 0, splitRow);
      return next;
    });

    // 同步草稿總量（合成 id 來自商品目錄才有對應草稿；編輯中 DB 列則為 no-op，無副作用）
    if (!item.id.startsWith(`${item.productId}-`)) return;
    draft.updateQuantity(item.id, Math.max(1, item.quantity - 1));
  }, [draft]);

  const handleTogglePriceSync = useCallback((id: string, checked: boolean) => {
    const nextMap = { ...priceSyncMap, [id]: checked };
    setPriceSyncMap(nextMap);
    draft.setPriceSyncMap(nextMap);
  }, [priceSyncMap, draft]);

  const {
    updateOrderMutation,
    createPendingMutation,
    handleCreateWithSalesNote,
    toggleStatusMutation,
    directShipMutation,
    createPurchaseOrderMutation,
    createConsignmentReceiveMutation,
    createConsignmentSendMutation,
    syncPrices,
    isSubmitting,
  } = useOrderFormMutations({
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
    itemsForSync: items,
    onDirectShipDialogClose: () => setDirectShipDialogOpen(false),
  });

  const navigateBack = useCallback(() => {
    if (orderType === 'purchase') navigate('/admin/purchase-orders');
    else if (orderType === 'consignment_receive' || orderType === 'consignment_send') navigate('/admin/consignment');
    else navigate('/admin/orders');
  }, [orderType, navigate]);

  const orderIdVal = order?.id;
  const orderCodeVal = order?.code;
  const orderStatusVal = order?.status;
  const orderConsignmentMode = order?.consignment_mode;
  const isTogglePending = toggleStatusMutation.isPending;

  return {
    orderId,
    searchParams,
    selectedStoreId,
    setSelectedStoreId,
    navigate,
    isEditMode,
    isRep,
    user,
    orderType,
    setOrderType,
    supplierId,
    setSupplierId,
    targetStoreId,
    setTargetStoreId,
    expectedDate,
    setExpectedDate,
    supplierOrderNumber,
    setSupplierOrderNumber,
    order,
    orderLoading,
    storeInfo,
    displayStoreName,
    displayBrand,
    categories,
    categoryHierarchy,
    brandMap,
    suppliersList,
    storesList,
    supplierMappings,
    storeId,
    draftKey,
    storeProducts,
    productsLoading,
    draft,
    notes,
    setNotes,
    items,
    setItems,
    priceSyncMap,
    setPriceSyncMap,
    pendingDeletedIds,
    setPendingDeletedIds,
    defaultWarehouse,
    warehouses,
    directShipDialogOpen,
    setDirectShipDialogOpen,
    shippedAt,
    setShippedAt,
    warehouseId,
    setWarehouseId,
    itemWarehouses,
    setItemWarehouses,
    itemSources,
    setItemSources,
    consignmentMode,
    setConsignmentMode,
    activePanel,
    setActivePanel,
    mobileCatalogOpen,
    setMobileCatalogOpen,
    desktopCatalogOpen,
    setDesktopCatalogOpen,
    productSearch,
    setProductSearch,
    viewMode,
    setViewMode,
    filterSheetOpen,
    setFilterSheetOpen,
    selectedBrandsParam,
    selectedSpecs,
    selectedCategory,
    filteredProducts,
    handleCategoryChange,
    handleBrandsChange,
    handleSpecChange,
    handleClearFilters,
    getItemWarehouse,
    handleQuantityChange,
    handlePriceChange,
    handleRemoveItem,
    handleReorder,
    handleSplitItem,
    handleTogglePriceSync,
    updateOrderMutation,
    createPendingMutation,
    handleCreateWithSalesNote,
    toggleStatusMutation,
    directShipMutation,
    createPurchaseOrderMutation,
    createConsignmentReceiveMutation,
    createConsignmentSendMutation,
    syncPrices,
    isSubmitting,
    navigateBack,
    orderIdVal,
    orderCodeVal,
    orderStatusVal,
    orderConsignmentMode,
    isTogglePending,
  };
}

export type AdminOrderFormController = ReturnType<typeof useAdminOrderFormController>;