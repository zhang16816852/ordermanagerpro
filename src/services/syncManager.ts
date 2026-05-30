import { supabase } from '@/integrations/supabase/client';
import { useSpecStore } from '@/store/useSpecStore';
import { getProductCache, syncProducts, setProductCache } from '@/hooks/useProductCache';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';

/**
 * 格式化時間為台北時間 (UTC+8)
 */
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

/**
 * 前端版本打包與拆解工具函數
 */
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
            
            // 由於採用 YYMMDD-xxxx 字串大小比對，如果 syncMode 為 full 或伺服器版本大於客戶端版本，則需要更新
            const needsUpdate = data.syncMode === 'full' || data.serverSequenceId > lastSequenceId;
            
            return {
                needsUpdate,
                syncMode: data.syncMode,
                data: data, // 包含 snapshot, changes, deletedIds 等
                serverSequenceId: data.serverSequenceId
            };
        } catch (err) {
            console.error(`[SyncManager] 🔴 ${tableName} 版本校驗失敗:`, err);
            return null;
        }
    }

    /**
     * [極緻美感 Telemetry] 全域日誌折疊輸出
     */
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

        // 追蹤各表最終版本（用於完成 Telemetry 顯示）
        const finalVersions: Record<string, string> = {};

        try {
            // 1. 同步規格 (Specs)
            const specsCache = JSON.parse(localStorage.getItem('specs_cache_v2') || '{}');
            const specSeq = forceFull ? '0' : (specsCache.version || '0');
            
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
            const catSeq = forceFull ? '0' : (specsCache.categoryVersion || '0');
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
            const deviceModelsCache = JSON.parse(localStorage.getItem('device_models_cache_v2') || '{}');
            const deviceSeq = forceFull ? '0' : (deviceModelsCache.version || '0');
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
        // 1. 寫入 LocalStorage 快取
        setProductCache({ version: serverVersion as any, data: newProducts });

        // 2. 透過事件或主動更新 Zustand 等前端 React 快取訂閱，促使畫面立即重繪
        // 在我們的系統中，useStoreProductCache 與 useProductCache 直接讀取 getProductCache()，
        // 這裡我們可以使用全域 React Query invalidation 或自訂事件讓訂閱 Hook 樂觀更新！
        SyncManager.logTelemetry('⚡ 樂觀快取推送', '#f39c12', {
            '更新版本': serverVersion,
            '產品筆數': newProducts.length,
            '狀態': '畫面即時反應中'
        });
        
        // 觸發全域廣播事件讓 hooks 知道要重加載快取
        window.dispatchEvent(new CustomEvent('optimistic-product-cache-update', {
            detail: { version: serverVersion, data: newProducts }
        }));
    }
}
