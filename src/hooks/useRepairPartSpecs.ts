import { useMemo } from 'react';
import { useCategorySpecs } from './useCategorySpecs';
import { useSpecStore } from '@/store/useSpecStore';

export interface RepairPartSpecDef {
  id: string;
  name: string;
  options: string[];
  required: boolean;
  triggers: { id: string; triggerValue: string; targetSpec: string; relationType: 'visibility' | 'quantity' }[];
}

/**
 * 載入維修零件分類的規格定義 + Triggers
 * 從 useCategorySpecs + useSpecStore 整合
 */
export function useRepairPartSpecs(categoryIds: string[]) {
  const { data: specs, isLoading: specsLoading } = useCategorySpecs(categoryIds, {
    includeTriggerDownstream: true,
  });
  const { specTriggers } = useSpecStore();

  const repairSpecs = useMemo(() => {
    if (!specs || specs.length === 0) return [];

    // 建立 spec id → name 的映射
    const specNameMap = new Map(specs.map(s => [s.id, s.name]));

    // 建立 spec name → triggers 的映射
    const triggersBySpecName = new Map<string, { id: string; triggerValue: string; targetSpec: string; relationType: 'visibility' | 'quantity' }[]>();

    (specTriggers || []).forEach((t: any) => {
      const sourceName = specNameMap.get(t.source_spec_id);
      const targetName = specNameMap.get(t.target_spec_id);
      if (!sourceName || !targetName) return;

      const condition = t.condition_dsl || {};
      const onValue = condition.on_value || condition.value || '';
      if (!onValue) return;

      if (!triggersBySpecName.has(sourceName)) {
        triggersBySpecName.set(sourceName, []);
      }
      triggersBySpecName.get(sourceName)!.push({
        id: t.id,
        triggerValue: onValue,
        targetSpec: targetName,
        relationType: (t.relation_type === 'quantity' ? 'quantity' : 'visibility') as 'visibility' | 'quantity',
      });
    });

    return specs.map(spec => ({
      id: spec.id,
      name: spec.name,
      options: spec.options || [],
      required: spec.required || false,
      triggers: triggersBySpecName.get(spec.name) || [],
    }));
  }, [specs, specTriggers]);

  return {
    specs: repairSpecs,
    isLoading: specsLoading,
  };
}