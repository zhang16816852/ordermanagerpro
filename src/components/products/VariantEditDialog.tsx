import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
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
    DialogDescription,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { toast } from 'sonner';
import { StandaloneDeviceModelSelectField } from './StandaloneDeviceModelSelectField';
import { ColorSelectField } from '../ProductFormDialog/ColorSelectField';
import { useColorStore } from '@/store/useColorStore';
import { DynamicSpecsFields } from '../ProductFormDialog/sections/DynamicSpecsFields';
import { serializeSpecs, deserializeSpecs } from '@/utils/specLogic';
import { useSpecStore } from '@/store/useSpecStore';

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
    const { colors, fetchColors } = useColorStore();
    const { specMap, fetchSpecs } = useSpecStore();

    const form = useForm({
        defaultValues: {
            sku: '',
            name: '',
            option_1: '',
            option_2: '',
            color: '',
            barcode: '',
            wholesale_price: 0,
            retail_price: 0,
            status: 'active' as any,
            spec_values: {} as Record<string, any>,
            selectedColorIds: [] as string[],
            selectedModelIds: [] as string[],
            selectedGroupIds: [] as string[],
            selectedExclusionIds: [] as string[],
            category_ids: [] as string[],
        }
    });

    // 初始化模型的 state
    useEffect(() => {
        const init = async () => {
            if (open) {
                const latestColors = await fetchColors();
                fetchSpecs();

                if (variant) {
                    // 取得設備型號連結與群組連結與排除
                    const [links, groupLinks, exclusions, specValues] = await Promise.all([
                        supabase.from('variant_model_links').select('model_id').eq('variant_id', variant.id),
                        supabase.from('variant_model_group_links').select('group_id').eq('variant_id', variant.id),
                        supabase.from('variant_model_exclusions').select('model_id').eq('variant_id', variant.id),
                        supabase.from('product_spec_values').select('*').eq('entity_id', variant.id).eq('entity_type', 'variant').is('deleted_at', null)
                    ]);

                    // 根據 option_3 的名稱找回顏色 ID
                    let colorIds: string[] = [];
                    if (variant.option_3) {
                        const color = latestColors.find(c => c.name === variant.option_3);
                        if (color) colorIds = [color.id];
                    }

                    form.reset({
                        sku: variant.sku,
                        name: variant.name,
                        option_1: variant.option_1 || '',
                        option_2: variant.option_2 || '',
                        color: variant.color || '',
                        barcode: variant.barcode || '',
                        wholesale_price: variant.wholesale_price,
                        retail_price: variant.retail_price,
                        status: variant.status as any,
                        spec_values: deserializeSpecs(specValues.data || []),
                        selectedColorIds: colorIds,
                        selectedModelIds: links.data?.map(l => l.model_id) || [],
                        selectedGroupIds: groupLinks.data?.map(l => l.group_id) || [],
                        selectedExclusionIds: exclusions.data?.map(l => l.model_id) || [],
                        category_ids: (product as any)?.category_ids || [],
                    });
                } else {
                    form.reset({
                        sku: product ? `${product.sku}-` : '',
                        name: '',
                        option_1: '',
                        option_2: '',
                        color: '',
                        barcode: '',
                        wholesale_price: product?.base_wholesale_price || 0,
                        retail_price: product?.base_retail_price || 0,
                        status: 'active',
                        spec_values: {},
                        selectedColorIds: [],
                        selectedModelIds: [],
                        selectedGroupIds: [],
                        selectedExclusionIds: [],
                        category_ids: (product as any)?.category_ids || [],
                    });
                }
            }
        };
        init();
    }, [open, variant, product, form, fetchColors, fetchSpecs]);

    const createMutation = useMutation({
        mutationFn: async (values: any) => {
            const {
                selectedModelIds,
                selectedGroupIds,
                selectedExclusionIds,
                selectedColorIds,
                category_ids,
                spec_values, // 排除 spec_values，以免寫入 product_variants 表
                ...dataToInsert
            } = values;

            // 處理顏色名稱
            const selectedColor = colors.find(c => c.id === selectedColorIds[0]);
            const finalData = {
                ...dataToInsert,
                product_id: product?.id,
                option_3: selectedColor?.name || null,
                // 確保空字串轉為 null
                barcode: dataToInsert.barcode || null,
                color: dataToInsert.color || null,
                option_1: dataToInsert.option_1 || null,
                option_2: dataToInsert.option_2 || null,
            };

            const { data, error } = await supabase.from('product_variants').insert(finalData).select().single();
            if (error) throw error;

            // v6 規格同步
            if (values.spec_values && (product as any)?.category_ids?.length > 0) {
                const serializedSpecsData = serializeSpecs(values.spec_values, specMap);
                await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: data.id,
                    p_entity_type: 'variant',
                    p_category_id: (product as any).category_ids[0],
                    p_new_data: serializedSpecsData
                });
            }

            // 處理型號連結、群組連結與排除
            const promises = [];
            if (values.selectedModelIds.length > 0) {
                promises.push(supabase.from('variant_model_links').insert(
                    values.selectedModelIds.map((mId: string) => ({ variant_id: data.id, model_id: mId }))
                ));
            }
            if (values.selectedGroupIds.length > 0) {
                promises.push(supabase.from('variant_model_group_links').insert(
                    values.selectedGroupIds.map((gId: string) => ({ variant_id: data.id, group_id: gId }))
                ));
            }
            if (values.selectedExclusionIds.length > 0) {
                promises.push(supabase.from('variant_model_exclusions').insert(
                    values.selectedExclusionIds.map((mId: string) => ({ variant_id: data.id, model_id: mId }))
                ));
            }
            if (promises.length > 0) await Promise.all(promises);
        },
        onSuccess: () => {
            if (product) {
                queryClient.invalidateQueries({ queryKey: ['product-variants', product.id] });
            }
            toast.success('變體已新增');
            onOpenChange(false);
            onSuccess?.();
        },
        onError: (error: any) => {
            toast.error(`新增失敗：${error.message}`);
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (values: any) => {
            const {
                selectedModelIds,
                selectedGroupIds,
                selectedExclusionIds,
                selectedColorIds,
                category_ids,
                spec_values, // 排除 spec_values，以免寫入 product_variants 表
                ...updates
            } = values;

            // 處理顏色名稱
            const selectedColor = colors.find(c => c.id === selectedColorIds[0]);
            const finalUpdates = {
                ...updates,
                option_3: selectedColor?.name || null,
                // 確保空字串轉為 null
                barcode: updates.barcode || null,
                color: updates.color || null,
                option_1: updates.option_1 || null,
                option_2: updates.option_2 || null,
            };

            const { error } = await supabase.from('product_variants').update(finalUpdates).eq('id', variant!.id);
            if (error) throw error;

            // v6 規格同步
            if (values.spec_values && (product as any)?.category_ids?.length > 0) {
                const serializedSpecsData = serializeSpecs(values.spec_values, specMap);
                await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: variant!.id,
                    p_entity_type: 'variant',
                    p_category_id: (product as any).category_ids[0],
                    p_new_data: serializedSpecsData
                });
            }

            // 更新連結與排除 (先刪後增)
            await Promise.all([
                supabase.from('variant_model_links').delete().eq('variant_id', variant!.id),
                supabase.from('variant_model_group_links').delete().eq('variant_id', variant!.id),
                supabase.from('variant_model_exclusions').delete().eq('variant_id', variant!.id),
            ]);

            const promises = [];
            if (values.selectedModelIds.length > 0) {
                promises.push(supabase.from('variant_model_links').insert(
                    values.selectedModelIds.map((mId: string) => ({ variant_id: variant!.id, model_id: mId }))
                ));
            }
            if (values.selectedGroupIds.length > 0) {
                promises.push(supabase.from('variant_model_group_links').insert(
                    values.selectedGroupIds.map((gId: string) => ({ variant_id: variant!.id, group_id: gId }))
                ));
            }
            if (values.selectedExclusionIds.length > 0) {
                promises.push(supabase.from('variant_model_exclusions').insert(
                    values.selectedExclusionIds.map((mId: string) => ({ variant_id: variant!.id, model_id: mId }))
                ));
            }
            if (promises.length > 0) await Promise.all(promises);
        },
        onSuccess: () => {
            if (product) {
                queryClient.invalidateQueries({ queryKey: ['product-variants', product.id] });
            }
            toast.success('變體已更新');
            onOpenChange(false);
            onSuccess?.();
        },
        onError: (error: any) => {
            toast.error(`更新失敗：${error.message}`);
        },
    });

    const onSubmit = (values: any) => {
        if (!product) return;
        if (variant) {
            updateMutation.mutate(values);
        } else {
            createMutation.mutate(values);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{variant ? '編輯變體' : '新增變體'}</DialogTitle>
                    <DialogDescription>
                        請在此設定產品變體的 SKU、名稱及相關規格。
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="sku"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>SKU *</FormLabel>
                                        <FormControl>
                                            <Input {...field} required />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>變體名稱 *</FormLabel>
                                        <FormControl>
                                            <Input {...field} required />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                            <FormField
                                control={form.control}
                                name="option_1"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>選項1</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="如：霧面" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="option_2"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>選項2</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="如：256GB" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="selectedColorIds"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>顏色</FormLabel>
                                        <FormControl>
                                            <ColorSelectField
                                                selectedColorIds={field.value}
                                                onChange={field.onChange}
                                                multiple={false}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="barcode"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>條碼</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="color"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>顏色備註</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                            <FormField
                                control={form.control}
                                name="wholesale_price"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>批發價</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                {...field}
                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="retail_price"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>零售價</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                {...field}
                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="status"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>狀態</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="active">上架中</SelectItem>
                                                <SelectItem value="preorder">預購中</SelectItem>
                                                <SelectItem value="sold_out">售完停產</SelectItem>
                                                <SelectItem value="discontinued">已停售</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <DynamicSpecsFields form={form} />

                        <FormField
                            control={form.control}
                            name="selectedModelIds"
                            render={({ field }) => (
                                <FormItem>
                                    <StandaloneDeviceModelSelectField
                                        modelIds={field.value}
                                        groupIds={form.watch('selectedGroupIds')}
                                        exclusionIds={form.watch('selectedExclusionIds')}
                                        onChange={(data) => {
                                            form.setValue('selectedModelIds', data.modelIds);
                                            form.setValue('selectedGroupIds', data.groupIds);
                                            form.setValue('selectedExclusionIds', data.exclusionIds);
                                        }}
                                    />
                                </FormItem>
                            )}
                        />

                        <div className="flex justify-end gap-2 pt-4 border-t">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                取消
                            </Button>
                            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                                {variant ? '儲存' : '新增'}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
