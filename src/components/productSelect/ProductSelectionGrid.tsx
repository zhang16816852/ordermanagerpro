// src/components/order/ProductSelectionGrid.tsx
import { useState } from "react";
import { Search, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ProductWithPricing, VariantWithPricing } from "@/hooks/useProductCache";

interface ProductSelectionGridProps {
    products: ProductWithPricing[];
    isLoading: boolean;
    onAddToCart: (product: ProductWithPricing, variant?: VariantWithPricing) => void;
    getCartQuantity: (productId: string, variantId?: string) => number;
    // 用於顯示該產品在購物車中的總數（不論變體）
    getTotalProductQuantity?: (productId: string) => number;
}

export default function ProductSelectionGrid({
    products,
    isLoading,
    onAddToCart,
    getCartQuantity,
    getTotalProductQuantity,
}: ProductSelectionGridProps) {
    const [search, setSearch] = useState("");
    const [variantDialogProduct, setVariantDialogProduct] = useState<ProductWithPricing | null>(null);

    const filteredProducts = products.filter((product) => {
        if (!search.trim()) return true;

        const keywords = search
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);

        // 父商品可搜尋文字
        const productTexts = [
            product.name,
            product.sku,
        ]
            .filter(Boolean)
            .map((v) => v!.toLowerCase());

        // 變體可搜尋文字（重點）
        const variantTexts =
            product.variants?.flatMap((variant) =>
                [
                    variant.name,
                    variant.sku,
                    variant.barcode,
                    variant.option_1,
                    variant.option_2,
                    variant.option_3,
                ]
                    .filter(Boolean)
                    .map((v) => v!.toLowerCase())
            ) ?? [];

        const searchableTexts = [...productTexts, ...variantTexts];

        // OR 搜尋
        return keywords.some((keyword) =>
            searchableTexts.some((text) => text.includes(keyword))
        );
    });



    const handleProductClick = (product: ProductWithPricing) => {
        if (product.has_variants && product.variants && product.variants.length > 0) {
            setVariantDialogProduct(product);
        } else {
            onAddToCart(product);
        }
    };

    const handleVariantSelect = (product: ProductWithPricing, variant: VariantWithPricing) => {
        onAddToCart(product, variant);
        setVariantDialogProduct(null);
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>產品目錄</CardTitle>
                    <div className="relative mt-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="搜尋產品名稱或 SKU..."
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
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {filteredProducts.map((product) => {
                                const totalInCart = getTotalProductQuantity
                                    ? getTotalProductQuantity(product.id)
                                    : getCartQuantity(product.id);

                                const hasVariants = product.has_variants && product.variants && product.variants.length > 0;

                                return (
                                    <div
                                        key={product.id}
                                        className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
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
                                                <div>
                                                    <div className="font-medium">${product.wholesale_price}</div>
                                                    {totalInCart > 0 && (
                                                        <div className="text-sm text-primary">已加入 x{totalInCart}</div>
                                                    )}
                                                </div>
                                                {hasVariants && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 變體選擇對話框 */}
            <Dialog open={!!variantDialogProduct} onOpenChange={() => setVariantDialogProduct(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>選擇規格</DialogTitle>
                    </DialogHeader>
                    {variantDialogProduct && (
                        <div className="space-y-4">
                            <div className="text-sm text-muted-foreground">{variantDialogProduct.name}</div>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {variantDialogProduct.variants?.map((variant) => {
                                    const qty = getCartQuantity(variantDialogProduct.id, variant.id);
                                    const price = variant.wholesale_price ?? variant.wholesale_price;

                                    return (
                                        <div
                                            key={variant.id}
                                            className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
                                            onClick={() => handleVariantSelect(variantDialogProduct, variant as VariantWithPricing)}
                                        >
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <div className="font-medium">{variant.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{variant.sku}</div>
                                                    <div className="flex gap-1 mt-1">
                                                        {variant.option_1 && <Badge variant="secondary" className="text-xs">{variant.option_1}</Badge>}
                                                        {variant.option_2 && <Badge variant="secondary" className="text-xs">{variant.option_2}</Badge>}
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
        </>
    );
}