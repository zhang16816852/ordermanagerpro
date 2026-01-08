// src/pages/store/Catalog.tsx
import { useAuth } from '@/hooks/useAuth';
import { useCartStore } from '@/stores/useCartStore';
import { useStoreProductCache, ProductWithPricing, VariantWithPricing } from "@/hooks/useProductCache";
import ProductSelectionGrid from "@/components/productSelect/ProductSelectionGrid";
import CartSidebar from "@/components/cart/CartSidebar";

export default function StoreCatalog() {
  const { storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;

  // 使用與 OrderCreator 相同的 Cache Hook
  const { products, isLoading } = useStoreProductCache(storeId);
  
  const { items: cartItems, addItem } = useCartStore();

  const handleAddToCart = (product: ProductWithPricing, variant?: VariantWithPricing) => {
    addItem({
      id: product.id,
      variantId: variant?.id, // 確保你的 Zustand Store 支援 variantId
      name: variant ? `${product.name} - ${variant.name}` : product.name,
      sku: variant?.sku || product.sku,
      wholesale_price: variant?.effective_wholesale_price ?? product.wholesale_price,
    });
  };

  const getCartQuantity = (productId: string, variantId?: string) => {
    if (variantId) {
      return cartItems.find(i => i.productId === productId && i.variantId === variantId)?.quantity || 0;
    }
    return cartItems.find(i => i.productId === productId && !i.variantId)?.quantity || 0;
  };

  const getTotalProductQuantity = (productId: string) => {
    return cartItems
      .filter(i => i.productId === productId)
      .reduce((sum, i) => sum + i.quantity, 0);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
          <p className="text-muted-foreground">選擇想訂購的商品，加入購物車後去結帳</p>
        </div>

        <ProductSelectionGrid 
          products={products}
          isLoading={isLoading}
          onAddToCart={handleAddToCart}
          getCartQuantity={getCartQuantity}
          getTotalProductQuantity={getTotalProductQuantity}
        />
      </div>

      <div className="lg:col-span-1">
        <CartSidebar showCheckoutButton={true} />
      </div>
    </div>
  );
}