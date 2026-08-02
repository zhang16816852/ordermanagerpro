# Order Manager Pro — 專案記憶

本檔案由 AI 自動載入並**持續維護**。開新對話前請先完整閱讀本檔；詳細內容再依需求 lazy-load 下方指定文件。

## 專案一句話

手機/3C 通路訂單管理系統：後台管理（商品/品牌/庫存/採購/會計/出貨）+ 門市端（訂單/銷貨/維修/收貨）+ 媒合市場，採「Supabase 後端 + IndexedDB 離線優先快取」架構。

## 技術棧

- **前端**：React 18 + Vite 5 + TypeScript（strict）+ Tailwind 3 + shadcn/ui
- **狀態**：React Query（`@tanstack/react-query`）+ Zustand（`@/store/`）
- **後端**：Supabase（Postgres + Auth + 2 支 Edge Function + Storage）
- **離線快取**：IndexedDB（`idb`）+ 記憶體快取 + 版本校驗
- 套件管理器：npm（另有 bun.lock，開發以 npm 為主）

## 常用指令

```sh
npm run dev          # 開發伺服器
npm run build        # 建置
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run supabase:types  # 從 Supabase 重新產生 src/integrations/supabase/types.ts
```

## 目錄導覽

- `src/routes/`：`admin.tsx`（`/admin/*`）、`store.tsx`（門市）、`shared.tsx`（auth/分享/404）、`index.tsx` 組合路由與權限包裝
- `src/pages/`：`admin/`、`store/`、`market/`、`share/`、`Auth.tsx`、`AcceptInvite.tsx`
- `src/services/`：離線快取與同步核心（見下方）
- `src/hooks/`：資料讀取 hooks（`useProductCache`、`useCache`、`useAuth`、`useCreateOrder` 等）
- `src/store/`：Zustand stores（`useSpecStore`、`useDeviceModelStore`、`useOrderDraftStore`、`useFilterStore`、`useColorStore`）
- `src/integrations/supabase/`：`client.ts`（supabase client）、`types.ts`（自動產生，勿手改）
- `supabase/migrations/`：70 支 SQL migration（唯一 schema 權威來源，另含 brands_ui_diff.patch）
- `supabase/functions/`：Edge Functions
- `.agent/`：架構文件（歷史紀錄保留）

## 系統架構摘要

### 權限與角色（雙層）
- `user_roles`：`system_role` = `admin` | `customer`
- `store_users`：`store_role` = `founder` | `manager` | `employee`，關聯 `stores`
- 登入後 `useAuth`（`src/hooks/useAuth.tsx`）抓取兩種角色；`isAdmin` 決定跳轉 `/admin` 或 `/dashboard`
- RLS 用 `has_role()`、`is_store_member()`、`get_store_role()` 函式

### 離線優先快取（核心架構）
```
App 啟動 → CacheService.init()（src/services/cacheService.ts）
  → versionCache.preload()（讀 data_versions 版本表）
  → 將 IndexedDB 各 store 載入 memoryStorage（內存快取）

讀取：useCache hook（src/hooks/useCache.ts，stale-while-revalidate）
  → 先回傳記憶體快取 → 背景比對 data_versions 版本 → 過期才重抓

同步：SyncManager.performGlobalDataSync()（src/services/syncManager.ts）
  → 呼叫 check-data-version Edge Function（增量 Diff 引擎）
  → 依 data_change_logs 回傳增量 changes/deletedIds 或全量 snapshot

寫入：樂觀更新 → SyncManager.updateAndPropagateProducts()
  → window 事件「optimistic-product-cache-update」廣播到 UI
```
- 快取設定在 `cacheService.ts` 的 `CACHE` 常數（key/schema/versionKey/idbStore）
- IDB adapter：`src/services/indexedDBAdapter.ts`（`idbReplaceAll` 原子替換）
- 版本格式：`YYMMDD-XXXX` 字串比較（`versionCache.ts`）

### 訂單資料流（門市端範例）
`StoreOrderList.tsx` 用 React Query 直接查 Supabase（orders + order_items + 產品資訊），非走快取。建立訂單走 `useCreateOrder` → insert orders → insert order_items；後台「下單即出貨」走 `create_order_with_sales_note` RPC。後台建立訂單可整單切換**寄賣模式**（`orders.consignment_mode`），出貨時由 `create_consignment_shipment_layer` 自動同步建立 send_to_store 寄賣單（`source_order_id` 回填）。

## 資料庫邏輯重點

### 版本控制系統
- `data_versions`（每表一個 `YYMMDD-XXXX` 版本）、`data_change_logs`（event log）、`data_snapshots`
- `bump_data_version()` + 各表 trigger 自動遞增
- 注意：data_versions 的 key 與實際表名不同（如 `specs` 對應 `specification_definitions`），`check-data-version` 內有別名映射

### 流水號（system_sequences）
- 訂單：`OD{YYMMDD}{5碼}`；銷貨單：`SL{YYMM}{門市碼}{4碼}`；維修單：`RO-YYYYMMDD-XXXXX`；寄賣單：`CS-YYMMDD-XXXXX`

### 庫存系統（最新重構，warehouse 路線）
- `warehouses`（own / supplier_consignment / defective 三個預設倉）
- `inventory_movements` BEFORE INSERT trigger 自動同步 `product_inventory` 餘額
- `source_type` CHECK 約束綁定單據 FK（purchase_orders / sales_notes / consignment_orders）
- `sales_note_items.inventory_source_type` 逐項記錄庫存來源（self / supplier_consignment / store_consignment）
- 關鍵 RPC：`ship_from_pool`、`direct_ship_order`、`create_order_with_sales_note`、`delete_sales_note`、`receive_purchase_items`、`adjust_inventory`、`recalculate_inventory`

### 寄賣系統（統一模板 v1）
- `consignment_orders`（direction = receive_from_supplier | send_to_store，status = draft | active | settled | cancelled，訂單轉寄賣時 `source_order_id` 回填）+ `consignment_order_items` + `consignment_order_item_summary`（VIEW，統計計算不落庫）
- `consignment_sales_reports`（店家回報審核層 pending/confirmed/rejected）→ 確認後寫入 `consignment_sales`（統一銷售帳本，direction + source_type = store_report | customer_order）
- `consignment_settlements`（supplier_payment / store_receivable，v1 僅此兩種，付清自動 settled）+ `consignment_returns` / `consignment_return_items`
- 寄賣所有權以 `inventory_movements.inventory_owner` 標記（不落 warehouse），`product_inventory` 維持總量
- **訂單轉寄賣（v1.1）**：後台訂單可整單切換寄賣模式（`orders.consignment_mode`）；`ship_from_pool` / `direct_ship_order` / `create_order_with_sales_note` 出貨時經 `create_consignment_shipment_layer` 自動同步建 send_to_store 寄賣單
- 關鍵 RPC：`receive_consignment_items`、`create_consignment_shipment`、`create_consignment_shipment_layer`、`allocate_inventory`、`report_consignment_sale`、`confirm_consignment_sales`、`return_consignment_items`、`settle_consignment`
- 前端：後台 `/admin/consignment`（`src/pages/admin/consignment/`）、門市 `/consignment-sales`（`src/pages/store/ConsignmentSales.tsx`）

### 規格引擎 v6
- `specification_definitions` + `entity_spec_values`（JSONB 值）+ `specification_triggers`（DSL 條件）
- RPC：`get_visible_specs_v6`、`sync_product_specs_v6`、`safe_eval_dsl`

### 其他
- 共享訂單/銷貨連結用 `access_token` + `get_shared_order_details`/`get_shared_sales_note_details` RPC
- 維修單：`repair_orders` + `repair_order_items` + `repair_order_status_history`

## ⚠️ 已知問題 / 安全注意

**10 張表 RLS 未啟用**（任何人持 anon key 可直接讀寫）：`categories`、`specification_definitions`、`category_spec_links`、`category_hierarchy`、`product_category_links`、`data_change_logs`、`data_snapshots`、`storefront_items`、`table_templates`、`table_template_variants`。修復前需先補對應 policies。

## 專案慣例

- 文件與程式碼註解使用**繁體中文**
- 除非明確要求，**不要新增程式碼註釋**
- 沿用既有 library，引入新套件前先檢查 package.json
- import 用 `@/` 別名（對應 `src/`）
- 程式碼變更後跑 `npm run typecheck` 與 `npm run lint`
- 修改 `src/integrations/supabase/types.ts` 不要手動編輯，改 schema 後用 `npm run supabase:types` 重新產生

## 詳細文件（lazy-load，需要時才讀）

- **前端架構詳情** → `@.agent/ARCHITECTURE.md`
- **資料庫 schema 與商業邏輯詳情** → `@.agent/DATABASE.md`
- 舊文件（歷史紀錄，可參考）：`.agent/COMPONENT_ARCHITECTURE.md`、`.agent/REFACTORING_SUMMARY.md`

## 維護協定（對 AI 的重要指示）

1. 每次做出**重大變更**時，必須在**同一場對話內**同步更新本檔與對應的 `.agent/` 文件：
   - 新增/改名/移除資料表、RPC、trigger、enum → 更新 `AGENTS.md` 資料庫重點 + `.agent/DATABASE.md`
   - 新增/重構路由、頁面、service、hooks、資料流 → 更新 `AGENTS.md` 架構摘要 + `.agent/ARCHITECTURE.md`
   - 更動常用指令、專案慣例、安全注意事項 → 更新 `AGENTS.md`
2. 維持本檔「精簡、可一口氣讀完」；細節放 `.agent/` 文件。
3. 開新對話時，本檔是**主要**記憶來源；細節文件僅在相關任務需要時讀取。
