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
 * 通用值讀取器
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
 * 將值正規化為可比較的格式 (輔助邏輯判定)
 */
export function normalizeValue(val: any): any {
    if (val === undefined || val === null) return '';
    // 如果是舊式物件格式 { "TYPE-C": 2, "0": "TYPE-C" }
    if (typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val).filter(k => isNaN(Number(k))); // 只回傳 key 名稱列表
    }
    return val;
}

/**
 * 解析資料庫儲存的規格陣列
 */
export function deserializeSpecs(entries: SpecEntry[]): Record<string, any> {
    if (!Array.isArray(entries)) return {};
    const result: Record<string, any> = {};
    entries.forEach(entry => {
        const parent = entry.parentId || 'root';
        const key = `${parent}:${entry.id}`;
        result[key] = entry.value;
    });
    return result;
}

/**
 * 序列化回資料庫格式
 */
export function serializeSpecs(pathObj: Record<string, any>, specMap: Map<string, any>): SpecEntry[] {
    return Object.entries(pathObj)
        .filter(([_, val]) => val !== undefined && val !== '')
        .map(([path, value]) => {
            const parts = path.split(':');
            const specId = parts[parts.length - 1];
            const spec = specMap.get(specId);
            
            let parentId = 'root';
            if (parts.length > 2) {
                parentId = parts[parts.length - 2];
            }

            let readablePath = spec?.name || specId;
            if (parentId !== 'root') {
                const parentSpec = specMap.get(parentId);
                if (parentSpec) readablePath = `${parentSpec.name} > ${readablePath}`;
            }

            return {
                id: specId,
                path: readablePath,
                value: value,
                parentId: parentId
            };
        });
}

/**
 * 智慧可見性計算 (v4.12 修復平舖問題)
 */
export function getVisibleSpecsTree(specFields: any[], currentValues: Record<string, any>) {
    const visiblePaths = new Map<string, { spec: any; sourceValue?: any }>();
    const specMap = new Map<string, any>();
    specFields.forEach(s => specMap.set(s.id, s));

    // 1. 找出所有被「觸發」指向的規格 ID (這些不能當作 root)
    const targetSpecIds = new Set<string>();
    specFields.forEach(spec => {
        const triggers = spec.logic_config?.triggers || [];
        triggers.forEach((t: any) => {
            const targets = t.targets || t.target_ids?.map((id: string) => ({ id })) || [];
            targets.forEach((tar: any) => targetSpecIds.add(tar.id));
        });
    });

    const checkTriggers = (specId: string, currentPath: string, value: any) => {
        const spec = specMap.get(specId);
        if (!spec || !spec.logic_config?.triggers) return;

        const normalizedVal = normalizeValue(value);

        spec.logic_config.triggers.forEach((trigger: any) => {
            const onValue = trigger.on_value;
            const isMatch = checkSpecTriggerMatch(spec.type, normalizedVal, onValue);

            if (isMatch) {
                const targets = trigger.targets || trigger.target_ids?.map((id: string) => ({ id }));
                targets.forEach((target: any) => {
                    const targetPath = `${currentPath}:${target.id}`;
                    const targetSpec = specMap.get(target.id);
                    if (targetSpec) {
                        visiblePaths.set(targetPath, { spec: targetSpec, sourceValue: value });
                        checkTriggers(target.id, targetPath, currentValues[targetPath]);
                    }
                });
            }
        });
    };

    // 2. 初始化真正的 Root 規格 (沒被任何人觸發的才出現在第一層)
    specFields.forEach(spec => {
        if (!targetSpecIds.has(spec.id)) {
            const path = `root:${spec.id}`;
            visiblePaths.set(path, { spec });
        }
    });

    // 3. 遞迴追蹤觸發
    let changed = true;
    while (changed) {
        const beforeSize = visiblePaths.size;
        Array.from(visiblePaths.entries()).forEach(([path, info]) => {
            const val = currentValues[path];
            const specId = path.split(':').pop()!;
            checkTriggers(specId, path, val);
        });
        changed = visiblePaths.size > beforeSize;
    }

    return visiblePaths;
}

/**
 * 樹狀排序演算法
 */
export function getTreeSortedVisiblePaths(
    specFields: any[], 
    visibleInfo: Map<string, any>
): { pathKey: string; level: number }[] {
    const sorted: { pathKey: string; level: number }[] = [];
    const visited = new Set<string>();

    const traverse = (parentPath: string = '', level: number = 0) => {
        const children = Array.from(visibleInfo.keys())
            .filter(k => {
                const parts = k.split(':');
                if (parentPath === '') return parts.length === 2 && parts[0] === 'root';
                return k.startsWith(`${parentPath}:`) && parts.length === parentPath.split(':').length + 1;
            })
            .sort((a, b) => a.localeCompare(b));

        children.forEach(pathKey => {
            if (visited.has(pathKey)) return;
            visited.add(pathKey);
            sorted.push({ pathKey, level });
            traverse(pathKey, level + 1);
        });
    };

    traverse('', 0);
    return sorted;
}

/**
 * 判斷條件是否匹配 (支援陣列與正規化後的值)
 */
export function checkSpecTriggerMatch(specType: string, value: any, onValue: string | undefined): boolean {
    if (!onValue) return false;
    
    // 如果是陣列 (多選正規化後的結果)
    if (Array.isArray(value)) {
        if (onValue === '*') return value.length > 0;
        return value.some(v => String(v) === onValue);
    }

    const val = value === undefined || value === null ? '' : value;
    
    if (onValue === '*') {
        if (specType === 'boolean') return val === 'true' || val === true;
        return val !== '' && val !== false;
    }

    if (specType === 'boolean') {
        const isTrue = val === 'true' || val === true;
        return String(isTrue) === onValue;
    }

    return String(val) === onValue;
}
