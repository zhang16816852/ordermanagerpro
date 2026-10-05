-- 強化 supplier_product_mappings 相關內部 helper 的權限與 search_path
--
-- 背景：20261003000001 新增的 trigger function `_spm_normalize_row()` 未設定
--       `SET search_path`，被 Supabase security advisor 標為
--       `function_search_path_mutable`（WARN）；且建立時沿用 Postgres 預設，
--       對 PUBLIC / anon / authenticated 都留有 EXECUTE。
--
-- 本 migration（皆為冪等）：
--   1) 重發 `_spm_normalize_row()` 並加上 `SET search_path TO 'public','extensions'`
--      ——body 只用 btrim / COALESCE / NULLIF / now()（皆在 pg_catalog），
--      固定 search_path 後可消除 advisory，且與全站 helper 慣例一致。
--      簽名與回傳不變，trigger 不需重建（CREATE OR REPLACE 會沿用原 trigger 綁定）。
--   2) REVOKE `_spm_normalize_row()` 的 EXECUTE（內部 helper 不對外）。
--      ⚠️ trigger 觸發時不會重新檢查 EXECUTE 權限，故撤銷不影響 trigger 運作。
--   3) 補上 `_po_resolve_item()` 的明確 REVOKE。該函式非 SECURITY DEFINER
--      （預設 SECURITY INVOKER），遠端 ACL 目前僅 postgres / service_role，
--      但撤銷語句原本只存在於遠端、未落在 migration 檔；補齊以確保
--      `supabase db push` 到新環境時權限一致（避免日後 CREATE OR REPLACE
--      夾帶 explicit grant 而繼承）。
--
-- 注意：`REVOKE ... FROM public` 指的是角色 PUBLIC；若日後有人對這些函式
--      另下 `GRANT ... TO authenticated`，explicit grant 優先於 PUBLIC，
--      必須把 authenticated 一併列入 REVOKE（見 AGENTS.md 物流批次教訓）。

-- ── 1) 重發 _spm_normalize_row：加上固定 search_path ─────────────────────
CREATE OR REPLACE FUNCTION public._spm_normalize_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.vendor_product_id := NULLIF(btrim(COALESCE(NEW.vendor_product_id, '')), '');
  IF NEW.vendor_product_id IS NULL THEN
    RAISE EXCEPTION '廠商料號不可為空白';
  END IF;

  IF NEW.vendor_product_name IS NOT NULL THEN
    NEW.vendor_product_name := NULLIF(btrim(NEW.vendor_product_name), '');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2) 撤銷 trigger function 的對外 EXECUTE ──────────────────────────────
REVOKE ALL ON FUNCTION public._spm_normalize_row() FROM public, anon, authenticated;

-- ── 3) 補齊 _po_resolve_item 的明確 REVOKE ──────────────────────────────
REVOKE ALL ON FUNCTION public._po_resolve_item(uuid, uuid, uuid, text)
  FROM public, anon, authenticated;