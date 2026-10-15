import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { calculatePriceRange } from '@/utils/priceUtils';
import type { ProductWithDetails } from '@/types/product';
import {
  getProductVariants,
  type VariantLike,
  type DisplayedVariantsOf,
} from './brandPricingUtils';
import type { PriceEntry } from './brandPricingTypes';

interface BrandPricingProductListProps {
  isLoading: boolean;
  filteredProducts: ProductWithDetails[];
  allVariants: VariantLike[];
  priceEntries: Record<string, PriceEntry>;
  selectedProducts: Set<string>;
  expandedProducts: Set<string>;
  totalSelectableCount: number;
  displayedVariantsOf: DisplayedVariantsOf;
  onToggleProduct: (key: string) => void;
  onToggleExpanded: (productId: string) => void;
  onToggleAll: () => void;
  onPriceChange: (
    key: string,
    productId: string,
    variantId: string | undefined,
    value: string,
  ) => void;
}

export const BrandPricingProductList = ({
  isLoading,
  filteredProducts,
  allVariants,
  priceEntries,
  selectedProducts,
  expandedProducts,
  totalSelectableCount,
  displayedVariantsOf,
  onToggleProduct,
  onToggleExpanded,
  onToggleAll,
  onPriceChange,
}: BrandPricingProductListProps) => {
  const variantsOf = (productId: string) => getProductVariants(allVariants, productId);

  return (
    <div className="rounded-lg border bg-card shadow-soft">
      {/* Desktop: Table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedProducts.size === totalSelectableCount && totalSelectableCount > 0}
                  onCheckedChange={onToggleAll}
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
                const variants = variantsOf(product.id);
                const displayedVariants = displayedVariantsOf(variants);
                const hasVariants = variants.length > 0;
                const isUnified = !!product.unified_pricing;
                const isExpanded = expandedProducts.has(product.id);
                const productEntry = priceEntries[product.id];
                const hasCustomPrice = !!productEntry?.wholesalePrice;

                return (
                  <Collapsible
                    key={product.id}
                    open={isExpanded}
                    onOpenChange={() => onToggleExpanded(product.id)}
                    asChild
                  >
                    <>
                      <TableRow className={hasVariants ? 'cursor-pointer hover:bg-muted/50' : ''}>
                        <TableCell>
                          {(!hasVariants || isUnified) && (
                            <Checkbox
                              checked={selectedProducts.has(product.id)}
                              onCheckedChange={() => onToggleProduct(product.id)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {hasVariants && (
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                aria-label={isExpanded ? '收合變體' : '展開變體'}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{product.code}</TableCell>
                        <TableCell className="font-medium">
                          {product.name}
                          {isUnified && (
                            <Badge className="ml-2 text-xs bg-emerald-100 text-emerald-700 border-emerald-300">統一價格</Badge>
                          )}
                          {hasVariants && !isUnified && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              <Layers className="h-3 w-3 mr-1" />
                              {displayedVariants.length} 變體
                            </Badge>
                          )}
                          {!hasVariants && hasCustomPrice && (
                            <Badge variant="outline" className="ml-2 text-xs">已設定</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {calculatePriceRange(undefined, variants.map((v) => v.wholesale_price)).display}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {calculatePriceRange(undefined, variants.map((v) => v.retail_price)).display}
                        </TableCell>
                        <TableCell className="text-right">
                          {(!hasVariants || isUnified) ? (
                            <Input
                              type="number"
                              placeholder="輸入批發價"
                              value={productEntry?.wholesalePrice || ''}
                              onChange={(e) => onPriceChange(product.id, product.id, undefined, e.target.value)}
                              className="w-24 text-right ml-auto"
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">展開設定</span>
                          )}
                        </TableCell>
                      </TableRow>

                      {hasVariants && !isUnified && (
                        <CollapsibleContent asChild>
                          <>
                            {displayedVariants.map((variant) => {
                              const variantKey = `${product.id}:${variant.id}`;
                              const variantEntry = priceEntries[variantKey];
                              const hasVariantCustomPrice = !!variantEntry?.wholesalePrice;

                              return (
                                <TableRow key={variant.id} className="bg-muted/30">
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedProducts.has(variantKey)}
                                      onCheckedChange={() => onToggleProduct(variantKey)}
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
                                      onChange={(e) => onPriceChange(variantKey, product.id, variant.id, e.target.value)}
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

      {/* Mobile: Cards */}
      <div className="md:hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">沒有找到產品</div>
        ) : (
          <div className="divide-y">
            {filteredProducts.map((product) => {
              const variants = variantsOf(product.id);
              const displayedVariants = displayedVariantsOf(variants);
              const hasVariants = variants.length > 0;
              const isUnified = !!product.unified_pricing;
              const productEntry = priceEntries[product.id];
              const hasCustomPrice = !!productEntry?.wholesalePrice;

              return (
                <div key={product.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{product.code}</p>
                    </div>
                    {isUnified && (
                      <Badge className="text-xs bg-emerald-100 text-emerald-700 border-emerald-300 flex-shrink-0">統一價格</Badge>
                    )}
                    {hasVariants && !isUnified && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        <Layers className="h-3 w-3 mr-1" />
                        {displayedVariants.length} 變體
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">批發價</p>
                      <p>{calculatePriceRange(undefined, variants.map((v) => v.wholesale_price)).display}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">零售價</p>
                      <p>{calculatePriceRange(undefined, variants.map((v) => v.retail_price)).display}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(!hasVariants || isUnified) && (
                      <Input
                        type="number"
                        placeholder="連鎖批發價"
                        value={productEntry?.wholesalePrice || ''}
                        onChange={(e) => onPriceChange(product.id, product.id, undefined, e.target.value)}
                        className="flex-1 text-right text-sm h-8"
                      />
                    )}
                    {(!hasVariants || isUnified) && hasCustomPrice && (
                      <Badge variant="outline" className="text-xs">已設定</Badge>
                    )}
                    {hasVariants && !isUnified && (
                      <span className="text-xs text-muted-foreground">展開變體設定價格</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
