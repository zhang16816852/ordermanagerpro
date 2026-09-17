import { useMemo, useState, useEffect } from "react";
import { Filter } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { formatSpecValue } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { useCategorySpecs } from "@/hooks/useCategorySpecs";
import { useSpecStore } from "@/store/useSpecStore";
import { useBrandSeriesCache } from "@/hooks/useBrandSeriesCache";
import { CatalogSidebarProps, getFilterConfig } from "./catalogSidebarTypes";
import { CategoryFilterSection } from "./CategoryFilterSection";
import { BrandSeriesFilterSection } from "./BrandSeriesFilterSection";
import { DeviceModelFilterSection } from "./DeviceModelFilterSection";
import { SpecFilterSection } from "./SpecFilterSection";

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
    const [openSections, setOpenSections] = useState<Set<string>>(new Set(['categories']));

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

    useEffect(() => {
        if (specDefinitions.length === 0 || categoryLinks.length === 0) {
            fetchSpecs();
        }
    }, [fetchSpecs, specDefinitions.length, categoryLinks.length]);

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
                    <CategoryFilterSection
                        open={openSections.has('categories')}
                        onOpenChange={() => toggleSection('categories')}
                        specsLoading={specsLoading}
                        categories={categories}
                        categoryTree={categoryTree}
                        selectedCategory={selectedCategory}
                        onCategoryChange={onCategoryChange}
                    />

                    {/* Brands + Series Tree */}
                    <BrandSeriesFilterSection
                        open={openSections.has('brands')}
                        onOpenChange={() => toggleSection('brands')}
                        brandsLoading={brandsLoading}
                        brands={brands}
                        seriesByBrand={seriesByBrand}
                        seriesCounts={seriesCounts}
                        selectedBrands={selectedBrands}
                        onBrandChange={onBrandChange}
                        selectedSeries={selectedSeries}
                        onSeriesChange={onSeriesChange}
                    />

                    {/* Device Models Tree */}
                    <DeviceModelFilterSection
                        open={openSections.has('deviceModels')}
                        onOpenChange={() => toggleSection('deviceModels')}
                        products={products}
                        selectedDeviceModels={selectedDeviceModels}
                        onDeviceModelChange={onDeviceModelChange}
                    />

                    {/* Advanced Specs */}
                    {selectedCategory !== null && (
                        <SpecFilterSection
                            open={openSections.has('specs')}
                            onOpenChange={() => toggleSection('specs')}
                            availableSpecs={availableSpecs}
                            specFields={specFields}
                            selectedSpecs={selectedSpecs}
                            onSpecChange={onSpecChange}
                        />
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}