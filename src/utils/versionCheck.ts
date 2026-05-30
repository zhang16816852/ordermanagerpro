import { SyncManager, formatTaipeiTime, packVersion, unpackVersion } from '@/services/syncManager';

export { formatTaipeiTime, packVersion, unpackVersion };

/**
 * [V8.1] 向 Edge Function 校驗資料序列點 (委託給 SyncManager)
 */
export async function checkServerSequence(tableName: string, lastSequenceId: any) {
    return SyncManager.checkServerSequence(tableName, String(lastSequenceId));
}

/**
 * [V8.1] 全域資料同步協調器 (Orchestrator) (委託給 SyncManager)
 */
export const performGlobalDataSync = async () => {
    return SyncManager.performGlobalDataSync(false);
};
