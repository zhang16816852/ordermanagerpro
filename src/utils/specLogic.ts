import { CategorySpec } from '@/hooks/useCategorySpecs';

/**
 * 規格陣列實體格式 (資料庫儲存格式)
 */
export interface SpecEntry {
    id: string;
    parentId: string | 'root';
    path: string; // 人類可讀路徑
    value: any;
}

/**
 * 將資料庫資料轉換為前端「路徑字典物件 (Plain Object)」
 */
export function deserializeSpecs(data: any): Record<string, any> {
    const obj: Record<string, any> = {};
    if (!data) return obj;

    if (Array.isArray(data)) {
        data.forEach((entry: SpecEntry) => {
            const key = `${entry.parentId}:${entry.id}`;
            obj[key] = entry.value;
        });
    } else if (typeof data === 'object') {
        Object.entries(data).forEach(([id, val]) => {
            if (id === '_metadata') return;
            obj[`root:${id}`] = val;
        });
    }
    return obj;
}

/**
 * 通用值讀取器 (支援新舊格式)
 */
export function getSpecValue(data: any, specId: string): any {
    if (!data) return undefined;
    if (Array.isArray(data)) {
        const found = data.find((s: SpecEntry) => s.id === specId);
        return found?.value;
    }
    return data[specId];
}

/**
 * 將前端路徑字典物件轉換為易讀陣列儲存
 */
export function serializeSpecs(pathObj: Record<string, any>, specMap: Map<string, CategorySpec>): SpecEntry[] {
    const entries: SpecEntry[] = [];
    if (!pathObj) return entries;
    
    Object.entries(pathObj).forEach(([pathKey, value]) => {
        if (value === undefined || value === null || value === '') return;
        
        const [parentId, specId] = pathKey.split(':');
        if (!specId) return;

        const spec = specMap.get(specId);
        const parent = parentId === 'root' ? null : specMap.get(parentId);
        
        const pathName = parent 
            ? `${parent.name} > ${spec?.name || specId}`
            : (spec?.name || specId);

        entries.push({
            id: specId,
            parentId: parentId as any,
            path: pathName,
            value: value
        });
    });

    return entries;
}

/**
 * 核心：計算目前應該顯示哪些規格路徑
 */
export function getVisibleSpecsTree(specFields: CategorySpec[], tableSettings: Record<string, any>) {
    const visible = new Map<string, { sourceValue?: any }>();
    if (!specFields || specFields.length === 0) return visible;
    
    const allTargetIds = new Set<string>();
    specFields.forEach(f => {
        f.logicConfig?.triggers?.forEach(t => {
            getMergedTriggerTargets(t).forEach((tar: any) => allTargetIds.add(tar.id));
        });
    });

    specFields.forEach(f => {
        if (!allTargetIds.has(f.id)) {
            visible.set(`root:${f.id}`, {});
        }
    });

    let changed = true;
    let iterations = 0;
    const settings = tableSettings || {};

    while (changed && iterations < 8) {
        changed = false;
        iterations++;
        
        visible.forEach((info, pathKey) => {
            const [_, specId] = pathKey.split(':');
            const spec = specFields.find(s => s.id === specId);
            const val = settings[pathKey] !== undefined && settings[pathKey] !== ''
                ? settings[pathKey]
                : (settings[`root:${specId}`] || '');

            if (!spec || val === undefined || val === null || val === '') return;

            spec.logicConfig?.triggers?.forEach(t => {
                const isMatch = checkSpecTriggerMatch(spec.type, val, t.on_value);
                if (isMatch) {
                    getMergedTriggerTargets(t).forEach((tar: any) => {
                        const childPathKey = `${spec.id}:${tar.id}`;
                        if (!visible.has(childPathKey)) {
                            const sourceValue = tar.is_quantity_detail ? val : (info.sourceValue || null);
                            visible.set(childPathKey, { sourceValue });
                            changed = true;
                        }
                    });
                }
            });
        });
    }

    return visible;
}

/**
 * v4.7 樹狀排序演算法 (DFS)
 * 根據層級關係重新排列 Key 的順序，確保父子連隨
 */
export function getTreeSortedVisiblePaths(
    specFields: CategorySpec[], 
    visibleInfo: Map<string, any>
): { pathKey: string; level: number }[] {
    const sorted: { pathKey: string; level: number }[] = [];
    const visited = new Set<string>();

    const traverse = (parentId: string = 'root', level: number = 0) => {
        // 找出所有父規格為 parentId 且可見的路徑
        const children = Array.from(visibleInfo.keys())
            .filter(k => k.startsWith(`${parentId}:`))
            .sort((a, b) => a.localeCompare(b)); // 同層按 ID 排序

        children.forEach(pathKey => {
            if (visited.has(pathKey)) return;
            visited.add(pathKey);
            
            const [_, specId] = pathKey.split(':');
            sorted.push({ pathKey, level });
            
            // 遞迴尋找該規格的子規格
            traverse(specId, level + 1);
        });
    };

    traverse('root', 0);
    return sorted;
}

/**
 * 判斷當前數值是否滿足觸發條件
 */
export const checkSpecTriggerMatch = (
    specType: string,
    value: any,
    onValue: string | undefined
): boolean => {
    if (!onValue) return false;
    const val = value === undefined || value === null ? '' : value;
    
    if (onValue === '*') {
        if (specType === 'boolean') {
            return val === 'true' || val === true || val === 'on';
        }
        return val !== '' && val !== false && val !== 'false';
    }

    if (specType === 'boolean') {
        const isTrue = val === 'true' || val === true || val === 'on';
        return String(isTrue) === onValue;
    }

    return String(val) === onValue;
};

/**
 * 合併新舊格式的 Target 列表
 */
export const getMergedTriggerTargets = (trigger: any) => {
    return [
        ...(trigger.targets || []),
        ...((trigger.target_ids || []).map((id: string) => ({ id, is_quantity_detail: false })))
    ];
};
