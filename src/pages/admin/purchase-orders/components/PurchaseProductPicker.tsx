import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { ProductSelector, type ViewMode } from '@/components/order/ProductSelector';
import { useStoreDraft } from '@/store/useOrderDraftStore';
import { useSpecStore } from '@/store/useSpecStore';
import { useBrands } from '@/hooks/useBrands';
import { useProductCache } from '@/hooks/useProductCache';
import { useProductSearch } from '@/hooks/useProductSearch';
import { formatCurrency } from '@/lib/formatters';
import type { ProductWithPricing } from '@/types/product';

export interface PurchasePickerItem {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_cost: number;
}

interface PurchaseProductPickerProps {
  purchaseOrderId: string;
  supplierId?: string | null;
  isLoading?: boolean;
  onSubmit: (items: PurchasePickerItem[]) => void;
}

const mappingKey = (productId: string, variantId?: string | null) =>
  `${productId}_${variantId ?? ''}`;

export function PurchaseProductPicker({
  purchaseOrderId,
  supplierId,
  isLoading,
  onSubmit,
}: PurchaseProductPickerProps) {
  const draftKey = `po-pick-${purchaseOrderId}`;
  const { items, updateQuantity, removeItem, clearDraft } = useStoreDraft(draftKey);
  const { products: rawProducts, isLoading: productsLoading } = useProductCache();
  const { categories, categoryHierarchy, fetchSpecs } = useSpecStore();
  const { brands } = useBrands();

  // 篩選狀態刻意用區域 local state（不寫入 URL），避免污染採購頁既有的 URL 篩選參數
  const [viewMode, setViewMode] = useState<ViewMode>('products');
  const [productSearch, setProductSearch] = useState('');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSpecs, setSelectedSpecs] = useState<Record<string, string[]>>({});
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [costOverrides, setCostOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    if (categories.length === 0) fetchSpecs();
  }, [categories.length, fetchSpecs]);

  // 採購需可挑全部商品（含隱藏／維修零件／運費型），故直接用完整商品快取，不套用門市目錄的過濾
  const products = useMemo<ProductWithPricing[]>(
    () =>
      (rawProducts ?? []).map((p) => ({
        ...p,
        wholesale_price: p.unified_wholesale_price ?? 0,
        retail_price: p.unified_retail_price ?? 0,
        has_store_price: false,
        variants: (p.variants ?? []).map((v) => ({
          ...v,
          effective_wholesale_price: v.wholesale_price ?? 0,
          effective_retail_price: v.retail_price ?? 0,
          has_brand_price: false,
        })),
      })),
    [rawProducts]
  );

  const brandMap = useMemo(
    () => (brands ?? []).reduce<Record<string, string>>((acc, b: any) => {
      acc[b.id] = b.name;
      return acc;
    }, {}),
    [brands]
  );

  const filteredProducts = useProductSearch({
    products,
    search: productSearch,
    selectedCategory,
    categoryHierarchy,
    selectedBrands,
    selectedSpecs,
    brandMap,
  });

  // 供應商商品對應的廠商成本優先於變體批價
  const { data: vendorCostMap = {} } = useQuery({
    queryKey: ['po-vendor-costs', supplierId],
    queryFn: async () => {
      if (!supplierId) return {} as Record<string, number>;
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('internal_product_id, internal_variant_id, vendor_unit_cost')
        .eq('supplier_id', supplierId);
      if (error) throw error;
      return ((data as any[]) ?? []).reduce<Record<string, number>>((acc, m) => {
        if (m.vendor_unit_cost != null) {
          acc[mappingKey(m.internal_product_id, m.internal_variant_id)] = m.vendor_unit_cost;
        }
        return acc;
      }, {});
    },
    enabled: !!supplierId,
  });

  // 加購配件（item_type='packaging'）不是採購意圖，僅取實際挑選的品項
  const stagedItems = useMemo(
    () => items.filter((item) => !item.id.startsWith('addon:')),
    [items]
  );

  const costOf = (item: (typeof items)[number]) =>
    costOverrides[item.id] ??
    vendorCostMap[mappingKey(item.productId, item.variantId)] ??
    item.unitCost ??
    item.price ??
    0;

  const totalAmount = stagedItems.reduce(
    (sum, item) => sum + item.quantity * costOf(item),
    0
  );

  const handleSpecChange = (key: string, values: string[]) => {
    setSelectedSpecs((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
  };

  const handleClearFilters = () => {
    setSelectedCategory(null);
    setSelectedBrands([]);
    setSelectedSpecs({});
  };

  const handleSubmit = () => {
    if (stagedItems.length === 0) return;
    onSubmit(
      stagedItems.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId ?? null,
        quantity: item.quantity,
        unit_cost: costOf(item),
      }))
    );
    clearDraft();
    setCostOverrides({});
  };

  return (
    <div className="space-y-3">
      <div className="h-[320px] rounded-md border">
        <ProductSelector
          products={products}
          productsLoading={productsLoading}
          filteredProducts={filteredProducts}
          storeId={draftKey}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          productSearch={productSearch}
          onSearchChange={setProductSearch}
          filterSheetOpen={filterSheetOpen}
          onFilterSheetToggle={() => setFilterSheetOpen((v) => !v)}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          selectedSpecs={selectedSpecs}
          onSpecChange={handleSpecChange}
          selectedBrands={selectedBrands}
          onBrandChange={setSelectedBrands}
          onClearFilters={handleClearFilters}
          activePanel={catalogOpen ? 'products' : null}
          onTogglePanel={() => setCatalogOpen((v) => !v)}
          collapsed={!catalogOpen}
          catalogSidebarMaxHeight={280}
        />
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">
            已選購品項（{stagedItems.length}）
          </span>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">合計</span>
            <span className="font-medium">{formatCurrency(totalAmount)}</span>
          </div>
        </div>
        {stagedItems.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            尚未選擇品項，請由上方商品目錄點選加入。
          </p>
        ) : (
          <div className="max-h-44 divide-y overflow-auto">
            {stagedItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.variantName || item.productName}
                  </div>
                  {item.variantName && (
                    <div className="truncate text-xs text-muted-foreground">
                      {item.productName}
                    </div>
                  )}
                </div>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  aria-label="數量"
                  className="h-8 w-16 shrink-0"
                  value={item.quantity}
                  onChange={(e) =>
                    updateQuantity(item.id, Math.max(1, parseInt(e.target.value) || 1))
                  }
                />
                <Input
                  type="number"
                  min={0}
                  step="any"
                  aria-label="單價"
                  className="h-8 w-24 shrink-0"
                  value={costOf(item)}
                  onChange={(e) =>
                    setCostOverrides((prev) => ({
                      ...prev,
                      [item.id]: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive"
                  aria-label="移除品項"
                  onClick={() => removeItem(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button onClick={handleSubmit} disabled={stagedItems.length === 0 || isLoading}>
          {isLoading ? '處理中...' : `加入採購單（${stagedItems.length} 項）`}
        </Button>
      </DialogFooter>
    </div>
  );
}
