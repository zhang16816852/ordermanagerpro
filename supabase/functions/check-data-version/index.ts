import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * 表名別名映射：Edge Function 接收的 tableName 可能與 data_versions 的 key 不同
 * 例如 SyncManager 傳 'specification_definitions'，但 data_versions 存的是 'specs'
 */
const TABLE_VERSION_ALIASES: Record<string, string> = {
  specification_definitions: 'specs',
  category_spec_links: 'specs',
  specification_triggers: 'specs',
};

/**
 * [V8.2] 增量同步 Diff 引擎
 * Fix: maxLog 為 null 時改查 data_versions 作為 fallback，避免回傳 '0'
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { tableName, lastSequenceId = '0' } = await req.json();
    if (!tableName) throw new Error('Missing tableName');

    console.log(`[DiffEngine] 📡 請求同步: ${tableName}, ClientSeq: ${lastSequenceId}`);

    // 如果是 0，或者是空，或者沒有包含 '-'，則視為需要全量同步的初始狀態
    const isInitial = !lastSequenceId || lastSequenceId === '0' || String(lastSequenceId).indexOf('-') === -1;

    // 1. 偵測 Gap (斷層檢查)
    const { data: border } = await supabase
      .from('data_change_logs')
      .select('version_tag')
      .eq('table_name', tableName)
      .order('version_tag', { ascending: true })
      .limit(1)
      .maybeSingle();

    const minVersionTag = border?.version_tag || '';
    
    // 如果客戶端是初始狀態，或者是斷層 (Client 序號比資料庫最舊的 Log 還舊)，則執行 Full Sync
    const needsFullSync = isInitial || (minVersionTag !== '' && String(lastSequenceId) < minVersionTag);

    let syncMode = 'incremental';
    let responseData: any = {};
    let serverSequenceId = String(lastSequenceId);

    if (needsFullSync) {
      // [Case A] 全量模式：快照 + 追蹤日誌
      console.log(`[DiffEngine] ⚠️ 偵測到斷層或冷啟動 (MinVersion: ${minVersionTag}), 執行全量同步...`);
      syncMode = 'full';
      
      const { data: snapshot } = await supabase
        .from('data_snapshots')
        .select('*')
        .eq('table_name', tableName)
        .maybeSingle();

      const snapshotSeq = snapshot?.last_sequence_id || '0-0000';
      
      // 抓取快照之後的所有增量日誌
      const { data: logs } = await supabase
        .from('data_change_logs')
        .select('*')
        .eq('table_name', tableName)
        .gt('version_tag', snapshotSeq)
        .order('version_tag', { ascending: true });

      const diffResult = await resolveLogsToData(supabase, tableName, logs || []);
      
      responseData = {
        snapshot: snapshot?.data_json || [],
        changes: diffResult.changes,
        deletedIds: diffResult.deletedIds,
        snapshotSequenceId: snapshotSeq
      };
      
      // [V8.3] data_versions 是版本權威來源，data_change_logs 只負責提供 diff 數據
      serverSequenceId = await getVersionFromDataVersions(supabase, tableName, snapshotSeq);
      console.log(`[DiffEngine] 📌 ${tableName} 全量版本 (from data_versions): ${serverSequenceId}`);

    } else {
      // [Case B] 增量模式：僅 Diff
      console.log(`[DiffEngine] ✅ 執行增量同步 (Seq > ${lastSequenceId})...`);
      const { data: logs } = await supabase
        .from('data_change_logs')
        .select('*')
        .eq('table_name', tableName)
        .gt('version_tag', lastSequenceId)
        .order('version_tag', { ascending: true });

      const diffResult = await resolveLogsToData(supabase, tableName, logs || []);
      
      syncMode = 'incremental';
      responseData = {
        changes: diffResult.changes,
        deletedIds: diffResult.deletedIds
      };
      
      // 增量 diff 的邊界仍用 data_change_logs（如果有的話）
      const diffBoundary = (logs && logs.length > 0)
        ? logs[logs.length - 1].version_tag
        : String(lastSequenceId);

      // [V8.3] 最終版本以 data_versions 為準（可能比 change log 更新）
      const dbVersion = await getVersionFromDataVersions(supabase, tableName, diffBoundary);
      serverSequenceId = dbVersion > diffBoundary ? dbVersion : diffBoundary;
      console.log(`[DiffEngine] 📌 ${tableName} 增量版本: diff=${diffBoundary}, db=${dbVersion}, final=${serverSequenceId}`);
    }

    return new Response(
      JSON.stringify({
        syncMode,
        ...responseData,
        serverSequenceId,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const errMsg = error?.message || String(error);
    console.error('[DiffEngine] 🔴 Error:', errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * [V8.2 新增] 從 data_versions 取得正確版本號
 * 支援表名別名映射（specification_definitions → specs）
 */
async function getVersionFromDataVersions(
  supabase: any,
  tableName: string,
  fallback: string
): Promise<string> {
  // 嘗試直接用 tableName 查
  const aliasKey = TABLE_VERSION_ALIASES[tableName] ?? tableName;

  // 先查原始表名，再查別名
  const keysToTry = Array.from(new Set([tableName, aliasKey]));

  for (const key of keysToTry) {
    const { data } = await supabase
      .from('data_versions')
      .select('version')
      .eq('table_name', key)
      .maybeSingle();

    if (data?.version && String(data.version).indexOf('-') !== -1) {
      return String(data.version);
    }
  }

  return fallback;
}

/**
 * 核心輔助：將日誌流解析為最終異動資料 (Event Compaction + Batch Fetch)
 */
async function resolveLogsToData(supabase: any, tableName: string, logs: any[]) {
  if (!logs || logs.length === 0) return { changes: [], deletedIds: [] };

  // 1. Defensive Sorting & Deduplication (事件去重)
  const sortedLogs = [...logs].sort((a, b) => Number(a.id) - Number(b.id));
  const latestEvents = new Map<string, any>();
  
  sortedLogs.forEach(log => {
    latestEvents.set(log.record_id, log);
  });

  const idsToFetch: string[] = [];
  const deletedIds: string[] = [];

  for (const [recordId, log] of latestEvents) {
    if (log.action === 'DELETE') {
      deletedIds.push(recordId);
    } else {
      idsToFetch.push(recordId);
    }
  }

  // 2. Batch Fetch 最新資料
  let changes: any[] = [];
  if (idsToFetch.length > 0) {
    const pkCol = await getPrimaryKeyColumn(supabase, tableName);
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .in(pkCol, idsToFetch);

    if (error) console.error(`[DiffEngine] 📡 Fetch Error for ${tableName}:`, error);
    
    changes = (data || []).map((item: any) => ({
      id: item[pkCol],
      action: 'UPSERT',
      data: item
    }));
  }

  return { changes, deletedIds };
}

/**
 * 取得資料表的主鍵欄位名 (由 SQL sync_table_metadata 維護)
 */
async function getPrimaryKeyColumn(supabase: any, tableName: string): Promise<string> {
  const { data } = await supabase
    .from('sync_table_metadata')
    .select('pk_column')
    .eq('table_name', tableName)
    .maybeSingle();
  return data?.pk_column || 'id';
}
