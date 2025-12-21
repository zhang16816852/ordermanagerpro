import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

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
  const { storeRoles } = useAuth();
  const storeId = storeRoles[0]?.store_id;
  const [search, setSearch] = useState('');

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

  const getPrice = (product: ProductWithStorePrice, type: 'wholesale' | 'retail') => {
    const storePrice = product.store_products?.[0];
    if (type === 'wholesale') {
      return storePrice?.wholesale_price ?? product.base_wholesale_price;
    }
    return storePrice?.retail_price ?? product.base_retail_price;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
        <p className="text-muted-foreground">瀏覽可訂購的商品</p>
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
            <Card key={i} className="shadow-soft">
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-16 mb-1" />
                <Skeleton className="h-5 w-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-4" />
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredProducts?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">沒有找到商品</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredProducts?.map((product) => (
            <Card key={product.id} className="shadow-soft hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-xs">
                    {product.sku}
                  </Badge>
                </div>
                <CardTitle className="text-base line-clamp-2">{product.name}</CardTitle>
              </CardHeader>
              <CardContent>
                {product.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {product.description}
                  </p>
                )}
                <div className="flex justify-between items-center text-sm">
                  <div>
                    <span className="text-muted-foreground">批發價：</span>
                    <span className="font-semibold text-primary">
                      ${getPrice(product, 'wholesale').toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">零售價：</span>
                    <span className="font-semibold">
                      ${getPrice(product, 'retail').toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
