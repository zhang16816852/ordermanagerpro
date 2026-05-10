import { CategorySpec } from '@/hooks/useCategorySpecs';

/**
 * 規格資料存儲格式 (v6 product_spec_values 表)
 */
export interface SpecEntry {
    spec_id: string;
    parent_id: string | 'root';
    instance_uuid: string;
    value: any;
}

/**
 * 產生穩定且合法的 UUID (基於種子字串)
 * 用於數量連動時產生符合資料庫 UUID 型別約束的識別碼
 */
export function generateStableUUID(seed: string): string {
    // 簡單的哈希處理，將字串轉為固定長度的 16 進制
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash |= 0;
    }

    // 將 hash 轉為 8 位 16 進制，並重複/填充以湊足 UUID 的 32 位
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    const part2 = (Math.abs(hash * 31) % 0xFFFF).toString(16).padStart(4, '0');
    const part3 = (Math.abs(hash * 37) % 0xFFFF).toString(16).padStart(4, '0');
    const part4 = (Math.abs(hash * 41) % 0xFFFF).toString(16).padStart(4, '0');
    const part5 = (Math.abs(hash * 43)).toString(16).padEnd(12, '0').substring(0, 12);

    // 輸出格式: 8-4-4-4-12
    return `${hex}-${part2}-${part3}-${part4}-${part5}`;
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
        const found = data.find((s: SpecEntry) => (s as any).spec_id === specId || (s as any).id === specId);
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

    // 1. 找出根規格 (不被任何人觸發，且沒有數量連動來源)
    const targetSpecIdsInTriggers = new Set(specTriggers.map(t => t.target_spec_id));
    const quantityTargetIds = new Set(specFields.filter(f => f.quantity_source_id).map(f => f.id));

    specFields.forEach(f => {
        if (!targetSpecIdsInTriggers.has(f.id) && !quantityTargetIds.has(f.id)) {
            visible.set(`root:${f.id}:${f.id}`, {});
        }
    });

    // 2. 廣度優先遍歷 (BFS)
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

            // --- 處理 A: 規格連動 (Triggers) ---
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
                            sourceValue: val, // 傳遞父規格的值作為總量參考
                            triggerInfo: t.condition_dsl,
                            isQuantityDetail: !!t.condition_dsl?.is_quantity_detail // 從 DSL 中提取分配模式標記
                        });
                        changed = true;
                    }
                }
            });

            // --- 處理 B: 數量連動 (Quantity Source) ---
            const quantityTargets = specFields.filter(f => f.quantity_source_id === specId);
            if (quantityTargets.length > 0) {
                console.log(`[SpecLogic] 發現數量連動: ${spec.name} (值: ${val}) 觸發了 ${quantityTargets.length} 個目標`, quantityTargets.map(t => t.name));
            }
            quantityTargets.forEach(qTarget => {
                const count = parseInt(String(val)) || 0;
                console.log(`[SpecLogic] ${qTarget.name} 將產生 ${count} 個實例`);
                if (count > 0) {
                    for (let i = 1; i <= count; i++) {
                        // [正規化] 根據規格ID和序號產生穩定且合法的 UUID
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

    // 4. 清理重複項：如果一個規格作為子節點出現，就從根目錄移除它
    const childSpecIds = new Set<string>();
    visible.forEach((_, pathKey) => {
        if (!pathKey.startsWith('root:')) {
            const specId = pathKey.split(':')[1];
            if (specId) childSpecIds.add(specId);
        }
    });

    //console.log('[SpecLogic] 🌲 原始根節點數:', Array.from(visible.keys()).filter(k => k.startsWith('root:')).length);
    childSpecIds.forEach(specId => visible.delete(`root:${specId}:${specId}`));

    // 5. 保底機制：如果最後算出來什麼都沒有 (可能是規則設定錯誤)，預設顯示所有沒有被當作目標的規格
    if (visible.size === 0 && specFields.length > 0) {
        //console.warn('[SpecLogic] ⚠️ 計算結果為空，執行保底顯示所有規格');
        specFields.forEach(f => visible.set(`root:${f.id}:${f.id}`, {}));
    }

    const sortedVisible = getTreeSortedVisiblePaths(specFields, visible);
    /*
    console.log('[DynamicSpecs] 當前 spec_values:', tableSettings);
    console.log('[DynamicSpecs] 排序後的可見路徑:', sortedVisible.map(s => s.pathKey));
    console.log('[DynamicSpecs] visibleInfo 內容:', Object.fromEntries(visible.entries()));
*/
    return visible;
}

/**
 * v4.7 樹狀排序演算法 (DFS)
 * 根據層級關係重新排列 Key 的順序，確保父子連隨
 */
/**
 * v6 樹狀排序演算法 (森林 DFS)
 * 根據層級關係重新排列 Key 的順序，支援多根節點情況
 */
export function getTreeSortedVisiblePaths(
    specFields: CategorySpec[],
    visibleInfo: Map<string, any>,
    categorySortMap?: Record<string, number>
) {
    const sorted: { pathKey: string; level: number }[] = [];
    const visited = new Set<string>();

    // 1. 建立 父路徑節點 -> 子路徑 的映射表
    const parentIdToChildren = new Map<string, string[]>();
    visibleInfo.forEach((_, pathKey) => {
        const parentId = pathKey.split(':')[0];
        if (!parentIdToChildren.has(parentId)) parentIdToChildren.set(parentId, []);
        parentIdToChildren.get(parentId)!.push(pathKey);
    });

    // 2. 識別所有「頂層路徑」
    const allVisibleSpecIds = new Set(Array.from(visibleInfo.keys()).map(k => k.split(':')[1]));
    const topLevelPaths: string[] = [];

    visibleInfo.forEach((_, pathKey) => {
        const parentId = pathKey.split(':')[0];
        if (parentId === 'root' || !allVisibleSpecIds.has(parentId)) {
            topLevelPaths.push(pathKey);
        }
    });

    // 排序函式：優先使用分類權重，其次使用全域權重
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

    // 3. DFS 遍歷函數
    const traverse = (pathKey: string, level: number) => {
        if (visited.has(pathKey)) return;
        visited.add(pathKey);

        sorted.push({ pathKey, level });

        const currentSpecId = pathKey.split(':')[1];
        const children = parentIdToChildren.get(currentSpecId) || [];

        children.sort(sortByKey);

        // 統一增加層級，無論父節點是否為標籤 (heading)
        const nextLevel = level + 1;
        children.forEach(childKey => traverse(childKey, nextLevel));
    };

    // 4. 從所有頂層路徑開始執行 DFS
    topLevelPaths.sort(sortByKey);

    topLevelPaths.forEach(path => traverse(path, 0));

    // 5. 保底補齊（理論上不應該執行到這，除非有循環引用）
    visibleInfo.forEach((_, pathKey) => {
        if (!visited.has(pathKey)) {
            sorted.push({ pathKey, level: 0 });
            visited.add(pathKey);
        }
    });

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
 * 將整個規格集 (spec_values) 轉換為縮略的可讀字串
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
export function getStaticSpecTree(specDefinitions: any[]): { spec: any; level: number; id: string }[] {
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

    const sorted: { spec: any; level: number; id: string }[] = [];
    const visited = new Set<string>();

    const traverse = (nodes: any[], level: number = 0, path: string = '') => {
        // 同層按排序與名稱排序
        const sortedNodes = [...nodes].sort((a, b) => {
            if (a.sort_order !== b.sort_order) {
                return (a.sort_order || 0) - (b.sort_order || 0);
            }
            return a.name.localeCompare(b.name);
        });

        sortedNodes.forEach(node => {
            const currentPath = path ? `${path}>${node.id}` : node.id;
            
            // 雖然是靜態樹，但為了防止資料配置錯誤導致無限迴圈
            const visitKey = `${currentPath}`;
            if (visited.has(visitKey)) return;
            visited.add(visitKey);

            sorted.push({ spec: node, level, id: currentPath });

            const children = getChildren(node.id);
            if (children.length > 0) {
                traverse(children, level + 1, currentPath);
            }
        });
    };

    traverse(roots, 0);
    return sorted;
}
