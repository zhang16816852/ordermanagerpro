import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutGrid } from "lucide-react";
import { ProductWithPricing, VariantWithPricing } from "@/types/product";
import { OrderGridRenderer } from "@/components/order-grid/OrderGridRenderer";
import type { OrderGridTemplateWithProducts } from "@/types/order-grid";
import type { GridQuantities } from "@/types/order-grid";
import { toast } from "sonner";

interface ProductCatalogTableProps {
  matchingTemplates: OrderGridTemplateWithProducts[];
  filteredProducts: ProductWithPricing[];
  storeId: string;
  addItem: (product: ProductWithPricing, variant?: VariantWithPricing, selectedModelName?: string, customItemId?: string) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  getItemQuantity: (productId: string, variantId?: string) => number;
}

export function ProductCatalogTable({
  matchingTemplates,
  filteredProducts,
  storeId,
  addItem,
  removeItem,
  updateQuantity,
  getItemQuantity,
}: ProductCatalogTableProps) {
  const handleAddToCart = (
    items: { variant: VariantWithPricing; product: ProductWithPricing; quantity: number }[]
  ) => {
    let addedCount = 0;
    items.forEach(({ variant, product, quantity }) => {
      for (let i = 0; i < quantity; i++) {
        addItem(product, variant);
        addedCount++;
      }
    });
    toast.success(`已加入 ${addedCount} 項商品至購物車`);
  };

  const handleDirectItemAdd = (
    variant: VariantWithPricing,
    product: ProductWithPricing,
    delta: number
  ) => {
    if (delta > 0) {
      addItem(product, variant);
    } else {
      const itemId = `${product.id}-${variant?.id || "base"}`;
      const currentQty = getItemQuantity(product.id, variant?.id);
      if (currentQty <= 1) {
        removeItem(itemId);
      } else {
        updateQuantity(itemId, currentQty - 1);
      }
    }
  };

  if (matchingTemplates.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        目前篩選結果沒有對應的 table 範本
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {matchingTemplates.map((template) => {
        const templateVariantIds = new Set(
          template.template_variants?.map((tv) => tv.variant_id) || []
        );
        const templateFilteredProducts = filteredProducts
          .filter((p) =>
            (p.variants || []).some((v: any) => templateVariantIds.has(v.id))
          )
          .map((p) => ({
            ...p,
            variants: (p.variants || []).filter((v: any) =>
              templateVariantIds.has(v.id)
            ),
          }));

        if (templateFilteredProducts.length === 0) return null;

        return (
          <Card key={template.id} className="overflow-hidden">
            <CardHeader className="px-4 py-3 border-b bg-muted/20">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base font-medium">
                  {template.name}
                </CardTitle>
              </div>
              {template.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {template.description}
                </p>
              )}
            </CardHeader>
            <CardContent className="p-4">
              <OrderGridRenderer
                template={template}
                products={templateFilteredProducts}
                onAddToCart={handleAddToCart}
                onDirectItemAdd={handleDirectItemAdd}
                initialQuantities={{} as GridQuantities}
                getCartQuantity={(productId, variantId) => getItemQuantity(productId, variantId)}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
