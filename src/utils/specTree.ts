import { CategorySpec } from '@/hooks/useCategorySpecs';
import { generateStableUUID } from './specSerializer';

export function getVisibleSpecsTree(
    specFields: CategorySpec[],
    tableSettings: Record<string, any>,
    specTriggers: any[] = [],
    specDefinitions: any[] = []
) {
    const visible = new Map<string, {
        sourceValue?: any;
        sourceName?: string;
        triggerInfo?: any;
        isQuantityDetail?: boolean;
        isQuantityInstance?: boolean;
        instanceIndex?: number;
        parentPathKey?: string;
    }>();
    if (!specFields || specFields.length === 0) return visible;

    // [修正] specMap 合併 specFields 與 specDefinitions，確保即使 specFields 未包含某 downstream spec
    // （例如 store 快取尚未同步），仍能查到 spec 定義並處理其 triggers，避免子項規格不觸發
    const specMap = new Map<string, any>();
    (specDefinitions || []).forEach((s: any) => specMap.set(s.id, s));
    (specFields || []).forEach((s: any) => specMap.set(s.id, s)); // specFields takes priority (has sourceCategoryIds etc.)
    const settings = tableSettings || {};

    // [修正] 只有來源規格也在本次表單集合內的 trigger 才算有效 gating；
    // 來源缺席（跨分類共用 spec）的 target 永遠不可能被觸發，須視為根節點，否則會永久隱形
    const specFieldIds = new Set(specFields.map(f => f.id));
    const reachableTriggers = specTriggers.filter(t => specFieldIds.has(t.source_spec_id));
    const targetSpecIdsInTriggers = new Set(reachableTriggers.map(t => t.target_spec_id));
    const quantityTargetIds = new Set(reachableTriggers.filter(t => t.relation_type === 'quantity').map(t => t.target_spec_id));

    specFields.forEach(f => {
        if (!targetSpecIdsInTriggers.has(f.id) && !quantityTargetIds.has(f.id)) {
            visible.set(`root:${f.id}:${f.id}`, {});
        }
    });

    let changed = true;
    while (changed) {
        changed = false;

        visible.forEach((info, pathKey) => {
            const parts = pathKey.split(':');
            const specId = parts[1];
            const instanceUuid = parts[2];

            const spec = specMap.get(specId);
            if (!spec) return;

            const val = settings[pathKey] !== undefined ? settings[pathKey] : '';
            const isHeading = spec.type === 'heading';

            // [修正] 優先使用 specTriggers，fallback 到 spec.logicConfig/logic_config 的 triggers（相容 store 快取尚未同步的情況）
            const storeTriggersForSpec = specTriggers.filter(t => t.source_spec_id === specId);
            const legacyTriggersForSpec = (spec.logicConfig?.triggers || spec.logic_config?.triggers || []).flatMap((t: any) =>
                (t.targets || []).map((tar: any) => ({
                    source_spec_id: specId,
                    target_spec_id: tar.id,
                    relation_type: t.type === 'quantity' ? 'quantity' : 'visibility',
                    condition_dsl: t.type === 'quantity' ? {} : {
                        operator: t.operator || 'eq',
                        on_value: t.on_value,
                        is_quantity_detail: !!tar.is_quantity_detail
                    }
                }))
            );
            const seenTargets = new Set(storeTriggersForSpec.map((t: any) => t.target_spec_id));
            const activeTriggers = [
                ...storeTriggersForSpec,
                ...legacyTriggersForSpec.filter((t: any) => !seenTargets.has(t.target_spec_id))
            ];

            activeTriggers.forEach(t => {
                const isMatch = isHeading ? true : checkSpecTriggerMatch(
                    spec.type,
                    val,
                    t.condition_dsl?.on_value,
                    t.condition_dsl?.operator,
                    spec.options
                );

                if (isMatch) {
                    const childPathKey = `${specId}:${t.target_spec_id}:${instanceUuid}`;
                    if (!visible.has(childPathKey)) {
                        visible.set(childPathKey, {
                            sourceName: spec.name,
                            sourceValue: val,
                            triggerInfo: t.condition_dsl,
                            isQuantityDetail: !!t.condition_dsl?.is_quantity_detail,
                            parentPathKey: pathKey
                        });
                        changed = true;
                    }
                }
            });

            // 若當前規格本身是 quantity target（處於被複製層），則把上層 branch 帶入，
            // 避免「數量內再嵌數量」時跨所有一層實例產生相同 pathKey 而彼此碰撞
            const isNestedQuantity = quantityTargetIds.has(specId);
            const storeQtyTriggers = specTriggers.filter(t => t.relation_type === 'quantity' && t.source_spec_id === specId);
            const legacyQtyTriggers = (spec.logicConfig?.triggers || spec.logic_config?.triggers || [])
                .filter((t: any) => t.type === 'quantity')
                .flatMap((t: any) =>
                    (t.targets || []).map((tar: any) => ({
                        source_spec_id: specId,
                        target_spec_id: tar.id,
                        relation_type: 'quantity',
                        condition_dsl: {}
                    }))
                );
            const seenQtyTargets = new Set(storeQtyTriggers.map((t: any) => t.target_spec_id));
            const quantityTriggers = [
                ...storeQtyTriggers,
                ...legacyQtyTriggers.filter((t: any) => !seenQtyTargets.has(t.target_spec_id))
            ];
            quantityTriggers.forEach(qt => {
                const qTarget = specMap.get(qt.target_spec_id);
                if (!qTarget) return;
                const count = parseInt(String(val)) || 0;
                if (count > 0) {
                    for (let i = 1; i <= count; i++) {
                        const childUuid = isNestedQuantity
                            ? generateStableUUID(`${pathKey}:${qTarget.id}:${i}`)
                            : generateStableUUID(`${qTarget.id}-${i}`);
                        const childPathKey = `${specId}:${qTarget.id}:${childUuid}`;
                        if (!visible.has(childPathKey)) {
                            visible.set(childPathKey, {
                                sourceName: spec.name,
                                isQuantityInstance: true,
                                instanceIndex: i,
                                parentPathKey: pathKey
                            });
                            changed = true;
                        }
                    }
                }
            });
        });
    }

    const childSpecIds = new Set<string>();
    visible.forEach((_, pathKey) => {
        if (!pathKey.startsWith('root:')) {
            const specId = pathKey.split(':')[1];
            if (specId) childSpecIds.add(specId);
        }
    });

    childSpecIds.forEach(specId => visible.delete(`root:${specId}:${specId}`));

    if (visible.size === 0 && specFields.length > 0) {
        specFields.forEach(f => visible.set(`root:${f.id}:${f.id}`, {}));
    }

    getTreeSortedVisiblePaths(specFields, visible);
    return visible;
}

export function getTreeSortedVisiblePaths(
    specFields: CategorySpec[],
    visibleInfo: Map<string, any>,
    categorySortMap?: Record<string, number>
) {
    const sorted: { pathKey: string; level: number }[] = [];
    const visited = new Set<string>();

    // 以完整 parentPathKey 建立父子關係：
    // 同一規格被數量複製出多份時，每份實例擁有各自獨立的 parentPathKey，
    // 不再用 parts[0]（上層規格 id）當 parent key 而把多份實例的子項併到同一處
    const childrenByParent = new Map<string, string[]>();
    const topLevelPaths: string[] = [];

    visibleInfo.forEach((info, pathKey) => {
        const p = info.parentPathKey;
        if (!p || p === 'root' || !visibleInfo.has(p)) {
            topLevelPaths.push(pathKey);
        } else {
            if (!childrenByParent.has(p)) childrenByParent.set(p, []);
            childrenByParent.get(p)!.push(pathKey);
        }
    });

    const sortByKey = (a: string, b: string) => {
        const idA = a.split(':')[1];
        const idB = b.split(':')[1];

        const catSortA = categorySortMap?.[idA] ?? 999;
        const catSortB = categorySortMap?.[idB] ?? 999;

        if (catSortA !== catSortB) return catSortA - catSortB;

        const sortA = specFields.find(s => s.id === idA)?.sort_order || 0;
        const sortB = specFields.find(s => s.id === idB)?.sort_order || 0;
        return sortA - sortB;
    };

    const traverse = (pathKey: string, level: number) => {
        if (visited.has(pathKey)) return;
        visited.add(pathKey);

        sorted.push({ pathKey, level });

        const children = childrenByParent.get(pathKey) || [];
        children.sort(sortByKey);
        children.forEach(childKey => traverse(childKey, level + 1));
    };

    topLevelPaths.sort(sortByKey);
    topLevelPaths.forEach(path => traverse(path, 0));

    // 安全網：任何未被拜訪的孤立節點（parent 不存在）補到最外層
    visibleInfo.forEach((_, pathKey) => {
        if (!visited.has(pathKey)) {
            sorted.push({ pathKey, level: 0 });
            visited.add(pathKey);
        }
    });

    return sorted;
}

export const checkSpecTriggerMatch = (
    specType: string,
    value: any,
    onValue: string | undefined,
    operator: 'eq' | 'ne' = 'eq',
    options?: string[]
): boolean => {
    if (!onValue) return false;
    const val = value === undefined || value === null ? '' : value;

    if (onValue === '*') {
        let isNotEmpty = false;
        if (specType === 'boolean') {
            isNotEmpty = val === 'true' || val === true || val === 'on';
        } else {
            isNotEmpty = val !== '' && val !== false && val !== 'false';
        }
        return operator === 'ne' ? !isNotEmpty : isNotEmpty;
    }

    // 「自訂輸入」：值非空且不在預設選項清單內（個例，不被當成預設選項）
    if (onValue === 'input') {
        const isCustom = (v: any): boolean => {
            const s = v === undefined || v === null ? '' : String(v);
            return s.trim() !== '' && (options && options.length > 0 ? !options.includes(s) : true);
        };
        const matched = Array.isArray(val) ? val.some(isCustom) : isCustom(val);
        return operator === 'ne' ? !matched : matched;
    }

    if (Array.isArray(val)) {
        const matched = val.includes(onValue);
        return operator === 'ne' ? !matched : matched;
    }

    if (specType === 'boolean') {
        const isTrue = val === 'true' || val === true || val === 'on';
        const matched = String(isTrue) === onValue;
        return operator === 'ne' ? !matched : matched;
    }

    const matched = String(val) === onValue;
    return operator === 'ne' ? !matched : matched;
};
