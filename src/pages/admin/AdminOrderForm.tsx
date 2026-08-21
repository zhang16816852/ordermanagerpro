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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ArrowLeft, Save, Lock, Unlock, AlertTriangle, Send, Truck, ShoppingBag, PackageCheck,
  Filter, ChevronDown, Warehouse,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { OrderItemsTable, OrderItemRow } from '@/components/order/OrderItemsTable';
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { useProductSearch } from '@/hooks/useProductSearch';
import { useBrands } from '@/hooks/useBrands';
import { WarehouseSelector } from "@/components/WarehouseSelector";
import { StorePicker } from '@/components/ui/StorePicker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ProductCatalog from '@/components/products/catalog/ProductCatalog';
import { CatalogSidebar } from '@/components/products/catalog/CatalogSidebar';

const statusLabels: Record<string, { label: string; className: string }> = {
  pending: { label: '未確認', className: 'bg-warning text-warning-foreground' },
  processing: { label: '處理中', className: 'bg-primary text-primary-foreground' },
  shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
  cancelled: { label: '已取消', className: 'bg-destructive text-destructive-foreground' },
};

export default function AdminOrderForm() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const storeIdFromParam = searchParams.get('storeId') || '';
  const [selectedStoreId, setSelectedStoreId] = useState(storeIdFromParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const isEditMode = !!orderId;

  // Edit mode: fetch existing order
  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await (supabase
        .from('orders') as any)
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
            products (name, code),
            product_variants (name)
          )
        `)
        .eq('id', orderId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });

  // Unified order type
  const [orderType, setOrderType] = useState<'sales' | 'purchase' | 'consignment_receive' | 'consignment_send'>(
    (searchParams.get('type') as any) || 'sales'
  );
  const [supplierId, setSupplierId] = useState('');
  const [targetStoreId, setTargetStoreId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [supplierOrderNumber, setSupplierOrderNumber] = useState('');

  const storeId = isEditMode ? (order?.store_id ?? '') : selectedStoreId;
  const draftKey = storeId || '_admin_new_order';

  // Fetch store info (create mode)
  const { data: storeInfo } = useQuery({
    queryKey: ['store', storeId],
    queryFn: async () => {
      if (!storeId) return null;
      const { data, error } = await (supabase
        .from('stores') as any)
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

  const { products: storeProducts, isLoading: productsLoading, templates } = useStoreProductCache(
    orderType !== 'purchase' ? (storeId || null) : null,
    displayBrand || null,
  );
  const draft = useStoreDraft(draftKey);

  // Local state
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [priceSyncMap, setPriceSyncMap] = useState<Record<string, boolean>>({});
  const [isPendingMode2, setIsPendingMode2] = useState(false);
  const { defaultWarehouse, warehouses } = useWarehouses();
  const [directShipDialogOpen, setDirectShipDialogOpen] = useState(false);
  const [shippedAt, setShippedAt] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [itemWarehouses, setItemWarehouses] = useState<Record<string, string>>({});
  const [itemSources, setItemSources] = useState<Record<string, string>>({});
  const [consignmentMode, setConsignmentMode] = useState(false);
  const [warehouseExpanded, setWarehouseExpanded] = useState(false);

  // Product browsing state
  const [activePanel, setActivePanel] = useState<'items' | 'products' | null>(null);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(true);
  const [productSearch, setProductSearch] = useState('');
  const [viewMode, setViewMode] = useState<'products' | 'variants' | 'gallery' | 'table'>('products');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const selectedCategoryName = searchParams.get('category');
  const selectedBrandsParam = useMemo(
    () => searchParams.get('brands')?.split(',').filter(Boolean) || [],
    [searchParams]
  );
  const selectedSpecs = useMemo(() => {
    try {
      const s = searchParams.get('specs');
      return s ? JSON.parse(s) : {};
    } catch { return {}; }
  }, [searchParams]);

  // Categories for sidebar filter
  const { data: categories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['categories-for-sidebar'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('categories') as any)
        .select('id, name')
        .order('sort_order', { ascending: true });
      if (error) return [];
      return data || [];
    },
  });

  const { data: categoryHierarchy = [] } = useQuery({
    queryKey: ['category_hierarchy'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
      if (error) return [];
      return data;
    },
  });

  const { brandMap } = useBrands();

  const selectedCategory = useMemo(() => {
    if (!selectedCategoryName || categories.length === 0) return null;
    return categories.find((c) => c.name === selectedCategoryName)?.id || null;
  }, [selectedCategoryName, categories]);

  // Sidebar filter callbacks
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        });
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const handleCategoryChange = useCallback(
    (id: string | null) => {
      const cat = categories.find((c) => c.id === id);
      updateParams({ category: cat ? cat.name : null, specs: null });
    },
    [categories, updateParams]
  );

  const handleBrandsChange = useCallback(
    (val: string[]) => updateParams({ brands: val.length > 0 ? val.join(',') : null }),
    [updateParams]
  );

  const handleSpecChange = useCallback(
    (key: string, values: string[]) => {
      const nextSpecs = { ...selectedSpecs };
      if (values.length === 0) delete nextSpecs[key];
      else nextSpecs[key] = values;
      updateParams({
        specs: Object.keys(nextSpecs).length > 0 ? JSON.stringify(nextSpecs) : null,
      });
    },
    [selectedSpecs, updateParams]
  );

  const handleClearFilters = useCallback(() => {
    updateParams({ category: null, brands: null, specs: null });
  }, [updateParams]);

  const filteredProducts = useProductSearch({
    products: storeProducts || [],
    search: productSearch,
    selectedCategory,
    categoryHierarchy,
    selectedBrands: selectedBrandsParam,
    selectedSpecs,
    brandMap,
  });

  // Suppliers list (for purchase/consignment types)
  const { data: suppliersList = [] } = useQuery({
    queryKey: ['suppliers-for-order-form'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: orderType !== 'sales' && !isEditMode,
  });

  // Stores list (for consignment_send type)
  const { data: storesList = [] } = useQuery({
    queryKey: ['stores-for-order-form'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('stores')
        .select('id, name, code, brand')
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string; code: string | null; brand: string | null }[];
    },
    enabled: (orderType === 'consignment_send' || (orderType === 'sales' && !isEditMode && !storeIdFromParam)) && !isEditMode,
  });

  // Supplier product mappings (for purchase/consignment pricing)
  const { data: supplierMappings = [] } = useQuery({
    queryKey: ['supplier-mappings', supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('internal_product_id, internal_variant_id, vendor_unit_cost')
        .eq('supplier_id', supplierId);
      if (error) throw error;
      return (data || []) as { internal_product_id: string; internal_variant_id: string | null; vendor_unit_cost: number | null }[];
    },
    enabled: !!supplierId && orderType !== 'sales' && !isEditMode,
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

  // Refs to avoid stale closures in mutations
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const consignmentModeRef = useRef(consignmentMode);
  consignmentModeRef.current = consignmentMode;
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
      sku: item.products?.code || '',
      productName: item.products?.name || '',
      variantName: item.product_variants?.name || undefined,
    })));
  }, [isEditMode, order]);

  // Sync draft items → local items (ProductCatalog adds to Zustand, we read into local state)
  const prevDraftItemsRef = useRef<string>('[]');
  useEffect(() => {
    if (isEditMode) return;
    const draftItemsJson = JSON.stringify(draft.items);
    if (draftItemsJson === prevDraftItemsRef.current) return;
    prevDraftItemsRef.current = draftItemsJson;

    setItems(draft.items.map((item) => {
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
        isNew: true,
        selectedModelName: item.selectedModelName,
        sku: item.sku,
        productName: item.productName || item.name,
        variantName: item.variantName,
      };
    }));
    setPriceSyncMap(draft.priceSyncMap);
  }, [draft.items, draft.priceSyncMap, isEditMode, supplierMappings]);

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
      setPriceSyncMap((prev) => ({ ...prev, [itemId]: true }));
    }
  }, [draft]);

  const handleRemoveItem = useCallback((index: number) => {
    const itemId = itemsRef.current[index]?.id;
    setItems((prev) => prev.filter((_, i) => i !== index));
    if (itemId) draft.removeItem(itemId);
  }, [draft]);

  const handleTogglePriceSync = useCallback((id: string, checked: boolean) => {
    setPriceSyncMap((prev) => ({ ...prev, [id]: checked }));
  }, []);

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
      await (supabase.from('orders') as any).update({ notes: currentNotes || null }).eq('id', orderId);

      for (const item of currentItems) {
        if (item.isNew) {
          const { error } = await (supabase.from('order_items') as any).insert({
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
          const { error } = await (supabase
            .from('order_items') as any)
            .update({ quantity: item.quantity, unit_price: item.unitPrice })
            .eq('id', item.id);
          if (error) throw error;
        }
      }

      const existingIds = currentOrder.order_items.map((i: any) => i.id);
      const currentIds = currentItems.filter((i) => !i.isNew).map((i) => i.id);
      const toDelete = existingIds.filter((id: string) => !currentIds.includes(id));
      if (toDelete.length > 0) {
        await (supabase.from('order_items') as any).delete().in('id', toDelete);
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
      if (!storeId) throw new Error('請先選擇店鋪');
      const { data: newOrder, error: orderError } = await (supabase
        .from('orders') as any)
        .insert({
          store_id: storeId,
          created_by: user?.id,
          source_type: 'admin_proxy',
          notes: currentNotes.trim() || null,
          consignment_mode: consignmentModeRef.current,
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
      const payload = items.map((i) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        selected_model_name: i.selectedModelName || null,
        warehouse_id: getItemWarehouse(i.id) || null,
        inventory_source_type: itemSources[i.id] || "self",
      }));

      const { data, error } = await supabase.rpc('create_order_with_sales_note', {
        p_store_id: storeId,
        p_created_by: user?.id as string,
        p_notes: notes.trim() || undefined,
        p_items: payload,
        p_shipped_at: shippedAt ? new Date(shippedAt).toISOString() : undefined,
        p_warehouse_id: undefined,
        p_consignment_mode: consignmentModeRef.current,
      });
      if (error) throw error;

      if (consignmentModeRef.current) {
        toast.success('訂單已建立並以店家寄賣方式出貨，確認售出後才開立銷貨單');
      } else {
        const link = `${window.location.origin}/share/sales-note/${(data as any).sales_note_code || (data as any).sales_note_id}?token=${(data as any).access_token}`;
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
  }, [isEditMode, items, notes, storeId, user, navigate, draft, itemSources, getItemWarehouse, shippedAt]);

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
      const warehouseMap = items.reduce((acc, i) => {
        const wh = getItemWarehouse(i.id);
        if (wh) acc[i.id] = wh;
        return acc;
      }, {} as Record<string, string>);
      const sourceMap = items.reduce((acc, i) => {
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
      } else {
        toast.success('訂單已以店家寄賣方式出貨，確認售出後才開立銷貨單');
      }
      setDirectShipDialogOpen(false);
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

  const isSubmitting = updateOrderMutation.isPending || createPendingMutation.isPending || isPendingMode2 || directShipMutation.isPending || createPurchaseOrderMutation.isPending || createConsignmentReceiveMutation.isPending || createConsignmentSendMutation.isPending;

  // Loading / empty states
  if (isEditMode && orderLoading) {
    return <div className="flex items-center justify-center h-64" role="status" aria-live="polite"><div className="text-muted-foreground">載入中…</div></div>;
  }
  if (isEditMode && !order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">找不到訂單</p>
        <Button onClick={() => navigate('/admin/orders')}><ArrowLeft className="mr-2 h-4 w-4" />返回訂單列表</Button>
      </div>
    );
  }

  const statusInfo = order ? statusLabels[order.status] || { label: order.status, className: 'bg-muted text-muted-foreground' } : null;

  const typeTitle = isEditMode ? '編輯訂單' : (
    orderType === 'sales' ? '建立銷售訂單' :
    orderType === 'purchase' ? '建立採購單' :
    orderType === 'consignment_receive' ? '建立寄賣收貨單' :
    '建立寄賣出貨單'
  );

  const typeBadge = !isEditMode ? (
    <Badge variant="outline" className={
      orderType === 'purchase' ? 'border-blue-500 text-blue-500' :
      orderType === 'consignment_receive' ? 'border-purple-500 text-purple-500' :
      orderType === 'consignment_send' ? 'border-orange-500 text-orange-500' :
      ''
    }>
      {orderType === 'sales' ? '銷售' :
       orderType === 'purchase' ? '採購' :
       orderType === 'consignment_receive' ? '寄賣收貨' : '寄賣出貨'}
    </Badge>
  ) : null;

  const navigateBack = () => {
    if (orderType === 'purchase') navigate('/admin/purchase-orders');
    else if (orderType === 'consignment_receive' || orderType === 'consignment_send') navigate('/admin/consignment');
    else navigate('/admin/orders');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={isEditMode ? () => navigate('/admin/orders') : navigateBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{typeTitle}</h1>
            <p className="text-muted-foreground font-mono text-sm">
              {isEditMode ? order!.id : (
                orderType === 'sales' ? `店鋪: ${displayStoreName}` :
                orderType === 'purchase' ? '向供應商採購' :
                orderType === 'consignment_receive' ? '供應商寄放貨品' : '寄放貨品至門市'
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {typeBadge}
          {statusInfo && <Badge className={statusInfo.className}>{statusInfo.label}</Badge>}
          {order?.consignment_mode && <Badge variant="secondary">寄賣</Badge>}
          {isEditMode && order!.status !== 'shipped' && (
            <Button variant="outline" onClick={() => toggleStatusMutation.mutate()} disabled={toggleStatusMutation.isPending}>
              {order!.status === 'pending' ? <><Lock className="mr-2 h-4 w-4" />鎖定訂單</> : <><Unlock className="mr-2 h-4 w-4" />解除鎖定</>}
            </Button>
          )}
        </div>
      </div>

      {/* Type selector (create mode only) */}
      {!isEditMode && (
        <Tabs value={orderType} onValueChange={(v) => setOrderType(v as any)}>
          <TabsList>
            <TabsTrigger value="sales" className="gap-1.5">
              <ShoppingBag className="h-4 w-4" />銷售訂單
            </TabsTrigger>
            <TabsTrigger value="purchase" className="gap-1.5">
              <Truck className="h-4 w-4" />採購單
            </TabsTrigger>
            <TabsTrigger value="consignment_receive" className="gap-1.5">
              <PackageCheck className="h-4 w-4" />寄賣收貨
            </TabsTrigger>
            <TabsTrigger value="consignment_send" className="gap-1.5">
              <Send className="h-4 w-4" />寄賣出貨
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Warning for non-pending orders */}
      {isEditMode && order!.status !== 'pending' && (
        <Alert variant="default" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800 dark:text-yellow-200">
            此訂單狀態為「{statusInfo?.label}」，部分品項可能已在出貨池或已出貨。修改時請謹慎操作，避免資料不一致。
          </AlertDescription>
        </Alert>
      )}

      {/* Top row: Order info + Notes */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{isEditMode ? '訂單資訊' : (
            orderType === 'purchase' ? '採購資訊' :
            orderType === 'consignment_receive' ? '寄賣收貨資訊' :
            orderType === 'consignment_send' ? '寄賣出貨資訊' : '訂單資訊'
          )}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isEditMode ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">店鋪：</span>
                  <span className="font-medium">{displayStoreName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">品牌：</span>
                  <span className="font-medium">{displayBrand || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">建立時間：</span>
                  <span>{format(new Date(order!.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">來源：</span>
                  <span>{order!.source_type === 'frontend' ? '前台' : order!.source_type === 'consignment' ? '寄賣' : '後台'}</span>
                </div>
              </div>
            ) : (
              <>
                {/* Sales: store selector */}
                {orderType === 'sales' && (
                  <>
                    {storeIdFromParam ? (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">店鋪：</span>
                          <span className="font-medium">{displayStoreName}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">品牌：</span>
                          <span className="font-medium">{displayBrand || '-'}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>門市</Label>
                        <StorePicker
                          stores={storesList}
                          value={selectedStoreId}
                          onChange={(v) => setSelectedStoreId(Array.isArray(v) ? v[0] || '' : v)}
                          valueField="id"
                          placeholder="搜尋門市名稱或編號..."
                        />
                      </div>
                    )}
                  </>
                )}

                {/* Purchase: supplier + dates */}
                {orderType === 'purchase' && (
                  <>
                    <div className="space-y-2">
                      <Label>供應商</Label>
                      <Select value={supplierId} onValueChange={setSupplierId}>
                        <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                        <SelectContent>
                          {suppliersList.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>預計到貨日（選填）</Label>
                        <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>廠商單號（選填）</Label>
                        <Input value={supplierOrderNumber} onChange={(e) => setSupplierOrderNumber(e.target.value)} placeholder="廠商端訂單編號" />
                      </div>
                    </div>
                  </>
                )}

                {/* Consignment receive: supplier */}
                {orderType === 'consignment_receive' && (
                  <div className="space-y-2">
                    <Label>供應商</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                      <SelectContent>
                        {suppliersList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Consignment send: supplier + target store */}
                {orderType === 'consignment_send' && (
                  <>
                    <div className="space-y-2">
                      <Label>供應商</Label>
                      <Select value={supplierId} onValueChange={setSupplierId}>
                        <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                        <SelectContent>
                          {suppliersList.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>目標門市</Label>
                      <StorePicker
                        stores={storesList}
                        value={targetStoreId}
                        onChange={(v) => setTargetStoreId(Array.isArray(v) ? v[0] || '' : v)}
                        valueField="id"
                        placeholder="搜尋門市名稱或編號..."
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>備註</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Textarea placeholder="輸入備註..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            {!isEditMode && orderType === 'sales' && (
              <>
                <div>
                  <label className="text-sm font-medium">出貨時間</label>
                  <Input
                    type="datetime-local"
                    value={shippedAt}
                    onChange={(e) => setShippedAt(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">寄賣模式</div>
                    <div className="text-xs text-muted-foreground">
                      訂單出貨時以店家寄賣方式轉出，不扣自有庫存
                    </div>
                  </div>
                  <Switch checked={consignmentMode} onCheckedChange={setConsignmentMode} />
                </div>
              </>
            )}
            {!isEditMode && orderType === 'sales' && items.length > 0 && (
              <Collapsible open={warehouseExpanded} onOpenChange={setWarehouseExpanded}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
                    <Warehouse className="h-4 w-4" />
                    <span>出貨倉設定</span>
                    <ChevronDown className={`h-4 w-4 ml-auto transition-transform duration-200 ${warehouseExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {!consignmentMode ? (
                    items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm">
                        <span className="w-40 truncate">{item.productName || item.sku || item.id.slice(0, 8)}</span>
                        <WarehouseSelector
                          value={getItemWarehouse(item.id)}
                          onChange={(w) => setItemWarehouses(prev => ({ ...prev, [item.id]: w }))}
                          productId={item.productId}
                          variantId={item.variantId}
                        />
                        <Select
                          value={itemSources[item.id] || "self"}
                          onValueChange={(v) => setItemSources(prev => ({ ...prev, [item.id]: v }))}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="self">自有庫存</SelectItem>
                            <SelectItem value="supplier_consignment">供應商寄賣</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      寄賣模式：出貨時以店家寄賣方式轉出（庫存來源為「店家寄賣」，不扣自有庫存）。
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Two-panel layout: Order Items + Product Catalog */}
      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 'calc(100vh - 320px)' }}>
        {/* Left panel: Order items */}
        <div
          className={`transition-all duration-300 overflow-auto ${
            activePanel === 'items' ? 'lg:flex-[3]' : activePanel === 'products' ? 'lg:flex-[1]' : 'lg:flex-1'
          }`}
        >
          <Card className="h-full min-h-[300px]">
            <CardHeader className="sticky top-0 bg-background z-10 cursor-pointer" onClick={() => setActivePanel(activePanel === 'items' ? null : 'items')}>
              <CardTitle className="flex items-center justify-between">
                <span>{isEditMode ? '訂單項目' : (
                  orderType === 'purchase' ? '採購品項' :
                  orderType === 'consignment_receive' ? '寄賣收貨品項' :
                  orderType === 'consignment_send' ? '寄賣出貨品項' : '訂單項目'
                )}</span>
                <Badge variant="secondary">{items.length} 項</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent onClick={(e) => e.stopPropagation()}>
              <OrderItemsTable
                items={items}
                onUpdateQuantity={handleQuantityChange}
                onUpdatePrice={handlePriceChange}
                onRemove={handleRemoveItem}
                isEditable={true}
                priceSyncMap={orderType === 'sales' ? priceSyncMap : undefined}
                onTogglePriceSync={orderType === 'sales' ? handleTogglePriceSync : undefined}
                priceLabel={orderType === 'sales' ? '單價' : '進貨價'}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right panel: Product Catalog */}
        {(!isEditMode || rightPanelExpanded) && (
          <div
            className={`transition-all duration-300 overflow-hidden ${
              activePanel === 'products' ? 'lg:flex-[3]' : activePanel === 'items' ? 'lg:flex-[1]' : 'lg:flex-[2]'
            }`}
          >
            <Card className="h-full flex flex-col">
              <CardHeader className="sticky top-0 bg-background z-10 shrink-0 cursor-pointer" onClick={() => setActivePanel(activePanel === 'products' ? null : 'products')}>
                <div className="flex items-center justify-between">
                  <CardTitle>商品選擇</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setFilterSheetOpen(!filterSheetOpen); }}>
                      <Filter className="h-4 w-4" />
                    </Button>
                    <div className="flex bg-muted p-1 rounded-lg">
                      {(['products', 'variants', 'gallery', 'table'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={(e) => { e.stopPropagation(); setViewMode(mode); }}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-200 ${
                            viewMode === mode
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {mode === 'products' ? '產品' : mode === 'variants' ? '單品' : mode === 'gallery' ? '圖卡' : '表格'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-auto p-0" onClick={(e) => e.stopPropagation()}>
                <div className="flex h-full">
                  {/* Sidebar filters (desktop) */}
                  {!filterSheetOpen && (
                    <aside className="hidden xl:block w-56 shrink-0 border-r p-2">
                      <CatalogSidebar
                        products={storeProducts || []}
                        selectedCategory={selectedCategory}
                        onCategoryChange={handleCategoryChange}
                        selectedSpecs={selectedSpecs}
                        onSpecChange={handleSpecChange}
                        selectedBrands={selectedBrandsParam}
                        onBrandChange={handleBrandsChange}
                        onClearFilters={handleClearFilters}
                      />
                    </aside>
                  )}
                  {/* Filter sheet (mobile/tablet) */}
                  {filterSheetOpen && (
                    <aside className="w-64 shrink-0 border-r p-2 overflow-auto">
                      <CatalogSidebar
                        products={storeProducts || []}
                        selectedCategory={selectedCategory}
                        onCategoryChange={(v) => { handleCategoryChange(v); setFilterSheetOpen(false); }}
                        selectedSpecs={selectedSpecs}
                        onSpecChange={(key, values) => { handleSpecChange(key, values); setFilterSheetOpen(false); }}
                        selectedBrands={selectedBrandsParam}
                        onBrandChange={(v) => { handleBrandsChange(v); setFilterSheetOpen(false); }}
                        onClearFilters={() => { handleClearFilters(); setFilterSheetOpen(false); }}
                      />
                    </aside>
                  )}
                  {/* Product grid */}
                  <div className="flex-1 p-2 overflow-auto">
                    <ProductCatalog
                      products={filteredProducts}
                      isLoading={productsLoading}
                      storeId={draftKey}
                      viewMode={viewMode}
                      search={productSearch}
                      onSearchChange={setProductSearch}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {orderType === 'sales' && (
          <Button variant="outline" onClick={syncPrices} disabled={isSubmitting}>
            <Save className="mr-2 h-4 w-4" />同步價格
          </Button>
        )}
        {isEditMode ? (
          <>
            {order?.status === 'processing' && (
              <Button variant="default" onClick={() => setDirectShipDialogOpen(true)} disabled={isSubmitting}>
                <Send className="mr-2 h-4 w-4" />
                {order?.consignment_mode ? '寄賣出貨' : '轉銷貨單'}
              </Button>
            )}
            <Button onClick={() => updateOrderMutation.mutate()} disabled={isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {updateOrderMutation.isPending ? '儲存中…' : '儲存變更'}
            </Button>
          </>
        ) : orderType === 'sales' ? (
          <>
            <Button onClick={() => createPendingMutation.mutate()} disabled={isSubmitting || items.length === 0}>
              {createPendingMutation.isPending ? '建立中…' : '建立訂單'}
            </Button>
            <Button onClick={handleCreateWithSalesNote} disabled={isSubmitting || items.length === 0} variant="default">
              {consignmentMode ? '建立訂單並寄賣出貨' : '建立訂單並開立銷貨單'}
            </Button>
          </>
        ) : orderType === 'purchase' ? (
          <Button onClick={() => createPurchaseOrderMutation.mutate()} disabled={isSubmitting || items.length === 0 || !supplierId}>
            {createPurchaseOrderMutation.isPending ? '建立中…' : '建立採購單'}
          </Button>
        ) : orderType === 'consignment_receive' ? (
          <Button onClick={() => createConsignmentReceiveMutation.mutate()} disabled={isSubmitting || items.length === 0 || !supplierId}>
            {createConsignmentReceiveMutation.isPending ? '建立中…' : '建立寄賣收貨單'}
          </Button>
        ) : (
          <Button onClick={() => createConsignmentSendMutation.mutate()} disabled={isSubmitting || items.length === 0 || !supplierId || !targetStoreId}>
            {createConsignmentSendMutation.isPending ? '建立中…' : '建立寄賣出貨單'}
          </Button>
        )}
      </div>

      {/* Direct Ship Dialog */}
      <Dialog open={directShipDialogOpen} onOpenChange={(open) => {
        setDirectShipDialogOpen(open);
        if (open) setItemWarehouses({});
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {order?.consignment_mode ? '寄賣出貨' : '直接轉銷貨單'}
            </DialogTitle>
            <DialogDescription>
              {order?.consignment_mode
                ? '將此訂單的所有剩餘品項以店家寄賣方式直接出貨，不開立銷貨單，店家確認售出後再開立。'
                : '將此訂單的所有剩餘品項直接出貨，跳過出貨池。出貨後訂單狀態將變為「已出貨」。'}
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
            <div>
              <label className="text-sm font-medium">出貨時間</label>
              <Input
                type="datetime-local"
                value={shippedAt}
                onChange={(e) => setShippedAt(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{order?.consignment_mode ? '出貨資訊' : '出貨倉（逐項）'}</label>
              {order?.consignment_mode ? (
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  此訂單為寄賣模式，轉出時以店家寄賣方式記錄，不扣自有庫存。
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{item.productName || item.sku || item.id.slice(0, 8)}</span>
                    <span className="text-muted-foreground w-12 text-right">{item.quantity}件</span>
                    <WarehouseSelector
                      value={getItemWarehouse(item.id)}
                      onChange={(w) => setItemWarehouses(prev => ({ ...prev, [item.id]: w }))}
                      productId={item.productId}
                      variantId={item.variantId}
                    />
                    <Select
                      value={itemSources[item.id] || "self"}
                      onValueChange={(v) => setItemSources(prev => ({ ...prev, [item.id]: v }))}
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="self">自有庫存</SelectItem>
                        <SelectItem value="supplier_consignment">供應商寄賣</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))
              )}
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
              {directShipMutation.isPending ? '處理中…' : (order?.consignment_mode ? '確認寄賣出貨' : '確認轉銷貨單')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
