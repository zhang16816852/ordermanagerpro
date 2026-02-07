// src/pages/store/Catalog.tsx
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStoreProductCache } from "@/hooks/useProductCache";
import ProductCatalog from "@/components/order/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useStoreDraft } from "@/stores/useOrderDraftStore";

export default function StoreCatalog() {
  const { storeId } = useAuth();
  const { totalItems } = useStoreDraft(storeId || '');
  const { products, isLoading } = useStoreProductCache(storeId ?? null);
  const [viewMode, setViewMode] = useState<'products' | 'variants'>('products');

  if (!storeId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        無法取得店鋪資訊
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
          <p className="text-muted-foreground">選擇想訂購的商品，加入購物車後去結帳</p>
        </div>

        <div className="flex items-center gap-4 self-start sm:self-auto">
          <div className="flex bg-muted p-1 rounded-lg">
            <button
              onClick={() => setViewMode('products')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'products'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              產品檢視
            </button>
            <button
              onClick={() => setViewMode('variants')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'variants'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              單品檢視
            </button>
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button className="relative">
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
              className="w-full sm:w-[540px] p-3"
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
      />
    </div>
  );
}
