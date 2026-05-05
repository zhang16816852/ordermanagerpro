// src/components/order/ProductCatalog.tsx
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProductWithPricing, VariantWithPricing } from "@/types/product";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import { getSpecValue, formatSpecValue, deserializeSpecs } from "@/utils/specLogic";
import { StatusBadge } from "../ProductStatusBadge";
import { toast } from 'sonner';
import { ProductDetailDialog } from "./ProductDetailDialog";
import { Info, LayoutGrid, List } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from "react";
import { calculatePriceRange } from "@/utils/priceUtils";
import { useProductColors } from "@/hooks/useProductColors";
import { getContrastColor } from "@/utils/colorUtils";

interface ProductCatalogProps {
  products: ProductWithPricing[];
  isLoading: boolean;
  storeId: string;
  viewMode?: 'products' | 'variants' | 'gallery';
  search: string;
  onSearchChange: (val: string) => void;
  categoryFilter?: string | null;
  specFilters?: Record<string, string[]>;
  brandFilter?: string[];
}

export default function ProductCatalog({
  products,
  isLoading,
  storeId,
  viewMode = 'products',
  search,
  onSearchChange,
  categoryFilter = null,
  specFilters = {},
  brandFilter = [],
}: ProductCatalogProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { colors } = useProductColors();
  const [variantDialogProduct, setVariantDialogProduct] = useState<ProductWithPricing | null>(null);
  const [detailProduct, setDetailProduct] = useState<ProductWithPricing | null>(null);

  const { addItem, getItemQuantity, getTotalProductQuantity } = useStoreDraft(storeId);

  // Sync detailProduct with URL ?p=...
  useEffect(() => {
    const pName = searchParams.get("p");
    if (pName && products.length > 0) {
      const found = products.find(p => p.name === pName || p.sku === pName);
      if (found) {
        setDetailProduct(found);
      }
    } else {
      setDetailProduct(null);
    }
  }, [searchParams, products]);

  const handleOpenDetail = (p: ProductWithPricing | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (p) next.set("p", p.name);
      else next.delete("p");
      return next;
    }, { replace: true });
  };

  const { data: categoryHierarchy = [] } = useQuery({
    queryKey: ['category_hierarchy'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
      if (error) return [];
      return data;
    },
  });

  // Calculate all child category IDs (inclusive) for filtering
  const subCategoryIds = useMemo(() => {
    if (!categoryFilter) return new Set<string>();

    const ids = new Set<string>([categoryFilter]);
    const queue = [categoryFilter];

    while (queue.length > 0) {
      const parentId = queue.shift();
      categoryHierarchy
        .filter((h: any) => h.parent_id === parentId)
        .forEach((h: any) => {
          if (!ids.has(h.child_id)) {
            ids.add(h.child_id);
            queue.push(h.child_id);
          }
        });
    }
    return ids;
  }, [categoryFilter, categoryHierarchy]);


  const keywords = search
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const filteredProducts = products
    .filter((product) => {
      // 1. Category Filter (Recursive)
      if (categoryFilter) {
        const pCategoryIds = (product as any).category_ids || [];
        // 僅檢查多分類關聯
        if (!pCategoryIds.some((id: string) => subCategoryIds.has(id))) {
          return false;
        }
      }

      // 2. Spec Filters (AND between keys, OR between values in same key)
      const specKeys = Object.keys(specFilters);
      if (specKeys.length > 0) {
        const matchesSpec = (target: any) => {
          if (!target) return false;
          
          // 如果 target 是變體，它會有 option_1, option_2, option_3
          // 如果 target 是產品，則主要看 table_settings
          const isVariant = 'product_id' in target;
          const flatSettings = deserializeSpecs(target.table_settings);

          return specKeys.every((key) => {
            const allowedValues = specFilters[key];
            if (!allowedValues || allowedValues.length === 0) return true;

            let actualValue = "";
            
            // 處理核心選項 (Core Options)
            if (key.startsWith('core:')) {
              if (!isVariant) return false; // 產品層級通常不帶核心選項
              const optionKey = key.replace('core:', '');
              actualValue = target[optionKey] || "";
            } else {
              // 處理一般規格
              const val = flatSettings[key];
              actualValue = formatSpecValue(val);
            }
            
            if (!actualValue) return false;

            // 檢查是否為區間篩選 (格式為 "MIN-MAX")
            const isRangeFilter = allowedValues.length === 1 && allowedValues[0].includes('-');
            
            if (isRangeFilter) {
                const [min, max] = allowedValues[0].split('-').map(Number);
                const productNumbers = actualValue.match(/\d+(\.\d+)?/g)?.map(Number) || [];
                if (productNumbers.length === 0) return false;
                return productNumbers.some(n => n >= min && n <= max);
            }

            return allowedValues.includes(actualValue);
          });
        };

        const productMatches = matchesSpec(product);
        const anyVariantMatches = product.variants?.some((v) => matchesSpec(v));

        if (!productMatches && !anyVariantMatches) return false;
      }

      // 3. Brand Filter
      if (brandFilter.length > 0) {
        const pBrandId = (product as any).brand_id;
        if (!pBrandId || !brandFilter.includes(pBrandId)) {
          return false;
        }
      }

      return true;
    })
    .map((product) => {
      if (keywords.length === 0) return product;

      const productTexts = [product.name, product.sku, ...(product.category_names || [])]
        .filter(Boolean)
        .map((v) => v!.toLowerCase());

      const productMatched = keywords.every((keyword) =>
        productTexts.some((text) => text.includes(keyword))
      );

      const matchedVariants =
        product.variants?.filter((variant) => {
          const variantTexts = [
            variant.name,
            variant.sku,
            variant.barcode,
            variant.option_1,
            variant.option_2,
            variant.option_3,
          ]
            .filter(Boolean)
            .map((v) => v!.toLowerCase());

          return keywords.every((keyword) =>
            variantTexts.some((text) => text.includes(keyword))
          );
        }) ?? [];

      return {
        ...product,
        variants: productMatched ? product.variants : matchedVariants,
      };
    })
    .filter((product) => {
      if (keywords.length === 0) return true;

      const productTexts = [product.name, product.sku, ...(product.category_names || [])]
        .filter(Boolean)
        .map((v) => v!.toLowerCase());

      const productMatched = keywords.every((keyword) =>
        productTexts.some((text) => text.includes(keyword))
      );

      if (productMatched) return true;

      return (product.variants?.length ?? 0) > 0;
    });

  const handleProductClick = (product: ProductWithPricing) => {
    if (product.has_variants && product.variants && product.variants.length > 1) {
      setVariantDialogProduct(product);
    } else {
      handleOpenDetail(product);
    }
  };

  const handleVariantSelect = (product: ProductWithPricing, variant: VariantWithPricing) => {
    addItem(product, variant);
    toast.success(`${variant ? `(${variant.name})` : ''} 已加入購物車`);
    setVariantDialogProduct(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>產品目錄</CardTitle>
            <div className="flex items-center gap-2">
              {viewMode === 'variants' && (
                <Badge variant="outline" className="text-xs">
                  顯示所有規格單品
                </Badge>
              )}
              {viewMode === 'gallery' && (
                <Badge variant="outline" className="text-xs">
                  圖卡檢視
                </Badge>
              )}
            </div>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={viewMode === 'products' ? "搜尋產品名稱或 SKU..." : "搜尋單品名稱、SKU 或規格..."}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">沒有找到符合的產品</div>
          ) : viewMode === 'products' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredProducts.map((product) => {
                const totalInCart = getTotalProductQuantity(product.id);
                const hasVariants = product.has_variants && product.variants && product.variants.length > 0;

                return (
                  <div
                    key={product.id}
                    className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors group relative"
                    onClick={() => handleProductClick(product)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {product.name}
                          {hasVariants && (
                            <Badge variant="outline" className="text-xs">
                              {product.variants!.length} 變體
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono">
                          {product.sku}
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div className="flex flex-col items-end">
                          <div className="font-medium">
                            {calculatePriceRange(product.wholesale_price, product.variants?.map(v => v.effective_wholesale_price) || []).display}
                          </div>
                          {totalInCart > 0 && (
                            <div className="text-sm text-primary">已加入 x{totalInCart}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDetail(product);
                            }}
                          >
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          {hasVariants && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : viewMode === 'gallery' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredProducts.map((product) => {
                const totalInCart = getTotalProductQuantity(product.id);
                const hasVariants = product.has_variants && product.variants && product.variants.length > 0;

                return (
                  <div
                    key={product.id}
                    className="flex flex-col border rounded-xl overflow-hidden hover:border-primary cursor-pointer transition-all hover:shadow-md group"
                    onClick={() => handleProductClick(product)}
                  >
                    <div className="aspect-square bg-muted relative flex items-center justify-center border-b">
                      <div className="text-muted-foreground/40 font-bold uppercase tracking-widest text-[10px]">No Image</div>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetail(product);
                        }}
                      >
                        <Info className="h-3 w-3" />
                      </Button>
                      {totalInCart > 0 && (
                        <Badge className="absolute top-2 left-2 px-1.5 h-5 min-w-[20px] justify-center">
                          {totalInCart}
                        </Badge>
                      )}
                    </div>
                    <div className="p-3 flex flex-col flex-1">
                      <div className="font-medium text-sm line-clamp-2 min-h-[40px]">
                        {product.name}
                      </div>
                      <div className="mt-auto pt-2 flex items-center justify-between">
                        <div className="text-primary font-bold">
                          {calculatePriceRange(product.wholesale_price, product.variants?.map(v => v.effective_wholesale_price) || []).display}
                        </div>
                        {hasVariants && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1">
                            {product.variants!.length} 規格
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredProducts.flatMap(product => {
                if (product.has_variants && product.variants && product.variants.length > 0) {
                  return product.variants.map(variant => ({ product, variant }));
                }
                return [{ product, variant: null }];
              }).map(({ product, variant }) => {
                const key = variant ? `${product.id}-${variant.id}` : product.id;
                const qty = variant ? getItemQuantity(product.id, variant.id) : getItemQuantity(product.id);
                const price = variant ? ((variant as VariantWithPricing).effective_wholesale_price ?? variant.wholesale_price) : product.wholesale_price;
                const displayName = variant ? variant.name : product.name;

                return (
                  <div
                    key={key}
                    className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors group relative"
                    onClick={() => {
                      if (variant) {
                        handleVariantSelect(product, variant as VariantWithPricing);
                      } else {
                        addItem(product);
                        toast.success(`${product.name} 已加入購物車`);
                      }
                    }}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate pr-2">
                          {displayName}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {variant && (
                            <>
                              {variant.option_1 && <Badge variant="secondary" className="text-[10px] h-5 px-1">{variant.option_1}</Badge>}
                              {variant.option_2 && <Badge variant="secondary" className="text-[10px] h-5 px-1">{variant.option_2}</Badge>}
                              {variant.option_3 && (() => {
                                const colorData = colors.find(c => c.name === variant.option_3);
                                return (
                                  <Badge 
                                    variant="secondary" 
                                    className="text-[10px] h-5 px-1 border-none shadow-sm"
                                    style={colorData?.hex_code ? {
                                      backgroundColor: colorData.hex_code,
                                      color: getContrastColor(colorData.hex_code)
                                    } : {}}
                                  >
                                    {variant.option_3}
                                  </Badge>
                                );
                              })()}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-medium">${Number(price)}</div>
                        {qty > 0 && (
                          <div className="text-sm text-primary font-medium">已選 x{qty}</div>
                        )}
                      </div>
                      <StatusBadge status={variant?.status ?? product.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!variantDialogProduct} onOpenChange={() => setVariantDialogProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>選擇規格</DialogTitle>
            <DialogDescription>
              此產品包含多種規格選項，請點擊下方清單以選擇欲加入購物車的特定型號。
            </DialogDescription>
          </DialogHeader>
          {variantDialogProduct && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">{variantDialogProduct.name}</div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {variantDialogProduct.variants?.map((variant) => {
                  const qty = getItemQuantity(variantDialogProduct.id, variant.id);
                  const variantWithPricing = variant as VariantWithPricing;
                  const price = variantWithPricing.effective_wholesale_price ?? variant.wholesale_price;

                  return (
                    <div
                      key={variant.id}
                      className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
                      onClick={() => handleVariantSelect(variantDialogProduct, variant as VariantWithPricing)}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-medium">{variant.name}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {variant.option_1 && <Badge variant="secondary" className="text-xs">{variant.option_1}</Badge>}
                            {variant.option_2 && <Badge variant="secondary" className="text-xs">{variant.option_2}</Badge>}
                            {variant.option_3 && (() => {
                              const colorData = colors.find(c => c.name === variant.option_3);
                              return (
                                <Badge 
                                  variant="secondary" 
                                  className="text-xs border-none shadow-sm"
                                  style={colorData?.hex_code ? {
                                    backgroundColor: colorData.hex_code,
                                    color: getContrastColor(colorData.hex_code)
                                  } : {}}
                                >
                                  {variant.option_3}
                                </Badge>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">${Number(price)}</div>
                          {qty > 0 && <div className="text-sm text-primary">已加入 x{qty}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ProductDetailDialog
        product={detailProduct}
        open={!!detailProduct}
        onOpenChange={(open) => !open && handleOpenDetail(null)}
        storeId={storeId}
      />
    </>
  );
}
