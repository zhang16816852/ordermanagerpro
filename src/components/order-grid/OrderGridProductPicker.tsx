import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductWithPricing } from '@/types/product';
import { VariantSummaryPanel } from './VariantSummaryPanel';

interface OrderGridProductPickerProps {
  selectedVariantIds: string[];
  onChange: (ids: string[]) => void;
  products: ProductWithPricing[];
}

export function OrderGridProductPicker({
  selectedVariantIds,
  onChange,
  products,
}: OrderGridProductPickerProps) {
  const [search, setSearch] = useState('');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const selectedSet = useMemo(() => new Set(selectedVariantIds), [selectedVariantIds]);

  const productVariantMap = useMemo(() => {
    const map: Record<string, ProductWithPricing['variants']> = {};
    products.forEach(p => {
      const activeVariants = (p.variants || []).filter((v: any) => v.status !== 'inactive');
      if (activeVariants.length > 0) {
        map[p.id] = activeVariants;
      }
    });
    return map;
  }, [products]);

  const productRows = useMemo(() => {
    return products.filter(p => {
      if (!productVariantMap[p.id]) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, search, productVariantMap]);

  const getProductVariantIds = (productId: string): string[] => {
    return (productVariantMap[productId] || []).map((v: any) => v.id);
  };

  const isProductFullySelected = (productId: string): boolean => {
    const ids = getProductVariantIds(productId);
    return ids.length > 0 && ids.every(id => selectedSet.has(id));
  };

  const isProductPartiallySelected = (productId: string): boolean => {
    const ids = getProductVariantIds(productId);
    return ids.some(id => selectedSet.has(id)) && !isProductFullySelected(productId);
  };

  const toggleProduct = (productId: string) => {
    const ids = getProductVariantIds(productId);
    const allSelected = isProductFullySelected(productId);
    const current = new Set(selectedSet);
    ids.forEach(id => {
      if (allSelected) {
        current.delete(id);
      } else {
        current.add(id);
      }
    });
    onChange(Array.from(current));
  };

  const toggleVariant = (variantId: string) => {
    const current = new Set(selectedSet);
    if (current.has(variantId)) {
      current.delete(variantId);
    } else {
      current.add(variantId);
    }
    onChange(Array.from(current));
  };

  const toggleExpand = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const totalSelectedVariants = selectedVariantIds.length;

  const selectedVariantsList = useMemo(() => {
    const list: { productName: string; variantName: string; variantId: string }[] = [];
    products.forEach(p => {
      (p.variants || []).forEach((v: any) => {
        if (selectedSet.has(v.id)) {
          list.push({ productName: p.name, variantName: v.name || v.sku, variantId: v.id });
        }
      });
    });
    return list;
  }, [products, selectedSet]);

  const removeVariant = (variantId: string) => {
    const current = new Set(selectedSet);
    current.delete(variantId);
    onChange(Array.from(current));
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋產品名稱或 SKU..."
          className="pl-8 h-9"
        />
      </div>

      {selectedVariantsList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            已選 {totalSelectedVariants} 個變體
          </div>
          <div className="flex flex-wrap gap-1 max-h-[72px] overflow-y-auto">
            {selectedVariantsList.slice(0, 20).map((item) => (
              <Badge
                key={item.variantId}
                variant="secondary"
                className="gap-1 pr-1.5 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors text-[10px]"
                onClick={() => removeVariant(item.variantId)}
              >
                {item.productName}: {item.variantName}
                <X className="h-2.5 w-2.5" />
              </Badge>
            ))}
            {selectedVariantsList.length > 20 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{selectedVariantsList.length - 20} 更多
              </span>
            )}
          </div>
        </div>
      )}

      <ScrollArea className="h-[220px] border rounded-md">
        {productRows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {search ? '找不到符合的產品' : '尚無產品'}
          </div>
        ) : (
          <div className="p-1 space-y-0.5">
            {productRows.map((product) => {
              const variants = productVariantMap[product.id] || [];
              const fullySelected = isProductFullySelected(product.id);
              const partiallySelected = isProductPartiallySelected(product.id);
              const isExpanded = expandedProducts.has(product.id);

              return (
                <div key={product.id}>
                  <div
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/50 transition-colors',
                      (fullySelected || partiallySelected) && 'bg-muted/80'
                    )}
                  >
                    <div
                      className="flex items-center justify-center w-4 h-4 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); toggleExpand(product.id); }}
                    >
                      {variants.length > 0 ? (
                        isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <span className="w-3.5" />
                      )}
                    </div>
                    <Checkbox
                      checked={fullySelected}
                      data-state={partiallySelected ? 'indeterminate' : undefined}
                      onCheckedChange={() => toggleProduct(product.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0" onClick={() => toggleExpand(product.id)}>
                      <div className="text-sm truncate">{product.name}</div>
                      <div className="text-xs text-muted-foreground">{product.sku}</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0">
                      {variants.length} 變體
                    </div>
                  </div>

                  {isExpanded && variants.length > 0 && (
                    <div className="ml-8 pl-1 border-l border-muted space-y-0.5 pb-1">
                      {variants.map((v: any) => {
                        const isSelected = selectedSet.has(v.id);
                        const label = [v.name, v.option_1, v.option_2, v.option_3].filter(Boolean).join(' / ') || v.sku;
                        return (
                          <div
                            key={v.id}
                            className={cn(
                              'flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/30 transition-colors',
                              isSelected && 'bg-muted/50'
                            )}
                            onClick={() => toggleVariant(v.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleVariant(v.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-3.5 w-3.5"
                            />
                            <div className="text-xs truncate flex-1">{label}</div>
                            <div className="text-[10px] text-muted-foreground">{v.sku}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <VariantSummaryPanel
        products={products}
        selectedVariantIds={selectedVariantIds}
      />
    </div>
  );
}
