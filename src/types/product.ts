import type { Database } from "../integrations/supabase/types";

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Product = Tables<'products'>;
export type ProductVariant = Tables<'product_variants'>;

export interface Category {
    id: string;
    name: string;
    parent_id: string | null;
    level: number;
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
    type: 'text' | 'select' | 'multiselect' | 'boolean' | 'number_with_unit';
    options?: string[] | null;
    default_value?: any;
}

export interface ProductWithDetails extends Product {
    category_names?: string[];
    category_ids?: string[];
    brand_name?: string;
    variants?: ProductVariant[];
    // Supabase Row 裡已有 category: string | null 與 table_settings: Json | null
    // 這裡我們將其型別放寬或保持一致
    table_settings: any;
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
