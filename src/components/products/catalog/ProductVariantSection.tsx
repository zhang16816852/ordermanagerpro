import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Minus, LayoutGrid } from "lucide-react";
import { useStoreDraft } from "@/store/useOrderDraftStore";
import { VariantOptionsPicker } from "@/components/products/catalog/VariantOptionsPicker";
import { OrderGridRenderer } from "@/components/order-grid/OrderGridRenderer";
import type { ProductWithPricing, VariantWithPricing } from "@/types/product";
import type { OrderGridTemplateWithProducts, GridQuantities } from "@/types/order-grid";

interface ProductVariantSectionProps {
    product: ProductWithPricing;
    storeId: string;
    onVariantSelect: (variant: any | null) => void;
    onSelectionChange?: (options: Record<string, string | null>) => void;
    templates?: OrderGridTemplateWithProducts[];
}

export function ProductVariantSection({
    product,
    storeId,
    onVariantSelect,
    onSelectionChange,
    templates,
}: ProductVariantSectionProps) {
    const { addItem, getItemQuantity, removeItem, updateQuantity } = useStoreDraft(storeId);
    const [viewMode, setViewMode] = useState<'option' | 'table'>('option');

    const matchingTemplate = useMemo(() => {
        if (!templates || templates.length === 0) return null;
        const productVariantIds = new Set((product.variants || []).map((v: any) => v.id));
        return templates.find((t) =>
            (t.template_variants || []).some((tv) => productVariantIds.has(tv.variant_id))
        ) || null;
    }, [templates, product.variants]);

    const templateFilteredProducts = useMemo(() => {
        if (!matchingTemplate) return [];
        const tVariantIds = new Set(
            matchingTemplate.template_variants?.map((tv) => tv.variant_id) || []
        );
        return [{
            ...product,
            variants: (product.variants || []).filter((v: any) => tVariantIds.has(v.id)),
        }];
    }, [matchingTemplate, product]);

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

    const handleAddToCart = (
        items: { variant: VariantWithPricing; product: ProductWithPricing; quantity: number }[]
    ) => {
        items.forEach(({ variant, product, quantity }) => {
            for (let i = 0; i < quantity; i++) {
                addItem(product, variant);
            }
        });
    };

    return (
        <div className="mt-6 border-t pt-4 space-y-4">
            <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
                <button
                    onClick={() => setViewMode('option')}
                    className={cn(
                        'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                        viewMode === 'option' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    規格選項
                </button>
                <button
                    onClick={() => setViewMode('table')}
                    className={cn(
                        'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                        viewMode === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    表格檢視
                </button>
            </div>

            {viewMode === 'option' ? (
                <VariantOptionsPicker
                    product={product}
                    onVariantSelect={onVariantSelect}
                    onSelectionChange={onSelectionChange}
                    getVariantQuantity={(variantId) => getItemQuantity(product.id, variantId)}
                />
            ) : matchingTemplate ? (
                <Card className="overflow-hidden">
                    <CardHeader className="px-4 py-3 border-b bg-muted/20">
                        <div className="flex items-center gap-2">
                            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                            <CardTitle className="text-base font-medium">
                                {matchingTemplate.name}
                            </CardTitle>
                        </div>
                        {matchingTemplate.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {matchingTemplate.description}
                            </p>
                        )}
                    </CardHeader>
                    <CardContent className="p-4">
                        <OrderGridRenderer
                            template={matchingTemplate}
                            products={templateFilteredProducts}
                            onAddToCart={handleAddToCart}
                            onDirectItemAdd={handleDirectItemAdd}
                            initialQuantities={{} as GridQuantities}
                            getCartQuantity={(productId, variantId) => getItemQuantity(productId, variantId)}
                        />
                    </CardContent>
                </Card>
            ) : (
                <div className="border rounded-lg divide-y">
                    {(product.variants || []).map((v: any) => {
                        const cartQty = getItemQuantity(product.id, v.id);
                        const price = v.effective_wholesale_price ?? v.wholesale_price ?? 0;
                        return (
                            <div key={v.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                                <div className="flex-1 min-w-0 pr-3">
                                    <div className="text-sm font-medium truncate">{v.name}</div>
                                    <div className="text-xs text-muted-foreground font-mono truncate">{v.sku || product.sku}</div>
                                </div>
                                <div className="text-sm font-semibold text-right mr-4 w-16 shrink-0">
                                    ${Number(price)}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Button
                                            variant={cartQty > 0 ? "default" : "outline"}
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => addItem(product, v)}
                                        >
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                        <span className="text-xs font-medium leading-none text-primary tabular-nums">{cartQty}</span>
                                        {cartQty > 0 && (
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => {
                                                    const itemId = `${product.id}-${v.id}`;
                                                    if (cartQty <= 1) {
                                                        removeItem(itemId);
                                                    } else {
                                                        updateQuantity(itemId, cartQty - 1);
                                                    }
                                                }}
                                            >
                                                <Minus className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
