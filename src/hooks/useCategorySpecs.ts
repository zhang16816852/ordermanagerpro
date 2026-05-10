import { useMemo } from 'react';
import { useSpecStore } from '@/store/useSpecStore';

export interface CategorySpec {
    id: string;
    name: string;
    key: string;
    type: 'heading' | 'text' | 'select' | 'boolean' | 'multiselect' | 'number_with_unit' | 'table';
    options: string[];
    defaultValue: string;
    expectedType?: 'string' | 'number' | 'boolean' | 'array' | 'object';
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
    logicConfig?: {
        triggers?: {
            on_value: string;
            operator?: 'eq' | 'ne';
            targets: { id: string; is_quantity_detail?: boolean }[];
        }[];
    };
    logic_config?: {
        triggers?: {
            on_value: string;
            operator?: 'eq' | 'ne';
            targets: { id: string; is_quantity_detail?: boolean }[];
        }[];
    };
    sort_order: number;
    quantity_source_id?: string | null;
}

/**
 * v4.7 分類規格 Hook
 * [v6] 已改為從 useSpecStore 獲取資料，以支援連動規則合併與版本校驗
 */
export function useCategorySpecs(categoryIds: string[]) {
    const { specDefinitions, categoryLinks, isLoading } = useSpecStore();

    const filteredSpecs = useMemo(() => {
        if (!categoryIds || categoryIds.length === 0) return [];
        
        // 1. 找出連結到這些分類的 spec_id
        const linkedSpecIds = new Set(
            (categoryLinks || [])
                .filter(link => categoryIds.includes(link.category_id))
                .map(link => link.spec_id)
        );

        // 2. 從 Store 中找出這些規格的完整定義 (已包含合併後的規則)
        return (specDefinitions || [])
            .filter(spec => linkedSpecIds.has(spec.id))
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            
    }, [categoryIds, specDefinitions, categoryLinks]);

    return {
        data: filteredSpecs,
        isLoading: isLoading
    };
}
