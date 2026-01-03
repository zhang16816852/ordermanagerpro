import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProductCache } from '@/hooks/useProductCache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Search, Save, Tags, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface PriceEntry {
  productId: string;
  wholesalePrice: string;
}

export default function AdminBrandPricing() {
  const queryClient = useQueryClient();
  const { products, isLoading: productsLoading, forceRefresh } = useProductCache();
  const [search, setSearch] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [priceEntries, setPriceEntries] = useState<Record<string, PriceEntry>>({});

  // 取得所有品牌
  const { data: brands = [], isLoading: brandsLoading } = useQuery({
    queryKey: ['all-brands'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('brand')
        .not('brand', 'is', null);
      if (error) throw error;
      const uniqueBrands = [...new Set(data.map(s => s.brand).filter(Boolean))] as string[];
      return uniqueBrands.sort();
    },
  });

  // 取得選定品牌的現有價格
  const { data: existingPrices = [] } = useQuery({
    queryKey: ['brand-prices', selectedBrand],
    queryFn: async () => {
      if (!selectedBrand) return [];
      const { data, error } = await supabase
        .from('store_products')
        .select('product_id, wholesale_price')
        .eq('brand', selectedBrand);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedBrand,
  });

  // 當選擇品牌時，載入現有價格
  useEffect(() => {
    if (!existingPrices) return;

    if (existingPrices.length > 0) {
      const entries: Record<string, PriceEntry> = {};
      existingPrices.forEach(p => {
        entries[p.product_id] = {
          productId: p.product_id,
          wholesalePrice: p.wholesale_price?.toString() || '',
        };
      });
      setPriceEntries(entries);
    } else {
      setPriceEntries({});
    }
  }, [existingPrices]);


  const activeProducts = products.filter(p => p.status === 'active');

  const filteredProducts = activeProducts.filter(p => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(searchLower) ||
      p.sku.toLowerCase().includes(searchLower)
    );
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBrand) throw new Error('請先選擇品牌');
      if (selectedProducts.size === 0) throw new Error('請選擇至少一個產品');

      const productsToSave = Array.from(selectedProducts).map(productId => {
        const entry = priceEntries[productId];
        const product = products.find(p => p.id === productId);
        return {
          product_id: productId,
          wholesale_price: entry?.wholesalePrice ? parseFloat(entry.wholesalePrice) : product?.base_wholesale_price || 0,
        };
      });

      // 使用 upsert 方式更新價格
      for (const item of productsToSave) {
        // 先檢查是否存在
        const { data: existing } = await supabase
          .from('store_products')
          .select('id')
          .eq('brand', selectedBrand)
          .eq('product_id', item.product_id)
          .maybeSingle();

        if (existing) {
          // 更新
          const { error } = await supabase
            .from('store_products')
            .update({
              wholesale_price: item.wholesale_price,
            })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          // 新增 - 使用 any 暫時繞過類型限制（types 尚未更新）
          const { error } = await supabase
            .from('store_products')
            .insert({
              brand: selectedBrand,
              product_id: item.product_id,
              wholesale_price: item.wholesale_price,
              store_id: '00000000-0000-0000-0000-000000000000', // placeholder, brand-based pricing
            } as any);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success(`已更新 ${selectedProducts.size} 個產品的批發價`);
      queryClient.invalidateQueries({ queryKey: ['brand-prices'] });
      setSelectedProducts(new Set());
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handlePriceChange = (productId: string, value: string) => {
    setPriceEntries(prev => ({
      ...prev,
      [productId]: {
        productId,
        wholesalePrice: value,
      },
    }));
  };

  const toggleProduct = (productId: string) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const toggleAll = () => {
    if (selectedProducts.size === filteredProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const applyBatchPrice = (value: string) => {
    const newEntries = { ...priceEntries };
    selectedProducts.forEach(productId => {
      newEntries[productId] = {
        productId,
        wholesalePrice: value,
      };
    });
    setPriceEntries(newEntries);
  };

  const isLoading = productsLoading || brandsLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">品牌批發價設定</h1>
          <p className="text-muted-foreground">批次設定各品牌的產品批發價（零售價統一使用基礎零售價）</p>
        </div>
        <Button variant="outline" onClick={forceRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重新載入產品
        </Button>
      </div>

      {/* 選擇品牌 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            選擇品牌
          </CardTitle>
          <CardDescription>
            選擇要設定批發價的品牌，或輸入新品牌名稱
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="選擇現有品牌" />
              </SelectTrigger>
              <SelectContent>
                {brands.map(brand => (
                  <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground self-center">或</span>
            <Input
              placeholder="輸入新品牌名稱"
              value={selectedBrand && !brands.includes(selectedBrand) ? selectedBrand : ''}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-64"
            />
          </div>
          {selectedBrand && (
            <Badge variant="secondary" className="text-base px-3 py-1">
              目前品牌：{selectedBrand}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* 批次操作 */}
      {selectedProducts.size > 0 && (
        <Card className="border-primary">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">批次設定批發價</CardTitle>
            <CardDescription>
              已選擇 {selectedProducts.size} 個產品
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">批發價：</span>
                <Input
                  type="number"
                  placeholder="批發價"
                  className="w-32"
                  onBlur={(e) => e.target.value && applyBatchPrice(e.target.value)}
                />
              </div>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !selectedBrand}
              >
                <Save className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? '儲存中...' : '儲存選定產品'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 搜尋 */}
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
        <span className="text-sm text-muted-foreground">
          共 {filteredProducts.length} 個產品
        </span>
      </div>

      {/* 產品列表 */}
      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>產品名稱</TableHead>
              <TableHead className="text-right">基礎批發價</TableHead>
              <TableHead className="text-right">基礎零售價</TableHead>
              <TableHead className="text-right">品牌批發價</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  沒有找到產品
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => {
                const entry = priceEntries[product.id];
                const hasCustomPrice = !!entry?.wholesalePrice;
                return (
                  <TableRow key={product.id} className={selectedProducts.has(product.id) ? 'bg-muted/50' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={selectedProducts.has(product.id)}
                        onCheckedChange={() => toggleProduct(product.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                    <TableCell className="font-medium">
                      {product.name}
                      {hasCustomPrice && (
                        <Badge variant="outline" className="ml-2 text-xs">已設定</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      ${product.base_wholesale_price}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      ${product.base_retail_price}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        placeholder={product.base_wholesale_price.toString()}
                        value={entry?.wholesalePrice || ''}
                        onChange={(e) => handlePriceChange(product.id, e.target.value)}
                        className="w-24 text-right ml-auto"
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
