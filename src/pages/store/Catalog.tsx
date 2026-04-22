import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Category } from "@/types/product";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import { CatalogSidebar } from "@/components/order/CatalogSidebar";
import { ProductWithPricing } from "@/types/product";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function StoreCatalog() {
  const { storeId } = useAuth();
  const { totalItems } = useStoreDraft(storeId || '');
  const { products, isLoading } = useStoreProductCache(storeId ?? null);
  
  // Fetch categories for ID <-> Name mapping
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => {
        const { data, error } = await supabase.from('categories')
            .select('*')
            .order('sort_order', { ascending: true });
        if (error) return [];
        return data as Category[];
    },
  });

  const [viewMode, setViewMode] = useState<'products' | 'variants' | 'gallery'>('products');
  const [searchParams, setSearchParams] = useSearchParams();

  // URL States
  const search = searchParams.get("search") || "";
  const categoryNameInUrl = searchParams.get("category");
  const selectedBrands = searchParams.get("brands")?.split(",").filter(Boolean) || [];

  const selectedCategory = useMemo(() => {
    if (!categoryNameInUrl || categories.length === 0) return null;
    return categories.find(c => c.name === categoryNameInUrl)?.id || null;
  }, [categoryNameInUrl, categories]);

  // Specs are a bit more complex, stored as JSON in URL for simplicity
  const selectedSpecs = useMemo(() => {
    try {
      const s = searchParams.get("specs");
      return s ? JSON.parse(s) : {};
    } catch { return {}; }
  }, [searchParams]);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleSearchChange = (val: string) => updateParams({ search: val });
  
  const setSelectedCategory = (id: string | null) => {
    const cat = categories.find(c => c.id === id);
    updateParams({ category: cat ? cat.name : null, specs: null }); // Use name in URL, reset specs
  };

  const setSelectedBrands = (val: string[]) => updateParams({ brands: val.join(",") });
  const handleSpecChange = useCallback((key: string, values: string[]) => {
    const nextSpecs = { ...selectedSpecs };
    if (values.length === 0) delete nextSpecs[key];
    else nextSpecs[key] = values;
    updateParams({ specs: Object.keys(nextSpecs).length > 0 ? JSON.stringify(nextSpecs) : null });
  }, [selectedSpecs, updateParams]);

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

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
          onBrandChange={setSelectedBrands}
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
                  onBrandChange={setSelectedBrands}
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
          search={search}
          onSearchChange={handleSearchChange}
          categoryFilter={selectedCategory}
          specFilters={selectedSpecs}
          brandFilter={selectedBrands}
        />
      </div>
    </div>
  );
}
