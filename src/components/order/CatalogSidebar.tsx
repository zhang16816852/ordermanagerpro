import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ProductWithPricing } from "@/types/product";
import { Category } from "@/types/product";
import { ChevronRight, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { deserializeSpecs, formatSpecValue } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { Slider } from "@/components/ui/slider";

// 解析字串中的所有數字
const extractNumbers = (str: string) => {
    const matches = str.match(/\d+(\.\d+)?/g);
    return matches ? matches.map(Number) : [];
};

// 內部區間篩選拉桿組件
function RangeSliderFilter({
    values,
    specKey,
    selectedRange,
    onChange
}: {
    values: string[];
    specKey: string;
    selectedRange?: string; // 格式如 'MIN-MAX'
    onChange: (range: string | null) => void;
}) {
    // 找出所有可能數值的極值
    const allNumbers = values.flatMap(extractNumbers).filter(n => !isNaN(n));
    const minBound = allNumbers.length > 0 ? Math.floor(Math.min(...allNumbers)) : 0;
    const maxBound = allNumbers.length > 0 ? Math.ceil(Math.max(...allNumbers)) : 100;

    // 解析目前設定
    const currentMin = selectedRange ? Number(selectedRange.split('-')[0]) : minBound;
    const currentMax = selectedRange ? Number(selectedRange.split('-')[1]) : maxBound;

    // 如果沒有任何數字，不顯示
    if (allNumbers.length === 0) return <p className="text-xs text-muted-foreground italic">無有效數值可供篩選</p>;

    return (
        <div className="px-2 pb-2 pt-4 space-y-4">
            <Slider
                defaultValue={[minBound, maxBound]}
                value={[currentMin, currentMax]}
                min={minBound}
                max={maxBound}
                step={maxBound - minBound > 100 ? 10 : 1}
                onValueChange={(val) => {
                    onChange(`${val[0]}-${val[1]}`);
                }}
            />
            <div className="flex justify-between items-center text-xs text-muted-foreground font-mono">
                <span>{currentMin}</span>
                <span>{currentMax}</span>
            </div>
            {selectedRange && (
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] text-muted-foreground" onClick={() => onChange(null)}>
                        清除區間
                    </Button>
                </div>
            )}
        </div>
    );
}


interface CatalogSidebarProps {
    products: ProductWithPricing[];
    selectedCategory: string | null; // This will now be category ID
    onCategoryChange: (categoryId: string | null) => void;
    selectedSpecs: Record<string, string[]>;
    onSpecChange: (key: string, values: string[]) => void;
    selectedBrands?: string[];
    onBrandChange?: (brands: string[]) => void;
    onClearFilters: () => void;
}

export function CatalogSidebar({
    products,
    selectedCategory,
    onCategoryChange,
    selectedSpecs,
    onSpecChange,
    selectedBrands = [],
    onBrandChange,
    onClearFilters,
}: CatalogSidebarProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    const { data: categories = [] } = useQuery<Category[]>({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await supabase.from('categories')
                .select('*')
                .order('sort_order', { ascending: true });
            if (error) return [];
            return data as Category[];
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

    const { brands } = useBrands();

    //console.log("分類產品", products)
    const categoryTree = useMemo(() => {
        // Deduplicate hierarchy links
        const seen = new Set<string>();
        const hierarchy = categoryHierarchy.filter((h: any) => {
            const key = `${h.parent_id}-${h.child_id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Find nodes that are NOT children in any hierarchy row (Roots)
        const childIds = new Set(hierarchy.map((h: any) => h.child_id));
        const roots = categories.filter((c: any) => !childIds.has(c.id));

        const build = (nodeId: string): any[] => {
            const childLinks = hierarchy.filter((h: any) => h.parent_id === nodeId);
            return childLinks
                .map((link: any) => {
                    const child = categories.find((c: any) => c.id === link.child_id);
                    if (!child) return null;
                    return {
                        ...child,
                        children: build(child.id)
                    };
                })
                .filter(Boolean);
        };

        return roots.map(root => ({
            ...root,
            children: build(root.id)
        }));
    }, [categories, categoryHierarchy]);

    // Fetch specs for the selected category
    const { data: specFields = [] } = useQuery({
        queryKey: ['category_specs', selectedCategory],
        enabled: !!selectedCategory,
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('category_spec_links' as any) as any)
                .select(`
                    specification_definitions (
                        id,
                        name,
                        type,
                        options,
                        configuration
                    )
                `)
                .eq('category_id', selectedCategory);

            if (error) return [];
            return (data || []).map((d: any) => ({
                id: d.specification_definitions.id,
                name: d.specification_definitions.name,
                type: d.specification_definitions.type,
                options: d.specification_definitions.options,
                configuration: d.specification_definitions.configuration
            }));
        },
    });

    // Extract available specs for the selected category
    const availableSpecs = useMemo(() => {
        const specs: Record<string, Set<string>> = {};

        // Use the fetched spec IDs as the keys for filtering spec_values
        const definedSpecIds = specFields.map(f => f.id);
        const definedSpecNames = specFields.map(f => f.name);
        const selectedCatDetails = categories.find(c => c.id === selectedCategory);

        products.forEach((p) => {
            // 檢查產品是否屬於當前選擇的分類
            const pCategoryIds = p.category_ids || [];
            const pCategoryId = p.category_id;

            if (selectedCategory) {
                const hasMatchInLinks = pCategoryIds.includes(selectedCategory);
                const hasMatchInLegacy = pCategoryId === selectedCategory || p.category_names?.includes(selectedCatDetails?.name || '');

                if (!hasMatchInLinks && !hasMatchInLegacy) return;
            }

            // Scan product spec_values
            const pSettings = deserializeSpecs(p.spec_values);
            Object.entries(pSettings).forEach(([key, value]) => {
                const parts = key.split(':');
                const specId = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[1] : key);

                // key could be ID or Name (for legacy data)
                // We check if it matches either the defined IDs or Names
                if (definedSpecIds.length > 0 && !definedSpecIds.includes(specId) && !definedSpecNames.includes(specId)) return;

                if (!specs[key]) specs[key] = new Set();

                if (value !== null && value !== undefined) {
                    const specDef = specFields.find(f => f.id === specId || f.name === specId);

                    // 1. 讀取 filter_config
                    const filterConfig = (specDef as any)?.configuration?.filter_config;

                    // 2. 如果有明確設定 enabled: false，直接略過
                    if (filterConfig && filterConfig.enabled === false) return;

                    // 3. 如果沒有設定 filter_config，則套用預設的「自動判斷隱藏」邏輯
                    if (!filterConfig) {
                        // 如果找不到規格定義，或是型態為文字/表格，則不顯示於篩選器
                        if (!specDef || specDef.type === 'text' || specDef.type === 'table') return;
                    }

                    specs[key].add(formatSpecValue(value, specDef as any, specFields as any));
                }
            });

            // Scan variant spec_values and core options
            p.variants?.forEach(v => {
                const vSettings = deserializeSpecs(v.spec_values);

                // 1. Scan core options (option_1, option_2, option_3)
                if (v.option_1) {
                    if (!specs['core:option_1']) specs['core:option_1'] = new Set();
                    specs['core:option_1'].add(v.option_1);
                }
                if (v.option_2) {
                    if (!specs['core:option_2']) specs['core:option_2'] = new Set();
                    specs['core:option_2'].add(v.option_2);
                }
                if (v.option_3) {
                    if (!specs['core:option_3']) specs['core:option_3'] = new Set();
                    specs['core:option_3'].add(v.option_3);
                }

                // 2. Scan spec_values
                Object.entries(vSettings).forEach(([key, value]) => {
                    const parts = key.split(':');
                    const specId = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[1] : key);

                    if (definedSpecIds.length > 0 && !definedSpecIds.includes(specId) && !definedSpecNames.includes(specId)) return;

                    if (!specs[key]) specs[key] = new Set();

                    if (value !== null && value !== undefined) {
                        const specDef = specFields.find(f => f.id === specId || f.name === specId);

                        const filterConfig = (specDef as any)?.configuration?.filter_config;
                        if (filterConfig && filterConfig.enabled === false) return;
                        if (!filterConfig) {
                            if (!specDef || specDef.type === 'text' || specDef.type === 'table') return;
                        }

                        specs[key].add(formatSpecValue(value, specDef as any, specFields as any));
                    }
                });
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
    }, [products, selectedCategory, categories, specFields]);

    const hasActiveFilters = selectedCategory !== null || Object.keys(selectedSpecs).length > 0 || selectedBrands.length > 0;

    const toggleExpand = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const renderCategoryNode = (node: any, level = 0, path = "root") => {
        const isSelected = selectedCategory === node.id;
        const isExpanded = expandedCategories.has(node.id);
        const hasChildren = node.children.length > 0;
        const uniqueKey = `${path}-${node.id}`;
        return (
            <div key={uniqueKey} className="space-y-1">
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
                        {node.children.map((child: any) => renderCategoryNode(child, level + 1, node.id))}
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

                    {/* Brands */}
                    {brands.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">品牌</h3>
                            <div className="space-y-2">
                                {brands.map((brand: any) => (
                                    <div key={brand.id} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`brand-${brand.id}`}
                                            checked={selectedBrands.includes(brand.id)}
                                            onCheckedChange={(checked) => {
                                                if (onBrandChange) {
                                                    if (checked) {
                                                        onBrandChange([...selectedBrands, brand.id]);
                                                    } else {
                                                        onBrandChange(selectedBrands.filter((id) => id !== brand.id));
                                                    }
                                                }
                                            }}
                                        />
                                        <Label
                                            htmlFor={`brand-${brand.id}`}
                                            className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground"
                                        >
                                            {brand.name}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <Separator />

                    {/* 進階規格：僅在選擇分類後才顯示 */}
                    {selectedCategory !== null && (
                        <div className="space-y-5">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">進階規格</h3>
                            {Object.entries(availableSpecs).length > 0 ? (
                                Object.entries(availableSpecs).map(([key, values]) => {
                                    // 將 key（ID 或 Name）解析為顯示名稱
                                    const specId = key.includes(':') ? key.split(':').pop()! : key;

                                    // 處理核心選項 (Core Options)
                                    if (key.startsWith('core:')) {
                                        const coreLabelMap: Record<string, string> = {
                                            'option_1': '規格選項 1',
                                            'option_2': '規格選項 2',
                                            'option_3': '顏色'
                                        };
                                        const displayName = coreLabelMap[specId] || specId;
                                        return (
                                            <div key={key} className="space-y-3">
                                                <h4 className="text-xs font-semibold text-foreground/80">{displayName}</h4>
                                                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
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
                                        );
                                    }

                                    const specDef = specFields.find(f => f.id === specId || f.name === specId);

                                    const filterConfig = (specDef as any)?.configuration?.filter_config;
                                    // 如果找不到規格定義，或者明確設定不啟用篩選，則不渲染
                                    if (!specDef || (filterConfig && filterConfig.enabled === false)) return null;

                                    let displayMode = filterConfig?.display_mode || 'auto';

                                    // 處理 auto 或 沒設定時的預設行為
                                    if (displayMode === 'auto') {
                                        if (specDef.type === 'text' || specDef.type === 'table') return null;
                                        // 如果是數值類型且值很多，預設切換為區間
                                        if (specDef.type === 'number_with_unit' && values.length > 5) {
                                            displayMode = 'range';
                                        } else {
                                            displayMode = 'checkbox';
                                        }
                                    }

                                    const displayName = specDef ? specDef.name : key;
                                    return (
                                        <div key={key} className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs font-semibold text-foreground/80">{displayName}</h4>
                                                {displayMode === 'range' && selectedSpecs[key]?.[0] && (
                                                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                                                        {selectedSpecs[key][0]}
                                                    </span>
                                                )}
                                            </div>

                                            {displayMode === 'range' ? (
                                                <RangeSliderFilter
                                                    values={values}
                                                    specKey={key}
                                                    selectedRange={selectedSpecs[key]?.[0]}
                                                    onChange={(range) => {
                                                        if (range) {
                                                            onSpecChange(key, [range]);
                                                        } else {
                                                            onSpecChange(key, []);
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                                    {values
                                                        .filter((val) => {
                                                            if (specDef?.type === "boolean") {
                                                                return val === "true" || val === "支援";
                                                            }
                                                            return true;
                                                        })
                                                        .map((val) => {
                                                            const displayVal = val;

                                                            return (
                                                                <div key={val} className="flex items-center space-x-2">
                                                                    <Checkbox
                                                                        id={`spec-${key}-${val}`}
                                                                        checked={(selectedSpecs[key] || []).includes(val)}
                                                                        onCheckedChange={(checked) => {
                                                                            const current = selectedSpecs[key] || [];
                                                                            // 清除區間設定的格式以防萬一
                                                                            const cleanedCurrent = current.filter(c => !c.includes('-'));
                                                                            if (checked) {
                                                                                onSpecChange(key, [...cleanedCurrent, val]);
                                                                            } else {
                                                                                onSpecChange(key, cleanedCurrent.filter((v) => v !== val));
                                                                            }
                                                                        }}
                                                                    />
                                                                    <Label
                                                                        htmlFor={`spec-${key}-${val}`}
                                                                        className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground"
                                                                    >
                                                                        {displayVal}
                                                                    </Label>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center py-4 bg-muted/20 rounded-lg border border-dashed">
                                    <p className="text-[10px] text-muted-foreground italic">目前此分類無可用的規格篩選</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
