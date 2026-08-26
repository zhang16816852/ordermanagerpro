import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { DynamicSpecsFields } from '@/components/products/form/sections/DynamicSpecsFields';
import { useSpecStore } from '@/store/useSpecStore';
import { CategorySpec } from '@/hooks/useCategorySpecs';

interface CategorySpecPreviewProps {
    categoryId?: string;
    activeConfiguration: any[];
    specDefinitions: any[];
    requiredMap?: Record<string, boolean>;
}

export function CategorySpecPreview({ categoryId, activeConfiguration, specDefinitions, requiredMap = {} }: CategorySpecPreviewProps) {
    const { specTriggers } = useSpecStore();
    const form = useForm({ defaultValues: { category_ids: categoryId ? [categoryId] : [], spec_values: {} } });

    const specFields = useMemo(() => {
        const ids = new Set((activeConfiguration || []).map((s: any) => s.id));
        if (ids.size === 0) return [];

        const down = new Map<string, string[]>();
        // [修正] 連動鏈現存於 specification_triggers 表，改以 specTriggers 建 downstream
        (specTriggers || []).forEach((t: any) => {
            const sid = t.source_spec_id;
            const tid = t.target_spec_id;
            if (!down.has(sid)) down.set(sid, []);
            down.get(sid)!.push(tid);
        });
        // 相容舊邏輯：表為空時退回 logic_config.triggers
        if (down.size === 0) {
            (specDefinitions || []).forEach((s: any) => {
                (s.logic_config?.triggers || []).forEach((t: any) => {
                    (t.targets || []).forEach((tar: any) => {
                        if (!down.has(s.id)) down.set(s.id, []);
                        down.get(s.id)!.push(tar.id);
                    });
                });
            });
        }

        const all = new Set(ids);
        const queue = [...ids];
        while (queue.length) {
            const sid = queue.shift()!;
            (down.get(sid) || []).forEach(tid => {
                if (!all.has(tid)) {
                    all.add(tid);
                    queue.push(tid);
                }
            });
        }

        return (specDefinitions || [])
            .filter((s: any) => all.has(s.id))
            .map((s: any) => ({ ...s, sourceCategoryIds: categoryId ? [categoryId] : [], required: !!requiredMap[s.id] } as CategorySpec));
    }, [activeConfiguration, specDefinitions, categoryId, requiredMap, specTriggers]);

    if (specFields.length === 0) {
        return (
            <div className="py-10 text-center text-sm text-muted-foreground">
                此分類尚未連結任何規格，無可預覽的表單。
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-4">
            <div className="mb-3 text-xs text-muted-foreground">
                互動預覽：勾選 / 填值會即時帶出下游連動規格（與商品表單行為一致）。
            </div>
            <DynamicSpecsFields form={form} specFieldsOverride={specFields} />
        </div>
    );
}
