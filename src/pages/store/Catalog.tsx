// src/pages/store/Catalog.tsx
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStoreProductCache } from "@/hooks/useProductCache";
import ProductCatalog from "@/components/order/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";

export default function StoreCatalog() {
  const { storeId } = useAuth();
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
            <p className="text-muted-foreground">選擇想訂購的商品，加入購物車後去結帳</p>
          </div>

          <div className="flex bg-muted p-1 rounded-lg self-start sm:self-auto">
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
        </div>

        <ProductCatalog
          products={products}
          isLoading={isLoading}
          storeId={storeId}
          viewMode={viewMode}
        />
      </div>

      <div className="lg:col-span-1">
        <CartPanel storeId={storeId} showCheckoutButton />
      </div>
    </div>
  );
}
