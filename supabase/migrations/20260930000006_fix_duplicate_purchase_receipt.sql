-- 20260930000006 移除維修叫料重複收貨 movement（資料修復）
--
-- 背景：舊「維修建立直接收貨」流程對同一零件寫入兩筆 purchase_receipt。
--   ac88bf2d-781a-4132-aa64-be304acc31cf  06:11:18  +1
--   1276c083-a9ea-4fbb-b39f-bfb2cf76ff90  06:12:06  +1   （相隔 48 秒）
-- 兩者商品/變體/倉庫完全相同（IRP_WP-SC-IP14PM），第一筆原本掛在一張
-- 0 品項的空殼採購單上（已於 20260930000004 改掛到本單），屬同一筆收貨
-- 被記錄兩次。該採購單僅 1 個品項（qty 1 / received 1 / consumed 1 / total 30）。
--
-- 修復（依使用者 2026-09-30 指示，判定為重複收貨）：
--   1. 刪除重複的那筆 purchase_receipt ac88bf2d
--   2. 回沖 product_inventory 1 → 0
--   3. 修正存活 movement 的 balance_after 連鎖（2→1、1→0），使帳面一致
--      修正後鏈：+1 (ba 1) → repair_part_usage -1 (ba 0)，期末庫存 0
--
-- 註：不另寫 manual_adjustment 沖銷分錄——若補在「現在」會排在
--     repair_part_usage 之後，使 running balance 變成 -1 與實際庫存矛盾。
--     此為移除錯誤紀錄的資料修復，稽核軌跡由本 migration 與 git 保留。
BEGIN;

DELETE FROM public.inventory_movements
 WHERE id = 'ac88bf2d-781a-4132-aa64-be304acc31cf';

UPDATE public.inventory_movements SET balance_after = 1
 WHERE id = '1276c083-a9ea-4fbb-b39f-bfb2cf76ff90';

UPDATE public.inventory_movements SET balance_after = 0
 WHERE id = 'b998869d-38a8-4db3-ab25-dc7c07caa291';

UPDATE public.product_inventory SET quantity = 0
 WHERE product_id = '401c24f0-bdf2-48c9-804a-ad5fdd56e318'
   AND variant_id = '3d7d3a26-5423-469c-aa6b-2402ccbc1c44'
   AND warehouse_id = '287d3d14-35d2-4e53-bcb1-81b65ef3fc79';

COMMIT;
