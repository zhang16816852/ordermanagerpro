import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Link2, Unlink, Search, Package } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { entityBindingService, EntityBinding, BoundVariantInfo } from '@/services/entityBindingService';

interface VariantBindingManagerProps {
  variantId: string;
}

export function VariantBindingManager({ variantId }: VariantBindingManagerProps) {
  const [bindings, setBindings] = useState<EntityBinding[]>([]);
  const [boundVariants, setBoundVariants] = useState<BoundVariantInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BoundVariantInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const loadBindings = async () => {
    setIsLoading(true);
    try {
      const data = await entityBindingService.fetchBindings('variant', variantId);
      setBindings(data);
      const ids = entityBindingService.getBoundVariantIds(data, variantId);
      if (ids.length > 0) {
        const variants = await entityBindingService.fetchBoundVariants(ids);
        setBoundVariants(variants);
      } else {
        setBoundVariants([]);
      }
    } catch (err: any) {
      console.error('Failed to load variant bindings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBindings();
  }, [variantId]);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await entityBindingService.searchVariants(searchQuery);
        setSearchResults(results.filter(r => r.id !== variantId));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, variantId]);

  const handleAdd = async (targetId: string) => {
    try {
      await entityBindingService.addBinding('variant', variantId, targetId);
      toast.success('變體綁定成功');
      setSearchQuery('');
      setSearchResults([]);
      await loadBindings();
    } catch (err: any) {
      toast.error(`綁定失敗: ${getErrorMessage(err)}`);
    }
  };

  const handleRemove = async (bindingId: string) => {
    try {
      await entityBindingService.removeBinding(bindingId);
      toast.success('已解除變體綁定');
      await loadBindings();
    } catch (err: any) {
      toast.error(`解除綁定失敗: ${getErrorMessage(err)}`);
    }
  };

  const isAlreadyBound = (vid: string) => {
    return bindings.some(b => b.variant_id === vid || b.bound_variant_id === vid);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 cursor-pointer select-none">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">變體綁定</span>
        {boundVariants.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{boundVariants.length}</Badge>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {boundVariants.length > 0 && (
            <Card>
              <CardContent className="p-3 space-y-2">
                {boundVariants.map((bv) => {
                  const binding = bindings.find(b =>
                    (b.variant_id === bv.id || b.bound_variant_id === bv.id)
                  );
                  return (
                    <div key={bv.id} className="flex items-center justify-between p-2 rounded-md border">
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{bv.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {bv.product_name} · {bv.sku}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive shrink-0 h-7 px-2"
                        onClick={() => binding && handleRemove(binding.id)}
                      >
                        <Unlink className="h-3.5 w-3.5 mr-1" />
                        解除
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {boundVariants.length === 0 && !isLoading && (
            <div className="text-center py-6 text-muted-foreground border rounded-lg">
              <Link2 className="h-6 w-6 mx-auto mb-1 opacity-40" />
              <p className="text-xs">尚未綁定任何變體</p>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜尋變體名稱或 SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          {isSearching && (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              搜尋中...
            </div>
          )}

          {searchResults.length > 0 && (
            <Card>
              <CardContent className="p-2 space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.product_name} · {r.sku}</div>
                    </div>
                    {isAlreadyBound(r.id) ? (
                      <Badge variant="secondary" className="text-[10px] shrink-0">已綁定</Badge>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => handleAdd(r.id)}>
                        <Link2 className="h-3 w-3 mr-1" />
                        綁定
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <p className="text-[10px] text-muted-foreground">
            * 綁定後規格值會自動同步。名稱、SKU、價格、型號各自獨立。
          </p>
        </>
      )}
    </div>
  );
}
