import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ProductWithPricing } from "@/hooks/useProductCache";
import { ChevronRight, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface CatalogSidebarProps {
    products: ProductWithPricing[];
    selectedCategory: string | null; // This will now be category ID
    onCategoryChange: (categoryId: string | null) => void;
    selectedSpecs: Record<string, string[]>;
    onSpecChange: (key: string, values: string[]) => void;
    onClearFilters: () => void;
}

export function CatalogSidebar({
    products,
    selectedCategory,
    onCategoryChange,
    selectedSpecs,
    onSpecChange,
    onClearFilters,
}: CatalogSidebarProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('categories' as any) as any)
                .select('*')
                .order('sort_order', { ascending: true });
            if (error) return [];
            return data;
        },
    });

    const categoryTree = useMemo(() => {
        const build = (pid: string | null = null): any[] => {
            return categories
                .filter((c: any) => c.parent_id === pid)
                .map((c: any) => ({
                    ...c,
                    children: build(c.id)
                }));
        };
        return build();
    }, [categories]);

    // Extract available specs for the selected category (OR use the spec_schema if category is selected)
    const availableSpecs = useMemo(() => {
        const specs: Record<string, Set<string>> = {};

        // If a category is selected and it has a spec_schema, we prioritize those keys
        const selectedCatDetails = categories.find((c: any) => c.id === selectedCategory);
        const definedSpecKeys = (selectedCatDetails as any)?.spec_schema?.fields?.map((f: any) => f.key) || [];

        products.forEach((p) => {
            // Filter by category_id (or legacy category name if no match)
            const pCategoryId = (p as any).category_id;
            if (selectedCategory && pCategoryId !== selectedCategory) {
                // Backward compatibility check: if p.category matches the name of selectedCategory
                if (p.category !== (selectedCatDetails as any)?.name) return;
            }

            // Scan product table_settings
            const pSettings = p.table_settings as Record<string, any> | null;
            if (pSettings && typeof pSettings === 'object') {
                Object.entries(pSettings).forEach(([key, value]) => {
                    // If we have defined keys, only include those
                    if (definedSpecKeys.length > 0 && !definedSpecKeys.includes(key)) return;
                    if (!specs[key]) specs[key] = new Set();
                    if (value !== null && value !== undefined) specs[key].add(String(value));
                });
            }

            // Scan variant table_settings
            p.variants?.forEach((v) => {
                const vSettings = v.table_settings as Record<string, any> | null;
                if (vSettings && typeof vSettings === 'object') {
                    Object.entries(vSettings).forEach(([key, value]) => {
                        if (definedSpecKeys.length > 0 && !definedSpecKeys.includes(key)) return;
                        if (!specs[key]) specs[key] = new Set();
                        if (value !== null && value !== undefined) specs[key].add(String(value));
                    });
                }
            });
        });

        // Convert sets to sorted arrays
        const result: Record<string, string[]> = {};
        Object.entries(specs).forEach(([key, values]) => {
            if (values.size > 0) {
                result[key] = Array.from(values).sort();
            }
        });
        return result;
    }, [products, selectedCategory, categories]);

    const hasActiveFilters = selectedCategory !== null || Object.keys(selectedSpecs).length > 0;

    const toggleExpand = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const renderCategoryNode = (node: any, level = 0) => {
        const isSelected = selectedCategory === node.id;
        const isExpanded = expandedCategories.has(node.id);
        const hasChildren = node.children.length > 0;

        return (
            <div key={node.id} className="space-y-1">
                <div className="flex items-center gap-1 group">
                    {hasChildren ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => toggleExpand(node.id)}
                        >
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </Button>
                    ) : (
                        <div className="w-6" />
                    )}
                    <button
                        onClick={() => onCategoryChange(node.id)}
                        className={`flex-1 flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors ${isSelected
                            ? "bg-primary text-primary-foreground font-medium"
                            : "hover:bg-muted text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        <span className="truncate">{node.name}</span>
                        {isSelected && <ChevronRight className="h-3 w-3" />}
                    </button>
                </div>
                {isExpanded && hasChildren && (
                    <div className="pl-4 border-l ml-6 space-y-1">
                        {node.children.map((child: any) => renderCategoryNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-card border rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                    <Filter className="h-4 w-4" />
                    篩選條件
                </div>
                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                    >
                        重設
                    </Button>
                )}
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    {/* Categories */}
                    <div className="space-y-3">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">產品分類</h3>
                        <div className="space-y-1">
                            <button
                                onClick={() => onCategoryChange(null)}
                                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors mb-2 ${selectedCategory === null
                                    ? "bg-primary text-primary-foreground font-medium"
                                    : "hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent"
                                    }`}
                            >
                                <span>全部產品</span>
                                {selectedCategory === null && <ChevronRight className="h-3 w-3" />}
                            </button>
                            {categoryTree.map((node) => renderCategoryNode(node))}
                            {categories.length === 0 && (
                                <p className="text-xs text-muted-foreground italic px-2">尚未建立分類</p>
                            )}
                        </div>
                    </div>

                    <Separator />

                    {/* Dynamic Specs */}
                    <div className="space-y-5">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">進階規格</h3>
                        {Object.entries(availableSpecs).length > 0 ? (
                            Object.entries(availableSpecs).map(([key, values]) => (
                                <div key={key} className="space-y-3">
                                    <h4 className="text-xs font-semibold text-foreground/80">{key}</h4>
                                    <div className="space-y-2">
                                        {values.map((val) => (
                                            <div key={val} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`spec-${key}-${val}`}
                                                    checked={(selectedSpecs[key] || []).includes(val)}
                                                    onCheckedChange={(checked) => {
                                                        const current = selectedSpecs[key] || [];
                                                        if (checked) {
                                                            onSpecChange(key, [...current, val]);
                                                        } else {
                                                            onSpecChange(key, current.filter((v) => v !== val));
                                                        }
                                                    }}
                                                />
                                                <Label
                                                    htmlFor={`spec-${key}-${val}`}
                                                    className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground"
                                                >
                                                    {val}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-4 bg-muted/20 rounded-lg border border-dashed">
                                <p className="text-[10px] text-muted-foreground italic">目前無可用的規格篩選</p>
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
