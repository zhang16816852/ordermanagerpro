import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

type Product = Tables<'products'>;
type ProductVariant = Tables<'product_variants'>;
type VariantInsert = TablesInsert<'product_variants'>;

interface VariantEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product: Product | null;
    variant: ProductVariant | null;
    onSuccess?: () => void;
}

export function VariantEditDialog({
    open,
    onOpenChange,
    product,
    variant, // variant to edit, if null then create new
    onSuccess,
}: VariantEditDialogProps) {
    const queryClient = useQueryClient();

    // Reset form or state if needed when opening/closing could be handled by key or uncontrolled inputs with defaultValues
    // using uncontrolled form submission for simplicity as per original implementation

    const createMutation = useMutation({
        mutationFn: async (variantData: VariantInsert) => {
            const { error } = await supabase.from('product_variants').insert(variantData);
            if (error) throw error;
        },
        onSuccess: () => {
            if (product) {
                queryClient.invalidateQueries({ queryKey: ['product-variants', product.id] });
            }
            toast.success('變體已新增');
            onOpenChange(false);
            onSuccess?.();
        },
        onError: (error) => {
            toast.error(`新增失敗：${error.message}`);
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, ...updates }: Partial<ProductVariant> & { id: string }) => {
            const { error } = await supabase.from('product_variants').update(updates).eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            if (product) {
                queryClient.invalidateQueries({ queryKey: ['product-variants', product.id] });
            }
            toast.success('變體已更新');
            onOpenChange(false);
            onSuccess?.();
        },
        onError: (error) => {
            toast.error(`更新失敗：${error.message}`);
        },
    });

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!product) return;

        const formData = new FormData(e.currentTarget);
        const variantData = {
            product_id: product.id,
            sku: formData.get('sku') as string,
            name: formData.get('name') as string,
            barcode: (formData.get('barcode') as string) || null,
            color: (formData.get('color') as string) || null,
            option_1: (formData.get('option_1') as string) || null,
            option_2: (formData.get('option_2') as string) || null,
            option_3: (formData.get('option_3') as string) || null,
            wholesale_price: parseFloat(formData.get('wholesale_price') as string) || 0,
            retail_price: parseFloat(formData.get('retail_price') as string) || 0,
            status: formData.get('status') as ProductVariant['status'],
        };

        if (variant) {
            updateMutation.mutate({ id: variant.id, ...variantData });
        } else {
            createMutation.mutate(variantData);
        }
    };

    // Generate default SKU for new variant
    const defaultSku = variant ? variant.sku : (product ? `${product.sku}-` : '');

    // If dialog is not open, return null to avoid rendering
    // But Dialog component handles open state, keeping it mounted allows animation?
    // However, we need to reset defaultValues when variant changes.
    // The simplest way to reset uncontrolled inputs is to use a key on the form or dialog content.
    const dialogKey = open ? (variant ? `edit-${variant.id}` : 'create') : 'closed';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg" key={dialogKey}>
                <DialogHeader>
                    <DialogTitle>{variant ? '編輯變體' : '新增變體'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="sku">SKU *</Label>
                            <Input
                                id="sku"
                                name="sku"
                                defaultValue={defaultSku}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="name">變體名稱 *</Label>
                            <Input
                                id="name"
                                name="name"
                                defaultValue={variant?.name}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="option_1">選項1</Label>
                            <Input
                                id="option_1"
                                name="option_1"
                                placeholder="如：霧面"
                                defaultValue={variant?.option_1 || ''}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="option_2">選項2</Label>
                            <Input
                                id="option_2"
                                name="option_2"
                                placeholder="如：256GB"
                                defaultValue={variant?.option_2 || ''}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="option_3">選項3</Label>
                            <Input
                                id="option_3"
                                name="option_3"
                                placeholder="如：白色"
                                defaultValue={variant?.option_3 || ''}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="barcode">條碼</Label>
                            <Input
                                id="barcode"
                                name="barcode"
                                defaultValue={variant?.barcode || ''}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="color">顏色備註</Label>
                            <Input
                                id="color"
                                name="color"
                                defaultValue={variant?.color || ''}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="wholesale_price">批發價</Label>
                            <Input
                                id="wholesale_price"
                                name="wholesale_price"
                                type="number"
                                step="0.01"
                                defaultValue={variant?.wholesale_price ?? product?.base_wholesale_price ?? 0}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="retail_price">零售價</Label>
                            <Input
                                id="retail_price"
                                name="retail_price"
                                type="number"
                                step="0.01"
                                defaultValue={variant?.retail_price ?? product?.base_retail_price ?? 0}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="status">狀態</Label>
                            <Select name="status" defaultValue={variant?.status || 'active'}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">上架中</SelectItem>
                                    <SelectItem value="preorder">預購中</SelectItem>
                                    <SelectItem value="sold_out">售完停產</SelectItem>
                                    <SelectItem value="discontinued">已停售</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                            {variant ? '儲存' : '新增'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
