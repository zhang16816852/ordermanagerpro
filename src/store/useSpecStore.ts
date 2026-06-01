import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { CategorySpec } from '@/hooks/useCategorySpecs';
import { SyncManager, packVersion, formatTaipeiTime } from '@/services/syncManager';
import { CacheService, CACHE } from '@/services/cacheService';

const SPEC_CACHE_CFG = CACHE.specs;
const CAT_CACHE_CFG = CACHE.categories;

interface SpecTrigger {
  id: string;
  source_spec_id: string;
  target_spec_id: string;
  condition_dsl: any;
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
  fetchSpecs: (force?: boolean, incomingData?: any, version?: string) => Promise<void>;
  fetchCategories: (force?: boolean, incomingData?: any, version?: string) => Promise<void>;
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

        writeSpecCache({
          version: newSequenceId, definitions, triggers, categoryLinks,
          categories: get().categories, categoryHierarchy: get().categoryHierarchy,
          categoryVersion: get().categoryVersion,
        });

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

          if (isLocalEmpty && !version) {
            newSequenceId = get().categoryVersion !== '0' ? get().categoryVersion : packVersion(formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2), 1);
          } else if (!version) {
            const today = formatTaipeiTime().split(' ')[0].replace(/\//g, '').substring(2);
            newSequenceId = packVersion(today, 1);
          }
        }

        writeSpecCache({
          version: get().specVersion, definitions: get().specDefinitions,
          triggers: get().specTriggers, categoryLinks: get().categoryLinks,
          categories, categoryHierarchy,
          categoryVersion: newSequenceId,
        });

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
