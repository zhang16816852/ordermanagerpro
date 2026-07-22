import { supabase } from '@/integrations/supabase/client';

/**
 * 伺服器版本快取：追蹤 data_versions 表的最新版本。
 * 在 init() 時預載入，之後供 isStale 快速比較。
 */
class VersionCache {
  private versions = new Map<string, string>();

  /** 從 Supabase data_versions 預載入所有版本 */
  async preload(): Promise<void> {
    try {
      const { data } = await supabase
        .from('data_versions')
        .select('table_name, version');
      if (data) {
        data.forEach((v: any) => {
          this.versions.set(v.table_name, String(v.version));
        });
      }
    } catch (err) {
      console.error('[VersionCache] Preload failed:', err);
    }
  }

  get(tableName: string): string {
    return this.versions.get(tableName) || '0';
  }

  set(tableName: string, version: string): void {
    this.versions.set(tableName, version);
  }

  /** 正確的版本比較 (YYMMDD-xxxx 字串比較) */
  isStale(localVersion: string, tableName: string): boolean {
    if (!localVersion || localVersion === '0') return true;
    const serverVersion = this.get(tableName);
    if (!serverVersion || serverVersion === '0') return false;
    return serverVersion > localVersion;
  }

  /** 直接比較兩個版本字串 */
  static compareVersions(a: string, b: string): number {
    if (a > b) return 1;
    if (a < b) return -1;
    return 0;
  }
}

export const versionCache = new VersionCache();
