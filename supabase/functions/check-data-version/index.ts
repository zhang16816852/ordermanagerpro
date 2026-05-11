import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * [V7.5] 增量同步 Diff 引擎
 * 採用 Event Stream (data_change_logs) + Snapshot (data_snapshots) 架構
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { tableName, lastSequenceId = 0 } = await req.json();
    if (!tableName) throw new Error('Missing tableName');

    console.log(`[DiffEngine] 📡 請求同步: ${tableName}, ClientSeq: ${lastSequenceId}`);

    // 1. 偵測 Gap (斷層檢查)
    const { data: border } = await supabase
      .from('data_change_logs')
      .select('id')
      .eq('table_name', tableName)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    const minLogId = border?.id ? Number(border.id) : 0;
    
    // 如果客戶端是 0，或者是斷層 (Client 序號比資料庫最舊的 Log 還舊)，則執行 Full Sync
    const needsFullSync = Number(lastSequenceId) === 0 || Number(lastSequenceId) < minLogId;

    let syncMode = 'incremental';
    let responseData: any = {};
    let serverSequenceId = Number(lastSequenceId);

    if (needsFullSync) {
      // [Case A] 全量模式：快照 + 追蹤日誌
      console.log(`[DiffEngine] ⚠️ 偵測到斷層或冷啟動 (MinLog: ${minLogId}), 執行全量同步...`);
      syncMode = 'full';
      
      const { data: snapshot } = await supabase
        .from('data_snapshots')
        .select('*')
        .eq('table_name', tableName)
        .maybeSingle();

      const snapshotSeq = snapshot?.last_sequence_id ? Number(snapshot.last_sequence_id) : 0;
      
      // 抓取快照之後的所有增量日誌
      const { data: logs } = await supabase
        .from('data_change_logs')
        .select('*')
        .eq('table_name', tableName)
        .gt('id', snapshotSeq)
        .order('id', { ascending: true });

      const diffResult = await resolveLogsToData(supabase, tableName, logs || []);
      
      responseData = {
        snapshot: snapshot?.data_json || [],
        changes: diffResult.changes,
        deletedIds: diffResult.deletedIds,
        snapshotSequenceId: snapshotSeq
      };
      
      // 取得全系統當前最新序號
      const { data: maxLog } = await supabase
        .from('data_change_logs')
        .select('id')
        .order('id', { descending: true })
        .limit(1)
        .maybeSingle();
      serverSequenceId = maxLog?.id ? Number(maxLog.id) : snapshotSeq;

    } else {
      // [Case B] 增量模式：僅 Diff
      console.log(`[DiffEngine] ✅ 執行增量同步 (Seq > ${lastSequenceId})...`);
      const { data: logs } = await supabase
        .from('data_change_logs')
        .select('*')
        .eq('table_name', tableName)
        .gt('id', lastSequenceId)
        .order('id', { ascending: true });

      const diffResult = await resolveLogsToData(supabase, tableName, logs || []);
      
      syncMode = 'incremental';
      responseData = {
        changes: diffResult.changes,
        deletedIds: diffResult.deletedIds
      };
      
      // 更新 Server 序號為最新的 Log ID
      if (logs && logs.length > 0) {
        serverSequenceId = Number(logs[logs.length - 1].id);
      } else {
        // 若無新日誌，仍抓取全域最新 ID 確保 Client Checkpoint 與 Server 同步
        const { data: maxLog } = await supabase
          .from('data_change_logs')
          .select('id')
          .order('id', { descending: true })
          .limit(1)
          .maybeSingle();
        serverSequenceId = maxLog?.id ? Number(maxLog.id) : Number(lastSequenceId);
      }
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
 * 核心輔助：將日誌流解析為最終異動資料 (Event Compaction + Batch Fetch)
 */
async function resolveLogsToData(supabase: any, tableName: string, logs: any[]) {
  if (!logs || logs.length === 0) return { changes: [], deletedIds: [] };

  // 1. Defensive Sorting & Deduplication (事件去重)
  // 確保順序正確，且同一個 ID 僅保留最後一個動作
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

  // 2. Batch Fetch 最新資料 (解決 N+1 效能問題)
  let changes: any[] = [];
  if (idsToFetch.length > 0) {
    const pkCol = await getPrimaryKeyColumn(supabase, tableName);
    
    // 從對應主表抓取 UPSERT 狀態的完整資料
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
