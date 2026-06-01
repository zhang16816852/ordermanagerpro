import { useState, useEffect, useCallback, useRef } from 'react';
import { CacheService, type FetchResult } from '@/services/cacheService';

interface UseCacheOptions<T> {
  cacheKey: string;
  schemaVersion: number;
  versionTableName: string;
  fetchFn: () => Promise<FetchResult<T>>;
  staleWhileRevalidate?: boolean;
}

interface UseCacheResult<T> {
  data: T | null;
  isLoading: boolean;
  isRevalidating: boolean;
  dataVersion: string;
  refresh: () => Promise<void>;
}

/**
 * Unified cache hook with stale-while-revalidate pattern:
 * 1. Show cached data immediately (if schema matches)
 * 2. Background-check server version via lightweight data_versions query
 * 3. Re-fetch only if server version is newer
 */
export function useCache<T>({
  cacheKey,
  schemaVersion,
  versionTableName,
  fetchFn,
  staleWhileRevalidate = true,
}: UseCacheOptions<T>): UseCacheResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [dataVersion, setDataVersion] = useState('0');
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchFn();
      if (!mountedRef.current) return;
      CacheService.set(cacheKey, result.data, result.version, schemaVersion);
      setData(result.data);
      setDataVersion(result.version);
    } catch (err) {
      console.error(`[useCache] ${cacheKey} fetch failed:`, err);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [cacheKey, schemaVersion, fetchFn]);

  const refresh = useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  useEffect(() => {
    mountedRef.current = true;

    const cached = CacheService.get<T>(cacheKey, schemaVersion);

    if (cached.exists && cached.data !== null) {
      setData(cached.data);
      setDataVersion(cached.dataVersion);
      setIsLoading(false);

      if (staleWhileRevalidate) {
        setIsRevalidating(true);
        CacheService.fetchServerVersions().then(serverVersions => {
          if (!mountedRef.current) return;
          const serverVersion = serverVersions[versionTableName] || '0';
          if (CacheService.isStale(cached.dataVersion, serverVersion)) {
            return fetchFn().then(result => {
              if (!mountedRef.current) return;
              CacheService.set(cacheKey, result.data, result.version, schemaVersion);
              setData(result.data);
              setDataVersion(result.version);
            });
          }
        }).catch(() => {}).finally(() => {
          if (mountedRef.current) setIsRevalidating(false);
        });
      }
    } else {
      doFetch();
    }

    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, schemaVersion, versionTableName]);

  return { data, isLoading, isRevalidating, dataVersion, refresh };
}
