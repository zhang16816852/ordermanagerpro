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
import { formatSpecValue } from "@/utils/specLogic";
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

    const { data: specDefinitions = [] } = useQuery({
        queryKey: ['spec_definitions'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    if (!product) return null;

    const handleAddProduct = () => {
        if (product.has_variants && product.variants && product.variants.length > 0) {
            // If product has variants, we might want to let them choose in the catalog's variant dialog
            // For now, we close this and let the parent handle it or provide a basic selection here.
            // But based on the current flow, ProductCatalog handles variant selection.
            // We'll just notify that they need to select a variant if they haven't.
            onOpenChange(false);
            return;
        }

        addItem(product);
        toast.success(`${product.name} 已加入購物車`);
    };

    const qty = getItemQuantity(product.id);

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
                                ${product.wholesale_price}
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

                        {product.table_settings && (Array.isArray(product.table_settings) ? product.table_settings.length > 0 : Object.keys(product.table_settings).length > 0) && (
                            <div className="pt-4 border-t">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">產品規格</h3>
                                <div className="space-y-2">
                                    {Array.isArray(product.table_settings) ? (
                                        product.table_settings.map((entry: any) => {
                                            if (entry.value === null || entry.value === undefined || entry.value === '') return null;

                                            const displayVal = formatSpecValue(entry.value);

                                            return (
                                                <div key={entry.path} className="flex justify-between text-sm py-1 border-b last:border-0 border-muted">
                                                    <span className="text-muted-foreground">{entry.path}</span>
                                                    <span className="font-medium text-right">{displayVal}</span>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        Object.entries(product.table_settings as Record<string, any>).map(([key, val]) => {
                                            if (val === null || val === undefined || val === '') return null;
                                            const specDef = specDefinitions.find((s: any) => s.id === key || s.name === key);
                                            const displayName = specDef ? specDef.name : key;
                                            const displayVal = formatSpecValue(val);

                                            return (
                                                <div key={key} className="flex justify-between text-sm py-1 border-b last:border-0 border-muted">
                                                    <span className="text-muted-foreground">{displayName}</span>
                                                    <span className="font-medium text-right">{displayVal}</span>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="pt-6">
                            <Button
                                onClick={handleAddProduct}
                                className="w-full"
                                disabled={product.has_variants}
                            >
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                {product.has_variants ? "請在列表中選擇規格" : `加入購物車 ${qty > 0 ? `(已選 ${qty})` : ''}`}
                            </Button>
                        </div>
                    </div>
                </div>

                {product.has_variants && product.variants && product.variants.length > 0 && (
                    <div className="mt-6 border-t pt-4">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">規格選項縮覽</h3>
                        <div className="flex flex-wrap gap-2">
                            {product.variants.map((v) => (
                                <Badge key={v.id} variant="outline" className="px-2 py-1">
                                    {v.name}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
