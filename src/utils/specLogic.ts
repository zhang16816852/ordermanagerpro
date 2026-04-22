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
 * @param pathObj 目前表單中的值集
 * @param specMap 規格定義地圖 (用於還原稱)
 * @param originalEntries 原始資料庫記錄 (用於保留那些地圖中找不到的「幽靈規格」原始路徑)
 */
export function serializeSpecs(
    pathObj: Record<string, any>, 
    specMap: Map<string, CategorySpec>,
    originalEntries?: SpecEntry[]
): SpecEntry[] {
    const entries: SpecEntry[] = [];
    if (!pathObj) return entries;
    
    Object.entries(pathObj).forEach(([pathKey, value]) => {
        if (value === undefined || value === null || value === '') return;
        
        const [parentId, specId] = pathKey.split(':');
        if (!specId) return;

        // 核心改進：始終嘗試從 specMap (全域字典) 找回名字
        const spec = specMap.get(specId);
        const parent = parentId === 'root' ? null : specMap.get(parentId);
        
        // 優先從 specMap 組合路徑 (自動刷新 UUID 為中文)
        let pathName;
        if (spec) {
            pathName = parent 
                ? `${parent.name} > ${spec.name}`
                : spec.name;
        } else {
            // 如果地圖真的找不到 (代表規格定義已從資料庫徹底刪除)
            const original = originalEntries?.find(e => e.id === specId);
            
            // 判斷是否為「無效幽靈」：字典找不到 且 原始數據的路徑也是 UUID 或 空白
            const originalPathValid = original?.path && !original.path.match(/^[0-9a-f-]{36}$/i);
            
            if (!originalPathValid) {
                // 這是無效幽靈規格，執行「洗掉」邏輯：直接跳過不存檔
                return;
            }
            
            // 如果雖然字典沒了，但原始數據有中文名字，則保留它 (保護歷史數據)
            pathName = original.path;
        }

        entries.push({
            id: specId,
            parentId: parentId as string,
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
    const visible = new Map<string, { 
        sourceValue?: any; 
        sourceName?: string;
        triggerValue?: string;
        operator?: string;
    }>();
    if (!specFields || specFields.length === 0) return visible;
    
    const allTargetIds = new Set<string>();
    specFields.forEach(f => {
        const triggers = f.logicConfig?.triggers || f.logic_config?.triggers;
        triggers?.forEach((t: any) => {
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

            const triggers = spec.logicConfig?.triggers || spec.logic_config?.triggers;
            triggers?.forEach((t: any) => {
                const isMatch = checkSpecTriggerMatch(spec.type, val, t.on_value, t.operator);
                if (isMatch) {
                    getMergedTriggerTargets(t).forEach((tar: any) => {
                        const childPathKey = `${spec.id}:${tar.id}`;
                        if (!visible.has(childPathKey)) {
                            const sourceValue = tar.is_quantity_detail ? val : (info.sourceValue || null);
                            visible.set(childPathKey, { 
                                sourceValue,
                                sourceName: spec.name,
                                triggerValue: t.on_value,
                                operator: t.operator || 'eq'
                            });
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

    // 處理陣列 (多選規格)
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

/**
 * 合併新舊格式的 Target 列表
 */
export const getMergedTriggerTargets = (trigger: any) => {
    return [
        ...(trigger.targets || []),
        ...((trigger.target_ids || []).map((id: string) => ({ id, is_quantity_detail: false })))
    ];
};
/**
 * 將單個規格值格式化為易讀字串
 */
export function formatSpecValue(val: any): string {
    if (val === null || val === undefined || val === '') return '';
    
    if (Array.isArray(val)) {
        // v4.11 增加對表格型數據 (Array of Objects) 的易讀化處理
        if (val.length > 0 && typeof val[0] === 'object' && val[0] !== null && !Array.isArray(val[0])) {
            return val.map((row: any) => {
                return Object.values(row)
                    .map(v => Array.isArray(v) ? v.join(',') : v)
                    .filter(v => v !== '' && v !== null && v !== undefined)
                    .join('/');
            }).filter(s => s !== '').join('; ');
        }
        return val.join('/');
    }
    
    if (typeof val === 'object' && val !== null) {
        // 處理複合型規格或數量分配
        return Object.entries(val)
            .map(([label, value]) => {
                if (!value && value !== 0) return null;
                
                // 解析單位：標籤(單位) -> 標籤: 數值單位
                const unitMatch = label.match(/(.+?)\((.+?)\)/);
                if (unitMatch) {
                    const displayName = unitMatch[1];
                    const unit = unitMatch[2];
                    return `${displayName}:${value}${unit}`;
                }

                // 數量分配傳統格式使用 *，一般複合格式使用 :
                // 啟發式：如果數值是純數字或標題不含特殊標籤，通常是複合規格
                return `${label}:${value}`;
            })
            .filter(Boolean)
            .join(' / ');
    }
    
    // 處理布林值
    if (val === 'true' || val === true || val === 'on') return '支援';
    if (val === 'false' || val === false) return '不支援';
    
    return String(val);
}

/**
 * 將整個規格集 (table_settings) 轉換為縮略的可讀字串
 * 支援 CSV 匯出與預覽顯示
 */
export function formatSpecsToCondensedString(
    settings: any, 
    specNameMap: Record<string, string> = {},
    delimiter: string = ', '
): string {
    if (!settings) return '';
    
    // 1. 先反序列化成扁平字典 [id]: value
    // 備註: deserializeSpecs 會回傳 parentId:specId 格式的 Key
    const flatMap = deserializeSpecs(settings);
    
    // 2. 轉換為 名稱:值
    return Object.entries(flatMap)
        .map(([pathKey, val]) => {
            const specId = pathKey.includes(':') ? pathKey.split(':').pop()! : pathKey;
            const name = specNameMap[specId] || specId;
            const formattedVal = formatSpecValue(val);
            
            if (!formattedVal) return null;
            return `${name}:${formattedVal}`;
        })
        .filter(Boolean)
        .join(delimiter);
}
