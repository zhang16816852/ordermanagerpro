import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { CategorySpec } from '@/hooks/useCategorySpecs';
import { SyncManager, packVersion, formatTaipeiTime } from '@/services/syncManager';

// 本地快取 Key (升級為 v2，強制清除可能損毀的舊快取)
const SPEC_CACHE_KEY = 'specs_cache_v2';

// 對應資料庫 specification_triggers 表的實際結構
interface SpecTrigger {
    id: string;
    source_spec_id: string;
    target_spec_id: string;
    condition_dsl: any;
    max_depth_limit: number;
    priority: number;
    created_at: string;
}

interface SpecCache {
    version: string; // 儲存 lastSequenceId
    definitions: any[];
    triggers: SpecTrigger[];
    categoryLinks: any[];
    categories: any[];
    categoryHierarchy: any[];
    categoryVersion: string; // 儲存 lastCategorySequenceId
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
    specDefinitions: any[];
    specMap: Map<string, CategorySpec>;
    specTriggers: SpecTrigger[];
    categoryLinks: any[];
    specVersion: string;
    categories: any[];
    categoryHierarchy: any[];
    categoryVersion: string;
    isLoading: boolean;
    invalidateCache: () => void;
    setDefinitions: (newDefs: any[]) => void;
    fetchSpecs: (force?: boolean, incomingData?: any, version?: string) => Promise<void>;
    fetchCategories: (force?: boolean, incomingData?: any, version?: string) => Promise<void>;
}

/**
 * [V7.5] 將獨立存放的 specification_triggers 合併回 definitions.logic_config
 */
const mergeTriggersToDefs = (definitions: any[], triggers: any[]) => {
    return definitions.map(def => {
        const specTriggers = triggers.filter(t => t.source_spec_id === def.id);
        if (specTriggers.length === 0) {
            const legacyTriggers = def.logic_config?.triggers || [];
            return {
                ...def,
                logic_config: { ...(def.logic_config as any || {}), triggers: legacyTriggers }
            };
        }

        const groupedTriggers = specTriggers.reduce((acc, t) => {
            const dsl = (t.condition_dsl as any) || {};
            const key = `${dsl.on_value}-${dsl.operator}`;
            if (!acc[key]) {
                acc[key] = { on_value: dsl.on_value, operator: dsl.operator || 'eq', targets: [] };
            }
            acc[key].targets.push({ id: t.target_spec_id, is_quantity_detail: dsl.is_quantity_detail || false });
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

export const useSpecStore = create<SpecStore>((set, get) => {
    const cache = getLocalSpecCache();

    return {
        specDefinitions: cache?.definitions || [],
        specMap: new Map(), // 將在下文由 buildSpecMap 初始化
        specTriggers: cache?.triggers || [],
        categoryLinks: cache?.categoryLinks || [],
        specVersion: cache?.version || '0',
        
        categories: cache?.categories || [],
        categoryHierarchy: cache?.categoryHierarchy || [],
        categoryVersion: cache?.categoryVersion || '0',

        isLoading: false,

        invalidateCache: () => {
            localStorage.removeItem(SPEC_CACHE_KEY);
            set({
                specDefinitions: [],
                specMap: new Map(),
                specTriggers: [],
                categoryLinks: [],
                specVersion: '0',
                categories: [],
                categoryHierarchy: [],
                categoryVersion: '0'
            });
        },

        setDefinitions: (newDefs: any[]) => {
            const specMap = buildSpecMap(newDefs);
            set({ specDefinitions: newDefs, specMap });
        },

        fetchSpecs: async (force = false, incomingData?: any, version?: string) => {
            if (get().isLoading) return;
            set({ isLoading: true });
            try {
                let definitions = get().specDefinitions;
                let triggers = get().specTriggers;
                let categoryLinks = get().categoryLinks;
                let newSequenceId = version ?? get().specVersion;

                const isLocalEmpty = definitions.length === 0 || triggers.length === 0 || categoryLinks.length === 0;

                if (incomingData) {
                    const { syncMode, snapshot, changes, deletedIds, serverSequenceId } = incomingData;
                    newSequenceId = serverSequenceId;

                    // 1. 全量快照模式 (Gap Recovery)
                    if (syncMode === 'full' && snapshot) {
                        SyncManager.logTelemetry('📸 載入規格快照', '#e67e22', {
                            '快照版本': serverSequenceId,
                            '資料筆數': snapshot.length
                        });
                        definitions = snapshot;

                        // 必須同時抓取全量關聯表
                        const [{ data: triggerData }, { data: catLinkData }] = await Promise.all([
                            supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
                            supabase.from('category_spec_links').select('*')
                        ]);
                        triggers = (triggerData || []) as unknown as SpecTrigger[];
                        categoryLinks = catLinkData || [];
                    }

                    // 2. 建立 Map 進行 Smart Merge
                    const defMap = new Map(definitions.map(d => [d.id, d]));
                    
                    // 3. 處理刪除 (Tombstone)
                    if (deletedIds) deletedIds.forEach(id => defMap.delete(id));

                    // 4. 處理增量 Patch (基於時序的單緒回放)
                    if (changes) {
                        changes.forEach((change: any) => {
                            const oldData = defMap.get(change.id) || {};
                            const newData = { ...oldData };
                            // 欄位級 Patch Merge: 僅覆蓋非 undefined 欄位
                            Object.entries(change.data).forEach(([key, value]) => {
                                if (value !== undefined) newData[key] = value;
                            });
                            defMap.set(change.id, newData);
                        });
                    }

                    // 防禦機制：如果本地為空，強補關聯資料
                    if (categoryLinks.length === 0 || triggers.length === 0) {
                        const [{ data: triggerData }, { data: catLinkData }] = await Promise.all([
                            supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
                            supabase.from('category_spec_links').select('*')
                        ]);
                        if (triggers.length === 0 && triggerData) triggers = triggerData as unknown as SpecTrigger[];
                        if (categoryLinks.length === 0 && catLinkData) categoryLinks = catLinkData || [];
                    }

                    const rawDefinitions = Array.from(defMap.values());
                    definitions = mergeTriggersToDefs(rawDefinitions, triggers);
                } else if (force || isLocalEmpty) {
                    SyncManager.logTelemetry('📡 執行規格完整重整/修復', '#e67e22', { 
                        '原因': force ? 'force=true' : '本地規格或關聯快取為空，啟動自我修復' 
                    });
                    const [{ data: defData }, { data: triggerData }, { data: catLinkData }] = await Promise.all([
                        supabase.from('specification_definitions').select('*').order('sort_order', { ascending: true }),
                        supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
                        supabase.from('category_spec_links').select('*')
                    ]);
                    triggers = (triggerData || []) as unknown as SpecTrigger[];
                    categoryLinks = catLinkData || [];
                    definitions = mergeTriggersToDefs(defData || [], triggers);
                    
                    if (isLocalEmpty && !version) {
                        newSequenceId = get().specVersion !== '0' ? get().specVersion : packVersion(formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2), 1);
                    } else if (!version) {
                        const today = formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2);
                        newSequenceId = packVersion(today, 1);
                    }
                }

                const currentCache = getLocalSpecCache() || { version: '0', definitions: [], triggers: [], categoryLinks: [], categories: [], categoryHierarchy: [], categoryVersion: '0' };
                setLocalSpecCache({ ...currentCache, version: newSequenceId, definitions, triggers, categoryLinks });

                set({
                    specDefinitions: definitions,
                    specMap: buildSpecMap(definitions),
                    specTriggers: triggers,
                    categoryLinks,
                    specVersion: newSequenceId,
                    isLoading: false
                });

                if (incomingData) {
                    SyncManager.logTelemetry('✅ 規格同步完成', '#2ecc71', {
                        '同步模式': incomingData.syncMode,
                        '更新版本': newSequenceId,
                        '定義筆數': definitions.length
                    });
                }
            } catch (error) {
                console.error('[SpecStore] 🔴 規格同步失敗:', error);
                set({ isLoading: false });
            }
        },

        fetchCategories: async (force = false, incomingData?: any, version?: string) => {
            if (get().isLoading) return;
            set({ isLoading: true });
            try {
                let categories = get().categories;
                let categoryHierarchy = get().categoryHierarchy;
                let newSequenceId = version ?? get().categoryVersion;

                const isLocalEmpty = categories.length === 0 || categoryHierarchy.length === 0;

                if (incomingData) {
                    const { syncMode, snapshot, changes, deletedIds, serverSequenceId } = incomingData;
                    newSequenceId = serverSequenceId;

                    if (syncMode === 'full' && snapshot) {
                        SyncManager.logTelemetry('📸 載入分類快照', '#1abc9c', {
                            '快照版本': serverSequenceId,
                            '資料筆數': snapshot.length
                        });
                        categories = snapshot;

                        // 必須同時抓取全量層級表
                        const { data: hierarchyData } = await supabase.from('category_hierarchy').select('*');
                        categoryHierarchy = hierarchyData || [];
                    }

                    const catMap = new Map(categories.map(c => [c.id, c]));
                    if (deletedIds) deletedIds.forEach(id => catMap.delete(id));
                    if (changes) {
                        changes.forEach((change: any) => {
                            const oldData = catMap.get(change.id) || {};
                            const newData = { ...oldData };
                            Object.entries(change.data).forEach(([key, value]) => {
                                if (value !== undefined) newData[key] = value;
                            });
                            catMap.set(change.id, newData);
                        });
                    }
                    categories = Array.from(catMap.values());

                    // 防禦機制：若本地層級為空，強補層級資料
                    if (categoryHierarchy.length === 0) {
                        const { data: hierarchyData } = await supabase.from('category_hierarchy').select('*');
                        categoryHierarchy = hierarchyData || [];
                    }
                } else if (force || isLocalEmpty) {
                    SyncManager.logTelemetry('📡 執行分類完整重整/修復', '#1abc9c', { 
                        '原因': force ? 'force=true' : '本地分類或層級快取為空，啟動自我修復' 
                    });
                    const [{ data: catData }, { data: hierarchyData }] = await Promise.all([
                        supabase.from('categories').select('*').order('sort_order', { ascending: true }),
                        supabase.from('category_hierarchy').select('*')
                    ]);
                    categories = catData || [];
                    categoryHierarchy = hierarchyData || [];
                    
                    if (isLocalEmpty && !version) {
                        newSequenceId = get().categoryVersion !== '0' ? get().categoryVersion : packVersion(formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2), 1);
                    } else if (!version) {
                        const today = formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2);
                        newSequenceId = packVersion(today, 1);
                    }
                }

                const currentCache = getLocalSpecCache() || { version: '0', definitions: [], triggers: [], categoryLinks: [], categories: [], categoryHierarchy: [], categoryVersion: '0' };
                setLocalSpecCache({ ...currentCache, categories, categoryHierarchy, categoryVersion: newSequenceId });

                set({
                    categories,
                    categoryHierarchy,
                    categoryVersion: newSequenceId,
                    isLoading: false
                });

                if (incomingData) {
                    SyncManager.logTelemetry('🏷️ 分類同步完成', '#1abc9c', {
                        '同步模式': incomingData.syncMode,
                        '更新版本': newSequenceId,
                        '分類筆數': categories.length
                    });
                }
            } catch (error) {
                console.error('[SpecStore] 🔴 分類同步失敗:', error);
                set({ isLoading: false });
            }
        },
    };
});

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
