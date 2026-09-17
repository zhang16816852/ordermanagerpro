import { ProductWithPricing } from "@/types/product";

export function getFilterConfig(specDef: any) {
    if (!specDef || !specDef.configuration) return undefined;
    const config = Array.isArray(specDef.configuration)
        ? specDef.configuration[0]
        : specDef.configuration;
    return config?.filter_config;
}

export interface CatalogSidebarProps {
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

export interface CategoryFilterSectionProps {
    open: boolean;
    onOpenChange: () => void;
    specsLoading: boolean;
    categories: any[];
    categoryTree: any[];
    selectedCategory: string | null;
    onCategoryChange: (categoryId: string | null) => void;
}

export interface BrandSeriesFilterSectionProps {
    open: boolean;
    onOpenChange: () => void;
    brandsLoading: boolean;
    brands: any[];
    seriesByBrand: Record<string, any[]>;
    seriesCounts: Record<string, number>;
    selectedBrands: string[];
    onBrandChange?: (brands: string[]) => void;
    selectedSeries: string[];
    onSeriesChange?: (series: string[]) => void;
}

export interface DeviceModelFilterSectionProps {
    open: boolean;
    onOpenChange: () => void;
    products: ProductWithPricing[];
    selectedDeviceModels: string[];
    onDeviceModelChange?: (models: string[]) => void;
}

export interface SpecFilterSectionProps {
    open: boolean;
    onOpenChange: () => void;
    availableSpecs: Record<string, string[]>;
    specFields: any[];
    selectedSpecs: Record<string, string[]>;
    onSpecChange: (key: string, values: string[]) => void;
}