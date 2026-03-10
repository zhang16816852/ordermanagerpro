import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Plus } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';

interface BasicInfoFormProps {
    form: UseFormReturn<any>;
    onSubmit: (data: any) => void;
    isLoading?: boolean;
    onCancel: () => void;
}

export function BasicInfoForm({ form, onSubmit, isLoading, onCancel }: BasicInfoFormProps) {
    console.log('[BasicInfoForm] Form data:', form.getValues());
    const selectedCategoryIds = form.watch('category_ids') || [];
    console.log('[BasicInfoForm] Current selectedCategoryIds:', selectedCategoryIds);
    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('categories' as any) as any)
                .select('*')
                .order('sort_order', { ascending: true });
            if (error) return [];
            return data;
        },
    });

    const { data: categoryHierarchy = [] } = useQuery({
        queryKey: ['category_hierarchy'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    const { data: brands = [], isLoading: isLoadingBrands } = useQuery({
        queryKey: ['brands'],
        queryFn: async () => {
            try {
                const { data, error } = await (supabase.from('brands' as any) as any)
                    .select('*')
                    .order('sort_order', { ascending: true })
                    .order('name', { ascending: true });
                if (error) return [];
                return data;
            } catch (err) {
                console.error('Error fetching brands:', err);
                return [];
            }
        },
    });

    // Build flat tree for select using the hierarchy table
    const categoryOptions = useMemo(() => {
        // Deduplicate hierarchy links to prevent recursive duplicates if DB has duplicate rows
        const seenLinks = new Set<string>();
        const hierarchy = categoryHierarchy.filter((h: any) => {
            const key = `${h.parent_id}_${h.child_id}`;
            if (seenLinks.has(key)) return false;
            seenLinks.add(key);
            return true;
        });

        const childIds = new Set(hierarchy.map((h: any) => h.child_id));
        const roots = categories.filter((c: any) => !childIds.has(c.id));

        const build = (nodeId: string, level = 0, path: string[] = []): any[] => {
            const childLinks = hierarchy.filter((h: any) => h.parent_id === nodeId);
            return childLinks.flatMap((link: any) => {
                const child = categories.find((c: any) => c.id === link.child_id);
                if (!child) return [];
                const newPath = [...path, child.id]; // 每個節點都記錄完整路徑
                const uniqueValue = newPath.join('-'); // 這樣每個節點唯一，即使同一個子分類出現多次

                // For the tree UI, we want to show everything, but keys/values must be unique
                // We'll use "parentID_childID" as the unique value for the Select component

                return [
                    {
                        id: child.id,
                        uniqueValue,
                        name: child.name,
                        level: level + 1,
                        spec_schema: child.spec_schema
                    },
                    ...build(child.id, level + 1, newPath)
                ];
            });
        };

        console.log('[BasicInfoForm] Data check - categories loaded:', categories.length);
        console.log('[BasicInfoForm] Rebuilding categoryOptions tree...');

        return roots.flatMap(root => [
            {
                id: root.id,
                uniqueValue: `root-${root.id}`,
                name: root.name,
                level: 0,
                spec_schema: root.spec_schema
            },
            ...build(root.id, 0, [root.id])
        ]);
    }, [categories, categoryHierarchy]);

    const selectedCategories = useMemo(() =>
        categories.filter((c: any) => selectedCategoryIds.includes(c.id)),
        [categories, selectedCategoryIds]);

    // Fetch specs for all selected categories
    const { data: specFields = [] } = useQuery({
        queryKey: ['category_specs', selectedCategoryIds],
        enabled: selectedCategoryIds.length > 0,
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('category_spec_links' as any) as any)
                .select(`
                    category_id,
                    spec_id,
                    sort_order,
                    specification_definitions (
                        id,
                        name,
                        type,
                        options,
                        default_value
                    )
                `)
                .in('category_id', selectedCategoryIds)
                .order('sort_order', { ascending: true });

            if (error) return [];

            // Deduplicate specs if multiple categories have the same spec
            const seenSpecs = new Set<string>();
            const result: any[] = [];

            data.forEach((d: any) => {
                const spec = d.specification_definitions;
                if (!spec || seenSpecs.has(spec.id)) return;
                seenSpecs.add(spec.id);
                result.push({
                    id: spec.id,
                    name: spec.name,
                    key: spec.id,
                    type: spec.type,
                    options: spec.options,
                    defaultValue: spec.default_value
                });
            });

            return result;
        },
    });

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {/* 產品名稱 - 滿版 */}
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem className="col-span-2">
                                <FormLabel>產品名稱</FormLabel>
                                <FormControl>
                                    <Input placeholder="例如：超輕量防水外套" {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* SKU */}
                    <FormField
                        control={form.control}
                        name="sku"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>主要 SKU</FormLabel>
                                <FormControl>
                                    <Input placeholder="P-001" {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* 狀態選單 */}
                    <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>銷售狀態</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="選擇狀態" />
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

                    {/* 類別 (UUID Array) */}
                    <FormField
                        control={form.control}
                        name="category_ids"
                        render={({ field }) => (
                            <FormItem className="col-span-2">
                                <FormLabel>產品分類 (可多選)</FormLabel>

                                {/* 已選擇的 Badge */}
                                <div className="flex flex-wrap gap-2 mb-2 p-2 min-h-[40px] border rounded-md bg-muted/5">
                                    {selectedCategoryIds.length === 0 ? (
                                        <span className="text-sm text-muted-foreground italic">
                                            尚未選擇分類
                                        </span>
                                    ) : (
                                        <>
                                            {selectedCategories.length === 0 && categories.length > 0 ? (
                                                <span className="text-sm text-destructive italic">
                                                    找不到對應的分類資料 (ID: {selectedCategoryIds.join(', ')})
                                                </span>
                                            ) : selectedCategories.length === 0 ? (
                                                <span className="text-sm text-muted-foreground animate-pulse">
                                                    載入中...
                                                </span>
                                            ) : (
                                                selectedCategories.map((cat: any) => (
                                                    <Badge
                                                        key={cat.id}
                                                        variant="secondary"
                                                        className="flex items-center gap-1 pr-1"
                                                    >
                                                        {cat.name}
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-4 w-4 rounded-full hover:bg-muted p-0"
                                                            onClick={() => {
                                                                const next = selectedCategoryIds.filter(id => id !== cat.id);
                                                                field.onChange(next);
                                                            }}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </Badge>
                                                ))
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Popover */}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full justify-start text-muted-foreground font-normal"
                                        >
                                            <Plus className="mr-2 h-4 w-4" />
                                            {selectedCategoryIds.length > 0
                                                ? `已選擇 ${selectedCategoryIds.length} 個分類`
                                                : '新增分類...'}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[300px] p-0" align="start">
                                        <div className="p-2 border-b">
                                            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                                選擇分類
                                            </h4>
                                        </div>

                                        <div className="max-h-[300px] overflow-y-auto w-full custom-scrollbar">
                                            <div className="p-2 space-y-1">
                                                {categoryOptions.map((cat) => {
                                                    const isSelected = selectedCategoryIds.includes(cat.id);

                                                    // 階層選擇邏輯
                                                    const toggleCategory = () => {
                                                        let next: string[];
                                                        if (isSelected) {
                                                            // 取消勾選：根據使用者需求，取消該分類及其所有子分類
                                                            // 也取消父分類 (如果父分類下沒有其他被選中的子分類，這裡採連鎖取消)
                                                            const toRemove = new Set<string>();

                                                            // 1. 找出所有子代
                                                            const getDescendants = (id: string) => {
                                                                const children = categoryHierarchy
                                                                    .filter((h: any) => h.parent_id === id)
                                                                    .map((h: any) => h.child_id);
                                                                children.forEach(childId => {
                                                                    toRemove.add(childId);
                                                                    getDescendants(childId);
                                                                });
                                                            };

                                                            toRemove.add(cat.id);
                                                            getDescendants(cat.id);

                                                            // 2. 處理父代 (使用者要求取消子分類時父分類也要取消)
                                                            const getAncestors = (id: string) => {
                                                                const parents = categoryHierarchy
                                                                    .filter((h: any) => h.child_id === id)
                                                                    .map((h: any) => h.parent_id);
                                                                parents.forEach(parentId => {
                                                                    toRemove.add(parentId);
                                                                    getAncestors(parentId);
                                                                });
                                                            };
                                                            getAncestors(cat.id);

                                                            next = selectedCategoryIds.filter(id => !toRemove.has(id));
                                                            console.log('[BasicInfoForm] Removing categories:', Array.from(toRemove));
                                                        } else {
                                                            // 勾選：自動勾選所有父分類
                                                            const toAdd = new Set<string>([cat.id]);
                                                            const getAncestors = (id: string) => {
                                                                const parents = categoryHierarchy
                                                                    .filter((h: any) => h.child_id === id)
                                                                    .map((h: any) => h.parent_id);
                                                                console.log(`[BasicInfoForm] Finding ancestors for ${id}:`, parents);
                                                                parents.forEach(parentId => {
                                                                    if (!toAdd.has(parentId)) {
                                                                        toAdd.add(parentId);
                                                                        getAncestors(parentId);
                                                                    }
                                                                });
                                                            };
                                                            getAncestors(cat.id);

                                                            const combined = new Set([...selectedCategoryIds, ...toAdd]);
                                                            next = Array.from(combined);
                                                            console.log('[BasicInfoForm] Adding categories (with ancestors):', next);
                                                        }
                                                        field.onChange(next);
                                                    };

                                                    return (
                                                        <div
                                                            key={cat.uniqueValue}
                                                            className={`flex items-center gap-2 p-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-primary/5 text-primary' : ''
                                                                }`}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                toggleCategory();
                                                            }}
                                                        >
                                                            <Checkbox
                                                                checked={isSelected}
                                                                className="pointer-events-none"
                                                                onCheckedChange={toggleCategory}
                                                            />
                                                            <span className="text-sm">{'\u00A0'.repeat(cat.level * 2) + cat.name}</span>
                                                        </div>
                                                    );
                                                })}
                                                {categoryOptions.length === 0 && (
                                                    <p className="text-xs text-center py-4 text-muted-foreground">
                                                        尚未建立分類
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="brand_id"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>品牌</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || undefined} disabled={isLoadingBrands}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder={isLoadingBrands ? "載入中..." : "選擇品牌"} />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="none" disabled className="hidden">無</SelectItem>
                                        {brands.map((brand: any) => (
                                            <SelectItem key={brand.id} value={brand.id}>
                                                {brand.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {brands.length === 0 && !isLoadingBrands && (
                                    <p className="text-[10px] text-muted-foreground mt-1">尚未建立任何品牌，請至分類管理新增</p>
                                )}
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* 型號 */}
                    <FormField
                        control={form.control}
                        name="model"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>型號</FormLabel>
                                <FormControl>
                                    <Input {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* 批發價 */}
                    <FormField
                        control={form.control}
                        name="base_wholesale_price"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>基準批發價</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* 零售價 */}
                    <FormField
                        control={form.control}
                        name="base_retail_price"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>基準零售價</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                {/* 動態規格欄位 (table_settings) */}
                {specFields.length > 0 && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                            分類特定規格
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            {specFields.map((f: any) => (
                                <div key={f.key} className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">{f.name}</label>
                                    {f.type === 'boolean' ? (
                                        <div className="flex items-center space-x-2 h-9 border rounded-md px-3 bg-background">
                                            <Checkbox
                                                id={`spec-${f.key}`}
                                                checked={form.watch(`table_settings.${f.key}`) === 'true'}
                                                onCheckedChange={(checked) => form.setValue(`table_settings.${f.key}`, checked ? 'true' : 'false')}
                                            />
                                            <label htmlFor={`spec-${f.key}`} className="text-sm cursor-pointer select-none flex-1">
                                                支援
                                            </label>
                                        </div>
                                    ) : f.type === 'number_with_unit' ? (
                                        <div className="flex items-center space-x-2">
                                            <Input
                                                type="number"
                                                value={form.watch(`table_settings.${f.key}`) || ''}
                                                onChange={(e) => form.setValue(`table_settings.${f.key}`, e.target.value)}
                                                placeholder={`輸入數值`}
                                                className="h-9"
                                            />
                                            {f.options?.[0] && (
                                                <span className="text-sm text-muted-foreground whitespace-nowrap">{f.options[0]}</span>
                                            )}
                                        </div>
                                    ) : f.type === 'text' ? (
                                        <Input
                                            value={form.watch(`table_settings.${f.key}`) || ''}
                                            onChange={(e) => form.setValue(`table_settings.${f.key}`, e.target.value)}
                                            placeholder={`輸入${f.name}`}
                                            className="h-9"
                                        />
                                    ) : f.type === 'multiselect' ? (
                                        // 多選：Checkbox 列表
                                        <div className="flex flex-col gap-1.5 p-2 border rounded-md bg-background max-h-32 overflow-y-auto">
                                            {f.options?.map((opt: string) => {
                                                const currentVals: string[] = (() => {
                                                    const raw = form.watch(`table_settings.${f.key}`);
                                                    if (Array.isArray(raw)) return raw;
                                                    if (typeof raw === 'string' && raw) return raw.split(',');
                                                    return [];
                                                })();
                                                const isChecked = currentVals.includes(opt);
                                                return (
                                                    <div key={opt} className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={`spec-${f.key}-${opt}`}
                                                            checked={isChecked}
                                                            onCheckedChange={(checked) => {
                                                                const next = checked
                                                                    ? [...currentVals, opt]
                                                                    : currentVals.filter((v) => v !== opt);
                                                                form.setValue(`table_settings.${f.key}`, next);
                                                            }}
                                                        />
                                                        <label htmlFor={`spec-${f.key}-${opt}`} className="text-sm cursor-pointer">{opt}</label>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <Select
                                            value={form.watch(`table_settings.${f.key}`) || ''}
                                            onValueChange={(val) => form.setValue(`table_settings.${f.key}`, val)}
                                        >
                                            <SelectTrigger className="h-9">
                                                <SelectValue placeholder="請選擇" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {f.options?.map((opt: string) => (
                                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 變體切換開關 */}
                <FormField
                    control={form.control}
                    name="has_variants"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/20">
                            <FormControl>
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={(checked) =>
                                        field.onChange(checked === true)
                                    }
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel>啟用規格變體</FormLabel>
                                <p className="text-sm text-muted-foreground">
                                    如果此產品有顏色、尺寸等不同規格，請勾選。
                                </p>
                            </div>
                        </FormItem>
                    )}
                />

                {/* 按鈕區 */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        取消
                    </Button>
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? "儲存中..." : "儲存基本資訊"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
