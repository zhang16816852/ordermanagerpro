import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { CategorySpec } from '@/hooks/useCategorySpecs';

// 本地快取 Key (升級為 v2，強制清除可能損毀的舊快取)
const SPEC_CACHE_KEY = 'specs_cache_v2';

// 對應資料庫 specification_triggers 表的實際結構
interface SpecTrigger {
    id: string;
    source_spec_id: string;
    target_spec_id: string;
    condition_dsl: any;       // DSL 連動規則（JSON 格式）
    max_depth_limit: number;  // 遞迴深度上限
    priority: number;
    created_at: string;
}

interface SpecCache {
    version: number;
    definitions: any[];
    triggers: SpecTrigger[];
    categoryLinks: any[];
}

function getLocalSpecCache(): SpecCache | null {
    try {
        const cached = localStorage.getItem(SPEC_CACHE_KEY);
        if (!cached) return null;
        return JSON.parse(cached) as SpecCache;
    } catch {
        localStorage.removeItem(SPEC_CACHE_KEY);
        return null;
    }
}

function setLocalSpecCache(cache: SpecCache) {
    localStorage.setItem(SPEC_CACHE_KEY, JSON.stringify(cache));
}

interface SpecStore {
    specDefinitions: CategorySpec[];
    specMap: Map<string, CategorySpec>;
    specTriggers: SpecTrigger[];
    categoryLinks: any[];
    specVersion: number;
    isLoading: boolean;
    fetchSpecs: (force?: boolean) => Promise<void>;
    invalidateCache: () => void;
    setDefinitions: (newDefs: any[]) => void;
}

/**
 * [v6 修正] 將獨立存放的 specification_triggers 合併回 definitions.logic_config
 * 確保原本的 UI 元件 (如 SpecDialog) 能正確讀取並顯示連動規則
 */
const mergeTriggersToDefs = (definitions: any[], triggers: any[]) => {
    return definitions.map(def => {
        const specTriggers = triggers.filter(t => t.source_spec_id === def.id);
        if (specTriggers.length === 0) {
            // [v6 修復] 如果關聯表沒有資料，但舊版 JSON 內有資料，則保留舊版 JSON 的 triggers 以便向下相容
            const legacyTriggers = def.logic_config?.triggers || [];
            return {
                ...def,
                logic_config: { ...(def.logic_config as any || {}), triggers: legacyTriggers }
            };
        }

        // 根據 on_value + operator 分組，重構成 UI 期待的格式
        const groupedTriggers = specTriggers.reduce((acc, t) => {
            const dsl = (t.condition_dsl as any) || {};
            const key = `${dsl.on_value}-${dsl.operator}`;
            if (!acc[key]) {
                acc[key] = {
                    on_value: dsl.on_value,
                    operator: dsl.operator || 'eq',
                    targets: []
                };
            }
            acc[key].targets.push({
                id: t.target_spec_id,
                is_quantity_detail: dsl.is_quantity_detail || false
            });
            return acc;
        }, {} as Record<string, any>);

        return {
            ...def,
            logic_config: {
                ...(def.logic_config as any || {}),
                triggers: Object.values(groupedTriggers)
            }
        };
    });
};

export const useSpecStore = create<SpecStore>((set, get) => ({
    specDefinitions: [],
    specMap: new Map(),
    specTriggers: [],
    categoryLinks: [],
    specVersion: 0,
    isLoading: false,

    // 清除快取
    invalidateCache: () => {
        localStorage.removeItem(SPEC_CACHE_KEY);
        set({ specDefinitions: [], specMap: new Map(), specTriggers: [], specVersion: 0 });
    },

    // 樂觀更新：手動設定規格定義
    setDefinitions: (newDefs: any[]) => {
        const specMap = buildSpecMap(newDefs);
        set({ specDefinitions: newDefs, specMap });
    },

    fetchSpecs: async (force = false) => {
        console.log(`[SpecStore] 🔍 fetchSpecs 調用 (force: ${force}), 當前資料量: ${get().specDefinitions.length}`);
        
        if (!force && get().specDefinitions.length > 0) {
            console.log('[SpecStore] ⏭️ 資料已存在且非強制刷新，跳過。');
            return;
        }

        set({ isLoading: true });
        try {
            const cache = getLocalSpecCache();
            const clientVersion = cache?.version ?? null;
            console.log(`[SpecStore] 📦 本地快取版本: ${clientVersion}`);

            // 透過 Edge Function 做版本校驗
            const { data: versionResult, error: versionError } = await supabase.functions.invoke('check-data-version', {
                body: { tableName: 'specs', clientVersion }
            });

            if (!versionError && versionResult && !versionResult.needsUpdate && cache) {
                // 版本一致，使用本地快取
                console.log(`%c[SpecStore] ✅ 版本一致 (v${cache.version})`, 'color: #2ecc71; font-weight: bold', `更新於: ${versionResult.updatedAt}`);
                console.log('[SpecStore] 快取內容 - 定義數:', cache.definitions.length, '規則數:', cache.triggers.length);
                
                const specMap = buildSpecMap(cache.definitions);
                set({
                    specDefinitions: cache.definitions,
                    specMap,
                    specTriggers: cache.triggers,
                    categoryLinks: cache.categoryLinks,
                    specVersion: cache.version,
                    isLoading: false
                });
                return;
            }

            // 版本不一致或有錯誤，從伺服器抓取最新資料
            let definitions: any[] = [];
            let triggers: SpecTrigger[] = [];
            let categoryLinks: any[] = [];
            let newVersion = cache?.version ?? 0;

            if (!versionError && versionResult?.needsUpdate && versionResult.data) {
                // Edge Function 回傳最新資料
                const rawDefinitions = versionResult.data.definitions || [];
                triggers = versionResult.data.triggers || [];
                categoryLinks = versionResult.data.categoryLinks || [];
                newVersion = versionResult.version;

                // 合併規則供 UI 使用
                definitions = mergeTriggersToDefs(rawDefinitions, triggers);

                console.log(
                    `%c[SpecStore] 🔄 版本更新至 v${newVersion}`,
                    'color: #f39c12; font-weight: bold',
                    `觸發來源: ${versionResult.lastTriggeredBy}, 更新時間: ${versionResult.updatedAt}`
                );
            } else {
                // Fallback：直接查詢資料庫
                console.warn('[SpecStore] Edge Function 失敗，改用直接查詢');
                const [
                    { data: defData },
                    { data: triggerData },
                    { data: catLinkData }
                ] = await Promise.all([
                    supabase.from('specification_definitions').select('*').order('sort_order', { ascending: true }).order('name'),
                    supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
                    supabase.from('category_spec_links').select('*')
                ]);

                const rawDefinitions = defData || [];
                triggers = (triggerData || []) as unknown as SpecTrigger[];
                categoryLinks = catLinkData || [];

                // 合併規則供 UI 使用
                definitions = mergeTriggersToDefs(rawDefinitions, triggers);
            }

                // 更新本地快取
                setLocalSpecCache({ version: newVersion, definitions, triggers, categoryLinks });
                console.log('[SpecStore] 💾 已更新本地快取 (v' + newVersion + ')');

                const specMap = buildSpecMap(definitions);
                console.log('[SpecStore] 🗺️ SpecMap 已建立，總數:', specMap.size);
                
                // 偵錯：看看「電池資訊」合併後的結果
                const batteryInfo = definitions.find(d => d.name === '電池資訊');
                if (batteryInfo) {
                    console.log('[SpecStore] 🐞 偵錯「電池資訊」:', batteryInfo.logic_config);
                }

                set({
                    specDefinitions: definitions,
                    specMap,
                    specTriggers: triggers,
                    categoryLinks,
                    specVersion: newVersion,
                    isLoading: false
                });

        } catch (err) {
            console.error('[SpecStore] Fetch failed:', err);
            set({ isLoading: false });
        }
    }
}));

// 將規格定義陣列轉換為 Map 供快速查找
function buildSpecMap(definitions: any[]): Map<string, CategorySpec> {
    const map = new Map<string, CategorySpec>();
    definitions.forEach((s: any) => {
        const spec: CategorySpec = {
            id: s.id,
            name: s.name,
            key: s.id,
            type: s.type,
            expectedType: s.expected_type,
            options: s.options || [],
            defaultValue: s.default_value || '',
            logicConfig: s.logic_config as any,
            configuration: s.configuration,
            sort_order: s.sort_order || 0,
            quantity_source_id: s.quantity_source_id
        };
        map.set(s.id, spec);
    });
    return map;
}
