import type { Database } from "../integrations/supabase/types";

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Product = Tables<'products'>;
export type ProductVariant = Tables<'product_variants'>;

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
            linkedSpecId?: string; // 連結到其他規格的 ID
            prefix?: string;       // 欄位前綴
            suffix?: string;       // 欄位後綴
            options?: string[];
        }[];
        columnSeparator?: string; // 欄位間連接符 (預設 '/')
        rowSeparator?: string;    // 行間連接符 (預設 ', ')
    } | null;
}

export interface ProductWithDetails extends Product {
    category_names?: string[];
    category_ids?: string[];
    category_id?: string | null;
    brand_name?: string;
    variants?: ProductVariant[];
    spec_values?: any; // v6 規格架構
    // 裝置模型相關屬性 (相容後台列表)
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
}
