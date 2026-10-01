import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useStoreProductCache, useProductCache } from '@/hooks/useProductCache';
import type { ProductWithPricing } from '@/types/product';
import { useStoreDraft, useOrderDraftStore } from '@/store/useOrderDraftStore';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { OrderItemRow, LineTypeOption } from '@/components/order/orderItemsTypes';
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { DeliveryType } from '@/components/shipping/DeliveryMethodPicker';
import { useStoreDeliveryDefaults } from '@/hooks/useStoreDeliveryDefaults';
import type { PurchaseOrderPurpose, PurchaseOrderStatus } from '@/pages/admin/purchase-orders/types';

import { useOrderFormQueries } from './useOrderFormQueries';
import { useCatalogFilters } from './useCatalogFilters';
import { useOrderFormMutations } from './useOrderFormMutations';
import { useOrderFormStateSync } from './useOrderFormStateSync';

export function useAdminOrderFormController() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const storeIdFromParam = searchParams.get('storeId') || '';
  const [selectedStoreId, setSelectedStoreId] = useState(storeIdFromParam);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isRep } = useAuth();

  const isEditMode = !!orderId;
  // 採購單編輯走獨立路由 /admin/purchase-orders/:orderId/edit（非 orders/:orderId/edit），
  // 強制 orderType='purchase'，不受 ?type= 影響
  const isPurchaseEdit = isEditMode && /^\/admin\/purchase-orders\/[^/]+\/edit\/?$/.test(location.pathname);

  // Unified order type
  const [orderType, setOrderType] = useState<'sales' | 'purchase' | 'consignment_receive' | 'consignment_send'>(
    isPurchaseEdit ? 'purchase' : ((searchParams.get('type') as any) || 'sales')
  );
  const [supplierId, setSupplierId] = useState('');
  const [targetStoreId, setTargetStoreId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [supplierOrderNumber, setSupplierOrderNumber] = useState('');
  // 採購單表頭（僅 purchase 編輯模式使用；建立模式未提供日期欄位，order_date 由 RPC 落 CURRENT_DATE）
  const [purchaseOrderDate, setPurchaseOrderDate] = useState('');
  const [purchaseStatus, setPurchaseStatus] = useState<PurchaseOrderStatus>('draft');
  const [purchasePurpose, setPurchasePurpose] = useState<PurchaseOrderPurpose>('general');

  const {
    order,
    orderLoading,
    purchaseOrder,
    purchaseLoading,
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
    isPurchaseEdit,
  });

  const storeId = isEditMode ? (order?.store_id ?? '') : selectedStoreId;
  // 建立模式依訂單類型分桶（分頁間草稿互不干擾），編輯模式獨立於建立中草稿
  const draftKey = isEditMode ? `_edit_${orderId}` : (storeId || `_admin_new_${orderType}`);

  const { products: storeProducts, isLoading: productsLoading, templates } = useStoreProductCache(
    orderType !== 'purchase' ? (storeId || null) : null,
    displayBrand || null,
    { includeShipping: true },
  );

  // 採購商品來源：整個商品目錄（不走 store_products 門市價）
  // 採購需可挑「維修零件」與運費型商品，故不套用 useStoreProductCache 的 item_type／隱藏過濾；
  // 單價一律以批發價（effective_wholesale_price）為預設成本，由供應商 mapping 於選供應商時覆寫。
  const { products: allCachedProducts, isLoading: allProductsLoading } = useProductCache();
  const purchaseProducts = useMemo<ProductWithPricing[]>(() => {
    if (orderType !== 'purchase') return [];
    return (allCachedProducts || []).map((p: any) => ({
      ...p,
      wholesale_price: p.wholesale_price ?? 0,
      retail_price: 0,
      has_store_price: false,
      variants: (p.variants || []).map((v: any) => ({
        ...v,
        effective_wholesale_price: v.wholesale_price ?? 0,
        effective_retail_price: v.retail_price ?? 0,
        has_brand_price: false,
        spec_values: v.spec_values,
      })),
    })) as ProductWithPricing[];
  }, [orderType, allCachedProducts]);

  // 採購走整個商品目錄，其餘類型走門市商品（useStoreProductCache）
  const catalogProducts = orderType === 'purchase' ? purchaseProducts : storeProducts;
  const catalogLoading = orderType === 'purchase' ? allProductsLoading : productsLoading;

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
  // 訂單層只存配送類型（delivery/logistics/pickup），方法/包裹細節於出貨 RPC 內產生
  const [deliveryType, setDeliveryType] = useState<DeliveryType | null>(null);

  // 表頭欄位隨草稿持久化：建立模式於 render 階段單次 hydrate（早於下方 persist effect，
  // 避免以空值覆寫既有草稿）；編輯模式以伺服器資料為準，不做 hydrate/persist。
  const [metaHydratedKey, setMetaHydratedKey] = useState('');
  if (!isEditMode && metaHydratedKey !== draftKey) {
    const stored = useOrderDraftStore.getState().getDraft(draftKey);
    const meta = stored.meta;
    if (meta) {
      if (meta.supplierId) setSupplierId(meta.supplierId);
      if (meta.targetStoreId) setTargetStoreId(meta.targetStoreId);
      if (meta.expectedDate) setExpectedDate(meta.expectedDate);
      if (meta.supplierOrderNumber) setSupplierOrderNumber(meta.supplierOrderNumber);
      if (meta.shippedAt) setShippedAt(meta.shippedAt);
      if (meta.warehouseId) setWarehouseId(meta.warehouseId);
      if (typeof meta.consignmentMode === 'boolean') setConsignmentMode(meta.consignmentMode);
      if (meta.deliveryType) setDeliveryType(meta.deliveryType);
      if (meta.itemWarehouses) setItemWarehouses(meta.itemWarehouses);
      if (meta.itemSources) setItemSources(meta.itemSources);
    }
    if (stored.notes) setNotes(stored.notes);
    setMetaHydratedKey(draftKey);
  }

  useEffect(() => {
    if (isEditMode || metaHydratedKey !== draftKey) return;
    useOrderDraftStore.getState().updateMeta(draftKey, {
      supplierId,
      targetStoreId,
      expectedDate,
      supplierOrderNumber,
      shippedAt,
      warehouseId,
      consignmentMode,
      deliveryType: deliveryType ?? undefined,
      itemWarehouses,
      itemSources,
    });
    useOrderDraftStore.getState().updateNotes(draftKey, notes);
  }, [
    isEditMode, metaHydratedKey, draftKey, supplierId, targetStoreId, expectedDate,
    supplierOrderNumber, shippedAt, warehouseId, consignmentMode, deliveryType,
    itemWarehouses, itemSources, notes,
  ]);

  // Product browsing state
  const [activePanel, setActivePanel] = useState<'information' | 'delivery' | 'items' | 'products' | null>(null);
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
    storeProducts: catalogProducts,
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

  // 建立模式：依店家預設配送方式推導預設配送類型（使用者已選則不覆寫）
  const { fromStore: fromStoreDefaults } = useStoreDeliveryDefaults();
  useEffect(() => {
    if (isEditMode || orderType !== 'sales' || !storeInfo || deliveryType) return;
    const { type } = fromStoreDefaults(storeInfo);
    if (type) setDeliveryType(type);
  }, [isEditMode, orderType, storeInfo, deliveryType, fromStoreDefaults]);

  const getItemWarehouse = (id: string) => itemWarehouses[id] || warehouseId || defaultWarehouse?.id || '';

  const { itemsRef, notesRef, consignmentModeRef, orderRef, pendingDeletedIdsRef } = useOrderFormStateSync({
    isEditMode,
    order,
    isPurchaseEdit,
    purchaseOrder,
    blockNewItems: isPurchaseEdit && purchaseOrder?.status === 'cancelled',
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
  });

  // 採購編輯模式品項守門（兩層，與 update_purchase_order_with_items 對齊）：
  //  1) 已取消（cancelled）：全部品項異動（新增／數量／單價／刪除／排序／拆分）一律拒絕，僅可改備註與狀態
  //  2) 已收貨品項：不可刪除、不可把數量降到已收貨以下（unit_cost 仍可更新）
  const purchaseEditRef = useRef(false);
  purchaseEditRef.current = isPurchaseEdit;
  const purchaseCancelledRef = useRef(false);
  purchaseCancelledRef.current = isPurchaseEdit && purchaseOrder?.status === 'cancelled';
  const guardPurchaseCancelled = useCallback((action: string): boolean => {
    if (!purchaseCancelledRef.current) return false;
    toast.error(`此採購單已取消，不可${action}`);
    return true;
  }, []);
  const handlePoLockGuard = useCallback((item: OrderItemRow | undefined, action: string): boolean => {
    if (!purchaseEditRef.current || !item) return false;
    if ((item.receivedQuantity ?? 0) <= 0) return false;
    toast.error(`此品項已收貨 ${item.receivedQuantity} 件，不可${action}`);
    return true;
  }, []);

  // Handlers
  const handleQuantityChange = useCallback((index: number, value: number) => {
    const row = itemsRef.current[index];
    const itemId = row?.id;
    if (guardPurchaseCancelled('修改數量')) return;
    // 採購：不可低於已收貨數量
    if (purchaseEditRef.current && (row?.receivedQuantity ?? 0) > 0 && value < (row?.receivedQuantity ?? 0)) {
      handlePoLockGuard(row, '降低數量至已收貨數量以下');
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: Math.max(1, value) };
      return next;
    });
    if (itemId) draft.updateQuantity(itemId, Math.max(1, value));
  }, [draft, handlePoLockGuard, guardPurchaseCancelled]);

  const handlePriceChange = useCallback((index: number, value: number) => {
    const item = itemsRef.current[index];
    const itemId = item?.id;
    if (guardPurchaseCancelled('修改單價')) return;
    // 換貨/退貨/送修列不寫入價格表（換貨固定單價 0）
    if (item && (item.lineType ?? 'sale') !== 'sale') return;
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
  }, [draft, priceSyncMap, guardPurchaseCancelled]);

  // 打單性質切換：一般/換貨→清退貨狀態；退貨→待處理；送修→退貨＋待處理＋isRepair
  // 換貨→單價歸 0 且不寫入價格表；非一般（退貨/送修/換貨）一律退出價格同步
  const handleUpdateLineType = useCallback((index: number, lineType: LineTypeOption) => {
    const item = itemsRef.current[index];
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        lineType: lineType === 'sale' || lineType === 'exchange' ? lineType : 'return',
        returnStatus: lineType === 'exchange' || lineType === 'sale' ? null : 'pending',
        isRepair: lineType === 'repair',
        unitPrice: lineType === 'exchange' ? 0 : next[index].unitPrice,
      };
      return next;
    });
    if (item) {
      if (lineType === 'exchange') draft.updateItemPrice(item.id, 0);
      if (lineType !== 'sale') {
        const nextMap = { ...priceSyncMap, [item.id]: false };
        setPriceSyncMap(nextMap);
        draft.setPriceSyncMap(nextMap);
      }
    }
  }, [draft, priceSyncMap]);

  const handleRemoveItem = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!item) return;

    if (guardPurchaseCancelled('刪除品項')) return;
    // 採購：已收貨品項不可刪除（RPC 亦會阻擋，此處提前擋下避免使用者困惑）
    if (handlePoLockGuard(item, '刪除')) return;

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
  }, [draft, handlePoLockGuard, guardPurchaseCancelled]);

  const handleReorder = useCallback((newItems: OrderItemRow[]) => {
    if (guardPurchaseCancelled('調整品項順序')) return;
    setItems(newItems);
  }, [guardPurchaseCancelled]);

  // 拆分行：原行減 1、插入數量 1 的新行（同變體多列，如單價 0 補寄/換貨）
  // 採購語意為「同一商品一列」，不支援拆行；已收貨品項若拆分會使原列低於收貨量
  const handleSplitItem = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!item || item.quantity <= 1) return;
    if (guardPurchaseCancelled('拆分品項')) return;
    if (purchaseEditRef.current) {
      toast.error('採購單不支援拆分同一品項，請直接調整數量');
      return;
    }
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
  }, [draft, guardPurchaseCancelled]);

  const handleTogglePriceSync = useCallback((id: string, checked: boolean) => {
    const item = itemsRef.current.find(i => i.id === id);
    if (!item || item.lineType !== 'sale') return;
    const nextMap = { ...priceSyncMap, [id]: checked };
    setPriceSyncMap(nextMap);
    draft.setPriceSyncMap(nextMap);
  }, [priceSyncMap, draft]);

  const {
    updateOrderMutation,
    createPendingMutation,
    handleCreateWithSalesNote,
    toggleStatusMutation,
    toggleConsignmentModeMutation,
    directShipMutation,
    createPurchaseOrderMutation,
    createConsignmentReceiveMutation,
    createConsignmentSendMutation,
    isSubmitting,
  } = useOrderFormMutations({
    orderId,
    user,
    isRep,
    isEditMode,
    isPurchaseEdit,
    purchaseOrder,
    purchaseOrderDate,
    purchaseStatus,
    purchasePurpose,
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
    getDeliveryType: () => deliveryType,
    onDirectShipDialogClose: () => setDirectShipDialogOpen(false),
  });

  // 切換訂單類型分頁時同步 URL，重新整理後仍停留在同一分頁
  const handleOrderTypeChange = useCallback((next: string) => {
    if (isPurchaseEdit) return;
    setOrderType(next as typeof orderType);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('type', next);
        return p;
      },
      { replace: true }
    );
  }, [setSearchParams, isPurchaseEdit]);

  // 建立模式為一般表單欄位；編輯模式為立即執行的動作（update_order_with_items 不含 consignment_mode）
  const handleConsignmentModeChange = useCallback((next: boolean) => {
    if (isEditMode) {
      toggleConsignmentModeMutation.mutate(next);
    } else {
      setConsignmentMode(next);
    }
  }, [isEditMode, toggleConsignmentModeMutation]);

  const navigateBack = useCallback(() => {
    if (orderType === 'purchase') navigate('/admin/purchase-orders');
    else if (orderType === 'consignment_receive' || orderType === 'consignment_send') navigate('/admin/consignment');
    else navigate('/admin/orders');
  }, [orderType, navigate]);

  // 編輯模式的單據來源：採購走 purchase_orders，其餘走 orders
  const editDoc = isPurchaseEdit ? purchaseOrder : order;
  const editDocLoading = isPurchaseEdit ? purchaseLoading : orderLoading;
  const orderIdVal = editDoc?.id;
  const orderCodeVal = isPurchaseEdit
    ? purchaseOrder?.supplier_order_number || purchaseOrder?.id?.slice(0, 8)
    : order?.code;
  const orderStatusVal = isPurchaseEdit ? purchaseStatus : order?.status;
  const orderConsignmentMode = order?.consignment_mode;
  const isTogglePending = isPurchaseEdit ? false : toggleStatusMutation.isPending;

  // 採購編輯：已取消鎖定所有品項異動（仍可改備註／狀態）；已收貨者狀態由收貨決定
  const purchaseHasReceived = (purchaseOrder?.purchase_order_items || []).some(
    (i: any) => (i.received_quantity ?? 0) > 0
  );
  const purchaseCancelled = isPurchaseEdit && purchaseOrder?.status === 'cancelled';
  const purchaseItemsLocked = purchaseCancelled || purchaseHasReceived;
  const purchaseStatusLocked = purchaseHasReceived;

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
    handleOrderTypeChange,
    supplierId,
    setSupplierId,
    targetStoreId,
    setTargetStoreId,
    expectedDate,
    setExpectedDate,
    supplierOrderNumber,
    setSupplierOrderNumber,
    purchaseOrderDate,
    setPurchaseOrderDate,
    purchaseStatus,
    setPurchaseStatus,
    purchasePurpose,
    setPurchasePurpose,
    purchaseItemsLocked,
    purchaseStatusLocked,
    purchaseCancelled,
    isPurchaseEdit,
    purchaseOrder,
    editDoc,
    editDocLoading,
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
    storeProducts: catalogProducts,
    productsLoading: catalogLoading,
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
    handleConsignmentModeChange,
    deliveryType,
    setDeliveryType,
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
    handleUpdateLineType,
    handleTogglePriceSync,
    updateOrderMutation,
    createPendingMutation,
    handleCreateWithSalesNote,
    toggleStatusMutation,
    toggleConsignmentModeMutation,
    directShipMutation,
    createPurchaseOrderMutation,
    createConsignmentReceiveMutation,
    createConsignmentSendMutation,
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