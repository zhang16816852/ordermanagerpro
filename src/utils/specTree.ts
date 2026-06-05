import { CategorySpec } from '@/hooks/useCategorySpecs';
import { generateStableUUID } from './specSerializer';

export function evaluateDSL(value: any, specType: string, condition: any): boolean {
    if (!condition || !condition.op) return false;

    const op = condition.op;
    const target = condition.val;

    if (op === 'exists') {
        return value !== undefined && value !== null && value !== '' && value !== false && value !== 'false';
    }

    if (value === undefined || value === null) return false;

    switch (specType) {
        case 'number_with_unit':
        case 'number': {
            const numVal = Number(value);
            const numTarget = Number(target);
            if (isNaN(numVal) || isNaN(numTarget)) return false;
            if (op === 'gt') return numVal > numTarget;
            if (op === 'lt') return numVal < numTarget;
            if (op === 'eq') return numVal === numTarget;
            break;
        }
        case 'multiselect':
        case 'array': {
            if (!Array.isArray(value)) return false;
            if (op === 'contains') return value.includes(target);
            if (op === 'overlap') {
                const targetArr = Array.isArray(target) ? target : [target];
                return value.some(v => targetArr.includes(v));
            }
            if (op === 'eq') return JSON.stringify(value) === JSON.stringify(target);
            break;
        }
        case 'boolean': {
            const boolVal = value === 'true' || value === true || value === 'on';
            const boolTarget = target === 'true' || target === true || target === 'on';
            return boolVal === boolTarget;
        }
        case 'select':
        case 'string':
        default: {
            if (op === 'eq') return String(value) === String(target);
            if (op === 'ne') return String(value) !== String(target);
            if (op === 'in') {
                const targetArr = Array.isArray(target) ? target : [target];
                return targetArr.map(String).includes(String(value));
            }
        }
    }
    return false;
}

export function getVisibleSpecsTree(
    specFields: CategorySpec[],
    tableSettings: Record<string, any>,
    specTriggers: any[] = []
) {
    const visible = new Map<string, {
        sourceValue?: any;
        sourceName?: string;
        triggerInfo?: any;
        isQuantityDetail?: boolean;
        isQuantityInstance?: boolean;
        instanceIndex?: number;
    }>();
    if (!specFields || specFields.length === 0) return visible;

    const specMap = new Map(specFields.map(s => [s.id, s]));
    const settings = tableSettings || {};

    const targetSpecIdsInTriggers = new Set(specTriggers.map(t => t.target_spec_id));
    const quantityTargetIds = new Set(specFields.filter(f => f.quantity_source_id).map(f => f.id));

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

            let activeTriggers = specTriggers.filter(t => t.source_spec_id === specId);

            activeTriggers.forEach(t => {
                const isMatch = isHeading ? true : checkSpecTriggerMatch(
                    spec.type,
                    val,
                    t.condition_dsl?.on_value,
                    t.condition_dsl?.operator
                );

                if (isMatch) {
                    const childPathKey = `${specId}:${t.target_spec_id}:${instanceUuid}`;
                    if (!visible.has(childPathKey)) {
                        visible.set(childPathKey, {
                            sourceName: spec.name,
                            sourceValue: val,
                            triggerInfo: t.condition_dsl,
                            isQuantityDetail: !!t.condition_dsl?.is_quantity_detail
                        });
                        changed = true;
                    }
                }
            });

            const quantityTargets = specFields.filter(f => f.quantity_source_id === specId);
            quantityTargets.forEach(qTarget => {
                const count = parseInt(String(val)) || 0;
                if (count > 0) {
                    for (let i = 1; i <= count; i++) {
                        const childUuid = generateStableUUID(`${qTarget.id}-${i}`);
                        const childPathKey = `${specId}:${qTarget.id}:${childUuid}`;
                        if (!visible.has(childPathKey)) {
                            visible.set(childPathKey, {
                                sourceName: spec.name,
                                isQuantityInstance: true,
                                instanceIndex: i
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

    const parentIdToChildren = new Map<string, string[]>();
    visibleInfo.forEach((_, pathKey) => {
        const parentId = pathKey.split(':')[0];
        if (!parentIdToChildren.has(parentId)) parentIdToChildren.set(parentId, []);
        parentIdToChildren.get(parentId)!.push(pathKey);
    });

    const allVisibleSpecIds = new Set(Array.from(visibleInfo.keys()).map(k => k.split(':')[1]));
    const topLevelPaths: string[] = [];

    visibleInfo.forEach((_, pathKey) => {
        const parentId = pathKey.split(':')[0];
        if (parentId === 'root' || !allVisibleSpecIds.has(parentId)) {
            topLevelPaths.push(pathKey);
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

        const currentSpecId = pathKey.split(':')[1];
        const children = parentIdToChildren.get(currentSpecId) || [];

        children.sort(sortByKey);

        const nextLevel = level + 1;
        children.forEach(childKey => traverse(childKey, nextLevel));
    };

    topLevelPaths.sort(sortByKey);

    topLevelPaths.forEach(path => traverse(path, 0));

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
    operator: 'eq' | 'ne' = 'eq'
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

export const getMergedTriggerTargets = (trigger: any) => {
    return [
        ...(trigger.targets || []),
        ...((trigger.target_ids || []).map((id: string) => ({ id, is_quantity_detail: false })))
    ];
};
