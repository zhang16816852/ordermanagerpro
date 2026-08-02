import type { Database } from "../integrations/supabase/types";

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Product = Tables<'products'>;
export type ProductVariant = Tables<'product_variants'>;
export type ProductOptionGroup = Tables<'product_option_groups'>;
export type ProductOptionValue = Tables<'product_option_values'>;
export type ProductVariantOption = Tables<'product_variant_options'>;

export interface Category {
    id: string;
    name: string;
    level?: number;
    sort_order?: number | null;
}

export interface CategoryHierarchy extends Category {
    children?: CategoryHierarchy[];
}

export interface Brand {
    id: string;
    name: string;
    code?: string | null;
}

export interface OptionGroupWithValues extends ProductOptionGroup {
    values: ProductOptionValue[];
}

export interface SpecDefinition {
    id: string;
    name: string;
    type: 'text' | 'select' | 'multiselect' | 'boolean' | 'number_with_unit' | 'table';
    options?: string[] | null;
    default_value?: any;
    configuration?: {
        columns: {
            id: string;
            name: string;
            type: 'text' | 'select' | 'multiselect' | 'link';
            linkedSpecId?: string;
            prefix?: string;
            suffix?: string;
            options?: string[];
        }[];
        columnSeparator?: string;
        rowSeparator?: string;
    } | null;
}

export interface ProductWithDetails extends Product {
    category_names?: string[];
    category_ids?: string[];
    category_id?: string | null;
    brand_ids?: string[];
    primary_brand_id?: string | null;
    brand_names?: string[];
    primary_brand_name?: string;
    brand_series_ids?: string[];
    variants?: ProductVariant[];
    option_groups?: OptionGroupWithValues[];
    spec_values?: any;
    device_models?: any[];
    device_model_groups?: any[];
    device_model_exclusions?: any[];
    effective_model_names?: string[];
}

export interface ProductWithPricing extends ProductWithDetails {
    wholesale_price: number;
    retail_price: number;
    has_store_price: boolean;
    variants?: VariantWithPricing[];
    image_url?: string;
}

export interface VariantWithPricing extends ProductVariant {
    effective_wholesale_price: number;
    effective_retail_price: number;
    has_brand_price: boolean;
    spec_values?: any;
    option_values?: ProductOptionValue[];
}
