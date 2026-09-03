import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Filter } from 'lucide-react';
import ProductCatalog from '@/components/products/catalog/ProductCatalog';
import { CatalogSidebar } from '@/components/products/catalog/CatalogSidebar';
import { ProductWithPricing } from '@/types/product';
import type { PanelState } from '@/components/order/OrderItemsPanel';

export type ViewMode = 'products' | 'variants' | 'gallery' | 'table';

interface ProductSelectorProps {
  products?: ProductWithPricing[];
  productsLoading: boolean;
  filteredProducts: ProductWithPricing[];
  storeId: string;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  productSearch: string;
  onSearchChange: (v: string) => void;
  filterSheetOpen: boolean;
  onFilterSheetToggle: () => void;
  selectedCategory: string | null;
  onCategoryChange: (id: string | null) => void;
  selectedSpecs: Record<string, string[]>;
  onSpecChange: (key: string, values: string[]) => void;
  selectedBrands: string[];
  onBrandChange: (v: string[]) => void;
  onClearFilters: () => void;
  activePanel: PanelState;
  onTogglePanel: () => void;
  catalogSidebarMaxHeight?: number;
  bare?: boolean;
}

export function ProductSelector({
  products,
  productsLoading,
  filteredProducts,
  storeId,
  viewMode,
  onViewModeChange,
  productSearch,
  onSearchChange,
  filterSheetOpen,
  onFilterSheetToggle,
  selectedCategory,
  onCategoryChange,
  selectedSpecs,
  onSpecChange,
  selectedBrands,
  onBrandChange,
  onClearFilters,
  activePanel,
  onTogglePanel,
  catalogSidebarMaxHeight = 520,
  bare = false,
}: ProductSelectorProps) {
  const viewModes: ViewMode[] = ['products', 'variants', 'gallery', 'table'];
  const viewModeLabels: Record<ViewMode, string> = {
    products: '產品',
    variants: '單品',
    gallery: '圖卡',
    table: '表格',
  };

  const header = (
    <div className="flex items-center justify-between">
      <CardTitle>商品選擇</CardTitle>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onFilterSheetToggle(); }}>
          <Filter className="h-4 w-4" />
        </Button>
        <div className="flex bg-muted p-1 rounded-lg">
          {viewModes.map((mode) => (
            <button
              key={mode}
              onClick={(e) => { e.stopPropagation(); onViewModeChange(mode); }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-200 ${
                viewMode === mode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {viewModeLabels[mode]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const body = (
    <div className="flex h-full">
      {!filterSheetOpen && (
        <aside className="hidden xl:block w-56 shrink-0 border-r p-2 overflow-auto" style={{ maxHeight: catalogSidebarMaxHeight }}>
          <CatalogSidebar
            products={products || []}
            selectedCategory={selectedCategory}
            onCategoryChange={onCategoryChange}
            selectedSpecs={selectedSpecs}
            onSpecChange={onSpecChange}
            selectedBrands={selectedBrands}
            onBrandChange={onBrandChange}
            onClearFilters={onClearFilters}
          />
        </aside>
      )}
      {filterSheetOpen && (
        <aside className="w-64 shrink-0 border-r p-2 overflow-auto" style={{ maxHeight: catalogSidebarMaxHeight }}>
          <CatalogSidebar
            products={products || []}
            selectedCategory={selectedCategory}
            onCategoryChange={(v) => { onCategoryChange(v); onFilterSheetToggle(); }}
            selectedSpecs={selectedSpecs}
            onSpecChange={(key, values) => { onSpecChange(key, values); onFilterSheetToggle(); }}
            selectedBrands={selectedBrands}
            onBrandChange={(v) => { onBrandChange(v); onFilterSheetToggle(); }}
            onClearFilters={() => { onClearFilters(); onFilterSheetToggle(); }}
          />
        </aside>
      )}
      <div className="flex-1 p-2 overflow-auto">
        <ProductCatalog
          products={filteredProducts}
          isLoading={productsLoading}
          storeId={storeId}
          viewMode={viewMode}
          search={productSearch}
          onSearchChange={onSearchChange}
        />
      </div>
    </div>
  );

  if (bare) {
    return (
      <div className="flex flex-col h-full">
        <div className="sticky top-0 bg-background z-10 shrink-0 cursor-pointer" onClick={onTogglePanel}>
          {header}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-0" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="sticky top-0 bg-background z-10 shrink-0 cursor-pointer" onClick={onTogglePanel}>
        {header}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-auto p-0" onClick={(e) => e.stopPropagation()}>
        {body}
      </CardContent>
    </Card>
  );
}
