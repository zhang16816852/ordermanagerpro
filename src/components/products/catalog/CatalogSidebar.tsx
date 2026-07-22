import { useMemo, useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProductWithPricing } from "@/types/product";
import { Category } from "@/types/product";
import { ChevronRight, Filter, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deserializeSpecs, formatSpecValue } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { useCategorySpecs } from "@/hooks/useCategorySpecs";
import { useSpecStore } from "@/store/useSpecStore";
import { useBrandSeriesCache } from "@/hooks/useBrandSeriesCache";
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
    selectedCategory: string | null;
    onCategoryChange: (categoryId: string | null) => void;
    selectedSpecs: Record<string, string[]>;
    onSpecChange: (key: string, values: string[]) => void;
    selectedBrands?: string[];
    onBrandChange?: (brands: string[]) => void;
    selectedSeries?: string[];
    onSeriesChange?: (series: string[]) => void;
    selectedDeviceModels?: string[];
    onDeviceModelChange?: (models: string[]) => void;
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
    selectedSeries = [],
    onSeriesChange,
    selectedDeviceModels = [],
    onDeviceModelChange,
    onClearFilters,
}: CatalogSidebarProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [activeSection, setActiveSection] = useState<string>('categories');
    const [modelSearch, setModelSearch] = useState('');

    const toggleSection = (section: string) => {
        setActiveSection(prev => prev === section ? '' : section);
    };

    const { brands } = useBrands();
    const { fetchSpecs, specDefinitions, categoryLinks, categories, categoryHierarchy } = useSpecStore();
    const { allSeries } = useBrandSeriesCache();

    useEffect(() => {
        if (specDefinitions.length === 0 || categoryLinks.length === 0) {
            fetchSpecs();
        }
    }, [fetchSpecs, specDefinitions.length, categoryLinks.length]);

    // Filter series by selected brands and active status
    const filteredSeries = useMemo(() => {
        if (selectedBrands.length === 0) return [];
        return allSeries.filter(s => s.is_active && selectedBrands.includes(s.brand_id));
    }, [allSeries, selectedBrands]);

    // Count products per series (from brand_series_ids on each product)
    const seriesCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        products.forEach(p => {
            (p as any).brand_series_ids?.forEach((sid: string) => {
                counts[sid] = (counts[sid] || 0) + 1;
            });
        });
        return counts;
    }, [products]);

    // Collect available device_models from products (effective_model_names + variant models)
    const { deviceModelCounts, filteredDeviceModels } = useMemo(() => {
        const counts: Record<string, number> = {};
        products.forEach(p => {
            const models = (p as any).effective_model_names || [];
            models.forEach((m: string) => {
                if (m) counts[m] = (counts[m] || 0) + 1;
            });
            (p as any).variants?.forEach((v: any) => {
                (v.effective_model_names || []).forEach((m: string) => {
                    if (m) counts[m] = (counts[m] || 0) + 1;
                });
            });
        });
        const sorted = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));
        const searchLower = modelSearch.toLowerCase();
        const filtered = searchLower
            ? sorted.filter(m => m.name.toLowerCase().includes(searchLower))
            : sorted;
        return { deviceModelCounts: counts, filteredDeviceModels: filtered };
    }, [products, modelSearch]);

    const categoryTree = useMemo(() => {
        const seen = new Set<string>();
        const hierarchy = categoryHierarchy.filter((h: any) => {
            const key = `${h.parent_id}-${h.child_id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const childIds = new Set(hierarchy.map((h: any) => h.child_id));
        const roots = categories.filter((c: any) => !childIds.has(c.id));
        const build = (nodeId: string): any[] => {
            const childLinks = hierarchy.filter((h: any) => h.parent_id === nodeId);
            return childLinks
                .map((link: any) => {
                    const child = categories.find((c: any) => c.id === link.child_id);
                    if (!child) return null;
                    return { ...child, children: build(child.id) };
                })
                .filter(Boolean);
        };
        return roots.map(root => ({ ...root, children: build(root.id) }));
    }, [categories, categoryHierarchy]);

    const { data: specFields = [] } = useCategorySpecs(selectedCategory ? [selectedCategory] : []);

    const availableSpecs = useMemo(() => {
        const specs: Record<string, Set<string>> = {};
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
        const definedSpecIds = specFields.map(f => f.id);

        products.forEach((p) => {
            const pCategoryIds = p.category_ids || [];
            if (selectedCategory) {
                const hasMatchInLinks = pCategoryIds.some((id: string) => subCategoryIds.has(id));
                if (!hasMatchInLinks) return;
            }
            const pSpecValues: Record<string, any> = p.spec_values && typeof p.spec_values === 'object' && !Array.isArray(p.spec_values)
                ? p.spec_values
                : {};
            Object.entries(pSpecValues).forEach(([key, value]) => {
                const parts = key.split(':');
                const specId = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[1] : key);
                if (definedSpecIds.length > 0 && !definedSpecIds.includes(specId)) return;
                if (!specs[key]) specs[key] = new Set();
                if (value !== null && value !== undefined) {
                    const specDef = specFields.find(f => f.id === specId || f.name === specId);
                    if (specDef && (specDef.type === 'heading' || specDef.type === 'text' || specDef.type === 'table')) return;
                    const filterConfig = getFilterConfig(specDef);
                    if (filterConfig && filterConfig.enabled === false) return;
                    specs[key].add(formatSpecValue(value, specDef as any, specFields as any));
                }
            });
            p.variants?.forEach(v => {
                const vSettings = deserializeSpecs(v.spec_values);
                if (v.option_1) { if (!specs['core:option_1']) specs['core:option_1'] = new Set(); specs['core:option_1'].add(v.option_1); }
                if (v.option_2) { if (!specs['core:option_2']) specs['core:option_2'] = new Set(); specs['core:option_2'].add(v.option_2); }
                if (v.option_3) { if (!specs['core:option_3']) specs['core:option_3'] = new Set(); specs['core:option_3'].add(v.option_3); }
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
                        if (specDef && (specDef.type === 'heading' || specDef.type === 'text' || specDef.type === 'table')) return;
                        const filterConfig = getFilterConfig(specDef);
                        if (filterConfig && filterConfig.enabled === false) return;
                        specs[key].add(formatSpecValue(value, specDef as any, specFields as any));
                    }
                });
            });
        });
        const result: Record<string, string[]> = {};
        Object.entries(specs).forEach(([key, values]) => {
            if (values.size > 0) result[key] = Array.from(values).sort();
        });
        return result;
    }, [products, selectedCategory, categories, specFields, categoryHierarchy]);

    const hasActiveFilters = selectedCategory !== null
        || Object.keys(selectedSpecs).length > 0
        || selectedBrands.length > 0
        || selectedSeries.length > 0
        || selectedDeviceModels.length > 0;

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
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => toggleExpand(node.id)}>
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
                    <Button variant="ghost" size="sm" onClick={onClearFilters}
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive">
                        重設
                    </Button>
                )}
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                    {/* Categories */}
                    <div className="border-b pb-3">
                        <button onClick={() => toggleSection('categories')}
                            className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
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
                            <button onClick={() => toggleSection('brands')}
                                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
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
                                            <Label htmlFor={`brand-${brand.id}`}
                                                className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground">
                                                {brand.name}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Series — only show when brands are selected */}
                    {selectedBrands.length > 0 && filteredSeries.length > 0 && (
                        <div className="border-b pb-3">
                            <button onClick={() => toggleSection('series')}
                                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
                                <span className="flex items-center gap-1.5">
                                    系列
                                    {selectedSeries.length > 0 && (
                                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{selectedSeries.length}</Badge>
                                    )}
                                </span>
                                {activeSection === 'series' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </button>
                            {activeSection === 'series' && (
                                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                    {filteredSeries.map((s: any) => (
                                        <div key={s.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`series-${s.id}`}
                                                checked={selectedSeries.includes(s.id)}
                                                onCheckedChange={(checked) => {
                                                    if (onSeriesChange) {
                                                        if (checked) {
                                                            onSeriesChange([...selectedSeries, s.id]);
                                                        } else {
                                                            onSeriesChange(selectedSeries.filter((id) => id !== s.id));
                                                        }
                                                    }
                                                }}
                                            />
                                            <Label htmlFor={`series-${s.id}`}
                                                className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate">
                                                {s.name}
                                            </Label>
                                            {seriesCounts[s.id] !== undefined && (
                                                <span className="text-[10px] text-muted-foreground tabular-nums">{seriesCounts[s.id]}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Device Models */}
                    {filteredDeviceModels.length > 0 && (
                        <div className="border-b pb-3">
                            <button onClick={() => toggleSection('deviceModels')}
                                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
                                <span className="flex items-center gap-1.5">
                                    裝置型號
                                    {selectedDeviceModels.length > 0 && (
                                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{selectedDeviceModels.length}</Badge>
                                    )}
                                </span>
                                {activeSection === 'deviceModels' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </button>
                            {activeSection === 'deviceModels' && (
                                <div className="space-y-2">
                                    <div className="relative">
                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                        <Input
                                            value={modelSearch}
                                            onChange={(e) => setModelSearch(e.target.value)}
                                            placeholder="搜尋型號..."
                                            className="h-7 text-xs pl-6"
                                        />
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto space-y-2">
                                        {filteredDeviceModels.map(({ name, count }) => (
                                            <div key={name} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`model-${name}`}
                                                    checked={selectedDeviceModels.includes(name)}
                                                    onCheckedChange={(checked) => {
                                                        if (onDeviceModelChange) {
                                                            if (checked) {
                                                                console.log('Adding model:', selectedDeviceModels);
                                                                onDeviceModelChange([...selectedDeviceModels, name]);
                                                            } else {
                                                                onDeviceModelChange(selectedDeviceModels.filter((n) => n !== name));
                                                            }
                                                        }
                                                    }}
                                                />
                                                <Label htmlFor={`model-${name}`}
                                                    className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate">
                                                    {name}
                                                </Label>
                                                <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Advanced Specs — only when category selected */}
                    {selectedCategory !== null && (
                        <div>
                            <button onClick={() => toggleSection('specs')}
                                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
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
