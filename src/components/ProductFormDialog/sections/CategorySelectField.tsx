import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, Plus } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';

interface CategorySelectFieldProps {
    form: UseFormReturn<any>;
}

export function CategorySelectField({ form }: CategorySelectFieldProps) {
    const selectedCategoryIds = form.watch('category_ids') || [];

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

    // Build flat tree for select using the hierarchy table
    const categoryOptions = useMemo(() => {
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
                const newPath = [...path, child.id]; 
                const uniqueValue = newPath.join('-'); 

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

    return (
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
                                        找不到對應的分類資料
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
                    <Popover modal={true}>
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
                        <PopoverContent 
                            className="w-[300px] p-0" 
                            align="start"
                            onWheel={(e) => e.stopPropagation()}
                        >
                            <div className="p-2 border-b">
                                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                    選擇分類
                                </h4>
                            </div>

                            <div 
                                className="max-h-[300px] overflow-y-auto overflow-x-hidden w-full scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
                            >
                                <div className="p-2 space-y-1">
                                    {categoryOptions.map((cat) => {
                                        const isSelected = selectedCategoryIds.includes(cat.id);

                                        const toggleCategory = () => {
                                            let next: string[];
                                            if (isSelected) {
                                                const toRemove = new Set<string>();
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
                                            } else {
                                                const toAdd = new Set<string>([cat.id]);
                                                const getAncestors = (id: string) => {
                                                    const parents = categoryHierarchy
                                                        .filter((h: any) => h.child_id === id)
                                                        .map((h: any) => h.parent_id);
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
    );
}
