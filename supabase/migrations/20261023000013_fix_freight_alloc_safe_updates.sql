-- 20261023000013_fix_freight_alloc_safe_updates.sql
--
-- 根因：_po_allocate_freight 內對臨時表執行的 EXECUTE format('UPDATE %I ...')
--       全部沒有 WHERE 子句。PostgREST 以 authenticator 身分連線時 pg_safeupdate
--       會攔下無 WHERE 的 UPDATE/DELETE 並拋 21000「UPDATE requires a WHERE clause」，
--       因此前端呼叫 allocate_purchase_freight 一律失敗（DB 內以 postgres 身分測試則正常）。
--
-- 修法：只補作用域 WHERE poi_id IS NOT NULL，分配數學完全不變（臨時表每列必有 poi_id）。
--       採 DO-block 錨點補丁（比照 20261017000000），以字面 replace() 逐句補上，
--       每組錨點命中次數不符即 fail-loud，避免盲改。
--
-- 註：00004 內有兩句等價的 SET base_cent（trunc 子查詢版與 floor 直算版），
--     遠端線上的函式本體只有 floor 版，本補丁只處理線上實際存在的 12 處。

DO $do$
DECLARE
  v_def    text;
  v_new    text;
  v_before text;
  v_from   text[];
  v_to     text[];
  v_expect int[];
  v_found  int;
  i        int;
  v_pat    constant text := ' WHERE poi_id IS NOT NULL';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = '_po_allocate_freight';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '[freight-alloc-safe-updates] 找不到 public._po_allocate_freight';
  END IF;

  v_found := (length(v_def) - length(replace(v_def, v_pat, ''))) / length(v_pat);

  IF v_found = 13 THEN
    RAISE NOTICE '[freight-alloc-safe-updates] 已修復，略過';
    RETURN;
  ELSIF v_found <> 0 THEN
    RAISE EXCEPTION '[freight-alloc-safe-updates] 已有 % 處 WHERE poi_id IS NOT NULL，狀態非預期', v_found;
  END IF;

  v_from := ARRAY[
    $q1$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity ELSE 0 END'$q1$,
    $q2$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN raw_weight * quantity * $1 ELSE 0 END'$q2$,
    $q3$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN raw_volume * quantity ELSE 0 END'$q3$,
    $q4$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity * COALESCE(unit_cost,0) ELSE 0 END'$q4$,
    $q5$'UPDATE %I SET w = COALESCE(manual_weight, 0)'$q5$,
    $q6$'UPDATE %I SET w = 1'$q6$,
    $q7$'UPDATE %I SET base_cent = floor($1::numeric * w / $2::numeric)::bigint'$q7$,
    $q8$'UPDATE %I SET rem = (($1::bigint * w)::numeric %% $2::numeric)::bigint'$q8$,
    $q9$END)::numeric / 100.0'$q9$,
    $q10$THEN round(unit_cost + allocated / quantity, 2) ELSE unit_cost END'$q10$
  ];

  v_to := ARRAY[
    $q1$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity ELSE 0 END WHERE poi_id IS NOT NULL'$q1$,
    $q2$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN raw_weight * quantity * $1 ELSE 0 END WHERE poi_id IS NOT NULL'$q2$,
    $q3$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN raw_volume * quantity ELSE 0 END WHERE poi_id IS NOT NULL'$q3$,
    $q4$'UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity * COALESCE(unit_cost,0) ELSE 0 END WHERE poi_id IS NOT NULL'$q4$,
    $q5$'UPDATE %I SET w = COALESCE(manual_weight, 0) WHERE poi_id IS NOT NULL'$q5$,
    $q6$'UPDATE %I SET w = 1 WHERE poi_id IS NOT NULL'$q6$,
    $q7$'UPDATE %I SET base_cent = floor($1::numeric * w / $2::numeric)::bigint WHERE poi_id IS NOT NULL'$q7$,
    $q8$'UPDATE %I SET rem = (($1::bigint * w)::numeric %% $2::numeric)::bigint WHERE poi_id IS NOT NULL'$q8$,
    $q9$END)::numeric / 100.0 WHERE poi_id IS NOT NULL'$q9$,
    $q10$THEN round(unit_cost + allocated / quantity, 2) ELSE unit_cost END WHERE poi_id IS NOT NULL'$q10$
  ];

  v_expect := ARRAY[3, 1, 1, 1, 1, 1, 1, 1, 1, 1];

  v_new := v_def;

  FOR i IN 1 .. array_length(v_from, 1) LOOP
    v_before := v_new;
    v_new := replace(v_new, v_from[i], v_to[i]);

    IF (length(v_before) - length(replace(v_before, v_from[i], ''))) / length(v_from[i]) <> v_expect[i] THEN
      RAISE EXCEPTION '[freight-alloc-safe-updates] 錨點 % 命中次數不符（預期 % 次）', i, v_expect[i];
    END IF;
  END LOOP;

  IF (length(v_new) - length(replace(v_new, v_pat, ''))) / length(v_pat) <> 13 THEN
    RAISE EXCEPTION '[freight-alloc-safe-updates] 補丁後 WHERE 數量不是 13';
  END IF;

  EXECUTE v_new;

  RAISE NOTICE '[freight-alloc-safe-updates] _po_allocate_freight 已補上 12 處 WHERE poi_id IS NOT NULL';
END
$do$;

-- 權限沿舊：CREATE OR REPLACE 不會重設既有 ACL，
-- 遠端實查 anon / authenticated / public 對 _po_allocate_freight 皆無 EXECUTE，
-- 僅能經由 SECURITY DEFINER 的公開 RPC 間接呼叫，故無需重發 REVOKE/GRANT。
