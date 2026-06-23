import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Link2, Unlink, Search, Package } from 'lucide-react';
import { toast } from 'sonner';
import { entityBindingService, EntityBinding, BoundProductInfo } from '@/services/entityBindingService';

interface EntityBindingManagerProps {
  productId: string;
}

export function EntityBindingManager({ productId }: EntityBindingManagerProps) {
  const [bindings, setBindings] = useState<EntityBinding[]>([]);
  const [boundProducts, setBoundProducts] = useState<BoundProductInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BoundProductInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const loadBindings = async () => {
    setIsLoading(true);
    try {
      const data = await entityBindingService.fetchBindings('product', productId);
      setBindings(data);
      const ids = entityBindingService.getBoundProductIds(data, productId);
      if (ids.length > 0) {
        const products = await entityBindingService.fetchBoundProducts(ids);
        setBoundProducts(products);
      } else {
        setBoundProducts([]);
      }
    } catch (err: any) {
      console.error('Failed to load bindings:', err);
      toast.error('載入綁定資料失敗');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBindings();
  }, [productId]);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await entityBindingService.searchProducts(searchQuery);
        setSearchResults(results.filter(r => r.id !== productId));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, productId]);

  const handleAdd = async (targetId: string) => {
    try {
      await entityBindingService.addBinding('product', productId, targetId);
      toast.success('綁定成功');
      setSearchQuery('');
      setSearchResults([]);
      await loadBindings();
    } catch (err: any) {
      toast.error(`綁定失敗: ${err.message}`);
    }
  };

  const handleRemove = async (bindingId: string) => {
    try {
      await entityBindingService.removeBinding(bindingId);
      toast.success('已解除綁定');
      await loadBindings();
    } catch (err: any) {
      toast.error(`解除綁定失敗: ${err.message}`);
    }
  };

  const isAlreadyBound = (productId: string) => {
    return bindings.some(b =>
      b.product_id === productId || b.bound_product_id === productId
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          產品綁定管理
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          綁定後，價格、規格、型號關聯、分類會自動同步。名稱、SKU、圖片、變體各自獨立。
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {boundProducts.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                {boundProducts.map((bp) => {
                  const binding = bindings.find(b =>
                    (b.product_id === bp.id || b.bound_product_id === bp.id)
                  );
                  return (
                    <div key={bp.id} className="flex items-center justify-between p-2 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{bp.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{bp.sku}</div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => binding && handleRemove(binding.id)}
                      >
                        <Unlink className="h-4 w-4 mr-1" />
                        解除
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {boundProducts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border rounded-lg">
              <Link2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">尚未綁定任何產品</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">綁定其他產品</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋產品名稱或 SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {isSearching && (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                搜尋中...
              </div>
            )}

            {searchResults.length > 0 && (
              <Card>
                <CardContent className="p-2 space-y-1">
                  {searchResults.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <div>
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.sku}</div>
                      </div>
                      {isAlreadyBound(r.id) ? (
                        <Badge variant="secondary" className="text-xs">已綁定</Badge>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleAdd(r.id)}>
                          <Link2 className="h-3 w-3 mr-1" />
                          綁定
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
              <p className="text-sm text-muted-foreground py-2">找不到符合的產品</p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <h4 className="text-sm font-medium mb-2">同步說明</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] h-4 px-1">自動</Badge>
                價格 (<code className="text-[10px]">base_wholesale_price</code>、<code className="text-[10px]">base_retail_price</code>)
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] h-4 px-1">自動</Badge>
                規格值 (<code className="text-[10px]">entity_spec_values</code>)
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] h-4 px-1">自動</Badge>
                型號關聯 (<code className="text-[10px]">entity_model_relations</code>)
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] h-4 px-1">自動</Badge>
                分類 (<code className="text-[10px]">product_category_links</code>)
              </li>
              <li className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="text-[9px] h-4 px-1">各自獨立</Badge>
                名稱、SKU、圖片、變體、品牌
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
