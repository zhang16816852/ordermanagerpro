import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStoreProductCache } from "@/hooks/useProductCache";
import ProductCatalog from "@/components/order/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Filter } from "lucide-react";
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import { CatalogSidebar } from "@/components/order/CatalogSidebar";
import { ProductWithPricing } from "@/types/product";

export default function StoreCatalog() {
  const { storeId } = useAuth();
  const { totalItems } = useStoreDraft(storeId || '');
  const { products, isLoading } = useStoreProductCache(storeId ?? null);
  const [viewMode, setViewMode] = useState<'products' | 'variants' | 'gallery'>('products');

  // Filter states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSpecs, setSelectedSpecs] = useState<Record<string, string[]>>({});
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);

  const handleSpecChange = useCallback((key: string, values: string[]) => {
    setSelectedSpecs(prev => {
      const next = { ...prev };
      if (values.length === 0) {
        delete next[key];
      } else {
        next[key] = values;
      }
      return next;
    });
  }, []);

  const handleBrandChange = useCallback((brands: string[]) => {
    setSelectedBrands(brands);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedCategory(null);
    setSelectedSpecs({});
    setSelectedBrands([]);
  }, []);

  if (!storeId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        無法取得店鋪資訊
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-64 flex-shrink-0">
        <CatalogSidebar
          products={products}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          selectedSpecs={selectedSpecs}
          onSpecChange={handleSpecChange}
          selectedBrands={selectedBrands}
          onBrandChange={handleBrandChange}
          onClearFilters={clearFilters}
        />
      </aside>

      <div className="flex-1 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
            <p className="text-muted-foreground text-sm">選擇想訂購的商品，加入購物車後去結帳</p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Mobile Filter Toggle */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="md:hidden">
                  <Filter className="h-4 w-4 mr-2" />
                  篩選
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <CatalogSidebar
                  products={products}
                  selectedCategory={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  selectedSpecs={selectedSpecs}
                  onSpecChange={handleSpecChange}
                  selectedBrands={selectedBrands}
                  onBrandChange={handleBrandChange}
                  onClearFilters={clearFilters}
                />
              </SheetContent>
            </Sheet>

            <div className="flex bg-muted p-1 rounded-lg">
              <button
                onClick={() => setViewMode('products')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'products'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                產品
              </button>
              <button
                onClick={() => setViewMode('variants')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'variants'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                單品
              </button>
              <button
                onClick={() => setViewMode('gallery')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'gallery'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                圖卡
              </button>
            </div>

            <Sheet>
              <SheetTrigger asChild>
                <Button className="relative h-9">
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  購物車
                  {totalItems > 0 && (
                    <Badge variant="destructive" className="ml-2 -mr-1 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                      {totalItems}
                    </Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-full sm:max-w-[500px] p-0 h-full flex flex-col"
              >
                <CartPanel storeId={storeId} showCheckoutButton />
              </SheetContent>

            </Sheet>
          </div>
        </div>

        <ProductCatalog
          products={products}
          isLoading={isLoading}
          storeId={storeId}
          viewMode={viewMode}
          categoryFilter={selectedCategory}
          specFilters={selectedSpecs}
          brandFilter={selectedBrands}
        />
      </div>
    </div>
  );
}
