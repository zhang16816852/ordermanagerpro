import { useState, useMemo, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductWithPricing, VariantWithPricing } from "@/types/product";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import { toast } from "sonner";
import { ShoppingCart, ImageIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatSpecValue, deserializeSpecs } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";

interface ProductDetailDialogProps {
    product: ProductWithPricing | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storeId: string;
}

export function ProductDetailDialog({
    product,
    open,
    onOpenChange,
    storeId,
}: ProductDetailDialogProps) {
    const { addItem, getItemQuantity } = useStoreDraft(storeId);
    const { getBrandName } = useBrands();
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

    // 當彈窗開啟或產品改變時，若產品有變體，預設不選中或由外部決定
    useEffect(() => {
        if (!open) setSelectedVariantId(null);
    }, [open]);

    // 獲取目前選中的變體物件
    const selectedVariant = useMemo(() => {
        if (!selectedVariantId || !product?.variants) return null;
        return product.variants.find(v => v.id === selectedVariantId) || null;
    }, [product?.variants, selectedVariantId]);

    const { data: specDefinitions = [] } = useQuery({
        queryKey: ['spec_definitions'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    // --- 關鍵邏輯：合併產品與變體的規格 ---
    const combinedSpecs = useMemo(() => {
        if (!product) return [];

        // 1. 標準化產品規格
        const pSpecs = deserializeSpecs(product.table_settings);
        
        // 2. 標準化變體規格 (若有選中)
        const vSpecs = selectedVariant ? deserializeSpecs(selectedVariant.table_settings) : {};

        // 3. 合併 (變體優先)
        const merged = { ...pSpecs, ...vSpecs };

        // 4. 轉換回給介面顯示的格式 (path -> value)
        // 為了維持顯示名稱，我們需要比對 specDefinitions
        return Object.entries(merged).map(([key, val]) => {
            const specId = key.includes(':') ? key.split(':').pop()! : key;
            const def = specDefinitions.find((s: any) => s.id === specId || s.name === specId);
            return {
                id: key,
                name: def ? def.name : key,
                value: val
            };
        }).filter(s => s.value !== null && s.value !== undefined && s.value !== '');
    }, [product, selectedVariant, specDefinitions]);

    const qty = (product && selectedVariantId) ? getItemQuantity(selectedVariantId) : (product ? getItemQuantity(product.id) : 0);

    if (!product) return null;

    const handleAddProduct = () => {
        if (product.has_variants && !selectedVariantId) {
            toast.error("請先選擇規格");
            return;
        }

        if (selectedVariant) {
            addItem({
                ...product,
                id: selectedVariant.id,
                name: `${product.name} (${selectedVariant.name})`,
                wholesale_price: selectedVariant.wholesale_price,
                retail_price: selectedVariant.retail_price,
            } as any);
            toast.success(`${product.name} (${selectedVariant.name}) 已加入購物車`);
        } else {
            addItem(product);
            toast.success(`${product.name} 已加入購物車`);
        }
    };

    // 獲取目前應顯示的價格
    const currentPrice = selectedVariant ? selectedVariant.retail_price : product.wholesale_price;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle className="text-xl">{product.name}</DialogTitle>
                    <DialogDescription className="font-mono text-sm">
                        SKU: {product.sku}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
                        <div className="flex flex-col items-center text-muted-foreground">
                            <ImageIcon className="h-12 w-12 mb-2" />
                            <span className="text-xs">尚無圖片</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">價格</h3>
                            <div className="text-2xl font-bold text-primary mt-1">
                                ${currentPrice}
                            </div>
                        </div>

                        {((product as any).category_names?.length > 0) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">類別</h3>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {(product as any).category_names.map((name: string) => (
                                        <Badge key={name} variant="secondary">
                                            {name}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(product.brand_id || product.model) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">品牌 / 型號</h3>
                                <p className="mt-1">
                                    {getBrandName(product.brand_id)} / {product.model || '-'}
                                </p>
                            </div>
                        )}

                        <div className="pt-4 border-t">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">產品描述</h3>
                            <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                                {product.description || "尚無詳細描述。"}
                            </div>
                        </div>

                        {combinedSpecs.length > 0 && (
                            <div className="pt-4 border-t">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">產品規格</h3>
                                <div className="space-y-2">
                                    {combinedSpecs.map((spec) => (
                                        <div key={spec.id} className="flex justify-between text-sm py-1 border-b last:border-0 border-muted">
                                            <span className="text-muted-foreground">{spec.name}</span>
                                            <span className="font-medium text-right">{formatSpecValue(spec.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="pt-6">
                            <Button
                                onClick={handleAddProduct}
                                className="w-full"
                                disabled={product.has_variants && !selectedVariantId}
                            >
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                {product.has_variants && !selectedVariantId 
                                    ? "請先選擇規格選項" 
                                    : `加入購物車 ${qty > 0 ? `(已選 ${qty})` : ''}`}
                            </Button>
                        </div>
                    </div>
                </div>

                {product.has_variants && product.variants && product.variants.length > 0 && (
                    <div className="mt-6 border-t pt-4">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">選擇規格選項</h3>
                        <div className="flex flex-wrap gap-2">
                            {product.variants.map((v) => (
                                <Badge 
                                    key={v.id} 
                                    variant={selectedVariantId === v.id ? "default" : "outline"}
                                    className="px-3 py-1.5 cursor-pointer hover:bg-primary/10 transition-colors text-sm"
                                    onClick={() => setSelectedVariantId(selectedVariantId === v.id ? null : v.id)}
                                >
                                    {v.name}
                                    {selectedVariantId === v.id && <span className="ml-1.5 opacity-70">✓</span>}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
