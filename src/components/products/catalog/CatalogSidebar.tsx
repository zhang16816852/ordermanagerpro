import { useMemo, useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProductWithPricing } from "@/types/product";
import { Category } from "@/types/product";
import { ChevronRight, Filter, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { deserializeSpecs, formatSpecValue } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { useCategorySpecs } from "@/hooks/useCategorySpecs";
import { useSpecStore } from "@/store/useSpecStore";
import { AdvancedSpecFilters } from "@/components/products/catalog/AdvancedSpecFilters";

function getFilterConfig(specDef: any) {
    if (!specDef || !specDef.configuration) return undefined;
    const config = Array.isArray(specDef.configuration)
        ? specDef.configuration[0]
        : specDef.configuration;
    return config?.filter_config;
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
    const [activeSection, setActiveSection] = useState<string>('categories');

    const toggleSection = (section: string) => {
        setActiveSection(prev => prev === section ? '' : section);
    };

    const { brands } = useBrands();
    const { fetchSpecs, specDefinitions, categoryLinks, categories, categoryHierarchy } = useSpecStore();

    useEffect(() => {
        if (specDefinitions.length === 0 || categoryLinks.length === 0) {
            fetchSpecs();
        }
    }, [fetchSpecs, specDefinitions.length, categoryLinks.length]);

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

    // Fetch specs for the selected category from store/cache
    const { data: specFields = [] } = useCategorySpecs(selectedCategory ? [selectedCategory] : []);

    // 根據選中分類，從產品資料中提取可用的規格篩選項
    const availableSpecs = useMemo(() => {
        const specs: Record<string, Set<string>> = {};

        // 步驟一：計算選中分類及其所有子分類的 ID 集合（包含自己）
        const subCategoryIds = new Set<string>();
        if (selectedCategory) {
            subCategoryIds.add(selectedCategory);
            const queue = [selectedCategory];
            while (queue.length > 0) {
                const parentId = queue.shift();
                categoryHierarchy
                    .filter((h: any) => h.parent_id === parentId)
                    .forEach((h: any) => {
                        const childId = h.child_id;
                        if (!subCategoryIds.has(childId)) {
                            subCategoryIds.add(childId);
                            queue.push(childId);
                        }
                    });
            }
        }

        /* console.group('🔍 [CatalogSidebar] availableSpecs 計算');
         console.log('📂 選中分類 ID:', selectedCategory);
         console.log('📂 子分類 IDs:', Array.from(subCategoryIds));
         console.log('📋 分類規格定義 (specFields):', specFields.map(f => ({ id: f.id, name: f.name, type: f.type })));
 */
        // 從 specFields 取出可用的規格 ID 與名稱，用於過濾產品的 spec_values
        const definedSpecIds = specFields.map(f => f.id);
        let matchedProductCount = 0;

        products.forEach((p) => {
            // 步驟二：檢查產品是否屬於當前選擇的分類或其子分類
            const pCategoryIds = p.category_ids || [];

            if (selectedCategory) {
                const hasMatchInLinks = pCategoryIds.some((id: string) => subCategoryIds.has(id));
                if (!hasMatchInLinks) return;
            }

            matchedProductCount++;

            // 步驟三：掃描產品層級的 spec_values
            // spec_values 在快取中已是 {pathKey: value} 格式，直接遍歷即可（不需 deserializeSpecs）
            const pSpecValues: Record<string, any> = p.spec_values && typeof p.spec_values === 'object' && !Array.isArray(p.spec_values)
                ? p.spec_values
                : {};
            // console.log(`  📦 產品 "${p.name}"，spec_values:`, pSpecValues, '(筆數:', Object.keys(pSpecValues).length, ')');

            Object.entries(pSpecValues).forEach(([key, value]) => {
                const parts = key.split(':');
                // key 格式為 parentId:specId:instanceUuid，取第二段作為 specId
                const specId = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[1] : key);

                // 若分類已設定規格定義，則只保留對應的規格（支援 ID 匹配）
                if (definedSpecIds.length > 0 && !definedSpecIds.includes(specId)) {
                    // console.log(`    ⛔ key="${key}" specId="${specId}" 不在 definedSpecIds 中，略過`);
                    return;
                }

                if (!specs[key]) specs[key] = new Set();

                if (value !== null && value !== undefined) {
                    const specDef = specFields.find(f => f.id === specId || f.name === specId);

                    // heading / text / table 類型不適合做篩選，直接跳過
                    if (specDef && (specDef.type === 'heading' || specDef.type === 'text' || specDef.type === 'table')) {
                        // console.log(`    ⛔ key="${key}" type="${specDef.type}" 不適合篩選，略過`);
                        return;
                    }

                    // 讀取 filter_config（相容 array 與 object 兩種 DB 格式）
                    const filterConfig = getFilterConfig(specDef);

                    // 只有明確設定 enabled: false 時才排除，未設定視為允許
                    if (filterConfig && filterConfig.enabled === false) {
                        // console.log(`    ⛔ key="${key}" filter_config.enabled=false，略過`);
                        return;
                    }

                    const formatted = formatSpecValue(value, specDef as any, specFields as any);
                    // console.log(`    ✅ key="${key}" specId="${specId}" value=${JSON.stringify(value)} → 格式化: "${formatted}"`);
                    specs[key].add(formatted);
                }
            });

            // 步驟四：掃描變體的 core options 與 spec_values
            p.variants?.forEach(v => {
                const vSettings = deserializeSpecs(v.spec_values);

                // 4-1. 收集核心規格選項 (option_1 / option_2 / option_3)
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

                // 4-2. 掃描變體的 spec_values（同樣已是 {pathKey: value} 格式）
                const vSpecValues: Record<string, any> = v.spec_values && typeof v.spec_values === 'object' && !Array.isArray(v.spec_values)
                    ? v.spec_values
                    : {};
                Object.entries(vSpecValues).forEach(([key, value]) => {
                    const parts = key.split(':');
                    const specId = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[1] : key);

                    if (definedSpecIds.length > 0 && !definedSpecIds.includes(specId)) return;

                    if (!specs[key]) specs[key] = new Set();

                    if (value !== null && value !== undefined) {
                        const specDef = specFields.find(f => f.id === specId || f.name === specId);

                        // heading / text / table 類型不適合做篩選
                        if (specDef && (specDef.type === 'heading' || specDef.type === 'text' || specDef.type === 'table')) return;

                        const filterConfig = getFilterConfig(specDef);
                        // 只有明確設定 enabled: false 時才跳過
                        if (filterConfig && filterConfig.enabled === false) return;

                        specs[key].add(formatSpecValue(value, specDef as any, specFields as any));
                    }
                });
            });
        });

        // console.log(`📦 符合分類的產品數: ${matchedProductCount} / ${products.length}`);

        // 步驟五：將 Set 轉為排序後的陣列
        const result: Record<string, string[]> = {};
        Object.entries(specs).forEach(([key, values]) => {
            if (values.size > 0) {
                result[key] = Array.from(values).sort();
            }
        });

        // console.log('🎯 最終 availableSpecs:', result);
        console.groupEnd();
        return result;
    }, [products, selectedCategory, categories, specFields, categoryHierarchy]);

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
                <div className="p-4 space-y-4">
                    {/* Categories */}
                    <div className="border-b pb-3">
                        <button
                            onClick={() => toggleSection('categories')}
                            className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
                        >
                            <span>產品分類</span>
                            {activeSection === 'categories' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                        {activeSection === 'categories' && (
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
                        )}
                    </div>

                    {/* Brands */}
                    {brands.length > 0 && (
                        <div className="border-b pb-3">
                            <button
                                onClick={() => toggleSection('brands')}
                                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
                            >
                                <span>品牌</span>
                                {activeSection === 'brands' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </button>
                            {activeSection === 'brands' && (
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
                            )}
                        </div>
                    )}

                    {/* 進階規格：僅在選擇分類後才顯示 */}
                    {selectedCategory !== null && (
                        <div>
                            <button
                                onClick={() => toggleSection('specs')}
                                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
                            >
                                <span>進階規格</span>
                                {activeSection === 'specs' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </button>
                            {activeSection === 'specs' && (
                                <AdvancedSpecFilters 
                                    availableSpecs={availableSpecs}
                                    specFields={specFields}
                                    selectedSpecs={selectedSpecs}
                                    onSpecChange={onSpecChange}
                                />
                            )}
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
