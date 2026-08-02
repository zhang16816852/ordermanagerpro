import { useMemo, useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ProductWithPricing } from "@/types/product";
import {
    ChevronRight, ChevronDown, Filter, Search,
    FolderOpen, Tag, Smartphone, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deserializeSpecs, formatSpecValue } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { useCategorySpecs } from "@/hooks/useCategorySpecs";
import { useSpecStore } from "@/store/useSpecStore";
import { useBrandSeriesCache } from "@/hooks/useBrandSeriesCache";
import { useDeviceModelStore } from "@/store/useDeviceModelStore";
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

function SectionHeader({
    label,
    isOpen,
    count,
    selectedCount,
    icon: Icon,
}: {
    label: string;
    isOpen: boolean;
    count?: number;
    selectedCount?: number;
    icon: React.ElementType;
}) {
    return (
        <CollapsibleTrigger asChild>
            <button
                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group py-1"
            >
                <span className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 opacity-60" />
                    {label}
                    {selectedCount !== undefined && selectedCount > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{selectedCount}</Badge>
                    )}
                    {count !== undefined && !isOpen && (
                        <span className="text-[10px] font-normal text-muted-foreground/60 tabular-nums">{count}</span>
                    )}
                </span>
                <ChevronDown
                    className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200 text-muted-foreground/50 group-hover:text-foreground",
                        isOpen && "rotate-180"
                    )}
                />
            </button>
        </CollapsibleTrigger>
    );
}

function SectionSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <div className="space-y-2.5 py-1">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className={cn("h-3.5 rounded", i % 2 === 0 ? "w-20" : "w-16")} />
                </div>
            ))}
        </div>
    );
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
    return (
        <div className="flex flex-col items-center gap-1.5 py-4 text-muted-foreground/50">
            <Icon className="h-5 w-5" />
            <p className="text-[11px] italic">{text}</p>
        </div>
    );
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
    const [openSections, setOpenSections] = useState<Set<string>>(new Set(['categories']));
    const [modelSearch, setModelSearch] = useState('');
    const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
    const [expandedDeviceBrands, setExpandedDeviceBrands] = useState<Set<string>>(new Set());
    const [expandedDeviceSeries, setExpandedDeviceSeries] = useState<Set<string>>(new Set());

    const toggleSection = (section: string) => {
        setOpenSections(prev => {
            const next = new Set(prev);
            if (next.has(section)) next.delete(section);
            else next.add(section);
            return next;
        });
    };

    const { brands, isLoading: brandsLoading } = useBrands();
    const { fetchSpecs, specDefinitions, categoryLinks, categories, categoryHierarchy, isLoading: specsLoading } = useSpecStore();
    const { allSeries } = useBrandSeriesCache();
    const { models: deviceModels, brands: deviceBrands } = useDeviceModelStore();

    useEffect(() => {
        if (specDefinitions.length === 0 || categoryLinks.length === 0) {
            fetchSpecs();
        }
    }, [fetchSpecs, specDefinitions.length, categoryLinks.length]);

    const filteredSeries = useMemo(() => {
        if (selectedBrands.length === 0) return [];
        return allSeries.filter(s => s.is_active && selectedBrands.includes(s.brand_id));
    }, [allSeries, selectedBrands]);

    const seriesByBrand = useMemo(() => {
        const map: Record<string, typeof allSeries> = {};
        allSeries.forEach(s => {
            if (!s.is_active) return;
            if (!map[s.brand_id]) map[s.brand_id] = [];
            map[s.brand_id].push(s);
        });
        return map;
    }, [allSeries]);

    const seriesCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        products.forEach(p => {
            (p as any).brand_series_ids?.forEach((sid: string) => {
                counts[sid] = (counts[sid] || 0) + 1;
            });
        });
        return counts;
    }, [products]);

    const deviceModelLookup = useMemo(() => {
        const map: Record<string, { brand_id: string | null; device_series: string | null }> = {};
        deviceModels.forEach((m: any) => {
            map[m.name] = { brand_id: m.brand_id, device_series: m.device_series };
            (m.aliases || []).forEach((a: string) => {
                map[a] = { brand_id: m.brand_id, device_series: m.device_series };
            });
        });
        return map;
    }, [deviceModels]);

    const deviceModelTree = useMemo(() => {
        const modelCounts: Record<string, number> = {};
        products.forEach(p => {
            const models = (p as any).effective_model_names || [];
            models.forEach((m: string) => {
                if (m) modelCounts[m] = (modelCounts[m] || 0) + 1;
            });
            (p as any).variants?.forEach((v: any) => {
                (v.effective_model_names || []).forEach((m: string) => {
                    if (m) modelCounts[m] = (modelCounts[m] || 0) + 1;
                });
            });
        });

        const searchLower = modelSearch.toLowerCase();
        const tree: Record<string, Record<string, { name: string; count: number }[]>> = {};

        Object.entries(modelCounts).forEach(([name, count]) => {
            if (searchLower && !name.toLowerCase().includes(searchLower)) return;
            const lookup = deviceModelLookup[name];
            const brandId = lookup?.brand_id || '__unassigned__';
            const series = lookup?.device_series || '__unassigned__';
            if (!tree[brandId]) tree[brandId] = {};
            if (!tree[brandId][series]) tree[brandId][series] = [];
            tree[brandId][series].push({ name, count });
        });

        Object.values(tree).forEach(seriesMap => {
            Object.keys(seriesMap).forEach(series => {
                seriesMap[series].sort((a, b) => b.count - a.count);
            });
        });

        return tree;
    }, [products, modelSearch, deviceModelLookup]);

    useEffect(() => {
        if (modelSearch) {
            const brands = new Set<string>();
            const series = new Set<string>();
            Object.entries(deviceModelTree).forEach(([brandId, seriesMap]) => {
                brands.add(brandId);
                Object.keys(seriesMap).forEach(s => series.add(`${brandId}:${s}`));
            });
            setExpandedDeviceBrands(brands);
            setExpandedDeviceSeries(series);
        } else {
            setExpandedDeviceBrands(new Set());
            setExpandedDeviceSeries(new Set());
        }
    }, [modelSearch, deviceModelTree]);

    const totalDeviceModelCount = useMemo(() => {
        let total = 0;
        Object.values(deviceModelTree).forEach(seriesMap => {
            Object.values(seriesMap).forEach(models => { total += models.length; });
        });
        return total;
    }, [deviceModelTree]);

    const deviceBrandNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        deviceBrands.forEach((b: any) => { map[b.id] = b.name; });
        return map;
    }, [deviceBrands]);

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
                v.option_values?.forEach(ov => {
                    const group = p.option_groups?.find((og: any) => og.id === ov.group_id);
                    const groupName = group?.name || ov.group_id;
                    const key = `core:${groupName}`;
                    if (!specs[key]) specs[key] = new Set();
                    specs[key].add(ov.label || ov.value);
                });
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

    const toggleBrandExpand = (brandId: string) => {
        setExpandedBrands(prev => {
            const next = new Set(prev);
            if (next.has(brandId)) next.delete(brandId);
            else next.add(brandId);
            return next;
        });
    };

    const toggleDeviceBrandExpand = (brandId: string) => {
        setExpandedDeviceBrands(prev => {
            const next = new Set(prev);
            if (next.has(brandId)) next.delete(brandId);
            else next.add(brandId);
            return next;
        });
    };

    const toggleDeviceSeriesExpand = (key: string) => {
        setExpandedDeviceSeries(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
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
                            <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", !isExpanded && "-rotate-90")} />
                        </Button>
                    ) : (
                        <div className="w-6" />
                    )}
                    <button
                        onClick={() => onCategoryChange(node.id)}
                        className={cn(
                            "flex-1 flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors",
                            isSelected
                                ? "bg-primary text-primary-foreground font-medium"
                                : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                        )}
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
                <div className="flex items-center gap-2 font-semibold text-sm">
                    <Filter className="h-4 w-4" />
                    篩選條件
                </div>
                {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={onClearFilters}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive transition-colors">
                        重設
                    </Button>
                )}
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-1">
                    {/* Categories */}
                    <Collapsible open={openSections.has('categories')} onOpenChange={() => toggleSection('categories')}>
                        <div className="pb-2">
                            <SectionHeader
                                label="產品分類"
                                isOpen={openSections.has('categories')}
                                icon={FolderOpen}
                            />
                        </div>
                        <CollapsibleContent>
                            {specsLoading && categories.length === 0 ? (
                                <SectionSkeleton rows={5} />
                            ) : (
                                <div className="space-y-1 pb-3">
                                    <button
                                        onClick={() => onCategoryChange(null)}
                                        className={cn(
                                            "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors mb-1",
                                            selectedCategory === null
                                                ? "bg-primary text-primary-foreground font-medium"
                                                : "hover:bg-muted/60 text-muted-foreground hover:text-foreground border border-transparent"
                                        )}
                                    >
                                        <span>全部產品</span>
                                        {selectedCategory === null && <ChevronRight className="h-3 w-3" />}
                                    </button>
                                    {categoryTree.map((node) => renderCategoryNode(node))}
                                    {categories.length === 0 && (
                                        <EmptyState icon={FolderOpen} text="尚未建立分類" />
                                    )}
                                </div>
                            )}
                        </CollapsibleContent>
                        <Separator />
                    </Collapsible>

                    {/* Brands + Series Tree */}
                    <Collapsible open={openSections.has('brands')} onOpenChange={() => toggleSection('brands')}>
                        <div className="py-2">
                            <SectionHeader
                                label="品牌 / 系列"
                                isOpen={openSections.has('brands')}
                                count={brands.length}
                                selectedCount={selectedBrands.length + selectedSeries.length}
                                icon={Tag}
                            />
                        </div>
                        <CollapsibleContent>
                            {brandsLoading ? (
                                <SectionSkeleton rows={4} />
                            ) : brands.length === 0 ? (
                                <EmptyState icon={Tag} text="尚未建立品牌" />
                            ) : (
                                <div className="pb-3 max-h-[300px] overflow-y-auto space-y-0.5">
                                    {brands.map((brand: any) => {
                                        const brandSeries = seriesByBrand[brand.id] || [];
                                        const hasSeries = brandSeries.length > 0;
                                        const isExpanded = expandedBrands.has(brand.id);
                                        return (
                                            <div key={brand.id}>
                                                <div className={cn(
                                                    "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                    selectedBrands.includes(brand.id) ? "bg-primary/5" : "hover:bg-muted/50"
                                                )}>
                                                    {hasSeries ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-5 w-5 shrink-0"
                                                            onClick={() => toggleBrandExpand(brand.id)}
                                                        >
                                                            <ChevronDown className={cn(
                                                                "h-3 w-3 transition-transform duration-200",
                                                                !isExpanded && "-rotate-90"
                                                            )} />
                                                        </Button>
                                                    ) : (
                                                        <div className="w-5" />
                                                    )}
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
                                                        className="text-sm font-medium cursor-pointer flex-1 py-0.5 text-foreground transition-colors">
                                                        {brand.name}
                                                    </Label>
                                                    {hasSeries && (
                                                        <span className="text-[10px] text-muted-foreground/60 tabular-nums mr-1">
                                                            {brandSeries.length}
                                                        </span>
                                                    )}
                                                </div>
                                                {hasSeries && isExpanded && (
                                                    <div className="pl-5 ml-2.5 border-l space-y-0.5">
                                                        {brandSeries.map((s: any) => (
                                                            <div key={s.id} className={cn(
                                                                "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                                selectedSeries.includes(s.id) ? "bg-primary/5" : "hover:bg-muted/50"
                                                            )}>
                                                                <div className="w-5" />
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
                                                                    className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
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
                                        );
                                    })}
                                </div>
                            )}
                        </CollapsibleContent>
                        <Separator />
                    </Collapsible>

                    {/* Device Models Tree */}
                    {(totalDeviceModelCount > 0 || modelSearch) && (
                        <Collapsible open={openSections.has('deviceModels')} onOpenChange={() => toggleSection('deviceModels')}>
                            <div className="py-2">
                                <SectionHeader
                                    label="裝置型號"
                                    isOpen={openSections.has('deviceModels')}
                                    count={totalDeviceModelCount}
                                    selectedCount={selectedDeviceModels.length}
                                    icon={Smartphone}
                                />
                            </div>
                            <CollapsibleContent>
                                <div className="space-y-1 pb-3">
                                    <div className="relative mb-1">
                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                        <Input
                                            value={modelSearch}
                                            onChange={(e) => setModelSearch(e.target.value)}
                                            placeholder="搜尋型號..."
                                            className="h-7 text-xs pl-6"
                                        />
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                                        {Object.keys(deviceModelTree).length === 0 && modelSearch && (
                                            <EmptyState icon={Smartphone} text="找不到符合的型號" />
                                        )}
                                        {Object.entries(deviceModelTree)
                                            .sort(([a], [b]) => {
                                                if (a === '__unassigned__') return 1;
                                                if (b === '__unassigned__') return -1;
                                                return (deviceBrandNameMap[a] || a).localeCompare(deviceBrandNameMap[b] || b);
                                            })
                                            .map(([brandId, seriesMap]) => {
                                                const brandLabel = brandId === '__unassigned__'
                                                    ? '其他'
                                                    : (deviceBrandNameMap[brandId] || brandId);
                                                const brandModelCount = Object.values(seriesMap).reduce((sum, arr) => sum + arr.length, 0);
                                                const isBrandExpanded = expandedDeviceBrands.has(brandId);
                                                const seriesEntries = Object.entries(seriesMap).sort(([a], [b]) => {
                                                    if (a === '__unassigned__') return 1;
                                                    if (b === '__unassigned__') return -1;
                                                    return a.localeCompare(b);
                                                });
                                                const hasSingleUnnamedSeries = seriesEntries.length === 1 && seriesEntries[0][0] === '__unassigned__';

                                                if (hasSingleUnnamedSeries) {
                                                    return (
                                                        <div key={brandId}>
                                                            {brandId !== '__unassigned__' && (
                                                                <div className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors">
                                                                    <div className="w-5" />
                                                                    <Smartphone className="h-3 w-3 mr-1.5 text-muted-foreground/60" />
                                                                    <span className="text-xs font-medium text-foreground">{brandLabel}</span>
                                                                    <span className="text-[10px] text-muted-foreground/60 tabular-nums ml-auto mr-1">{brandModelCount}</span>
                                                                </div>
                                                            )}
                                                            <div className={brandId !== '__unassigned__' ? "pl-5 ml-2.5 border-l" : ""}>
                                                                {seriesEntries[0][1].map(({ name, count }) => (
                                                                    <div key={name} className={cn(
                                                                        "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                                        selectedDeviceModels.includes(name) ? "bg-primary/5" : "hover:bg-muted/50"
                                                                    )}>
                                                                        <div className="w-5" />
                                                                        <Checkbox
                                                                            id={`model-${name}`}
                                                                            checked={selectedDeviceModels.includes(name)}
                                                                            onCheckedChange={(checked) => {
                                                                                if (onDeviceModelChange) {
                                                                                    if (checked) {
                                                                                        onDeviceModelChange([...selectedDeviceModels, name]);
                                                                                    } else {
                                                                                        onDeviceModelChange(selectedDeviceModels.filter((n) => n !== name));
                                                                                    }
                                                                                }
                                                                            }}
                                                                        />
                                                                        <Label htmlFor={`model-${name}`}
                                                                            className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                                            {name}
                                                                        </Label>
                                                                        <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div key={brandId}>
                                                        <div
                                                            className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors cursor-pointer"
                                                            onClick={() => toggleDeviceBrandExpand(brandId)}
                                                        >
                                                            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                                                                <ChevronDown className={cn(
                                                                    "h-3 w-3 transition-transform duration-200",
                                                                    !isBrandExpanded && "-rotate-90"
                                                                )} />
                                                            </Button>
                                                            <Smartphone className="h-3 w-3 mr-1.5 text-muted-foreground/60" />
                                                            <span className="text-xs font-medium text-foreground flex-1">{brandLabel}</span>
                                                            <span className="text-[10px] text-muted-foreground/60 tabular-nums mr-1">{brandModelCount}</span>
                                                        </div>
                                                        {isBrandExpanded && (
                                                            <div className="pl-5 ml-2.5 border-l space-y-0.5">
                                                                {seriesEntries.map(([seriesKey, models]) => {
                                                                    const seriesLabel = seriesKey === '__unassigned__' ? '未分類系列' : seriesKey;
                                                                    const seriesKeyFull = `${brandId}:${seriesKey}`;
                                                                    const isSeriesExpanded = expandedDeviceSeries.has(seriesKeyFull);

                                                                    if (models.length === 1) {
                                                                        const model = models[0];
                                                                        return (
                                                                            <div key={seriesKeyFull} className={cn(
                                                                                "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                                                selectedDeviceModels.includes(model.name) ? "bg-primary/5" : "hover:bg-muted/50"
                                                                            )}>
                                                                                <div className="w-5" />
                                                                                <Checkbox
                                                                                    id={`model-${model.name}`}
                                                                                    checked={selectedDeviceModels.includes(model.name)}
                                                                                    onCheckedChange={(checked) => {
                                                                                        if (onDeviceModelChange) {
                                                                                            if (checked) {
                                                                                                onDeviceModelChange([...selectedDeviceModels, model.name]);
                                                                                            } else {
                                                                                                onDeviceModelChange(selectedDeviceModels.filter((n) => n !== model.name));
                                                                                            }
                                                                                        }
                                                                                    }}
                                                                                />
                                                                                <Label htmlFor={`model-${model.name}`}
                                                                                    className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                                                    {model.name}
                                                                                </Label>
                                                                                <span className="text-[10px] text-muted-foreground tabular-nums">{model.count}</span>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    return (
                                                                        <div key={seriesKeyFull}>
                                                                            <div
                                                                                className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors cursor-pointer"
                                                                                onClick={() => toggleDeviceSeriesExpand(seriesKeyFull)}
                                                                            >
                                                                                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                                                                                    <ChevronDown className={cn(
                                                                                        "h-3 w-3 transition-transform duration-200",
                                                                                        !isSeriesExpanded && "-rotate-90"
                                                                                    )} />
                                                                                </Button>
                                                                                <span className="text-xs text-muted-foreground flex-1">{seriesLabel}</span>
                                                                                <span className="text-[10px] text-muted-foreground/60 tabular-nums mr-1">{models.length}</span>
                                                                            </div>
                                                                            {isSeriesExpanded && (
                                                                                <div className="pl-5 ml-2.5 border-l space-y-0.5">
                                                                                    {models.map(({ name, count }) => (
                                                                                        <div key={name} className={cn(
                                                                                            "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                                                            selectedDeviceModels.includes(name) ? "bg-primary/5" : "hover:bg-muted/50"
                                                                                        )}>
                                                                                            <div className="w-5" />
                                                                                            <Checkbox
                                                                                                id={`model-${name}`}
                                                                                                checked={selectedDeviceModels.includes(name)}
                                                                                                onCheckedChange={(checked) => {
                                                                                                    if (onDeviceModelChange) {
                                                                                                        if (checked) {
                                                                                                            onDeviceModelChange([...selectedDeviceModels, name]);
                                                                                                        } else {
                                                                                                            onDeviceModelChange(selectedDeviceModels.filter((n) => n !== name));
                                                                                                        }
                                                                                                    }
                                                                                                }}
                                                                                            />
                                                                                            <Label htmlFor={`model-${name}`}
                                                                                                className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                                                                {name}
                                                                                            </Label>
                                                                                            <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                            </CollapsibleContent>
                            <Separator />
                        </Collapsible>
                    )}

                    {/* Advanced Specs */}
                    {selectedCategory !== null && (
                        <Collapsible open={openSections.has('specs')} onOpenChange={() => toggleSection('specs')}>
                            <div className="py-2">
                                <SectionHeader
                                    label="進階規格"
                                    isOpen={openSections.has('specs')}
                                    icon={SlidersHorizontal}
                                />
                            </div>
                            <CollapsibleContent>
                                <AdvancedSpecFilters
                                    availableSpecs={availableSpecs}
                                    specFields={specFields}
                                    selectedSpecs={selectedSpecs}
                                    onSpecChange={onSpecChange}
                                />
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
