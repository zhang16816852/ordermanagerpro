// src/components/order/ProductCatalog.tsx
import { useState } from "react";
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
} from "@/components/ui/dialog";
import { ProductWithPricing, VariantWithPricing } from "@/hooks/useProductCache";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import { StatusBadge } from "../ProductStatusBadge";
import { toast } from 'sonner';
import { ProductDetailDialog } from "./ProductDetailDialog";
import { Info, LayoutGrid, List } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from "react";
interface ProductCatalogProps {
  products: ProductWithPricing[];
  isLoading: boolean;
  storeId: string;
  viewMode?: 'products' | 'variants' | 'gallery';
  categoryFilter?: string | null;
  specFilters?: Record<string, string[]>;
  brandFilter?: string[];
}

export default function ProductCatalog({
  products,
  isLoading,
  storeId,
  viewMode = 'products',
  categoryFilter = null,
  specFilters = {},
  brandFilter = [],
}: ProductCatalogProps) {
  const [search, setSearch] = useState("");
  const [variantDialogProduct, setVariantDialogProduct] = useState<ProductWithPricing | null>(null);
  const [detailProduct, setDetailProduct] = useState<ProductWithPricing | null>(null);

  const { addItem, getItemQuantity, getTotalProductQuantity } = useStoreDraft(storeId);

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
        const pCategoryId = (product as any).category_id;

        // 優先檢查多分類關聯
        const hasMatchInLinks = pCategoryIds.some((id: string) => subCategoryIds.has(id));

        // 次之檢查舊有的單分類欄位 (相容性)
        const hasMatchInLegacy = pCategoryId && subCategoryIds.has(pCategoryId);

        if (!hasMatchInLinks && !hasMatchInLegacy) return false;
      }

      // 2. Spec Filters (AND between keys, OR between values in same key)
      const specKeys = Object.keys(specFilters);
      if (specKeys.length > 0) {
        const matchesSpec = (settings: any) => {
          if (!settings || typeof settings !== 'object') return false;
          return specKeys.every((key) => {
            const allowedValues = specFilters[key];
            if (!allowedValues || allowedValues.length === 0) return true;
            const actualValue = String(settings[key]);
            return allowedValues.includes(actualValue);
          });
        };

        const productMatches = matchesSpec(product.table_settings);
        const anyVariantMatches = product.variants?.some((v) => matchesSpec(v.table_settings));

        if (!productMatches && !anyVariantMatches) return false;
      }

      // 3. Brand Filter
      if (brandFilter.length > 0) {
        const pBrandId = (product as any).brand_id;
        const legacyBrand = (product as any).brand;
        // 如果這個產品有 brand_id，就看他有在這清單裡嗎
        // 為了相容防呆，如果沒有 brand_id，也可以先不用擋 (因為品牌是選填)，但既然使用者會「篩選品牌」，表示產品必須有中
        // 我們也檢查 legacy brand string (不過因為品牌將獨立，這裡主要還是看 brand_id)
        if (!pBrandId || !brandFilter.includes(pBrandId)) {
          // Fallback legacy (如果前端有傳名字也可以)
          // 這裡目前 brandFilter 是 UUID list
          return false;
        }
      }

      return true;
    })
    .map((product) => {
      if (keywords.length === 0) return product;

      const productTexts = [product.name, product.sku]
        .filter(Boolean)
        .map((v) => v!.toLowerCase());

      const productMatched = keywords.every((keyword) =>
        productTexts.every((text) => text.includes(keyword))
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

      const productTexts = [product.name, product.sku]
        .filter(Boolean)
        .map((v) => v!.toLowerCase());

      const productMatched = keywords.every((keyword) =>
        productTexts.every((text) => text.includes(keyword))
      );

      if (productMatched) return true;

      return (product.variants?.length ?? 0) > 0;
    });


  const handleProductClick = (product: ProductWithPricing) => {
    if (product.has_variants && product.variants && product.variants.length > 1) {
      // 多變體 → 打開選擇對話框
      setVariantDialogProduct(product);
    } else if (product.has_variants && product.variants && product.variants.length === 1) {
      // 單變體 → 直接加入，傳入變體
      const variant = product.variants[0];
      addItem(product, variant as VariantWithPricing);
      toast.success(`${product.name} (${variant.name}) 已加入購物車`);
    } else {
      // 無變體 → 直接加入
      addItem(product);
      toast.success(`${product.name} 已加入購物車`);
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
              onChange={(e) => setSearch(e.target.value)}
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
                          <div className="font-medium">${product.wholesale_price}</div>
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
                              setDetailProduct(product);
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
            // 圖卡檢視模式
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
                          setDetailProduct(product);
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
                          ${product.wholesale_price}
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
            // 單品檢視模式 (直接顯示所有變體)
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredProducts.flatMap(product => {
                if (product.has_variants && product.variants && product.variants.length > 0) {
                  return product.variants.map(variant => ({ product, variant }));
                }
                return [{ product, variant: null }];
              }).map(({ product, variant }) => {
                // 如果是變體，使用變體 ID 作為 Key，否則使用產品 ID
                const key = variant ? `${product.id}-${variant.id}` : product.id;

                // 計算購物車數量
                const qty = variant
                  ? getItemQuantity(product.id, variant.id)
                  : getItemQuantity(product.id);

                // 計算價格
                const price = variant
                  ? ((variant as VariantWithPricing).effective_wholesale_price ?? variant.wholesale_price)
                  : product.wholesale_price;

                const displayName = variant
                  ? variant.name
                  : product.name;

                const displaySku = variant ? variant.sku : product.sku;

                return (
                  <div
                    key={key}
                    className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
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
                              {variant.option_1 && <Badge variant="secondary" className="text-[10px] h-5 px-1">{variant.option_2}</Badge>}
                              {variant.option_2 && <Badge variant="secondary" className="text-[10px] h-5 px-1">{variant.option_3}</Badge>}
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
      </Card >

      {/* 變體選擇對話框 */}
      < Dialog open={!!variantDialogProduct
      } onOpenChange={() => setVariantDialogProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>選擇規格</DialogTitle>
          </DialogHeader>
          {variantDialogProduct && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">{variantDialogProduct.name}</div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {variantDialogProduct.variants?.map((variant) => {
                  const qty = getItemQuantity(variantDialogProduct.id, variant.id);
                  // 使用品牌價格（effective_wholesale_price），若無則使用變體的基礎批發價
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
                          <div className="flex gap-1 mt-1">
                            {variant.option_1 && <Badge variant="secondary" className="text-xs">{variant.option_2}</Badge>}
                            {variant.option_2 && <Badge variant="secondary" className="text-xs">{variant.option_3}</Badge>}
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
      </Dialog >
      <ProductDetailDialog
        product={detailProduct}
        open={!!detailProduct}
        onOpenChange={(open) => !open && setDetailProduct(null)}
        storeId={storeId}
      />
    </>
  );
}
