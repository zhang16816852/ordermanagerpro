import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CacheService } from '@/services/cacheService';

const CACHE_KEY = 'ac_dictionary_v1';
const SCHEMA_VERSION = 1;

export interface DictionaryCacheData {
  categoriesVersion: string;
  categories: any[];
  specsVersion: string;
  specs: any[];
  deviceModelsVersion: string;
  deviceModels: any[];
  brandsVersion: string;
  brands: any[];
}

const defaultCache: DictionaryCacheData = {
  categoriesVersion: '0',
  categories: [],
  specsVersion: '0',
  specs: [],
  deviceModelsVersion: '0',
  deviceModels: [],
  brandsVersion: '0',
  brands: [],
};

export const getDictionaryCache = (): DictionaryCacheData => {
  const result = CacheService.get<DictionaryCacheData>(CACHE_KEY, SCHEMA_VERSION);
  if (result.exists && result.data) return result.data;

  // Migrate from old cache
  try {
    const old = localStorage.getItem('dictionary_cache_v1');
    if (old) {
      const parsed = JSON.parse(old);
      const migrated: DictionaryCacheData = {
        categoriesVersion: String(parsed.categoriesVersion || '0'),
        categories: parsed.categories || [],
        specsVersion: String(parsed.specsVersion || '0'),
        specs: parsed.specs || [],
        deviceModelsVersion: String(parsed.deviceModelsVersion || '0'),
        deviceModels: parsed.deviceModels || [],
        brandsVersion: String(parsed.brandsVersion || '0'),
        brands: parsed.brands || [],
      };
      CacheService.set(CACHE_KEY, migrated, '0', SCHEMA_VERSION);
      localStorage.removeItem('dictionary_cache_v1');
      return migrated;
    }
  } catch { /* ignore */ }
  return defaultCache;
};

export const setDictionaryCache = (cache: DictionaryCacheData) => {
  CacheService.set(CACHE_KEY, cache, '0', SCHEMA_VERSION);
};

export const useDictionaryCache = () => {
  const [data, setData] = useState<DictionaryCacheData>(getDictionaryCache());
  const [isLoading, setIsLoading] = useState(true);

  const syncDictionary = async (force = false) => {
    setIsLoading(true);
    try {
      const local = getDictionaryCache();
      let updated = false;

      const { data: serverVersions, error: versionError } = await supabase
        .from('data_versions')
        .select('*');

      if (versionError) throw versionError;

      const serverVerMap = new Map<string, { version: string; updated_at: string }>();
      serverVersions?.forEach((v: any) => {
        serverVerMap.set(v.table_name, { version: String(v.version), updated_at: v.updated_at });
      });

      const catVer = serverVerMap.get('categories') || { version: '1', updated_at: '' };
      const specVer = serverVerMap.get('specs') || { version: '1', updated_at: '' };
      const modelVer = serverVerMap.get('device_models') || { version: '1', updated_at: '' };
      const brandVer = serverVerMap.get('brands') || { version: '1', updated_at: '' };

      const needsUpdate = (localVer: string, serverVer: string, items: any[]) =>
        force || serverVer > localVer || items.length === 0;

      if (needsUpdate(local.categoriesVersion, catVer.version, local.categories)) {
        const { data: catData, error } = await supabase
          .from('categories')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.categories = catData || [];
        local.categoriesVersion = catVer.version;
        updated = true;
      }

      if (needsUpdate(local.specsVersion, specVer.version, local.specs)) {
        const { data: specData, error } = await supabase
          .from('specification_definitions')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.specs = specData || [];
        local.specsVersion = specVer.version;
        updated = true;
      }

      if (needsUpdate(local.deviceModelsVersion, modelVer.version, local.deviceModels)) {
        const { data: modelData, error } = await supabase
          .from('device_models')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.deviceModels = modelData || [];
        local.deviceModelsVersion = modelVer.version;
        updated = true;
      }

      if (needsUpdate(local.brandsVersion, brandVer.version, local.brands)) {
        const { data: brandData, error } = await supabase
          .from('brands')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.brands = brandData || [];
        local.brandsVersion = brandVer.version;
        updated = true;
      }

      if (updated) {
        setDictionaryCache(local);
        setData(local);
      }
    } catch (error) {
      console.error('[DictionaryCache] 🔴 同步失敗:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncDictionary();
  }, []);

  const brandMap = useMemo(() => {
    const map: Record<string, string> = {};
    data.brands.forEach((b: any) => {
      map[b.id] = b.name;
    });
    return map;
  }, [data.brands]);

  const getBrandName = (brandId: string | null | undefined) => {
    if (!brandId) return '-';
    return brandMap[brandId] || brandId;
  };

  return {
    categories: data.categories,
    specs: data.specs,
    deviceModels: data.deviceModels,
    brands: data.brands,
    brandMap,
    getBrandName,
    isLoading,
    refresh: () => syncDictionary(true),
  };
};
