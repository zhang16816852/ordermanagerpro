// src/pages/store/Catalog.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCartStore, CartItem } from '@/stores/useCartStore';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Search, Package, ShoppingCart, Plus, Minus, Trash2, ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import CartSidebar from "@/components/cart/CartSidebar";
interface ProductWithStorePrice {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  base_wholesale_price: number;
  base_retail_price: number;
  status: 'active' | 'discontinued';
  store_products: { wholesale_price: number | null; retail_price: number | null }[];
}

export default function StoreCatalog() {
  const navigate = useNavigate();
  const { storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;

  const [search, setSearch] = useState('');

  // Zustand 購物車狀態
  const { items: cartItems, addItem, updateQuantity, removeItem, getTotalItems, getTotalAmount } = useCartStore();

  const { data: products, isLoading } = useQuery({
    queryKey: ['store-catalog', storeId],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select(`
          id,
          name,
          sku,
          description,
          base_wholesale_price,
          base_retail_price,
          status,
          store_products!left (wholesale_price, retail_price)
        `)
        .eq('status', 'active')
        .order('name');

      if (storeId) {
        query = query.eq('store_products.store_id', storeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ProductWithStorePrice[];
    },
  });

  const filteredProducts = products?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const getWholesalePrice = (product: ProductWithStorePrice) => {
    const storePrice = product.store_products?.[0];
    return storePrice?.wholesale_price ?? product.base_wholesale_price;
  };

  // 檢查此商品是否已在購物車，以及數量
  const getCartQuantity = (productId: string) => {
    const item = cartItems.find((i) => i.productId === productId);
    return item?.quantity || 0;
  };

  const handleAddToCart = (product: ProductWithStorePrice) => {
    addItem({
      id: product.id,
      name: product.name,
      sku: product.sku,
      wholesale_price: getWholesalePrice(product),
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 左側：商品列表 */}
      <div className="lg:col-span-2 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
          <p className="text-muted-foreground">選擇想訂購的商品，加入購物車後去結帳</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋產品名稱或 SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-16 mb-1" />
                  <Skeleton className="h-5 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full mb-4" />
                  <Skeleton className="h-5 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredProducts?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center col-span-full">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">沒有找到商品</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts?.map((product) => {
              const cartQty = getCartQuantity(product.id);
              const price = getWholesalePrice(product);

              return (
                <Card
                  key={product.id}
                  className="shadow-soft hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleAddToCart(product)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono text-xs">
                        {product.sku}
                      </Badge>
                      {cartQty > 0 && (
                        <Badge variant="default" className="text-xs">
                          已加入 {cartQty}
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-base line-clamp-2">{product.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {product.description && (
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    <div className="flex justify-between items-center">
                      <div className="font-semibold text-primary">
                        ${price.toFixed(2)}
                      </div>
                      <Button size="sm" variant="default">
                        <Plus className="h-4 w-4 mr-1" />
                        加入購物車
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 右側：側邊購物車 */}
      <div className="lg:col-span-1">
        <CartSidebar showCheckoutButton={true} />
      </div>
    </div>
  );
}