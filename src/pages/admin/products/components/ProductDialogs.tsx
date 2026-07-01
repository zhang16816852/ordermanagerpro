import { useState, useEffect, useMemo } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ProductFormDialog } from '@/components/products/form/ProductFormDialog';
import { UnifiedProductImport } from '@/components/products/import';
import { Tables } from '@/integrations/supabase/types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Minus, Plus, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { VariantOptionsPicker } from '@/components/products/catalog/VariantOptionsPicker';

type Product = Tables<'products'>;

interface ProductDialogsProps {
    isDialogOpen: boolean;
    setIsDialogOpen: (v: boolean) => void;
    isImportOpen: boolean;
    setIsImportOpen: (v: boolean) => void;
    editingProduct: Product | null;
    deleteProduct: Product | null;
    setDeleteProduct: (p: Product | null) => void;
    onFormSubmit: (values: any) => void;
    onDeleteConfirm: (id: string) => void;
    onImportSuccess: () => void;
    isMutationLoading: boolean;
    isSelectionOpen: boolean;
    setIsSelectionOpen: (v: boolean) => void;
    products: any[];
}

function QuantityControl({ quantity, onIncrease, onDecrease }: { quantity: number; onIncrease: () => void; onDecrease: () => void }) {
    return (
        <div className="flex items-center justify-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={onDecrease} disabled={quantity <= 0}>
                <Minus className="h-3 w-3" />
            </Button>
            <span className="w-8 text-center text-sm font-medium tabular-nums">{quantity}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={onIncrease}>
                <Plus className="h-3 w-3" />
            </Button>
        </div>
    );
}

function ProductSelectionDialog({
    open,
    onOpenChange,
    products,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    products: any[];
}) {
    const [viewMode, setViewMode] = useState<'option' | 'table'>('option');
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [selectedVariantMap, setSelectedVariantMap] = useState<Record<string, any | null>>({});

    useEffect(() => {
        if (open) {
            setQuantities({});
            setSelectedVariantMap({});
        }
    }, [open]);

    const getItemKey = (product: any, variant?: any) =>
        `${product.id}-${variant?.id || 'base'}`;

    const handleQuantityChange = (key: string, delta: number) => {
        setQuantities(prev => ({
            ...prev,
            [key]: Math.max(0, (prev[key] || 0) + delta),
        }));
    };

    const handleVariantSelect = (productId: string, variant: any | null) => {
        setSelectedVariantMap(prev => ({ ...prev, [productId]: variant }));
        const oldKeys = Object.keys(quantities).filter(k => k.startsWith(`${productId}-`));
        if (oldKeys.length > 0) {
            setQuantities(prev => {
                const next = { ...prev };
                oldKeys.forEach(k => delete next[k]);
                return next;
            });
        }
    };

    const totalItems = useMemo(
        () => Object.values(quantities).reduce((sum, q) => sum + q, 0),
        [quantities]
    );
    const selectedCount = useMemo(
        () => Object.values(quantities).filter(q => q > 0).length,
        [quantities]
    );

    const handleConfirm = () => {
        const selectedItems = Object.entries(quantities)
            .filter(([_, qty]) => qty > 0)
            .map(([key, qty]) => {
                const [productId, variantId] = key.split('-');
                const product = products.find((p: any) => p.id === productId);
                const variant = variantId !== 'base'
                    ? product?.variants?.find((v: any) => v.id === variantId)
                    : null;
                return { product, variant, quantity: qty };
            });

        if (selectedItems.length === 0) {
            toast.error('請至少選擇一個產品');
            return;
        }

        toast.success(`已選取 ${selectedItems.length} 項產品，共 ${totalItems} 件`);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>選取產品</DialogTitle>
                    <DialogDescription>
                        選擇產品並調整數量
                    </DialogDescription>
                </DialogHeader>

                <div className="sticky top-0 z-10 bg-background pb-3 border-b">
                    <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
                        <button
                            onClick={() => setViewMode('option')}
                            className={cn(
                                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                                viewMode === 'option' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            選項模式
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={cn(
                                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                                viewMode === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            表格模式
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto py-4">
                    {viewMode === 'option' ? (
                        <div className="space-y-3">
                            {products.map((product: any) => {
                                const currentVariant = selectedVariantMap[product.id];
                                const currentKey = getItemKey(product, currentVariant);
                                const currentQty = currentVariant || !product.has_variants
                                    ? (quantities[currentKey] || 0)
                                    : 0;

                                return (
                                    <div key={product.id} className="border rounded-lg p-3">
                                        <div className="flex items-start justify-between mb-2">
                                            <div>
                                                <div className="font-medium text-sm">{product.name}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{product.sku}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-medium text-sm">
                                                    ${Number(product.wholesale_price || 0)}
                                                </div>
                                            </div>
                                        </div>

                                        {product.has_variants && (
                                            <div className="mb-3">
                                                <VariantOptionsPicker
                                                    product={product}
                                                    onVariantSelect={(v: any | null) => handleVariantSelect(product.id, v)}
                                                />
                                            </div>
                                        )}

                                        {(product.has_variants && !currentVariant) ? (
                                            <div className="flex justify-end">
                                                <span className="text-xs text-muted-foreground italic">請先選擇規格</span>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end">
                                                <QuantityControl
                                                    quantity={currentQty}
                                                    onIncrease={() => handleQuantityChange(currentKey, 1)}
                                                    onDecrease={() => handleQuantityChange(currentKey, -1)}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
                                        <th className="text-left p-3">名稱</th>
                                        <th className="text-left p-3">SKU</th>
                                        <th className="text-right p-3">價格</th>
                                        <th className="text-center p-3 w-32">數量</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {products.flatMap((product: any) => {
                                        if (product.has_variants && product.variants?.length) {
                                            return product.variants.map((v: any) => ({
                                                id: `${product.id}-${v.id}`,
                                                name: `${product.name} / ${v.name}`,
                                                sku: v.sku || product.sku,
                                                price: v.effective_wholesale_price ?? v.wholesale_price ?? 0,
                                                product,
                                                variant: v,
                                            }));
                                        }
                                        return [{
                                            id: `${product.id}-base`,
                                            name: product.name,
                                            sku: product.sku,
                                            price: product.wholesale_price ?? 0,
                                            product,
                                            variant: null,
                                        }];
                                    }).map((row: any) => (
                                        <tr key={row.id} className="border-t hover:bg-muted/30">
                                            <td className="p-3 text-sm">{row.name}</td>
                                            <td className="p-3 text-sm text-muted-foreground font-mono">{row.sku}</td>
                                            <td className="p-3 text-sm text-right">${Number(row.price)}</td>
                                            <td className="p-3">
                                                <div className="flex justify-center">
                                                    <QuantityControl
                                                        quantity={quantities[row.id] || 0}
                                                        onIncrease={() => handleQuantityChange(row.id, 1)}
                                                        onDecrease={() => handleQuantityChange(row.id, -1)}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="border-t pt-4 flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                        {totalItems > 0
                            ? `已選 ${selectedCount} 項，共 ${totalItems} 件`
                            : '尚未選取產品'}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
                        <Button onClick={handleConfirm} disabled={totalItems === 0}>
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            加入購物車
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function ProductDialogs({
    isDialogOpen,
    setIsDialogOpen,
    isImportOpen,
    setIsImportOpen,
    editingProduct,
    deleteProduct,
    setDeleteProduct,
    onFormSubmit,
    onDeleteConfirm,
    onImportSuccess,
    isMutationLoading,
    isSelectionOpen,
    setIsSelectionOpen,
    products,
}: ProductDialogsProps) {
    return (
        <>
            <ProductFormDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                onSubmit={onFormSubmit}
                initialData={editingProduct}
                isLoading={isMutationLoading}
            />

            <AlertDialog open={!!deleteProduct} onOpenChange={() => setDeleteProduct(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除產品嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            這將刪除「{deleteProduct?.name}」及其關連的所有變體資料。此操作無法復原。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => deleteProduct && onDeleteConfirm(deleteProduct.id)}
                        >
                            確認刪除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <UnifiedProductImport 
                open={isImportOpen} 
                onOpenChange={setIsImportOpen} 
                onSuccess={onImportSuccess}
            />

            <ProductSelectionDialog
                open={isSelectionOpen}
                onOpenChange={setIsSelectionOpen}
                products={products}
            />
        </>
    );
}
