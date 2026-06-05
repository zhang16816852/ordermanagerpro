import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProductCache } from '@/hooks/useProductCache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { calculatePriceRange } from '@/utils/priceUtils';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Search, Save, Tags, RefreshCw, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface PriceEntry {
  productId: string;
  variantId?: string;
  wholesalePrice: string;
}

export default function AdminStorePricing() {
  const queryClient = useQueryClient();
  const { products, isLoading: productsLoading, forceRefresh } = useProductCache();
  const [search, setSearch] = useState('');
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [priceEntries, setPriceEntries] = useState<Record<string, PriceEntry>>({});
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const { data: stores = [], isLoading: storesLoading } = useQuery({
    queryKey: ['chain-stores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, brand')
        .not('brand', 'is', null)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // 取得選定連鎖客戶的現有價格（包含變體）
  const { data: existingPrices = [] } = useQuery({
    queryKey: ['store-prices', selectedStore],
    queryFn: async () => {
      if (!selectedStore) return [];
      const { data, error } = await supabase
        .from('store_products')
        .select('product_id, variant_id, wholesale_price')
        .eq('brand', selectedStore);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedStore,
  });

  // 取得所有變體
  const { data: allVariants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['all-product-variants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .order('sku');
      if (error) throw error;
      return data || [];
    },
  });

  // 當選擇連鎖客戶時，載入現有價格
  useEffect(() => {
    if (!existingPrices) return;

    if (existingPrices.length > 0) {
      const entries: Record<string, PriceEntry> = {};
      existingPrices.forEach(p => {
        // 統一使用 : 作為分隔符
        const key = p.variant_id ? `${p.product_id}:${p.variant_id}` : p.product_id;
        entries[key] = {
          productId: p.product_id,
          variantId: p.variant_id || undefined,
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

  // 取得產品的變體
  const getProductVariants = (productId: string) => {
    return allVariants.filter(v => v.product_id === productId && v.status === 'active');
  };

  // 儲存價格的 mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStore) throw new Error('請先選擇連鎖客戶');
      if (selectedProducts.size === 0) throw new Error('請選擇至少一個產品');

      // 整理資料格式
      const itemsToSave = Array.from(selectedProducts).map(key => {
 
        const [productId, variantId] = key.includes(':')
          ? key.split(':')
          : [key, null];

        const entry = priceEntries[key];
        const product = products.find(p => p.id === productId);
        const variant = variantId ? allVariants.find(v => v.id === variantId) : null;

        return {
          product_id: productId,
          variant_id: variantId,
          wholesale_price: entry?.wholesalePrice
            ? parseFloat(entry.wholesalePrice)
            : (variant?.wholesale_price ?? product?.base_wholesale_price ?? 0),
        };
      });

      // 呼叫 RPC 函數
      const { error } = await supabase.rpc('upsert_brand_product_prices', {
        p_brand: selectedStore, // 根據你的定義，這是一個單獨的參數
        p_products: itemsToSave
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`已成功更新價格`);
      queryClient.invalidateQueries({ queryKey: ['store-prices', selectedStore] });
      setSelectedProducts(new Set());
    },
    onError: (error: Error) => {
      toast.error(`儲存失敗: ${error.message}`);
    },
  });

  const handlePriceChange = (key: string, productId: string, variantId: string | undefined, value: string) => {
    setPriceEntries(prev => ({
      ...prev,
      [key]: {
        productId,
        variantId,
        wholesalePrice: value,
      },
    }));
  };

  const toggleProduct = (key: string) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const toggleExpanded = (productId: string) => {
    setExpandedProducts(prev => {
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
    const allKeys: string[] = [];
    filteredProducts.forEach(p => {
      const variants = getProductVariants(p.id);
      if (variants.length > 0) {
        variants.forEach(v => allKeys.push(`${p.id}:${v.id}`));
      } else {
        allKeys.push(p.id);
      }
    });

    if (selectedProducts.size === allKeys.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(allKeys));
    }
  };

  const applyBatchPrice = (value: string) => {
    const newEntries = { ...priceEntries };
    selectedProducts.forEach(key => {
      // 統一使用 : 作為分隔符
      const [productId, variantId] = key.includes(':') ? key.split(':') : [key, undefined];
      newEntries[key] = {
        productId,
        variantId,
        wholesalePrice: value,
      };
    });
    setPriceEntries(newEntries);
  };

  const isLoading = productsLoading || storesLoading || variantsLoading;

  // 計算總選擇數
  const getTotalSelectableCount = () => {
    let count = 0;
    filteredProducts.forEach(p => {
      const variants = getProductVariants(p.id);
      count += variants.length > 0 ? variants.length : 1;
    });
    return count;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">連鎖客戶批發價設定</h1>
          <p className="text-muted-foreground">批次設定各連鎖客戶的產品與變體批發價</p>
        </div>
        <Button variant="outline" onClick={forceRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重新載入產品
        </Button>
      </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                          
      {/* 選擇連鎖客戶 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            選擇連鎖客戶
          </CardTitle>
          <CardDescription>
            選擇要設定批發價的連鎖客戶，或輸入新連鎖客戶名稱
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="選擇現有連鎖客戶" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.brand}>{store.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground self-center">或</span>
            <Input
              placeholder="輸入新連鎖客戶名稱"
              value={selectedStore && !stores.some(s => s.brand === selectedStore) ? selectedStore : ''}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="w-64"
            />
          </div>
          {selectedStore && (
            <Badge variant="secondary" className="text-base px-3 py-1">
              目前連鎖客戶：{selectedStore}
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
              已選擇 {selectedProducts.size} 個項目
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
                disabled={saveMutation.isPending || !selectedStore}
              >
                <Save className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? '儲存中...' : '儲存選定項目'}
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
                  checked={selectedProducts.size === getTotalSelectableCount() && getTotalSelectableCount() > 0}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>產品名稱</TableHead>
              <TableHead className="text-right">基礎批發價</TableHead>
              <TableHead className="text-right">基礎零售價</TableHead>
              <TableHead className="text-right">連鎖客戶批發價</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
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
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  沒有找到產品
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => {
                const variants = getProductVariants(product.id);
                const hasVariants = variants.length > 0;
                const isExpanded = expandedProducts.has(product.id);
                const productEntry = priceEntries[product.id];
                const hasCustomPrice = !!productEntry?.wholesalePrice;

                return (
                  <Collapsible key={product.id} open={isExpanded} onOpenChange={() => toggleExpanded(product.id)} asChild>
                    <>
                      <TableRow className={hasVariants ? 'cursor-pointer hover:bg-muted/50' : ''}>
                        <TableCell>
                          {!hasVariants && (
                            <Checkbox
                              checked={selectedProducts.has(product.id)}
                              onCheckedChange={() => toggleProduct(product.id)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {hasVariants && (
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                        <TableCell className="font-medium">
                          {product.name}
                          {hasVariants && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              <Layers className="h-3 w-3 mr-1" />
                              {variants.length} 變體
                            </Badge>
                          )}
                          {!hasVariants && hasCustomPrice && (
                            <Badge variant="outline" className="ml-2 text-xs">已設定</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {calculatePriceRange(product.base_wholesale_price, variants.map(v => v.wholesale_price)).display}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {calculatePriceRange(product.base_retail_price, variants.map(v => v.retail_price)).display}
                        </TableCell>
                        <TableCell className="text-right">
                          {!hasVariants ? (
                            <Input
                              type="number"
                              placeholder={product.base_wholesale_price.toString()}
                              value={productEntry?.wholesalePrice || ''}
                              onChange={(e) => handlePriceChange(product.id, product.id, undefined, e.target.value)}
                              className="w-24 text-right ml-auto"
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">展開設定</span>
                          )}
                        </TableCell>
                      </TableRow>

                      {hasVariants && (
                        <CollapsibleContent asChild>
                          <>
                            {variants.map((variant) => {
                              const variantKey = `${product.id}:${variant.id}`;
                              const variantEntry = priceEntries[variantKey];
                              const hasVariantCustomPrice = !!variantEntry?.wholesalePrice;

                              return (
                                <TableRow key={variant.id} className="bg-muted/30">
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedProducts.has(variantKey)}
                                      onCheckedChange={() => toggleProduct(variantKey)}
                                    />
                                  </TableCell>
                                  <TableCell></TableCell>
                                  <TableCell className="font-mono text-sm pl-8">{variant.sku}</TableCell>
                                  <TableCell className="pl-8">
                                    <span className="text-muted-foreground">└ </span>
                                    {variant.name}
                                    {hasVariantCustomPrice && (
                                      <Badge variant="outline" className="ml-2 text-xs">已設定</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    ${variant.wholesale_price}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    ${variant.retail_price}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Input
                                      type="number"
                                      placeholder={variant.wholesale_price.toString()}
                                      value={variantEntry?.wholesalePrice || ''}
                                      onChange={(e) => handlePriceChange(variantKey, product.id, variant.id, e.target.value)}
                                      className="w-24 text-right ml-auto"
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </>
                        </CollapsibleContent>
                      )}
                    </>
                  </Collapsible>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}