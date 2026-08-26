import { useMemo, useState } from 'react';
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, Plus, ChevronDown, Search } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { useSpecStore } from '@/store/useSpecStore';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';

interface CategorySelectFieldProps {
    form: UseFormReturn<any>;
}

export function CategorySelectField({ form }: CategorySelectFieldProps) {
    const selectedCategoryIds = form.watch('category_ids') || [];
    const [search, setSearch] = useState('');
    const [previewOpen, setPreviewOpen] = useState(false);

    const { categories, categoryHierarchy } = useSpecStore();
    const { data: previewSpecs = [] } = useCategorySpecs(selectedCategoryIds);

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

    // 搜尋過濾：保留符合關鍵字的分支（含其祖先與子孫）以維持階層脈絡
    const filteredOptions = useMemo(() => {
        if (!search.trim()) return categoryOptions;
        const q = search.trim().toLowerCase();
        const matchIds = new Set<string>();
        categoryOptions.forEach(o => { if (o.name.toLowerCase().includes(q)) matchIds.add(o.id); });
        let changed = true;
        while (changed) {
            changed = false;
            categoryOptions.forEach(o => {
                if (!matchIds.has(o.id)) {
                    const hasMatchedChild = categoryHierarchy.some(h => h.parent_id === o.id && matchIds.has(h.child_id));
                    if (hasMatchedChild) { matchIds.add(o.id); changed = true; }
                }
            });
        }
        let changed2 = true;
        while (changed2) {
            changed2 = false;
            categoryOptions.forEach(o => {
                if (matchIds.has(o.id)) {
                    categoryHierarchy.filter(h => h.child_id === o.id).forEach(h => {
                        if (!matchIds.has(h.parent_id)) { matchIds.add(h.parent_id); changed2 = true; }
                    });
                }
            });
        }
        return categoryOptions.filter(o => matchIds.has(o.id));
    }, [search, categoryOptions, categoryHierarchy]);

    // 規格預覽：依來源分類分組
    const previewGroups = useMemo(() => {
        if (previewSpecs.length === 0) return [];
        const catNameMap = new Map((categories || []).map((c: any) => [c.id, c.name]));
        const seen = new Set<string>();
        const groups: { categoryId: string | null; categoryName: string; specs: any[] }[] = [];
        (selectedCategoryIds || []).forEach(catId => {
            const specs = previewSpecs.filter(s => (s.sourceCategoryIds || []).includes(catId) && !seen.has(s.id));
            if (specs.length === 0) return;
            specs.forEach(s => seen.add(s.id));
            groups.push({ categoryId: catId, categoryName: catNameMap.get(catId) || '分類', specs });
        });
        const remaining = previewSpecs.filter(s => !seen.has(s.id));
        if (remaining.length > 0) groups.push({ categoryId: null, categoryName: '其他規格', specs: remaining });
        return groups;
    }, [previewSpecs, selectedCategoryIds, categories]);

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

                            <div className="p-2 border-b">
                                <div className="relative">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="搜尋分類..."
                                        className="h-8 pl-7 text-xs"
                                    />
                                </div>
                            </div>

                            <div 
                                className="max-h-[300px] overflow-y-auto overflow-x-hidden w-full scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
                            >
                                <div className="p-2 space-y-1">
                                    {filteredOptions.length === 0 ? (
                                        <p className="text-xs text-center py-4 text-muted-foreground">
                                            找不到符合「{search}」的分類
                                        </p>
                                    ) : filteredOptions.map((cat) => {
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
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {previewGroups.length > 0 && (
                        <div className="mt-2 border rounded-md bg-muted/5">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full justify-between"
                                onClick={() => setPreviewOpen(o => !o)}
                            >
                                <span className="text-xs text-muted-foreground">
                                    規格預覽：{previewSpecs.length} 個欄位（來自 {selectedCategoryIds.length} 個分類）
                                </span>
                                <ChevronDown className={`h-4 w-4 transition-transform ${previewOpen ? 'rotate-180' : ''}`} />
                            </Button>
                            {previewOpen && (
                                <div className="px-3 pb-3 space-y-3 max-h-[260px] overflow-auto">
                                    {previewGroups.map(group => (
                                        <div key={group.categoryId || 'other'}>
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-foreground/60 mb-1">
                                                {group.categoryName}
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {group.specs.filter(s => s.type !== 'heading').map(s => (
                                                    <Badge key={s.id} variant="outline" className="text-[10px] font-normal">
                                                        {s.name}
                                                        {s.required && <span className="text-destructive ml-0.5">*</span>}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
