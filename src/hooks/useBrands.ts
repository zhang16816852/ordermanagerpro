import { useDictionaryCache } from './useDictionaryCache';

/**
 * 全域品牌抓取與名稱映射 Hook
 */
export function useBrands() {
  const { brands, brandMap, getBrandName, isLoading, refresh } = useDictionaryCache();

  return {
    brands,
    brandMap,
    getBrandName,
    isLoading,
    refresh
  };
}

