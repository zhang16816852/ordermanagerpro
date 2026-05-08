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
 * 將資料庫資料轉換為前端「穩定路徑字典物件 (Plain Object)」
 * Key 格式: parentId:specId:instanceUuid
 */
export function deserializeSpecs(data: any): Record<string, any> {
    const obj: Record<string, any> = {};
    if (!data) return obj;

    if (Array.isArray(data)) {
        data.forEach((entry: any) => {
            // 適配新舊格式
            const specId = entry.spec_id || entry.id;
            const parentId = entry.parent_id || entry.parentId || 'root';
            const instanceUuid = entry.instance_uuid || entry.instanceUuid || specId; // 舊資料暫時用 specId 代替
            
            const key = `${parentId}:${specId}:${instanceUuid}`;
            obj[key] = entry.value;
        });
    } else if (typeof data === 'object') {
        // 向後相容舊 JSONB 格式
        Object.entries(data).forEach(([id, val]) => {
            if (id === '_metadata') return;
            obj[`root:${id}:${id}`] = val;
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
 * 將前端字典物件轉換為 product_spec_values 存儲格式
 */
export function serializeSpecs(
    pathObj: Record<string, any>, 
    specMap: Map<string, CategorySpec>
): any[] {
    const entries: any[] = [];
    if (!pathObj) return entries;
    
    Object.entries(pathObj).forEach(([pathKey, value]) => {
        if (value === undefined || value === null || value === '') return;
        
        const parts = pathKey.split(':');
        const parentId = parts[0];
        const specId = parts[1];
        const instanceUuid = parts[2] || specId;

        if (!specId) return;

        const spec = specMap.get(specId);
        if (!spec) return; // 沒定義的不存

        entries.push({
            spec_id: specId,
            parent_id: parentId === 'root' ? null : parentId,
            instance_uuid: instanceUuid,
            value: value,
            display_order: 0
        });
    });

    return entries;
}

/**
 * DSL 條件評估器 (前端版本，需與後端 safe_eval_dsl 同步)
 */
export function evaluateDSL(value: any, specType: string, condition: any): boolean {
    if (!condition || !condition.op) return false;
    
    const op = condition.op;
    const target = condition.val;

    // exists 運算子：只要有填值就觸發 (模擬原有的 '*')
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
            // contains: 包含特定值
            if (op === 'contains') return value.includes(target);
            // overlap: 兩個陣列有交集
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

/**
 * 核心：計算目前應該顯示哪些規格路徑
 * v5.1 版：支援新舊連動規則混合
 */
export function getVisibleSpecsTree(
    specFields: CategorySpec[], 
    tableSettings: Record<string, any>,
    specTriggers: any[] = [] // 傳入從 specification_triggers 表抓取的連動規則
) {
    const visible = new Map<string, { 
        sourceValue?: any; 
        sourceName?: string;
        triggerInfo?: any;
    }>();
    if (!specFields || specFields.length === 0) return visible;
    
    // 1. 初始化根節點
    const targetSpecIdsInTriggers = new Set(specTriggers.map(t => t.target_spec_id));
    
    specFields.forEach(f => {
        if (!targetSpecIdsInTriggers.has(f.id)) {
            // 根規格的 instanceUuid 預設為 specId (除非資料中已有不同)
            visible.set(`root:${f.id}:${f.id}`, {});
        }
    });

    // 如果還是空，預設顯示所有沒有 parent 的規格
    if (visible.size === 0) {
        specFields.forEach(f => visible.set(`root:${f.id}:${f.id}`, {}));
    }

    let changed = true;
    let iterations = 0;
    const settings = tableSettings || {};

    while (changed && iterations < 10) {
        changed = false;
        iterations++;
        
        visible.forEach((info, pathKey) => {
            const parts = pathKey.split(':');
            const parentId = parts[0];
            const specId = parts[1];
            const instanceUuid = parts[2];
            
            const spec = specFields.find(s => s.id === specId);
            if (!spec) return;

            const val = settings[pathKey] !== undefined ? settings[pathKey] : '';
            const isHeading = spec.type === 'heading';

            // 處理新版規格連動 (specification_triggers 表)
            const activeTriggers = specTriggers.filter(t => t.source_spec_id === specId);
            activeTriggers.forEach(t => {
                const isMatch = isHeading ? true : evaluateDSL(val, spec.type, t.condition_dsl);
                if (isMatch) {
                    // 子規格繼承父規格的 instanceUuid (如果是 quantity detail)
                    const childPathKey = `${specId}:${t.target_spec_id}:${instanceUuid}`;
                    if (!visible.has(childPathKey)) {
                        visible.set(childPathKey, {
                            sourceName: spec.name,
                            triggerInfo: t.condition_dsl
                        });
                        changed = true;
                    }
                }
            });

            // 處理舊版規格連動 (向後相容)
            const oldTriggers = spec.logicConfig?.triggers || spec.logic_config?.triggers;
            oldTriggers?.forEach((t: any) => {
                const isMatch = isHeading ? true : checkSpecTriggerMatch(spec.type, val, t.on_value, t.operator);
                if (isMatch) {
                    getMergedTriggerTargets(t).forEach((tar: any) => {
                        const childPathKey = `${specId}:${tar.id}:${instanceUuid}`;
                        if (!visible.has(childPathKey)) {
                            visible.set(childPathKey, { 
                                sourceValue: tar.is_quantity_detail ? val : null,
                                sourceName: spec.name,
                                triggerInfo: { op: t.operator || 'eq', val: t.on_value }
                            });
                            changed = true;
                        }
                    });
                }
            });
        });
    }

    // 去重邏輯
    const childSpecIds = new Set<string>();
    visible.forEach((_, pathKey) => {
        if (!pathKey.startsWith('root:')) {
            const specId = pathKey.split(':')[1];
            if (specId) childSpecIds.add(specId);
        }
    });
    childSpecIds.forEach(specId => visible.delete(`root:${specId}:${specId}`));

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
            .sort((a, b) => {
                const specIdA = a.split(':').pop();
                const specIdB = b.split(':').pop();
                const specA = specFields.find(s => s.id === specIdA);
                const specB = specFields.find(s => s.id === specIdB);
                
                if (specA && specB) {
                    if (specA.sort_order !== specB.sort_order) {
                        return (specA.sort_order || 0) - (specB.sort_order || 0);
                    }
                    return specA.name.localeCompare(specB.name);
                }
                return a.localeCompare(b);
            });

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
export function formatSpecValue(val: any, spec?: CategorySpec, allSpecs?: CategorySpec[] | Map<string, CategorySpec>): string {
    if (val === null || val === undefined || val === '') return '';
    
    if (Array.isArray(val)) {
        // v4.11 增加對表格型數據 (Array of Objects) 的易讀化處理
        if (val.length > 0 && typeof val[0] === 'object' && val[0] !== null && !Array.isArray(val[0])) {
            const config = spec?.configuration;
            const colSep = config?.columnSeparator || '/';
            const rowSep = config?.rowSeparator || ', ';

            return val.map((row: any) => {
                return (config?.columns || []).map((col: any) => {
                    const colVal = row[col.id || col.name];
                    if (colVal === undefined || colVal === null || colVal === '') return null;
                    
                    let cellSuffix = col.suffix || '';
                    if (col.type === 'link' && col.linkedSpecId && allSpecs && !cellSuffix) {
                        const linkedSpec = Array.isArray(allSpecs) 
                            ? allSpecs.find((s: any) => s.id === col.linkedSpecId)
                            : allSpecs.get(col.linkedSpecId);
                            
                        if (linkedSpec && linkedSpec.type === 'number_with_unit' && linkedSpec.options?.length > 0) {
                            const unitMatch = linkedSpec.options[0].match(/(.+?)\((.+?)\)/);
                            cellSuffix = unitMatch ? unitMatch[2] : linkedSpec.options[0];
                        }
                    }

                    const formattedColVal = Array.isArray(colVal) ? colVal.join(',') : colVal;
                    return `${col.prefix || ''}${formattedColVal}${cellSuffix}`;
                }).filter(Boolean).join(colSep);
            }).filter((s: string) => s !== '').join(rowSep);
        }
        return val.join('/');
    }
    
    if (typeof val === 'object' && val !== null) {
        // 處理複合型規格或數量分配
        return Object.entries(val)
            .map(([label, value]) => {
                if (!value && value !== 0) return null;
                
                const unitMatch = label.match(/(.+?)\((.+?)\)/);
                if (unitMatch) {
                    const displayName = unitMatch[1];
                    const unit = unitMatch[2];
                    return `${displayName}:${value}${unit}`;
                }

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

/**
 * v4.12 靜態規格樹建構演算法 (用於後台分類設定)
 * 根據規格定義中的 triggers 關係建構 DFS 排序後的樹狀清單
 */
export function getStaticSpecTree(specDefinitions: any[]): { spec: any; level: number }[] {
    const childToParent = new Map<string, string>();
    
    // 1. 建立子對父的對照表
    specDefinitions.forEach(spec => {
        const triggers = spec.logic_config?.triggers || spec.logicConfig?.triggers;
        triggers?.forEach((t: any) => {
            const targets = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
            targets.forEach((tar: any) => {
                if (!childToParent.has(tar.id)) {
                    childToParent.set(tar.id, spec.id);
                }
            });
        });
    });

    // 2. 找出根節點 (沒有被任何人觸發的規格)
    const roots = specDefinitions.filter(s => !childToParent.has(s.id));
    
    const getChildren = (parentId: string): any[] => {
        return specDefinitions.filter(s => childToParent.get(s.id) === parentId);
    };

    const sorted: { spec: any; level: number }[] = [];
    const visited = new Set<string>();

    const traverse = (nodes: any[], level: number = 0) => {
        // 同層按名稱排序
        // 同層按排序與名稱排序
        const sortedNodes = [...nodes].sort((a, b) => {
            if (a.sort_order !== b.sort_order) {
                return (a.sort_order || 0) - (b.sort_order || 0);
            }
            return a.name.localeCompare(b.name);
        });
        
        sortedNodes.forEach(node => {
            if (visited.has(node.id)) return;
            visited.add(node.id);
            
            sorted.push({ spec: node, level });
            
            const children = getChildren(node.id);
            if (children.length > 0) {
                traverse(children, level + 1);
            }
        });
    };

    traverse(roots, 0);
    return sorted;
}
