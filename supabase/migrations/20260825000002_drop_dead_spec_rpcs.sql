-- 移除未被前端 / Edge Function 使用的規格連動 RPC（死碼）
-- 規格可見性 / 連動評估統一由前端 src/utils/specTree.ts 的 getVisibleSpecsTree 負責，
-- 後端僅負責持久化（specification_triggers 表 + specification_definitions.logic_config JSON）。
-- 先刪除依賴 safe_eval_dsl 的 get_visible_specs_v6，再刪除 safe_eval_dsl 本身。

DROP FUNCTION IF EXISTS public.get_visible_specs_v6(uuid, jsonb);
DROP FUNCTION IF EXISTS public.safe_eval_dsl(jsonb, spec_value_type, jsonb);
