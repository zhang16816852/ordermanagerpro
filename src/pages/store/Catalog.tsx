// src/pages/store/Catalog.tsx
import { useAuth } from "@/hooks/useAuth";
import { useStoreProductCache } from "@/hooks/useProductCache";
import ProductCatalog from "@/components/order/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";

export default function StoreCatalog() {
  const { storeId } = useAuth();
  const { products, isLoading } = useStoreProductCache(storeId ?? null);

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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
          <p className="text-muted-foreground">選擇想訂購的商品，加入購物車後去結帳</p>
        </div>

        <ProductCatalog
          products={products}
          isLoading={isLoading}
          storeId={storeId}
        />
      </div>

      <div className="lg:col-span-1">
        <CartPanel storeId={storeId} showCheckoutButton />
      </div>
    </div>
  );
}
