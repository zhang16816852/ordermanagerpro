import { supabase } from '@/integrations/supabase/client';
import { useSpecStore } from '@/store/useSpecStore';
import { getProductCache, syncProducts, setProductCache } from '@/hooks/useProductCache';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { CacheService, CACHE } from '@/services/cacheService';

export function formatTaipeiTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

export function packVersion(dateStr: string, seq: number): string {
  return `${dateStr}-${String(seq).padStart(4, '0')}`;
}

export function unpackVersion(versionStr: string): { date: string; seq: number } {
  if (!versionStr || versionStr.indexOf('-') === -1) {
    return { date: formatTaipeiTime(new Date()).split(' ')[0].replace(/\//g, '').substring(2), seq: 0 };
  }
  const [date, seqStr] = versionStr.split('-');
  return { date, seq: parseInt(seqStr, 10) || 0 };
}

/**
 * [V8.1] 全域快取、校驗與版本控制中心 (SyncManager)
 * 統一快取生命週期管理，並整合樂觀 UI 更新
 */
export class SyncManager {
  /**
   * 向 Edge Function 校驗資料序列版本點
   */
  static async checkServerSequence(tableName: string, lastSequenceId: string) {
    try {
      const { data, error } = await supabase.functions.invoke('check-data-version', {
        body: { tableName, lastSequenceId }
      });

      if (error) throw error;

      const needsUpdate = data.syncMode === 'full' || data.serverSequenceId > lastSequenceId;

      return {
        needsUpdate,
        syncMode: data.syncMode,
        data: data,
        serverSequenceId: data.serverSequenceId
      };
    } catch (err) {
      console.error(`[SyncManager] 🔴 ${tableName} 版本校驗失敗:`, err);
      return null;
    }
  }

  static logTelemetry(title: string, color: string, details: Record<string, any>) {
    const time = formatTaipeiTime();
    console.groupCollapsed(`%c[SyncManager] ${title} @ ${time}`, `color: ${color}; font-weight: bold`);
    Object.entries(details).forEach(([k, v]) => {
      console.log(`%c${k}:`, 'color: #7f8c8d; font-weight: bold', v);
    });
    console.groupEnd();
  }

  /**
   * 全域資料同步協調器 (Orchestrator)
   */
  static async performGlobalDataSync(forceFull = false) {
    SyncManager.logTelemetry('🏁 啟動全域增量校驗同步', '#3498db', {
      '模式': forceFull ? '強制全量刷新' : '增量同步'
    });

    const finalVersions: Record<string, string> = {};

    try {
      // 1. 同步規格 (Specs)
      const specCached = CacheService.get<any>(CACHE.specs.key, CACHE.specs.schema);
      const specSeq = forceFull ? '0' : (specCached.exists ? specCached.dataVersion : '0');

      const specResult = await this.checkServerSequence('specification_definitions', specSeq);
      if (specResult?.needsUpdate) {
        this.logTelemetry('🔄 規格資料更新中', '#e67e22', {
          '同步模式': specResult.syncMode,
          '客戶端版本': specSeq,
          '伺服器版本': specResult.serverSequenceId
        });
        await useSpecStore.getState().fetchSpecs(false, specResult.data, specResult.serverSequenceId);
        finalVersions['規格 (specs)'] = specResult.serverSequenceId;
      } else {
        await useSpecStore.getState().fetchSpecs(false);
        finalVersions['規格 (specs)'] = `${specSeq} (無異動)`;
      }

      // 2. 同步分類 (Categories)
      const catCached = CacheService.get<any>(CACHE.categories.key, CACHE.categories.schema);
      const catSeq = forceFull ? '0' : (catCached.exists ? catCached.dataVersion : '0');

      const catResult = await this.checkServerSequence('categories', catSeq);
      if (catResult?.needsUpdate) {
        this.logTelemetry('🏷️ 分類資料更新中', '#1abc9c', {
          '同步模式': catResult.syncMode,
          '客戶端版本': catSeq,
          '伺服器版本': catResult.serverSequenceId
        });
        await useSpecStore.getState().fetchCategories(false, catResult.data, catResult.serverSequenceId);
        finalVersions['分類 (categories)'] = catResult.serverSequenceId;
      } else {
        await useSpecStore.getState().fetchCategories(false);
        finalVersions['分類 (categories)'] = `${catSeq} (無異動)`;
      }

      // 3. 同步產品 (Products)
      const prodCache = getProductCache();
      const prodSeq = forceFull ? '0' : (prodCache?.version || '0');

      const prodResult = await this.checkServerSequence('products', String(prodSeq));
      let productsUpdated = false;

      if (prodResult?.needsUpdate) {
        this.logTelemetry('📦 產品資料更新中', '#9b59b6', {
          '同步模式': prodResult.syncMode,
          '客戶端版本': prodSeq,
          '伺服器版本': prodResult.serverSequenceId
        });
        const updatedProducts = await syncProducts(undefined, prodResult.serverSequenceId);
        productsUpdated = true;
        finalVersions['產品 (products)'] = prodResult.serverSequenceId;
      } else {
        finalVersions['產品 (products)'] = `${prodSeq} (無異動)`;
      }

      // 4. 同步變體 (Variants)
      if (!productsUpdated) {
        const vResult = await this.checkServerSequence('product_variants', String(prodSeq));
        if (vResult?.needsUpdate) {
          this.logTelemetry('🧬 變體關聯異動', '#e74c3c', {
            '客戶端版本': prodSeq,
            '伺服器版本': vResult.serverSequenceId
          });
          await syncProducts(undefined, vResult.serverSequenceId);
          finalVersions['變體 (variants)'] = vResult.serverSequenceId;
        } else {
          finalVersions['變體 (variants)'] = `${prodSeq} (無異動)`;
        }
      } else {
        finalVersions['變體 (variants)'] = '已隨產品同步更新';
      }

      // 5. 同步型號與型號群組 (Device Models)
      const deviceCached = CacheService.get<any>(CACHE.deviceModels.key, CACHE.deviceModels.schema);
      const deviceSeq = forceFull ? '0' : (deviceCached.exists ? deviceCached.dataVersion : '0');

      const deviceResult = await this.checkServerSequence('device_models', deviceSeq);
      if (deviceResult?.needsUpdate) {
        this.logTelemetry('📱 型號資料更新中', '#f1c40f', {
          '同步模式': deviceResult.syncMode,
          '客戶端版本': deviceSeq,
          '伺服器版本': deviceResult.serverSequenceId
        });
        await useDeviceModelStore.getState().fetchData(true, deviceResult.serverSequenceId);
        finalVersions['型號 (device_models)'] = deviceResult.serverSequenceId;
      } else {
        await useDeviceModelStore.getState().fetchData(false);
        finalVersions['型號 (device_models)'] = `${deviceSeq} (無異動)`;
      }

      SyncManager.logTelemetry('✨ 全域快取校驗完成', '#2ecc71', {
        '完成狀態': '成功',
        ...finalVersions
      });
    } catch (err) {
      console.error('[SyncManager] 🔴 同步過程發生異常:', err);
    }
  }

  /**
   * 樂觀快取寫入與推送更新 (防止 UI 變更遲滯)
   */
  static updateAndPropagateProducts(newProducts: any[], serverVersion: string) {
    setProductCache({ version: serverVersion as any, data: newProducts });

    SyncManager.logTelemetry('⚡ 樂觀快取推送', '#f39c12', {
      '更新版本': serverVersion,
      '產品筆數': newProducts.length,
      '狀態': '畫面即時反應中'
    });

    window.dispatchEvent(new CustomEvent('optimistic-product-cache-update', {
      detail: { version: serverVersion, data: newProducts }
    }));
  }
}
