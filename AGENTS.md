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
- `supabase/migrations/`：72 支 SQL migration（唯一 schema 權威來源，另含 brands_ui_diff.patch）
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
- ⚠️ **規格快取持久化（2026-08-26 修正）**：`useSpecStore.fetchSpecs` 在 `incomingData` 增量路徑下**一律重新抓取 `specification_triggers` + `category_spec_links`**（不再依賴可能為空的 store 基底），且當基底 `definitions` 為空時改走全量抓取，避免寫入空資料；`writeSpecCache` 會在 triggers 非空時寫入新版本。此修正解決「IndexedDB 規格版本停滯、store 記憶體版本與 console 不一致」以及「`specTriggers` 為空導致預覽全部攤平顯示」兩問題。若發現版本遲遲不更新，確認 `data_versions` 的 `specs` key 是否隨 `bump_data_version('specs','specification_definitions')` 推進。

### 訂單資料流（門市端範例）
`StoreOrderList.tsx` 用 React Query 直接查 Supabase（orders + order_items + 產品資訊），非走快取。建立訂單走 `useCreateOrder` → insert orders → insert order_items；後台「下單即出貨」走 `create_order_with_sales_note` RPC。後台建立訂單可整單切換**寄賣模式**（`orders.consignment_mode`），出貨時由 `create_consignment_shipment_layer` 自動同步建立 send_to_store 寄賣單（`source_order_id` 回填）；寄賣出貨不開銷貨單，店家確認收貨並回報銷售、後台審核後才開立收款銷貨單（v1.3）。後台訂單列表（`src/pages/admin/orders/list/`）在「訂單」tab 的批次操作除「轉銷貨單」外，尚有「轉寄賣」（先標 `consignment_mode=true` 再走 `direct_ship_order` 不開銷貨單）與「轉出貨池」（將整單剩餘品項加入 shipping_pool）。「所有訂單」會顯示 send_to_store 寄賣草稿為**真實來源訂單**：寄賣單一建立即同步建 `orders`（`source_type='consignment'`、`consignment_mode=true`、`status='pending'`）並回填 `consignment_orders.source_order_id`，品項同步建 `order_items` 並回填 `consignment_order_items.order_item_id`（前端 `useConsignment.ts` 的 create/add/remove/cancel 皆同步鏡像）；故草稿在 pending tab 可勾選、批次操作、編輯、商品模式可見數量，出貨時由 `create_consignment_shipment` 重用該來源訂單標 shipped；`receive_from_supplier` 不顯示於訂單列表。

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
- `consignment_orders`（direction = receive_from_supplier | send_to_store，status = draft | active | settled | cancelled，訂單轉寄賣時 `source_order_id` 回填，v1.3 起 send_to_store 非 draft/cancelled 皆強制有 source_order_id）+ `consignment_order_items` + `consignment_order_item_summary`（VIEW，統計計算不落庫）
- `consignment_sales_reports`（店家回報審核層 pending/confirmed/rejected）→ 確認後寫入 `consignment_sales`（統一銷售帳本，direction + source_type = store_report | customer_order）
- `consignment_settlements`（supplier_payment / store_receivable，v1 僅此兩種，付清自動 settled）+ `consignment_returns` / `consignment_return_items`
- 寄賣所有權以 `inventory_movements.inventory_owner` 標記（不落 warehouse），`product_inventory` 維持總量
- **訂單轉寄賣（v1.1）**：後台訂單可整單切換寄賣模式（`orders.consignment_mode`）；`ship_from_pool` / `direct_ship_order` / `create_order_with_sales_note` 出貨時經 `create_consignment_shipment_layer` 自動同步建 send_to_store 寄賣單
- **出貨池逐項轉寄賣（v1.2）**：`ship_from_pool` 改單一 canonical 簽名並新增 `p_consignment_override_map`（order_item_id → boolean），一般訂單可在出貨池逐項切「寄賣」；`create_consignment_shipment_layer` 改依 `sales_note_items.inventory_source_type = 'store_consignment'` 判斷（不再讀 orders.consignment_mode），故逐項 override 亦正確產出寄賣層；前端 `ShippingPool.tsx` 出貨 Dialog 將「出貨倉/庫存來源」合併為單一「出貨來源」欄（自有倉＋供應商寄賣 FIFO），`AdminOrderCheckout`（OrderReviewPanel）亦新增寄賣切換
- **出貨不開銷貨單（v1.3）**：寄賣出貨一律**不建立 sales_note**（`sales_note` 只代表「確認賣掉的部分」的收款憑證）；`create_consignment_shipment` 補建來源 order 並回填 `source_order_id`；店家 `confirm_consignment_receipt` 確認收貨後才能回報銷售（`report_consignment_sale` / 新 `report_consignment_sale_by_product` FIFO 跨單攤分）；後台 `confirm_consignment_sales` 審核時才依店家批次開立 `sales_notes`(status='received') 收款單並回填 `consignment_sales.sales_note_id`。`direct_ship_order` / `create_order_with_sales_note` / `create_consignment_shipment_layer` 均改**單一 canonical 簽名**（舊 overloads 全數移除）
- **出貨回滾（v1.5）**：`reverse_consignment_shipment(p_consignment_order_id, p_created_by, p_note)` 整單回滾（RETURNS JSONB），守門為 `send_to_store`＋`active`＋未收貨＋無銷售＋無 pending 回報；回滾時逐項扣回出貨（`consignment_shipment_reversal`＋movement）、品項放回 `shipping_pool`、寄賣單回 `draft`、來源 `order_items` 回 `waiting` 且全數回滾時來源訂單降 `processing`，重出貨重用同一來源訂單；維持不變式「order_items 已出貨 ⇒ `shipping_pool` 無該品項」——`create_consignment_shipment`/`create_consignment_shipment_layer`/`direct_ship_order`（寄賣＋一般分支）出貨時逐項 `DELETE FROM shipping_pool`，`reverse_consignment_shipment` 回補 pool 用「覆寫」而非「累加」（避免回滾後又「轉出貨池」時與既有列疊加）。已收貨者導向既有 `return_consignment_items` 退回流程。draft 寄賣單可**編輯品項**（數量/價格/新增/刪除，店家方向同步鏡像 `order_items`）。入口：寄賣頁 `OrderDetailDialog`（回滾出貨／編輯品項按鈕）與「所有訂單」shipped tab 的 RotateCcw 圖示（依 `orders.consignment_mode` 顯示）。「所有訂單」processing tab 批次列已修正：`BatchActionBar` 依選取組成顯示「轉銷貨單／轉寄賣」（僅正常單）與「寄賣出貨」（僅寄賣單，即 `direct_ship_order`）並以分隔線區分
- 關鍵 RPC：`receive_consignment_items`、`create_consignment_shipment`、`create_consignment_shipment_layer`、`allocate_inventory`、`report_consignment_sale`、`report_consignment_sale_by_product`、`confirm_consignment_receipt`、`confirm_consignment_sales`、`return_consignment_items`、`reverse_consignment_shipment`、`settle_consignment`
- 前端：後台 `/admin/consignment`（`src/pages/admin/consignment/`）、門市 `/sales-notes`（`src/pages/store/SalesNotes.tsx`，Tabs 寄賣回報＋銷貨單確認收貨；`/consignment-sales` 舊路由重導，`ConsignmentSales.tsx` 已刪除）

### 規格引擎 v6
- `specification_definitions` + `entity_spec_values`（JSONB 值）+ `specification_triggers`（DSL 條件）
- RPC：`sync_product_specs_v6`（其餘連動評估邏輯已統一由前端 `src/utils/specTree.ts` 的 `getVisibleSpecsTree` 處理；原 `get_visible_specs_v6` / `safe_eval_dsl` 兩支未使用的 RPC 已於 2026-08-25 移除，勿重建）
- 前端取數：`useCategorySpecs(categoryIds, options?)` 支援 `includeAncestors` / `includeDescendants` / `includeTriggerDownstream`（預設皆 false，維持精確比對；商品表單 `DynamicSpecsFields` 啟用後兩者以帶出連動鏈）。前端邏輯樹用 `getVisibleSpecsTree`（`src/utils/specTree.ts`）；連動鏈**唯一權威來源是 `specification_triggers` 表**（經 `useSpecStore().specTriggers` 讀取），`logic_config.triggers` JSON 已廢棄（寫入時刻意剔除，僅由 `mergeTriggersToDefs` 合併進 defs 供樹狀展示用）。商品預覽 `CategorySpecPreview` 的下游展開亦改採 `specTriggers` 表（`source_spec_id→target_spec_id`），不再讀 `logic_config.triggers`。後台邏輯樹（`src/pages/admin/categories/components/spec-library/SpecLibraryTreeView.tsx`）在 `viewMode==='tree'` 時**並排兩視圖**：左「金字塔視圖」（置中樹狀圖、唯讀、CSS 連接線呈金字塔輪廓，根容器 `min-w-max mx-auto` 避免寬樹最左文字被裁切）與右「編輯樹」（原有 dnd 拖曳排序）；`index.tsx` 維持一般 `space-y-6` 頁面排版（不強制整頁滿高，避免影響其他分頁寬度），僅 `SpecLibraryTab` 內的樹狀分隔容器**局部測量可用高度**：以 `splitContainerRef` 量得「分隔容器頂端到視窗底部的剩餘高度」（`window.innerHeight - getBoundingClientRect().top - 16`）套用到分隔容器，兩欄 `items-stretch` 等高、各自 `overflow-auto`（金字塔雙軸、編輯樹 `overflow-y-auto`），故金字塔橫向捲軸落在視窗底部、編輯樹獨立上下捲動，且不寫死 `calc(100vh-…)`；兩視圖共用拖曳分隔條（localStorage `spec-tree-split-ratio`），皆支援折疊與選取高亮，選取節點時雙向 `scrollIntoView` 同步。表單/`DynamicSpecsFields` 每個下游欄位**常駐顯示完整依賴鏈**（經 `specTree.ts` 的 `parentPathKey` 往上回溯，如「依賴 ▸ 自帶線數量·第1組 ▸ 自帶線類型 = 吊繩式可拆」），不再只是 hover 才看見、且修正原 `.val` 空白 bug。
- **數量連動（per-cable / Model B）**：數量複製已**合併進 `specification_triggers`**，以 `relation_type='quantity'` 與一般連動觸發（`relation_type='visibility'`）區分。一筆 quantity 觸發的 `source_spec_id`=數值型來源規格、`target_spec_id`=被複製的下游規格；當來源填入 N 時，下游被複製出 N 份（依序號）。例：行動電源「自帶線數量=N」→ 複製出 N 個「自帶線類型」（trigger：`source=自帶線數量, target=自帶線類型, relation_type='quantity'`），每個 `自帶線類型` 再依各自選值分流帶出 `充電線規格/長度/數量`（visibility 分支）；`充電線規格` 等**不再**設 quantity 觸發。注意：`自帶線數量 → 自帶線類型` 的 `visibility` trigger（on_value='*'）已刪除，避免與數量複製疊加成 N+1。舊 `specification_definitions.quantity_source_id` 欄位已廢棄（僅保留、寫入時恆為 null），資料由 migration 回填為 quantity 觸發。`getVisibleSpecsTree` 讀 specTriggers 中 `relation_type='quantity'` 的 `source_spec_id` 決定複製來源。修改後須 `bump_data_version('specs','specification_definitions')` 已由 `specMutation` 自動處理。
- **數量連動 UI（來源視角）**：`SpecDialog` 的「數量複製設定（來源視角）」以**多選勾選**列出下游規格（排除自身與 heading），勾選即寫入 `logic_config.triggers` 的 `type:'quantity'` 項（source=目前規格、targets=勾選項）；`specMutation` 同步寫入 `specification_triggers` 時依 `t.type==='quantity'` 設 `relation_type='quantity'`、`condition_dsl={}`。編輯樹/`mergeTriggersToDefs` 會將 quantity 觸發標為 `type:'quantity'`，故 `SpecDialog` 連動觸發編輯器（`type!=='quantity'`）不會顯示它們，`SpecLibraryTreeView` 以「數量複製」徽章區分 display，`handleRemoveLink` 依 `relation_type` 精確移除（避免誤刪同對的 visibility 觸發）。
- 共用 UI：`src/components/ui/searchable-select.tsx`（`SearchableSelect`，可搜尋單選、依 group 分組、可清除），`StorePicker` 基於此模式；`SpecDialog` 的「數量複製設定」因需多選，改以 `Checkbox` 清單實作。

### 其他
- 共享訂單/銷貨連結用 `access_token` + `get_shared_order_details`/`get_shared_sales_note_details` RPC
- 維修單：`repair_orders` + `repair_order_items` + `repair_order_status_history`

## ⚠️ 已知問題 / 安全注意

**10 張表 RLS 未啟用**（任何人持 anon key 可直接讀寫）：`categories`、`specification_definitions`、`category_spec_links`、`category_hierarchy`、`product_category_links`、`data_change_logs`、`data_snapshots`、`storefront_items`、`table_templates`、`table_template_variants`。修復前需先補對應 policies。

## 近期變更（AdminOrderForm 重構）

- `useStoreProductCache(storeId, brand?)` 新增第二參數 `brand`，查詢 `store_products` 時加 `.eq('brand', brand)` server-side 過濾
- `AdminOrderForm` 改為單頁兩欄佈局：左側 OrderItemsTable + 右側 ProductCatalog（含 CatalogSidebar）
- ProductCatalog 加入品項走 Zustand（`useStoreDraft`），AdminOrderForm 透過 `useEffect` 同步到本地 `items` state
- 編輯 OrderItemsTable 時同步回 Zustand（`updateQuantity` / `updateItemPrice` / `removeItem`）
- 店家切換時自動 re-price 已有品項（從新 brand 的 `store_products` 取價格）
- 採購/寄賣選供應商時自動帶入 `supplier_product_mappings.vendor_unit_cost`
- 右側面板支援點擊展開/收縮（CSS flex transition，`activePanel` state 控制）

## 近期變更（產品表單改為獨立頁面）

- `ProductFormDialog` 抽出共用 `ProductFormBody`（同一檔案 `src/components/products/form/ProductFormDialog.tsx`），表單本體由 Dialog 包裝（`ProductFormDialog`，採購 `UnmappedResolver` 仍用）與新頁面共用
- 新增 `src/pages/admin/products/ProductFormPage.tsx`，註冊 `/admin/products/new` 與 `/admin/products/:productId/edit`
- **共用頁頭介面**：新增 `src/components/layout/PageHeaderContext.tsx`（`PageHeaderConfig` 介面：title/back/onBack/actions + `usePageHeader()`），`AppLayout` 提供 Provider 並把 `pageHeader` 傳給 `DesktopHeader`／`MobileHeader`；頁面呼叫 `setPageHeader(...)` 即於桌面＋手機共用同一組「返回＋標題（＋actions）」，路由切換自動清除。目前 `ProductFormPage` 使用，返回與標題及「預覽」按鈕（置於 actions）皆由這組 Header 呈現
- 預覽鈕以 `ProductDetailDialog`（`storeId=""` no-op 購物車）即時合併目前表單值（名稱/價格/分類/品牌/規格值）顯示快照
- 產品列表（`src/pages/admin/products/index.tsx`）「新增產品／編輯／複製」改為路由導航；`handleCopy` 改回傳新產品 id 由呼叫端導航（不再開 Dialog）；`ProductDialogs` 僅保留刪除／匯入／選取產品

## 近期變更（統一價格 unified_pricing）

- `products` 新增 `unified_pricing BOOLEAN`、`unified_wholesale_price NUMERIC`、`unified_retail_price NUMERIC`（migration `20260827000001_add_unified_pricing.sql`）
- 兩支 trigger：`trg_enforce_unified_variant_price`（變體寫入時強制價格=產品統一價）、`trg_sync_unified_price_to_variants`（產品切換/修改統一價時覆寫所有變體價格）
- `ProductFormDialog` 新增 DAIGO 風格「統一價格」核取方塊 + 統一批發價/零售價輸入；首次啟用會彈確認「將覆寫所有現有變體價格」
- `VariantSection` / `VariantBatchCreator` / `VariantEditDialog`：統一價商品隱藏/停用逐變體價格編輯，生成變體自動繼承統一價
- `BrandPricing`：統一價商品之連鎖客戶價格改以「產品層級」(`store_products.variant_id = null`) 儲存並套用至所有變體
- `useStoreProductCache`：統一價商品的門市價改取產品層級 `store_products`（忽略逐變體列），確保未來新增變體也吃到同一連鎖價
- 商品目錄 / 詳情顯示「統一價格」徽章；因變體價格皆相同，`calculatePriceRange` 自然顯示單一價格

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
