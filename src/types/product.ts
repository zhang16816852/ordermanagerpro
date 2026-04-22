import type { Database } from "../integrations/supabase/types";

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Product = Tables<'products'>;
export type ProductVariant = Tables<'product_variants'>;

export interface Category {
    id: string;
    name: string;
    parent_id: string | null;
    level?: number;
    sort_order?: number | null;
    spec_schema?: any;
}

export interface CategoryHierarchy extends Category {
    children?: CategoryHierarchy[];
}

export interface Brand {
    id: string;
    name: string;
    code?: string | null;
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
            type: 'text' | 'select' | 'multiselect';
            options?: string[];
        }[];
    } | null;
}

export interface ProductWithDetails extends Product {
    category_names?: string[];
    category_ids?: string[];
    category_id?: string | null;
    brand_name?: string;
    variants?: ProductVariant[];
    table_settings: any; // 保持為 any 以支援動態規格
}

export interface ProductWithPricing extends ProductWithDetails {
    wholesale_price: number;
    retail_price: number;
    has_store_price: boolean;
    variants?: VariantWithPricing[];
}

export interface VariantWithPricing extends ProductVariant {
    effective_wholesale_price: number;
    effective_retail_price: number;
    has_brand_price: boolean;
    table_settings: any;
}
