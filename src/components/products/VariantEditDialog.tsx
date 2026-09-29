import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
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
    FormDescription,
} from "@/components/ui/form";
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { StandaloneDeviceModelSelectField } from './StandaloneDeviceModelSelectField';
import { DynamicSpecsFields } from './form/sections/DynamicSpecsFields';
import { serializeSpecs, deserializeSpecs } from '@/utils/specLogic';
import { useSpecStore } from '@/store/useSpecStore';
import { entityRelationService } from '@/services/entityRelationService';
import { ProductImageManager } from '@/components/products/images/ProductImageManager';
import { VariantBindingManager } from './form/sections/VariantBindingManager';
import { VariantOptionsEditor } from '@/components/products/variant/VariantOptionsEditor';
import { fetchOptionSuggestions } from './form/variantBatchCreatorUtils';
import {
    createOptionGroup,
    createOptionValue,
    type OptionGroupInput,
    type OptionGroupSuggestion,
} from '@/utils/variantGeneration';

type Product = Tables<'products'>;
type ProductVariant = Tables<'product_variants'>;

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
    const [optionGroups, setOptionGroups] = useState<OptionGroupInput[]>([]);
    const [selectedValueIds, setSelectedValueIds] = useState<Record<string, string>>({});
    const [suggestions, setSuggestions] = useState<OptionGroupSuggestion[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);
    const originalNamesRef = useRef<Record<string, string>>({});
    const isUnified = !!product?.unified_pricing;

    const form = useForm({
        defaultValues: {
            sku: '',
            name: '',
            barcode: '',
            wholesale_price: 0,
            retail_price: 0,
            status: 'active' as any,
            tracking_mode: 'none' as string,
            spec_values: {} as Record<string, any>,
            selectedModelIds: [] as string[],
            selectedGroupIds: [] as string[],
            selectedExclusionIds: [] as string[],
            category_ids: [] as string[],
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

        const loadOptionData = async () => {
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

            const loadedGroups: OptionGroupInput[] = groupsWithValues.map(g => ({
                id: g.id,
                name: g.name,
                values: g.values.map(v => ({
                    id: v.id,
                    label: v.label || '',
                    value: v.value || '',
                    wholesalePrice: '',
                    retailPrice: '',
                    hexCode: v.hex_code || '',
                })),
            }));
            setOptionGroups(loadedGroups);
            originalNamesRef.current = Object.fromEntries(loadedGroups.map(g => [g.id, g.name]));

            const selected: Record<string, string> = {};
            if (variant) {
                const { data: variantOptions } = await (supabase.from('product_variant_options') as any)
                    .select('option_group_id, option_value_id')
                    .eq('variant_id', variant.id);
                if (variantOptions) {
                    for (const opt of variantOptions) {
                        const group = loadedGroups.find(g => g.id === opt.option_group_id);
                        if (group && group.values.some(v => v.id === opt.option_value_id)) {
                            selected[opt.option_group_id] = opt.option_value_id;
                        }
                    }
                }
            }
            setSelectedValueIds(selected);
        };

        const init = async () => {
            useSpecStore.getState().fetchSpecs();
            await loadOptionData();
            fetchSuggestionsForProduct();

            if (variant) {
                const [links, groupLinks, exclusions, specValues] = await Promise.all([
                    (supabase.from('entity_model_relations') as any).select('model_id').eq('variant_id', variant.id).eq('relation_type', 'include').not('model_id', 'is', null),
                    (supabase.from('entity_model_relations') as any).select('group_id').eq('variant_id', variant.id).eq('relation_type', 'include').not('group_id', 'is', null),
                    (supabase.from('entity_model_relations') as any).select('model_id').eq('variant_id', variant.id).eq('relation_type', 'exclude').not('model_id', 'is', null),
                    (supabase.from('entity_spec_values') as any).select('*').eq('entity_id', variant.id).eq('entity_type', 'variant').is('deleted_at', null),
                ]);

                form.reset({
                    sku: variant.sku,
                    name: variant.name,
                    barcode: variant.barcode || '',
                    wholesale_price: isUnified ? Number((product as any)?.unified_wholesale_price ?? 0) : variant.wholesale_price,
                    retail_price: isUnified ? Number((product as any)?.unified_retail_price ?? 0) : variant.retail_price,
                    status: variant.status as any,
                    tracking_mode: variant.tracking_mode || 'none',
                    spec_values: deserializeSpecs(specValues.data || []),
                    selectedModelIds: links.data?.map(l => l.model_id) || [],
                    selectedGroupIds: groupLinks.data?.map(l => l.group_id) || [],
                    selectedExclusionIds: exclusions.data?.map(l => l.model_id) || [],
                    category_ids: (product as any)?.category_ids || [],
                });
            } else {
                form.reset({
                    sku: product ? `${product.code || ''}-` : '',
                    name: '',
                    barcode: '',
                    wholesale_price: isUnified ? Number((product as any)?.unified_wholesale_price ?? 0) : 0,
                    retail_price: isUnified ? Number((product as any)?.unified_retail_price ?? 0) : 0,
                    status: 'active',
                    tracking_mode: 'none',
                    spec_values: {},
                    selectedModelIds: [],
                    selectedGroupIds: [],
                    selectedExclusionIds: [],
                    category_ids: (product as any)?.category_ids || [],
                });
            }
        };
        init();
    }, [open, variant?.id, product?.id]);

    const fetchSuggestionsForProduct = async () => {
        if (!product) return;
        try {
            setSuggestionsLoading(true);
            const loaded = await fetchOptionSuggestions(product);
            setSuggestions(loaded);
        } catch (err) {
            console.error('載入選項建議失敗:', err);
            setSuggestions([]);
        } finally {
            setSuggestionsLoading(false);
        }
    };

    const importSuggestion = (sug: OptionGroupSuggestion) => {
        setOptionGroups(prev => {
            const existing = prev.find(g => g.name.trim().toLowerCase() === sug.name.toLowerCase());
            if (existing) {
                return prev.map(g => {
                    if (g.id !== existing.id) return g;
                    const existingLabels = new Set(g.values.map(v => v.label.trim().toLowerCase()));
                    const toAdd = sug.values.filter(v => !existingLabels.has(v.label.trim().toLowerCase()));
                    return { ...g, values: [...g.values, ...toAdd.map(v => createOptionValue(v.label, v.value, '', '', v.hexCode))] };
                });
            }
            const group = createOptionGroup(sug.name);
            group.values = sug.values.map(v => createOptionValue(v.label, v.value, '', '', v.hexCode));
            return [...prev, group];
        });
    };

    const importAllSuggestions = () => {
        suggestions.forEach(s => importSuggestion(s));
    };

    const handleSelectValue = (groupId: string, valueId: string) => {
        setSelectedValueIds(prev => {
            const next = { ...prev };
            if (!valueId || next[groupId] === valueId) {
                delete next[groupId];
            } else {
                next[groupId] = valueId;
            }
            return next;
        });
    };

    useEffect(() => {
        setSelectedValueIds(prev => {
            let changed = false;
            const next: Record<string, string> = {};
            for (const g of optionGroups) {
                const selId = prev[g.id];
                if (!selId) continue;
                if (g.values.some(v => v.id === selId)) next[g.id] = selId;
                else changed = true;
            }
            return changed ? next : prev;
        });
    }, [optionGroups]);

    const syncVariantOptions = async (variantId: string) => {
        const options: { name: string; display: string; label: string; value: string }[] = [];
        const keepGroupIds = new Set<string>();
        for (const group of optionGroups) {
            const selId = selectedValueIds[group.id];
            if (!selId) continue;
            const val = group.values.find(v => v.id === selId);
            if (!val || !val.label.trim()) continue;
            keepGroupIds.add(group.id);
            const originalName = originalNamesRef.current[group.id] || group.name;
            options.push({
                name: originalName,
                display: group.name.trim() || originalName,
                label: val.label.trim(),
                value: val.value.trim() || val.label.trim(),
            });
        }

        const { data, error } = await (supabase.rpc as any)('upsert_product_variant_options_batch', {
            p_product_id: product!.id,
            p_variants: [{ variant_id: variantId, options }],
        });
        if (error) throw error;
        if (data && (data as any)?.ok === false) throw new Error((data as any).reason || '同步選項失敗');

        const { data: links } = await (supabase.from('product_variant_options') as any)
            .select('option_group_id')
            .eq('variant_id', variantId);
        const toRemove = (links || [])
            .map((l: any) => l.option_group_id)
            .filter((id: string) => !keepGroupIds.has(id));
        if (toRemove.length > 0) {
            const { error: delErr } = await (supabase.from('product_variant_options') as any)
                .delete()
                .eq('variant_id', variantId)
                .in('option_group_id', toRemove);
            if (delErr) throw delErr;
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

            await syncVariantOptions(data.id);

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
                queryClient.invalidateQueries({ queryKey: ['products'] });
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
                ...updates
            } = values;

            const finalUpdates = {
                ...updates,
                barcode: updates.barcode || null,
            };

            const { error } = await (supabase.from('product_variants') as any).update(finalUpdates).eq('id', variant!.id);
            if (error) throw error;

            await syncVariantOptions(variant!.id);

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
                queryClient.invalidateQueries({ queryKey: ['products'] });
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

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">選項群組與本變體選值</Label>
                            <p className="text-xs text-muted-foreground">
                                可新增／編輯選項群組與值（影響全產品）；並於每個群組內點選本變體使用的值（每群組限一個）。未選值的群組不會建立此變體關聯；取消勾選即移除關聯。
                            </p>
                            <VariantOptionsEditor
                                groups={optionGroups}
                                onChange={setOptionGroups}
                                suggestions={suggestions}
                                suggestionsLoading={suggestionsLoading}
                                onImportSuggestion={importSuggestion}
                                onImportAllSuggestions={importAllSuggestions}
                                selectedValueIds={selectedValueIds}
                                onSelectValue={handleSelectValue}
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
                                                disabled={isUnified}
                                                {...field}
                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                            />
                                        </FormControl>
                                        {isUnified && <FormDescription className="text-emerald-600">由產品「統一價格」控制，無法個別修改</FormDescription>}
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
                                                disabled={isUnified}
                                                {...field}
                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                            />
                                        </FormControl>
                                        {isUnified && <FormDescription className="text-emerald-600">由產品「統一價格」控制，無法個別修改</FormDescription>}
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

                        <FormField
                            control={form.control}
                            name="tracking_mode"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>追蹤模式</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value || 'none'}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">不追蹤</SelectItem>
                                            <SelectItem value="serial">一機一號（序號）</SelectItem>
                                            <SelectItem value="batch">批號</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>
                                        一機一號：每台建立獨立序號列；批號：整批單一列。進貨時需提供對應序號/批號。
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

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
