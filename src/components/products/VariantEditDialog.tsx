import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import { OptionGroupWithValues } from '@/types/product';
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
import { getErrorMessage } from '@/lib/errorMessages';
import { StandaloneDeviceModelSelectField } from './StandaloneDeviceModelSelectField';
import { OptionValueCombobox } from './form/OptionValueCombobox';
import { DynamicSpecsFields } from './form/sections/DynamicSpecsFields';
import { serializeSpecs, deserializeSpecs } from '@/utils/specLogic';
import { useSpecStore } from '@/store/useSpecStore';
import { entityRelationService } from '@/services/entityRelationService';
import { ProductImageManager } from '@/components/products/images/ProductImageManager';
import { VariantBindingManager } from './form/sections/VariantBindingManager';

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
    variant,
    onSuccess,
}: VariantEditDialogProps) {
    const queryClient = useQueryClient();
    const { specMap } = useSpecStore();
    const [optionGroups, setOptionGroups] = useState<OptionGroupWithValues[]>([]);

    const form = useForm({
        defaultValues: {
            sku: '',
            name: '',
            barcode: '',
            wholesale_price: 0,
            retail_price: 0,
            status: 'active' as any,
            spec_values: {} as Record<string, any>,
            selectedModelIds: [] as string[],
            selectedGroupIds: [] as string[],
            selectedExclusionIds: [] as string[],
            category_ids: [] as string[],
            optionValues: {} as Record<string, string>,
        }
    });

    const initializedRef = useRef<string | null>(null);
    useEffect(() => {
        if (!open) {
            initializedRef.current = null;
            return;
        }
        const variantId = variant?.id || 'new';
        if (initializedRef.current === variantId && variantId !== 'new') return;
        initializedRef.current = variantId;

        const init = async () => {
            useSpecStore.getState().fetchSpecs();

            const { data: groups, error: groupsError } = await supabase
                .from('product_option_groups')
                .select('*')
                .eq('product_id', product!.id)
                .order('sort_order');

            if (groupsError) {
                toast.error(`選項群組載入失敗：${getErrorMessage(groupsError)}`);
                return;
            }

            const groupsWithValues: OptionGroupWithValues[] = [];
            if (groups) {
                for (const group of groups) {
                    const { data: values } = await supabase
                        .from('product_option_values')
                        .select('*')
                        .eq('group_id', group.id)
                        .order('sort_order');
                    groupsWithValues.push({ ...group, values: values || [] });
                }
            }
            setOptionGroups(groupsWithValues);

            const valueIdToLabel: Record<string, string> = {};
            for (const g of groupsWithValues) {
                for (const v of g.values) {
                    valueIdToLabel[v.id] = v.label || v.value || '';
                }
            }

            if (variant) {
                const [links, groupLinks, exclusions, specValues, variantOptions] = await Promise.all([
                    (supabase.from('entity_model_relations') as any).select('model_id').eq('variant_id', variant.id).eq('relation_type', 'include').not('model_id', 'is', null),
                    (supabase.from('entity_model_relations') as any).select('group_id').eq('variant_id', variant.id).eq('relation_type', 'include').not('group_id', 'is', null),
                    (supabase.from('entity_model_relations') as any).select('model_id').eq('variant_id', variant.id).eq('relation_type', 'exclude').not('model_id', 'is', null),
                    (supabase.from('entity_spec_values') as any).select('*').eq('entity_id', variant.id).eq('entity_type', 'variant').is('deleted_at', null),
                    (supabase.from('product_variant_options') as any).select('option_group_id, option_value_id').eq('variant_id', variant.id),
                ]);

                const optionValues: Record<string, string> = {};
                if (variantOptions.data) {
                    for (const opt of variantOptions.data) {
                        optionValues[opt.option_group_id] = valueIdToLabel[opt.option_value_id] || '';
                    }
                }

                form.reset({
                    sku: variant.sku,
                    name: variant.name,
                    barcode: variant.barcode || '',
                    wholesale_price: variant.wholesale_price,
                    retail_price: variant.retail_price,
                    status: variant.status as any,
                    spec_values: deserializeSpecs(specValues.data || []),
                    selectedModelIds: links.data?.map(l => l.model_id) || [],
                    selectedGroupIds: groupLinks.data?.map(l => l.group_id) || [],
                    selectedExclusionIds: exclusions.data?.map(l => l.model_id) || [],
                    category_ids: (product as any)?.category_ids || [],
                    optionValues,
                });
            } else {
                form.reset({
                    sku: product ? `${product.code || ''}-` : '',
                    name: '',
                    barcode: '',
                    wholesale_price: 0,
                    retail_price: 0,
                    status: 'active',
                    spec_values: {},
                    selectedModelIds: [],
                    selectedGroupIds: [],
                    selectedExclusionIds: [],
                    category_ids: (product as any)?.category_ids || [],
                    optionValues: {},
                });
            }
        };
        init();
    }, [open, variant?.id, product?.id]);

    const resolveOptionValueId = async (groupId: string, label: string): Promise<string | null> => {
        if (!label) return null;
        const existing = optionGroups.find(g => g.id === groupId)?.values.find(v => (v.label || v.value) === label);
        if (existing) return existing.id;
        const { data, error } = await (supabase.from('product_option_values') as any).insert({
            group_id: groupId,
            label,
            value: label,
        }).select().single();
        if (error) throw error;
        return data.id;
    };

    const manageVariantOptions = async (variantId: string, optionValues: Record<string, string>) => {
        await (supabase.from('product_variant_options') as any).delete().eq('variant_id', variantId);

        const resolved: { groupId: string; valueId: string }[] = [];
        for (const [groupId, label] of Object.entries(optionValues)) {
            const valueId = await resolveOptionValueId(groupId, label);
            if (valueId) resolved.push({ groupId, valueId });
        }

        const inserts = resolved.map(({ groupId, valueId }) => ({
            variant_id: variantId,
            option_group_id: groupId,
            option_value_id: valueId,
        }));
        if (inserts.length > 0) {
            const { error } = await (supabase.from('product_variant_options') as any).insert(inserts);
            if (error) throw error;
        }
    };

    const createMutation = useMutation({
        mutationFn: async (values: any) => {
            const {
                selectedModelIds,
                selectedGroupIds,
                selectedExclusionIds,
                category_ids,
                spec_values,
                optionValues,
                ...dataToInsert
            } = values;

            const finalData = {
                ...dataToInsert,
                product_id: product?.id,
                barcode: dataToInsert.barcode || null,
                sort_order: 0,
            };

            const { data, error } = await (supabase.from('product_variants') as any).insert(finalData).select().single();
            if (error) throw error;

            await manageVariantOptions(data.id, optionValues || {});

            if (values.spec_values && (product as any)?.category_ids?.length > 0) {
                const serializedSpecsData = serializeSpecs(values.spec_values, specMap);
                await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: data.id,
                    p_entity_type: 'variant',
                    p_category_id: (product as any).category_ids[0],
                    p_new_data: serializedSpecsData
                });
            }

            await entityRelationService.updateRelations('variant', data.id, {
                modelIds: selectedModelIds,
                groupIds: selectedGroupIds,
                exclusions: selectedExclusionIds.map((id: string) => ({ model_id: id }))
            });
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
            toast.error(`新增失敗：${getErrorMessage(error)}`);
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (values: any) => {
            const {
                selectedModelIds,
                selectedGroupIds,
                selectedExclusionIds,
                category_ids,
                spec_values,
                optionValues,
                ...updates
            } = values;

            const finalUpdates = {
                ...updates,
                barcode: updates.barcode || null,
            };

            const { error } = await (supabase.from('product_variants') as any).update(finalUpdates).eq('id', variant!.id);
            if (error) throw error;

            await manageVariantOptions(variant!.id, optionValues || {});

            if (values.spec_values && (product as any)?.category_ids?.length > 0) {
                const serializedSpecsData = serializeSpecs(values.spec_values, specMap);
                await supabase.rpc('sync_product_specs_v6', {
                    p_entity_id: variant!.id,
                    p_entity_type: 'variant',
                    p_category_id: (product as any).category_ids[0],
                    p_new_data: serializedSpecsData
                });
            }

            await entityRelationService.updateRelations('variant', variant!.id, {
                modelIds: selectedModelIds,
                groupIds: selectedGroupIds,
                exclusions: selectedExclusionIds.map((id: string) => ({ model_id: id }))
            });
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
            toast.error(`更新失敗：${getErrorMessage(error)}`);
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

                        {optionGroups.length > 0 && (
                            <div className="space-y-4">
                                <Label className="text-sm font-medium">選項</Label>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {optionGroups.map((group) => (
                                        <FormField
                                            key={group.id}
                                            control={form.control}
                                            name={`optionValues.${group.id}`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{group.name}</FormLabel>
                                                    <FormControl>
                                                        <OptionValueCombobox
                                                            group={group}
                                                            value={field.value || ''}
                                                            onChange={field.onChange}
                                                            placeholder={`輸入或選擇${group.name}`}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

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
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
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
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
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
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="status"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>狀態</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value || ""}>
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
                                        <FormMessage />
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

                        {variant && (
                            <div className="space-y-2 border-t pt-4">
                                <div>
                                    <h4 className="text-sm font-medium">變體圖片</h4>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        小圖營揚展時，前台會點擊變體選項後自動切換為此變體的圖片。
                                        若變體沒有圖片，則顯示主商品圖片。
                                    </p>
                                </div>
                                <ProductImageManager entityType="variant" entityId={variant.id} />
                            </div>
                        )}

                        {variant && (
                            <div className="border-t pt-4">
                                <VariantBindingManager variantId={variant.id} />
                            </div>
                        )}

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
