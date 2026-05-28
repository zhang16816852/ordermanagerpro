import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const DICTIONARY_CACHE_KEY = 'dictionary_cache_v1';

export interface DictionaryCacheData {
  categoriesVersion: number;
  categoriesUpdatedAt: string;
  categories: any[];
  
  specsVersion: number;
  specsUpdatedAt: string;
  specs: any[];
  
  deviceModelsVersion: number;
  deviceModelsUpdatedAt: string;
  deviceModels: any[];
  
  brandsVersion: number;
  brandsUpdatedAt: string;
  brands: any[];
}

const defaultCache: DictionaryCacheData = {
  categoriesVersion: 0,
  categoriesUpdatedAt: '',
  categories: [],
  
  specsVersion: 0,
  specsUpdatedAt: '',
  specs: [],
  
  deviceModelsVersion: 0,
  deviceModelsUpdatedAt: '',
  deviceModels: [],
  
  brandsVersion: 0,
  brandsUpdatedAt: '',
  brands: [],
};

export const getDictionaryCache = (): DictionaryCacheData => {
  try {
    const cached = localStorage.getItem(DICTIONARY_CACHE_KEY);
    if (!cached) return defaultCache;
    return { ...defaultCache, ...JSON.parse(cached) };
  } catch {
    localStorage.removeItem(DICTIONARY_CACHE_KEY);
    return defaultCache;
  }
};

export const setDictionaryCache = (cache: DictionaryCacheData) => {
  localStorage.setItem(DICTIONARY_CACHE_KEY, JSON.stringify(cache));
};

export const useDictionaryCache = () => {
  const [data, setData] = useState<DictionaryCacheData>(getDictionaryCache());
  const [isLoading, setIsLoading] = useState(true);

  const syncDictionary = async (force = false) => {
    setIsLoading(true);
    try {
      const local = getDictionaryCache();
      let updated = false;

      // 1. 取得伺服器最新版號
      const { data: serverVersions, error: versionError } = await supabase
        .from('data_versions')
        .select('*');

      if (versionError) throw versionError;

      const serverVerMap = new Map<string, { version: number; updated_at: string }>();
      serverVersions?.forEach((v: any) => {
        serverVerMap.set(v.table_name, { version: v.version, updated_at: v.updated_at });
      });

      const catVer = serverVerMap.get('categories') || { version: 1, updated_at: '' };
      const specVer = serverVerMap.get('specs') || { version: 1, updated_at: '' };
      // 若資料表沒有設定獨立的版號觸發器，則以 products / categories 變體版號為參考，或者預設以 date 為準
      const modelVer = serverVerMap.get('device_models') || { version: 1, updated_at: '' };
      const brandVer = serverVerMap.get('brands') || { version: 1, updated_at: '' };

      const formatVerLog = (tableName: string, typeName: string, localVer: number, serverVer: number, localTime: string, serverTime: string) => {
        const localTimeStr = localTime ? new Date(localTime).toISOString().slice(0, 10).replace(/-/g, '') : '無';
        const serverTimeStr = serverTime ? new Date(serverTime).toISOString().slice(0, 10).replace(/-/g, '') : '最新';
        return `[商品基礎快取] 發現【${typeName}變化】 (目前版本: ${localTimeStr}-v${localVer} -> 最新版本: ${serverTimeStr}-v${serverVer})，正在拉取更新...`;
      };

      // --- categories 同步 ---
      if (force || local.categoriesVersion < catVer.version || local.categories.length === 0) {
        console.log(formatVerLog('categories', '分類', local.categoriesVersion, catVer.version, local.categoriesUpdatedAt, catVer.updated_at));
        const { data: catData, error } = await supabase
          .from('categories')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.categories = catData || [];
        local.categoriesVersion = catVer.version;
        local.categoriesUpdatedAt = catVer.updated_at || new Date().toISOString();
        updated = true;
      }

      // --- specs 同步 ---
      if (force || local.specsVersion < specVer.version || local.specs.length === 0) {
        console.log(formatVerLog('specs', '規格', local.specsVersion, specVer.version, local.specsUpdatedAt, specVer.updated_at));
        const { data: specData, error } = await supabase
          .from('specification_definitions')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.specs = specData || [];
        local.specsVersion = specVer.version;
        local.specsUpdatedAt = specVer.updated_at || new Date().toISOString();
        updated = true;
      }

      // --- device_models 同步 ---
      if (force || local.deviceModelsVersion < modelVer.version || local.deviceModels.length === 0) {
        console.log(formatVerLog('device_models', '型號', local.deviceModelsVersion, modelVer.version, local.deviceModelsUpdatedAt, modelVer.updated_at));
        const { data: modelData, error } = await supabase
          .from('device_models')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.deviceModels = modelData || [];
        local.deviceModelsVersion = modelVer.version;
        local.deviceModelsUpdatedAt = modelVer.updated_at || new Date().toISOString();
        updated = true;
      }

      // --- brands 同步 ---
      if (force || local.brandsVersion < brandVer.version || local.brands.length === 0) {
        console.log(formatVerLog('brands', '品牌', local.brandsVersion, brandVer.version, local.brandsUpdatedAt, brandVer.updated_at));
        const { data: brandData, error } = await supabase
          .from('brands')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        local.brands = brandData || [];
        local.brandsVersion = brandVer.version;
        local.brandsUpdatedAt = brandVer.updated_at || new Date().toISOString();
        updated = true;
      }

      if (updated) {
        setDictionaryCache(local);
        setData(local);
      } else {
        console.log(`[商品基礎快取] 檢查完畢，各項字典 (分類/規格/型號/品牌) 皆為最新狀態。`);
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
