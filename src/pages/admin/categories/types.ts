// 分類相關型別定義

export interface Category {
    id: string;
    name: string;
    // parent_id 保留相容性，實際以 category_hierarchy 資料表為主
    parent_id: string | null;
    spec_schema: any;
    sort_order: number;
}

export interface CategoryHierarchy {
    parent_id: string;
    child_id: string;
}

export interface SpecDefinition {
    id: string;
    name: string;
    type: 'select' | 'multiselect' | 'text' | 'boolean' | 'number_with_unit' | 'table';
    options: string[];
    default_value?: string;
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
        filter_config?: {
            enabled: boolean;
            display_mode: 'auto' | 'checkbox' | 'range';
        };
    };
    logic_config?: {
        triggers?: {
            on_value: string;
            operator?: 'eq' | 'ne';
            targets: { id: string; is_quantity_detail?: boolean }[];
        }[];
    };
}

export interface Brand {
    id: string;
    name: string;
    description: string | null;
    sort_order: number;
}
