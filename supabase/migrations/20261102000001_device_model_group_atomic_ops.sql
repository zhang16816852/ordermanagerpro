-- ============================================================
-- device_model_groups：原子化操作 RPC（刪除決策 + 改名/新建碰撞處理）
-- 目的：軟刪除列不再阻擋名稱重用；刪除時依引用數決定硬/軟刪除；
--       改名/新建碰撞到軟刪除列時自動清理或合併（re-point 引用 / 復活），不需詢問。
-- ============================================================

-- A. 安全網：僅活躍列名稱唯一
ALTER TABLE public.device_model_groups DROP CONSTRAINT IF EXISTS device_model_groups_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS device_model_groups_name_active_key
  ON public.device_model_groups (name) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- RPC 1：刪除時機的 B 決策
-- refs=0 → 硬刪除；refs>0 → 軟刪除（保留引用）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_device_model_group(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_refs INT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除群組');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dmg_delete:' || p_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.device_model_groups WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '群組不存在');
  END IF;

  SELECT (SELECT count(*) FROM public.device_model_group_items WHERE group_id = p_id)
       + (SELECT count(*) FROM public.entity_model_relations WHERE group_id = p_id)
    INTO v_refs;

  IF v_refs = 0 THEN
    DELETE FROM public.device_model_groups WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'mode', 'hard', 'ref_count', 0);
  ELSE
    UPDATE public.device_model_groups SET deleted_at = now(), updated_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'mode', 'soft', 'ref_count', v_refs);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.delete_device_model_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_device_model_group(UUID) TO authenticated;

-- ------------------------------------------------------------
-- RPC 2：改名（原子化，自動處理軟刪除碰撞）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_device_model_group(p_id UUID, p_new_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT := regexp_replace(trim(p_new_name), '\s+', ' ', 'g');
  v_deleted RECORD;
  v_refs INT;
  v_deleted_list JSONB := '[]'::jsonb;
  v_merged_list  JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可編輯群組');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '群組名稱不可為空');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dmg_rename:' || v_name));

  IF NOT EXISTS (SELECT 1 FROM public.device_model_groups WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '群組不存在');
  END IF;

  -- 活躍群組間不可重名
  IF EXISTS (
    SELECT 1 FROM public.device_model_groups
    WHERE name = v_name AND deleted_at IS NULL AND id <> p_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此名稱已被其他活躍群組使用');
  END IF;

  -- 處理所有同名軟刪除群組：無引用硬刪；有引用 re-point 後硬刪
  FOR v_deleted IN
    SELECT id FROM public.device_model_groups WHERE name = v_name AND deleted_at IS NOT NULL
  LOOP
    SELECT (SELECT count(*) FROM public.device_model_group_items WHERE group_id = v_deleted.id)
         + (SELECT count(*) FROM public.entity_model_relations WHERE group_id = v_deleted.id)
      INTO v_refs;

    IF v_refs = 0 THEN
      DELETE FROM public.device_model_groups WHERE id = v_deleted.id;
      v_deleted_list := v_deleted_list || jsonb_build_array(v_deleted.id);
    ELSE
      -- C：引用重新指向被保留的群組
      UPDATE public.device_model_group_items SET group_id = p_id WHERE group_id = v_deleted.id;
      UPDATE public.entity_model_relations SET group_id = p_id WHERE group_id = v_deleted.id;
      DELETE FROM public.device_model_groups WHERE id = v_deleted.id;
      v_merged_list := v_merged_list || jsonb_build_array(v_deleted.id);
    END IF;
  END LOOP;

  -- 實際改名
  UPDATE public.device_model_groups SET name = v_name, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted_list, 'merged', v_merged_list);
END $$;

REVOKE ALL ON FUNCTION public.rename_device_model_group(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_device_model_group(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- RPC 3：新建（原子化，自動處理軟刪除碰撞）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_device_model_group(p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT := regexp_replace(trim(p_name), '\s+', ' ', 'g');
  v_deleted RECORD;
  v_refs INT;
  v_revived_id UUID;
  v_new_id UUID;
  v_deleted_list JSONB := '[]'::jsonb;
  v_merged_list  JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可建立群組');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '群組名稱不可為空');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('dmg_create:' || v_name));

  -- 活躍群組已使用此名稱
  IF EXISTS (SELECT 1 FROM public.device_model_groups WHERE name = v_name AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此名稱已被活躍群組使用');
  END IF;

  -- 處理所有同名軟刪除群組
  FOR v_deleted IN
    SELECT id FROM public.device_model_groups WHERE name = v_name AND deleted_at IS NOT NULL
  LOOP
    SELECT (SELECT count(*) FROM public.device_model_group_items WHERE group_id = v_deleted.id)
         + (SELECT count(*) FROM public.entity_model_relations WHERE group_id = v_deleted.id)
      INTO v_refs;

    IF v_refs = 0 THEN
      DELETE FROM public.device_model_groups WHERE id = v_deleted.id;
      v_deleted_list := v_deleted_list || jsonb_build_array(v_deleted.id);
    ELSE
      -- C：復活軟刪除列（引用保留，群組重新活躍）
      UPDATE public.device_model_groups
         SET deleted_at = NULL, description = COALESCE(p_description, description), updated_at = now()
       WHERE id = v_deleted.id
      RETURNING id INTO v_revived_id;
      v_merged_list := v_merged_list || jsonb_build_array(v_deleted.id);
    END IF;
  END LOOP;

  -- 若已復活，直接回傳復活的 id；否則新建
  IF v_revived_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'mode', 'revived', 'group_id', v_revived_id,
      'deleted', v_deleted_list, 'merged', v_merged_list);
  END IF;

  INSERT INTO public.device_model_groups (name, description)
  VALUES (v_name, p_description)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'mode', 'created', 'group_id', v_new_id,
    'deleted', v_deleted_list, 'merged', v_merged_list);
END $$;

REVOKE ALL ON FUNCTION public.create_device_model_group(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_device_model_group(TEXT, TEXT) TO authenticated;