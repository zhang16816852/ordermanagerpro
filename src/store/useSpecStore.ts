import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { CategorySpec } from '@/hooks/useCategorySpecs';
import { SyncManager, packVersion, formatTaipeiTime } from '@/services/syncManager';
import { CacheService, CACHE } from '@/services/cacheService';

const SPEC_CACHE_CFG = CACHE.specs;
const CAT_CACHE_CFG = CACHE.categories;

// 版本感知自動刷新：節流間隔（與 heartbeat 相同，控制 data_versions 查詢頻率）
const VERSION_CHECK_THROTTLE_MS = 5_000;
// 空資料自我修復的最小間隔：避免「版本號看似最新但本地資料為空」時每次心跳都重抓
const EMPTY_HEAL_MIN_INTERVAL_MS = 60_000;
let lastVersionCheckAt = 0;
let lastEmptyHealAt = 0;
let refreshingSpecs = false;
let heartbeatStarted = false;
let refreshChannel: BroadcastChannel | null = null;

function getRefreshChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!refreshChannel) {
    try {
      refreshChannel = new BroadcastChannel('spec-store-refresh');
    } catch {
      return null;
    }
  }
  return refreshChannel;
}

function startVersionHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  setInterval(() => {
    useSpecStore.getState().refreshIfStale(false);
  }, VERSION_CHECK_THROTTLE_MS);
}

interface SpecTrigger {
  id: string;
  source_spec_id: string;
  target_spec_id: string;
  condition_dsl: any;
  relation_type?: string;
  max_depth_limit: number;
  priority: number;
  created_at: string;
}

interface SpecStoreCache {
  version: string;
  definitions: any[];
  triggers: SpecTrigger[];
  categoryLinks: any[];
  categories: any[];
  categoryHierarchy: any[];
  categoryVersion: string;
}

function readSpecCache(): SpecStoreCache | null {
  const spec = CacheService.get<any>(SPEC_CACHE_CFG.key, SPEC_CACHE_CFG.schema);
  const cat = CacheService.get<any>(CAT_CACHE_CFG.key, CAT_CACHE_CFG.schema);
  if (!spec.exists && !cat.exists) return null;

  const cached = localStorage.getItem('specs_cache_v2');
  let legacy: any = {};
  if (cached) {
    try { legacy = JSON.parse(cached); } catch { /* ignore */ }
    localStorage.removeItem('specs_cache_v2');
  }

  return {
    version: spec.exists ? spec.dataVersion : legacy.version || '0',
    definitions: spec.exists ? (spec.data?.definitions ?? legacy.definitions ?? []) : legacy.definitions || [],
    triggers: spec.exists ? (spec.data?.triggers ?? legacy.triggers ?? []) : legacy.triggers || [],
    categoryLinks: spec.exists ? (spec.data?.categoryLinks ?? legacy.categoryLinks ?? []) : legacy.categoryLinks || [],
    categories: cat.exists ? (cat.data?.categories ?? legacy.categories ?? []) : legacy.categories || [],
    categoryHierarchy: cat.exists ? (cat.data?.categoryHierarchy ?? legacy.categoryHierarchy ?? []) : legacy.categoryHierarchy || [],
    categoryVersion: cat.exists ? cat.dataVersion : legacy.categoryVersion || '0',
  };
}

function writeSpecCache(data: SpecStoreCache) {
  if (data.definitions.length > 0 || data.triggers.length > 0 || data.categoryLinks.length > 0) {
    CacheService.set(SPEC_CACHE_CFG.key, {
      definitions: data.definitions,
      triggers: data.triggers,
      categoryLinks: data.categoryLinks,
    }, data.version, SPEC_CACHE_CFG.schema);
  }
  if (data.categories.length > 0 || data.categoryHierarchy.length > 0) {
    CacheService.set(CAT_CACHE_CFG.key, {
      categories: data.categories,
      categoryHierarchy: data.categoryHierarchy,
    }, data.categoryVersion, CAT_CACHE_CFG.schema);
  }
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
  fetchSpecs: (force?: boolean, incomingData?: any, version?: string, silent?: boolean) => Promise<void>;
  fetchCategories: (force?: boolean, incomingData?: any, version?: string, silent?: boolean) => Promise<void>;
  forceRefreshSpecs: () => Promise<void>;
  /** 版本感知自動刷新：比對 data_versions，落後才全量重抓（節流 + 跨 tab 廣播） */
  refreshIfStale: (notify?: boolean) => Promise<void>;
}

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

    // 數量連動 (relation_type='quantity') 與 連動觸發 (relation_type='visibility') 分開處理
    const quantityEntries: any[] = [];
    const groupedTriggers = specTriggers.reduce((acc, t) => {
      if (t.relation_type === 'quantity') {
        quantityEntries.push({ type: 'quantity', targets: [{ id: t.target_spec_id, is_quantity_detail: false }] });
        return acc;
      }
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
        triggers: [...Object.values(groupedTriggers), ...quantityEntries]
      }
    };
  });
};

export const useSpecStore = create<SpecStore>((set, get) => {
  const cache = readSpecCache();

  return {
    specDefinitions: cache?.definitions || [],
    specMap: cache?.definitions ? buildSpecMap(cache.definitions) : new Map(),
    specTriggers: cache?.triggers || [],
    categoryLinks: cache?.categoryLinks || [],
    specVersion: cache?.version || '0',

    categories: cache?.categories || [],
    categoryHierarchy: cache?.categoryHierarchy || [],
    categoryVersion: cache?.categoryVersion || '0',

    isLoading: false,

    invalidateCache: () => {
      CacheService.remove(SPEC_CACHE_CFG.key);
      CacheService.remove(CAT_CACHE_CFG.key);
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

    fetchSpecs: async (force = false, incomingData?: any, version?: string, silent = false) => {
      if (get().isLoading && !silent) return;
      if (!silent) set({ isLoading: true });
      try {
        let definitions = get().specDefinitions;
        let triggers = get().specTriggers;
        let categoryLinks = get().categoryLinks;
        let newSequenceId = version ?? get().specVersion;

        const isLocalEmpty = definitions.length === 0 || triggers.length === 0 || categoryLinks.length === 0;

        if (incomingData) {
          const { syncMode, snapshot, changes, deletedIds, serverSequenceId } = incomingData;
          newSequenceId = serverSequenceId;

          if (syncMode === 'full' && snapshot) {
            const snapshotData = Array.isArray(snapshot) ? snapshot : [];
            SyncManager.logTelemetry('📸 載入規格快照', '#e67e22', {
              '快照版本': serverSequenceId,
              '資料筆數': snapshotData.length
            });
            definitions = snapshotData;

            const [{ data: triggerData }, { data: catLinkData }] = await Promise.all([
              supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
              supabase.from('category_spec_links').select('*')
            ]);
            triggers = (triggerData || []) as unknown as SpecTrigger[];
            categoryLinks = catLinkData || [];
          }

          if (!Array.isArray(definitions)) definitions = [];
          const defMap = new Map(definitions.map(d => [d.id, d]));
          if (deletedIds) deletedIds.forEach(id => defMap.delete(id));

          if (changes) {
            changes.forEach((change: any) => {
              const oldData = defMap.get(change.id) || {};
              const newData = { ...oldData };
              Object.entries(change.data).forEach(([key, value]) => {
                if (value !== undefined) newData[key] = value;
              });
              defMap.set(change.id, newData);
            });
          }

          // [修正] 連動規則與分類連結一律重新抓取，避免增量路徑下 specTriggers 為空，
          // 造成預覽「全部顯示」與 IndexedDB 版本未隨伺服器推進（卡在舊版本）
          const [{ data: triggerData }, { data: catLinkData }] = await Promise.all([
            supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
            supabase.from('category_spec_links').select('*')
          ]);
          if (triggerData) triggers = triggerData as unknown as SpecTrigger[];
          if (catLinkData) categoryLinks = catLinkData || [];

          // [修正] 若基底定義為空（store 尚未從快取灌入），改走全量抓取，避免寫入空資料
          if (defMap.size === 0) {
            const { data: defData } = await supabase
              .from('specification_definitions')
              .select('*')
              .order('sort_order', { ascending: true });
            definitions = mergeTriggersToDefs(defData || [], triggers);
          } else {
            const rawDefinitions = Array.from(defMap.values());
            definitions = mergeTriggersToDefs(rawDefinitions, triggers);
          }
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

          if (force && !version) {
            // 強制重抓時，從 DB 讀取最新版本號，避免保持舊版本號導致下次比對失效
            const { data: versionData } = await (supabase
              .from('data_versions') as any)
              .select('version')
              .eq('table_name', 'specs')
              .single();
            if (versionData?.version) {
              newSequenceId = versionData.version;
            } else {
              const today = formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2);
              newSequenceId = packVersion(today, 1);
            }
          } else if (isLocalEmpty && !version) {
            newSequenceId = get().specVersion !== '0' ? get().specVersion : packVersion(formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2), 1);
          } else if (!version) {
            const today = formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2);
            newSequenceId = packVersion(today, 1);
          }
        }

        // 快取寫入失敗（IndexedDB 配額/隱私模式等）不可阻擋 store 版本更新，
        // 否則 version 永遠停在舊值 → refreshIfStale 每次心跳都判定落後 → 無限 force 重抓
        try {
          writeSpecCache({
            version: newSequenceId, definitions, triggers, categoryLinks,
            categories: get().categories, categoryHierarchy: get().categoryHierarchy,
            categoryVersion: get().categoryVersion,
          });
        } catch (cacheError) {
          console.warn('[SpecStore] ⚠️ 規格快取寫入失敗（不影響記憶體狀態）:', cacheError);
        }

        set({
          specDefinitions: definitions,
          specMap: buildSpecMap(definitions),
          specTriggers: triggers,
          categoryLinks,
          specVersion: newSequenceId,
          isLoading: silent ? get().isLoading : false
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
        if (!silent) set({ isLoading: false });
      }
    },

    // 強制重抓 specs（不依賴版本號比對，bypass 節流）
    forceRefreshSpecs: async () => {
      try {
        const { data: versionData } = await (supabase
          .from('data_versions') as any)
          .select('version')
          .eq('table_name', 'specs')
          .single();
        const latestVersion = versionData?.version || get().specVersion;
        await get().fetchSpecs(true, undefined, latestVersion, true);
      } catch (error) {
        console.error('[SpecStore] 強制重整失敗:', error);
      }
    },

    fetchCategories: async (force = false, incomingData?: any, version?: string, silent = false) => {
      if (get().isLoading && !silent) return;
      if (!silent) set({ isLoading: true });
      try {
        let categories = get().categories;
        let categoryHierarchy = get().categoryHierarchy;
        let newSequenceId = version ?? get().categoryVersion;

        const isLocalEmpty = categories.length === 0 || categoryHierarchy.length === 0;

        if (incomingData) {
          const { syncMode, snapshot, changes, deletedIds, serverSequenceId } = incomingData;
          newSequenceId = serverSequenceId;

          if (syncMode === 'full' && snapshot) {
            const snapshotData = Array.isArray(snapshot) ? snapshot : [];
            SyncManager.logTelemetry('📸 載入分類快照', '#1abc9c', {
              '快照版本': serverSequenceId,
              '資料筆數': snapshotData.length
            });
            categories = snapshotData;

            const { data: hierarchyData } = await supabase.from('category_hierarchy').select('*');
            categoryHierarchy = hierarchyData || [];
          }

          if (!Array.isArray(categories)) categories = [];
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

          if (!version) {
            // [修正] 未指定版本時從 DB 讀取最新 categories 版本號。
            // 舊邏輯用 packVersion(today, 1)（如 261020-0001）會低於伺服器真實版本，
            // 造成 refreshIfStale 每次心跳都判定落後 → 無限 force 重抓（console 刷屏根因）
            const { data: versionData } = await (supabase
              .from('data_versions') as any)
              .select('version')
              .eq('table_name', 'categories')
              .single();
            if (versionData?.version) {
              newSequenceId = versionData.version;
            } else if (get().categoryVersion === '0') {
              newSequenceId = packVersion(formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2), 1);
            } else {
              newSequenceId = get().categoryVersion;
            }
          }
        }

        // 快取寫入失敗不可阻擋 store 版本更新（否則版本停在舊值 → 無限 force 重抓）
        try {
          writeSpecCache({
            version: get().specVersion, definitions: get().specDefinitions,
            triggers: get().specTriggers, categoryLinks: get().categoryLinks,
            categories, categoryHierarchy,
            categoryVersion: newSequenceId,
          });
        } catch (cacheError) {
          console.warn('[SpecStore] ⚠️ 分類快取寫入失敗（不影響記憶體狀態）:', cacheError);
        }

        set({
          categories,
          categoryHierarchy,
          categoryVersion: newSequenceId,
          isLoading: silent ? get().isLoading : false
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
        if (!silent) set({ isLoading: false });
      }
    },

    refreshIfStale: async (notify = true) => {
      const now = Date.now();
      if (now - lastVersionCheckAt < VERSION_CHECK_THROTTLE_MS || refreshingSpecs) return;
      lastVersionCheckAt = now;
      refreshingSpecs = true;
      try {
        const versions = await CacheService.fetchServerVersions();
        let didRefresh = false;

        const serverSpecsVersion = versions['specs'] || '';
        const serverCategoriesVersion = versions['categories'] || '';

        if (serverSpecsVersion && serverSpecsVersion !== '0' && CacheService.isStale(get().specVersion, serverSpecsVersion)) {
          await get().fetchSpecs(true, undefined, serverSpecsVersion, true);
          didRefresh = true;
        }
        if (serverCategoriesVersion && serverCategoriesVersion !== '0' && CacheService.isStale(get().categoryVersion, serverCategoriesVersion)) {
          await get().fetchCategories(true, undefined, serverCategoriesVersion, true);
          didRefresh = true;
        }

        // 空資料自我修復：版本號看似最新但本地資料為空（例如先前 hierarchy 抓取失敗、寫入 [] 且版本已推進），
        // 此時僅比對版本號永遠不會重抓 → 祖先關聯/規格關聯永久遺失。以節流避免每次心跳都重抓。
        if (!didRefresh && Date.now() - lastEmptyHealAt > EMPTY_HEAL_MIN_INTERVAL_MS) {
          const s = get();
          const needSpecsHeal = s.specDefinitions.length === 0 || s.categoryLinks.length === 0;
          const needCategoriesHeal = s.categories.length === 0 || s.categoryHierarchy.length === 0;
          if (needSpecsHeal || needCategoriesHeal) {
            lastEmptyHealAt = Date.now();
            SyncManager.logTelemetry('📡 本地資料為空，執行自我修復', '#c0392b', {
              '規格定義': s.specDefinitions.length,
              '規格-分類連結': s.categoryLinks.length,
              '分類': s.categories.length,
              '分類階層': s.categoryHierarchy.length,
            });
            if (needSpecsHeal) {
              await get().fetchSpecs(true, undefined, serverSpecsVersion || get().specVersion, true);
            }
            if (needCategoriesHeal) {
              await get().fetchCategories(true, undefined, serverCategoriesVersion || get().categoryVersion, true);
            }
            didRefresh = true;
          }
        }

        if (didRefresh && notify) getRefreshChannel()?.postMessage('specs-refreshed');
      } catch (error) {
        console.warn('[SpecStore] ⚠️ 版本感知刷新失敗（沿用現有快取）:', error);
      } finally {
        refreshingSpecs = false;
      }
      startVersionHeartbeat();
    },
  };
});

// Supabase Realtime 訂閱 data_versions：當 specs 版本變動時，立即重抓快取（不依賴節流或 mount）
try {
  supabase.channel('spec-version-changes')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'data_versions',
      filter: `table_name=eq.'specs'`
    }, (payload: any) => {
      const newVersion = payload?.new?.version;
      if (newVersion && newVersion !== useSpecStore.getState().specVersion) {
        console.log('[SpecStore] Realtime 版本變更，觸發靜默重抓:', newVersion);
        useSpecStore.getState().fetchSpecs(true, undefined, newVersion, true);
      }
    })
    .subscribe();
} catch (err) {
  console.warn('[SpecStore] Realtime 訂閱失敗，沿用版本比對:', err);
}

// 跨 tab 同步：收到其他分頁已刷新的通知時，也檢查自身版本（不重播，避免廣播回圈）
getRefreshChannel()?.addEventListener('message', () => {
  useSpecStore.getState().refreshIfStale(false);
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
