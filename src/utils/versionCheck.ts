import { supabase } from '@/integrations/supabase/client';
import { useSpecStore } from '@/store/useSpecStore';
import { getProductCache, syncProducts } from '@/hooks/useProductCache';

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
 * [V7.5] 向 Edge Function 校驗資料序列點
 */
export async function checkServerSequence(tableName: string, lastSequenceId: number) {
    try {
        const { data, error } = await supabase.functions.invoke('check-data-version', {
            body: { tableName, lastSequenceId }
        });

        if (error) throw error;
        
        // 如果伺服器序號大於客戶端，或者 syncMode 為 full，則需要更新
        const needsUpdate = data.syncMode === 'full' || data.serverSequenceId > lastSequenceId;
        
        return {
            needsUpdate,
            syncMode: data.syncMode,
            data: data, // 包含 snapshot, changes, deletedIds 等
            serverSequenceId: data.serverSequenceId
        };
    } catch (err) {
        console.error(`[VersionCheck] 🔴 ${tableName} 校驗失敗:`, err);
        return null;
    }
}

/**
 * [V7.5] 全域資料同步協調器 (Orchestrator)
 */
export const performGlobalDataSync = async () => {
    const now = formatTaipeiTime();
    console.log(`%c[GlobalSync] 🏁 啟動全域增量同步 @ ${now}`, 'color: #3498db; font-weight: bold');

    try {
        // 1. 同步規格 (Specs)
        const specsCache = JSON.parse(localStorage.getItem('specs_cache_v2') || '{}');
        const specSeq = specsCache.version || 0;
        
        const specResult = await checkServerSequence('specification_definitions', specSeq);
        if (specResult?.needsUpdate) {
            await useSpecStore.getState().fetchSpecs(false, specResult.data, specResult.serverSequenceId);
        } else {
            await useSpecStore.getState().fetchSpecs(false);
        }

        // 2. 同步分類 (Categories)
        const catSeq = specsCache.categoryVersion || 0;
        const catResult = await checkServerSequence('categories', catSeq);
        if (catResult?.needsUpdate) {
            await useSpecStore.getState().fetchCategories(false, catResult.data, catResult.serverSequenceId);
        } else {
            await useSpecStore.getState().fetchCategories(false);
        }

        // 3. 同步產品 (Products)
        const prodCache = getProductCache();
        const prodSeq = prodCache?.version || 0;
        
        const prodResult = await checkServerSequence('products', prodSeq);
        let productsUpdated = false;

        if (prodResult?.needsUpdate) {
            console.log(`[GlobalSync] 🔄 產品資料有異動，觸發全量拉取 (涵蓋複雜關聯)`);
            // Option A: Pass undefined as incomingData to force full fetch, but pass the new sequence ID
            await syncProducts(undefined, prodResult.serverSequenceId);
            productsUpdated = true;
        }

        // 4. 同步變體 (Variants)
        if (!productsUpdated) {
            // 注意：產品的 sequenceId 通常涵蓋了變體，但若有獨立異動則檢查
            const vResult = await checkServerSequence('product_variants', prodSeq);
            if (vResult?.needsUpdate) {
                console.log(`[GlobalSync] 🔄 變體資料有異動，觸發全量拉取 (涵蓋複雜關聯)`);
                await syncProducts(undefined, vResult.serverSequenceId);
            }
        }

        console.log(`%c[GlobalSync] ✨ 全域序列同步完成`, 'color: #3498db; font-weight: bold');
    } catch (err) {
        console.error('[GlobalSync] 🔴 同步過程發生異常:', err);
    }
};
