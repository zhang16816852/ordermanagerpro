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
    sourceCategoryIds?: string[];
    required?: boolean;
}

export interface UseCategorySpecsOptions {
    /** 一併納入所選分類的祖先分類所掛載的規格 */
    includeAncestors?: boolean;
    /** 一併納入所選分類的子孫分類所掛載的規格 */
    includeDescendants?: boolean;
    /** 遞迴帶入觸發下游的規格（即使未掛載於任何分類） */
    includeTriggerDownstream?: boolean;
}

/**
 * v4.7 分類規格 Hook
 * [v6] 已改為從 useSpecStore 獲取資料，以支援連動規則合併與版本校驗
 * [v6.2] 新增 includeDescendants / includeTriggerDownstream，讓連動鏈在選到父/子分類時也能完整出現
 */
export function useCategorySpecs(categoryIds: string[], options?: UseCategorySpecsOptions) {
    const { specDefinitions, categoryLinks, categoryHierarchy, isLoading } = useSpecStore();
    const {
        includeAncestors = false,
        includeDescendants = false,
        includeTriggerDownstream = false,
    } = options || {};

    const filteredSpecs = useMemo(() => {
        if (!categoryIds || categoryIds.length === 0) return [];

        // 1. 擴展有效分類集合（祖先 / 子孫）
        const effectiveIds = new Set(categoryIds);

        if (includeAncestors) {
            categoryIds.forEach(id => {
                let cur: string | undefined = id;
                while (cur) {
                    const parent = categoryHierarchy.find(h => h.child_id === cur)?.parent_id;
                    if (parent) effectiveIds.add(parent);
                    cur = parent;
                }
            });
        }

        if (includeDescendants) {
            const queue = [...categoryIds];
            while (queue.length > 0) {
                const pid = queue.shift()!;
                categoryHierarchy.forEach(h => {
                    if (h.parent_id === pid && !effectiveIds.has(h.child_id)) {
                        effectiveIds.add(h.child_id);
                        queue.push(h.child_id);
                    }
                });
            }
        }

        // 2. 找出連結到有效分類的 spec link
        const linked = (categoryLinks || []).filter(link => effectiveIds.has(link.category_id));
        const linkedSpecIds = new Set(linked.map(l => l.spec_id));

        // 3. 遞迴帶入觸發下游規格（即便是純觸發、未掛載於任何分類）
        const downstreamMap = new Map<string, string[]>();
        (specDefinitions || []).forEach((s: any) => {
            const triggers = s.logic_config?.triggers || [];
            triggers.forEach((t: any) => {
                (t.targets || []).forEach((tar: any) => {
                    if (!downstreamMap.has(s.id)) downstreamMap.set(s.id, []);
                    downstreamMap.get(s.id)!.push(tar.id);
                });
            });
        });

        const effectiveSpecIds = new Set(linkedSpecIds);
        if (includeTriggerDownstream) {
            const queue = [...linkedSpecIds];
            while (queue.length > 0) {
                const sid = queue.shift()!;
                (downstreamMap.get(sid) || []).forEach(tid => {
                    if (!effectiveSpecIds.has(tid)) {
                        effectiveSpecIds.add(tid);
                        queue.push(tid);
                    }
                });
            }
        }

        // 4. 從 Store 中找出這些規格的完整定義 (已包含合併後的規則)
        return (specDefinitions || [])
            .filter(spec => effectiveSpecIds.has(spec.id))
            .map((spec: any) => {
                const sources = linked
                    .filter(l => l.spec_id === spec.id)
                    .map(l => l.category_id);
                const required = linked.some(l => l.spec_id === spec.id && l.required);
                return { ...spec, sourceCategoryIds: sources, required } as CategorySpec;
            })
            .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

    }, [categoryIds, specDefinitions, categoryLinks, categoryHierarchy, includeAncestors, includeDescendants, includeTriggerDownstream]);

    return {
        data: filteredSpecs,
        isLoading: isLoading
    };
}
