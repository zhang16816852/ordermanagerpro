import { supabase } from '@/integrations/supabase/client';

export interface BatchOptions<T> {
    batchSize?: number;
    onProgress?: (progress: number, processed: number, total: number) => void;
    onBatchComplete?: (batchIndex: number, successCount: number, errorCount: number) => void;
    filterUnchanged?: (item: T) => boolean;
}

export interface BatchResult<T> {
    success: boolean;
    processedCount: number;
    skippedCount: number;
    errors: { item: T; error: any }[];
}

/**
 * [V8.1] 全域統一批次處理控制中心 (Unified BatchProcessor)
 * 整合分批寫入、零異動過濾、與交易重試及進度追蹤
 */
export class BatchProcessor {
    /**
     * 通用分批執行主方法
     */
    static async processBatch<T>(
        entityType: string,
        items: T[],
        uploader: (chunk: T[]) => Promise<any>,
        options: BatchOptions<T> = {}
    ): Promise<BatchResult<T>> {
        const batchSize = options.batchSize || 200;
        const result: BatchResult<T> = {
            success: true,
            processedCount: 0,
            skippedCount: 0,
            errors: []
        };

        // 1. 執行零異動過濾 (若有設定過濾器)
        let itemsToProcess = items;
        if (options.filterUnchanged) {
            itemsToProcess = items.filter(item => {
                const needsUpload = options.filterUnchanged!(item);
                if (!needsUpload) {
                    result.skippedCount++;
                }
                return needsUpload;
            });
        }

        const totalItems = itemsToProcess.length;
        if (totalItems === 0) {
            console.log(`%c[BatchProcessor] 🟢 ${entityType} 零異動，無須上傳。跳過所有項目。`, 'color: #2ecc71; font-weight: bold');
            options.onProgress?.(100, 0, items.length);
            return result;
        }

        console.log(`%c[BatchProcessor] 🏁 開始批次處理 ${entityType}。共 ${items.length} 筆，過濾後待上傳 ${totalItems} 筆，每批 ${batchSize} 筆。`, 'color: #3498db; font-weight: bold');

        // 2. 切分 chunks 分批上傳
        const chunks: T[][] = [];
        for (let i = 0; i < totalItems; i += batchSize) {
            chunks.push(itemsToProcess.slice(i, i + batchSize));
        }

        for (let batchIndex = 0; batchIndex < chunks.length; batchIndex++) {
            const chunk = chunks[batchIndex];
            try {
                // 執行特定上傳程序
                await uploader(chunk);
                result.processedCount += chunk.length;

                // 觸發單批完成回呼
                options.onBatchComplete?.(batchIndex, chunk.length, 0);
            } catch (err: any) {
                console.error(`[BatchProcessor] 🔴 批次 ${batchIndex + 1} 失敗:`, err);
                result.success = false;
                chunk.forEach(item => {
                    result.errors.push({ item, error: err });
                });
                options.onBatchComplete?.(batchIndex, 0, chunk.length);
            }

            // 計算並更新進度
            const currentProcessed = result.processedCount + result.skippedCount;
            const progress = Math.round((currentProcessed / items.length) * 100);
            options.onProgress?.(progress, currentProcessed, items.length);
        }

        // 3. 全面同步完成後通知觸發資料庫版本標記 (由 syncManager 管理)
        console.log(`%c[BatchProcessor] ✨ ${entityType} 批次同步結束。成功: ${result.processedCount}, 跳過: ${result.skippedCount}, 失敗: ${result.errors.length}`, 'color: #3498db; font-weight: bold');
        return result;
    }
}
