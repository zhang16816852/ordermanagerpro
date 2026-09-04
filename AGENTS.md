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
- `user_roles`：`system_role` = `admin` | `customer` | `rep`
- `store_users`：`store_role` = `founder` | `manager` | `employee`，關聯 `stores`
- 登入後 `useAuth`（`src/hooks/useAuth.tsx`）抓取兩種角色；`isAdmin` 決定跳轉 `/admin` 或 `/dashboard`
- RLS 用 `has_role()`、`is_store_member()`、`get_store_role()` 函式

### 業務（rep）身分（2026-09-04）
- `system_role = 'rep'`（新增 enum 值），跨店、非單店成員；ADMIN 統一管理店家分配，業務「只讀」店家。
- 業務登入後進 `/admin`（`RootRedirect` 與 `ProtectedRoute` 皆 `isAdmin || isRep`），選單用 `repNavItems`（我的儀表板/所有訂單/建立新單據/銷售單），側欄標籤顯示「業務」。
- 業務可打單/編輯自己名下訂單（`AdminOrderForm` 綁 `sales_rep_id`、店家限名下 `rep_store_assignments`、僅銷售單、不出貨），查看名下店家訂單/銷貨單（RLS）與自己訂單（`useOrdersList` 對 rep 加 `.eq('sales_rep_id', user.id)`）。
- **佣金機制**：`user_roles.commission_rate`（ADMIN 設定業務級固定比例）+ `rep_product_costs`（業務自己的進貨成本，ADMIN 維護）；`helpCommission = (售價 - 業務成本) × commission_rate`。前端 `useRepCommission`（`src/hooks/useRepCommission.ts`）負責換算。
- **新表**：`rep_store_assignments`（業務↔店家）、`rep_product_costs`（rep/product/variant → cost，UNIQUE(rep_id,product_id,variant_id)）；`orders.sales_rep_id`；helper `is_rep()`/`get_rep_commission_rate()`/`is_rep_store()`；`update_order_with_items` 授權加固（允許 `sales_rep_id = auth.uid()`）。
- **利潤/佣金顯示**：業務儀表板（`RepDashboard`，由 `Dashboard.tsx` 依 `isRep` 分流）、訂單列表（`OrderTableView`「估佣（利潤）」欄 + 行動 `OrdersCardView` 行）、訂單詳情（`OrderDetailDialog` 底部利潤/估佣）、銷貨單列表頂部彙總（`AdminSalesNotes` 依 `isRep` 顯示業務利潤/估佣）。
- 業務管理 UI：`/admin/reps`（`src/pages/admin/Reps.tsx`，3 tabs：業務列表+佣金設定、店家分配、成本設定）；admin 側欄「業務管理」。
- **應發分潤彙總（2026-09-04）**：業務列表中新增「應發分潤」欄，供 admin 檢視每業務待發放的分潤總額與單數（聚合業務名下非取消訂單的明細，佣金 = max(0, 售價−業務成本)×比例），即「業務列表」內即可作分潤登記之依據。
- **店家選擇統一（2026-09-04）**：人員管理與指派對話框已統一改用 `StorePicker` 組件（`src/components/ui/StorePicker`），包含搜尋、多選/單選、店家代碼顯示。`Stores.tsx`（店鋪管理→人員 tab）的指派/邀請對話框、`Users.tsx`（人員管理）的指派/邀請對話框、`OrderFilters.tsx`（訂單列表頁首）的店鋪篩選已統一改用 `StorePicker`。`Stores.tsx` 店鋪管理 tab 的「所有店鋪」篩選下拉保留原有形式（僅篩選用）。
- **業務身分設定入口（2026-09-04）**：`/admin/stores`（`Stores.tsx` 人員管理 tab）每列「系統角色」（`UserCog`）按鈕可設定使用者為 `rep`（業務）/`admin`/`customer`，寫入 `user_roles`（`customer`＝清除系統角色）；角色篩選下拉含「業務」。原先無處可把使用者設為 rep，此為唯一入口。
- ⚠️ 出貨僅 admin 處理（業務不出貨）；系統穩定後可下放（RLS 已預留）。
- **使用者自動選店修復（2026-09-04）**：`useAuth` 在設定 `repAssignedStores` 後，若 `currentStoreId` 為空，自動選擇第一個已分配店家，確保業務登入/刷新時能顯示已分配店家，不再顯示「請先選擇店鋪」。
- ⚠️ 成本設定已改為**變體主導**：`/admin/reps` 成本 tab 使用 `useProductCache()` 取得含 variants 的產品資料，可展開每個產品設定逐變體成本（`variant_id` 非 null）；無變體產品維持產品層級（`variant_id=null`）。支援批次「全部儲存」；`rep_product_costs` unique key 為 `(rep_id,product_id,variant_id)`。

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

- **品項排序（2026-09-02）**：`order_items` 新增 `sort_order INTEGER NOT NULL DEFAULT 0`（migration `20260902000001`，並以 `created_at,id` backfill 既有資料）。**A 階段**＝「固定持久排序」：建立/新增品項時依當時順序寫入循序 `sort_order`；讀取時 `useOrdersList` / `StoreOrderList` 的 `order_items` 子查詢加 `.order('sort_order', { foreignTable: 'order_items' })`，詳情元件（`OrderDetailItemsTable`/`OrderDetailItemsCards`）再以 `sort_order` 客戶端排序確保順序穩定。**B 階段（已完成）**＝編輯頁拖曳排序 UI：在共用元件 `OrderItemsTable.tsx` 內建 dnd-kit 拖曳（`GripVertical` 拖柄，桌機 table + 行動 cards），`AdminOrderForm`（create/edit）、`AdminOrderEdit` 皆傳入 `onReorder`，拖曳後本地 `items` 順序更新。`OrderReviewPanel` 結帳確認頁亦有 dnd-kit 拖曳（已可持久化）。⚠️ 舊資料沒有 sort_order 時 backfill 已補齊。**C 階段（名稱排序 + edit-mode 持久化）**＝點擊「名稱」欄位標題可循環 default → A→Z → Z→A（`OrderItemsTable` 維護 `nameSort` state，排序經 `onReorder` 路由，拖曳時自動重設為 default）。`AdminOrderForm`/`AdminOrderEdit` 的 edit-mode 查詢加 `.order('sort_order', { foreignTable: 'order_items' })`，儲存時**所有品項**（含既有）寫入 `sort_order: index+1`，使拖曳與名稱排序結果可持久化。**D 階段（批次儲存 + 軟刪除）**＝編輯訂單儲存改走單一 RPC `update_order_with_items(p_order_id, p_notes, p_items jsonb, p_deleted_item_ids uuid[])`（migration `20260903000002`，SECURITY DEFINER，單一交易內完成 update notes + upsert 品項 + delete 移除品項），取代前端逐筆 `for...of` 的 N+1 呼叫；`p_items` 每元素含 `id`（null＝新品項由伺服器 insert，非 null＝既有品項 update）+ `product_id`/`variant_id`/`quantity`/`unit_price`/`selected_model_name`/`sort_order`。移除既有品項改**軟刪除**：`AdminOrderForm` 先從列表隱藏並存進 `pendingDeletedIds`，toast 提供「還原」按鈕（8 秒內可插回原位），按「儲存變更」時才把 `pendingDeletedIds` 一次隨 RPC 提交；新品項（`isNew`）仍直接移除。`AdminOrderEdit.tsx` 已刪除（dead code），編輯路由指向 `AdminOrderForm`。

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
- **採購防重複（2026-09-01）**：`purchase_order_items.source_quantities`（jsonb `{orderId: 數量}`）記錄來源訂單貢獻量；「轉採購單」前端依此扣除已採購量（`purchasedByOrderKey`），`unlink_orders_from_purchase_order` RPC 解除連結時精確扣減未收貨數量（舊多來源 NULL 資料只解除不扣量）；採購單明細與訂單列表 batch 皆可「解除採購」
- 關鍵 RPC：`ship_from_pool`、`direct_ship_order`、`create_order_with_sales_note`、`delete_sales_note`、`receive_purchase_items`、`adjust_inventory`、`recalculate_inventory`、`unlink_orders_from_purchase_order`、`remove_items_from_shipping_pool`
- **出貨池批次回滾成訂單（2026-09-03）**：`remove_items_from_shipping_pool(p_pool_ids UUID[], p_created_by UUID) RETURNS JSONB`（SECURITY DEFINER）——批次把選取出貨池品項移回訂單（移出出貨池），**單一 RPC 一次寫入**取代前端逐筆 `DELETE FROM shipping_pool`；刪除 pool 列後，僅當該訂單在出貨池**已無任何剩餘品項**且狀態為 `processing` 時才回退為 `pending`（對齊「全數移出才回退」），回傳 `{deleted_count, reverted_order_ids}`。前端 `ShippingPool.tsx` 改用品項級 checkbox 批次選取（每店家表頭「全選」＋列 checkbox＋`Undo2`「回滾成訂單」批次按鈕，含行動端 footer），並**移除原逐筆 Trash2 刪除**

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
- 前端取數：`useCategorySpecs(categoryIds, options?)` 支援 `includeAncestors` / `includeDescendants` / `includeTriggerDownstream`（預設皆 false，維持精確比對；商品表單 `DynamicSpecsFields` 啟用後兩者以帶出連動鏈）。前端邏輯樹用 `getVisibleSpecsTree`（`src/utils/specTree.ts`）；連動鏈**唯一權威來源是 `specification_triggers` 表**（經 `useSpecStore().specTriggers` 讀取），`logic_config.triggers` JSON 已廢棄（寫入時刻意剔除，僅由 `mergeTriggersToDefs` 合併進 defs 供樹狀展示用）。商品預覽 `CategorySpecPreview` 的下游展開亦改採 `specTriggers` 表（`source_spec_id→target_spec_id`）。
- **版本感知自動刷新（2026-08-28）**：`useSpecStore` 新增 `refreshIfStale(notify=true)`——比對 `data_versions`（`CacheService.fetchServerVersions`，30 秒節流），`specs`/`categories` 版本落後才 `fetchSpecs(true)`/`fetchCategories(true)` 全量重抓；有刷新且 `notify` 時經 `BroadcastChannel('spec-store-refresh')` 廣播，其他 tab 收到後 `refreshIfStale(false)` 不重播（無回圈）；首次呼叫即啟動 30 秒 heartbeat 讓「躺著不動」的頁面自動跟上。商品表單（`ProductFormDialog` 的 `active` effect）與 `DynamicSpecsFields`／`VariantSpecsMatrix` mount 時皆呼叫 `refreshIfStale()`，修復「分類管理新增規格後，商品表單仍顯示舊版規格結構」的問題（舊行為：三者只呼叫不帶 force 的 `fetchSpecs()`，store 有資料即 return，永遠沿用舊快照）。
- 後台邏輯樹（`src/pages/admin/categories/components/spec-library/SpecLibraryTreeView.tsx`）在 `viewMode==='tree'` 時**並排兩視圖**：左「金字塔視圖」（置中樹狀圖、唯讀、CSS 連接線呈金字塔輪廓，根容器 `min-w-max mx-auto` 避免寬樹最左文字被裁切）與右「編輯樹」（原有 dnd 拖曳排序）；`index.tsx` 維持一般 `space-y-6` 頁面排版（不強制整頁滿高，避免影響其他分頁寬度），僅 `SpecLibraryTab` 內的樹狀分隔容器**局部測量可用高度**：以 `splitContainerRef` 量得「分隔容器頂端到視窗底部的剩餘高度」（`window.innerHeight - getBoundingClientRect().top - 16`）套用到分隔容器，兩欄 `items-stretch` 等高、各自 `overflow-auto`（金字塔雙軸、編輯樹 `overflow-y-auto`），故金字塔橫向捲軸落在視窗底部、編輯樹獨立上下捲動，且不寫死 `calc(100vh-…)`；兩視圖共用拖曳分隔條（localStorage `spec-tree-split-ratio`），皆支援折疊與選取高亮，選取節點時雙向 `scrollIntoView` 同步。表單/`DynamicSpecsFields` 每個下游欄位**常駐顯示完整依賴鏈**（經 `specTree.ts` 的 `parentPathKey` 往上回溯，如「依賴 ▸ 自帶線數量·第1組 ▸ 自帶線類型 = 吊繩式可拆」），不再只是 hover 才看見、且修正原 `.val` 空白 bug。
- **數量連動（per-cable / Model B）**：數量複製已**合併進 `specification_triggers`**，以 `relation_type='quantity'` 與一般連動觸發（`relation_type='visibility'`）區分。一筆 quantity 觸發的 `source_spec_id`=數值型來源規格、`target_spec_id`=被複製的下游規格；當來源填入 N 時，下游被複製出 N 份（依序號）。例：行動電源「自帶線數量=N」→ 複製出 N 個「自帶線類型」（trigger：`source=自帶線數量, target=自帶線類型, relation_type='quantity'`），每個 `自帶線類型` 再依各自選值分流帶出 `充電線規格/長度/數量`（visibility 分支）；`充電線規格` 等**不再**設 quantity 觸發。注意：`自帶線數量 → 自帶線類型` 的 `visibility` trigger（on_value='*'）已刪除，避免與數量複製疊加成 N+1。舊 `specification_definitions.quantity_source_id` 欄位已廢棄（僅保留、寫入時恆為 null），資料由 migration 回填為 quantity 觸發。`getVisibleSpecsTree` 讀 specTriggers 中 `relation_type='quantity'` 的 `source_spec_id` 決定複製來源。修改後須 `bump_data_version('specs','specification_definitions')` 已由 `specMutation` 自動處理。
- **數量連動 UI（來源視角）**：`SpecDialog` 的「數量複製設定（來源視角）」以**多選勾選**列出下游規格（排除自身與 heading），勾選即寫入 `logic_config.triggers` 的 `type:'quantity'` 項（source=目前規格、targets=勾選項）；`specMutation` 同步寫入 `specification_triggers` 時依 `t.type==='quantity'` 設 `relation_type='quantity'`、`condition_dsl={}`。編輯樹/`mergeTriggersToDefs` 會將 quantity 觸發標為 `type:'quantity'`，故 `SpecDialog` 連動觸發編輯器（`type!=='quantity'`）不會顯示它們，`SpecLibraryTreeView` 以「數量複製」徽章區分 display，`handleRemoveLink` 依 `relation_type` 精確移除（避免誤刪同對的 visibility 觸發）。
- **「其他」自訂輸入＋觸發 `="input"`（2026-08-29）**：使用者可選「其他」並自由輸入，該自訂值視為**個例**（只存於該筆 entity_spec_values，**不回寫 `spec.options`**）。`checkSpecTriggerMatch`（`src/utils/specTree.ts`）新增第 5 參數 `options`；`condition_dsl.on_value='input'`＝「值非空且不在預設選項清單內」（多選＝任一元素符合；`operator='ne'` 反向），`getVisibleSpecsTree` 呼叫時帶入 `spec.options`。前端共用編輯器 `SpecValueEditor`（`src/components/products/form/sections/SpecValueEditor.tsx`，`OTHER_OPTION='其他'`）：`select`／`SearchableSelect`／`multiselect` 的選項含「其他」時顯示自訂文字框（單選另附「採用選項值」建議 chips，點擊改用該選項值），自訂文字直接作為值儲存（多選＝獨立字串陣列元素）。`SpecDialog`「連動觸發設定」選值欄位改 `<Input list>`＋`<datalist>`（列出該規格 options＋特殊項 `input`）方便填入；依賴鏈（`specFieldUi.buildDepChain`）與邏輯樹（`SpecLibraryTreeView`）皆把 `on_value='input'` 顯示為「自訂輸入」。
- 共用 UI：`src/components/ui/searchable-select.tsx`（`SearchableSelect`，可搜尋單選、依 group 分組、可清除），`StorePicker` 基於此模式；`SpecDialog` 的「數量複製設定」因需多選，改以 `Checkbox` 清單實作。

### 其他
- 共享連結用 `access_token`（UUID）+ `get_shared_order_details`/`get_shared_sales_note_details` RPC；路由 `/share/order/:orderId`、`/share/sale/:salesNoteId`
- 訂單與銷貨單各自有獨立的 `access_token`：訂單建立時即產生（永久可分享），銷貨單出貨時獨立產生（不共用訂單 token）
- `delete_sales_note` 不再將 token 保存回訂單（訂單有自己的永久 token）
- 維修單：`repair_orders` + `repair_order_items` + `repair_order_status_history`

## ⚠️ 已知問題 / 安全注意

**10 張表 RLS 未啟用**（任何人持 anon key 可直接讀寫）：`categories`、`specification_definitions`、`category_spec_links`、`category_hierarchy`、`product_category_links`、`data_change_logs`、`data_snapshots`、`storefront_items`、`table_templates`、`table_template_variants`。修復前需先補對應 policies。

## 近期變更（銷貨單收款狀態 + 會計模組）

- **`sales_notes.payment_status`（2026-09-04）**：新增收款狀態欄位（`text`，`unpaid`/`paid`，預設 `unpaid`），與收貨狀態 `status`（draft/shipped/received）**分離**。migration `add_sales_note_payment_status` 回填：凡 `accounting_entries` 有 `reference_type='sales_note'` 且 `type='income'` 且 `payment_status='paid'` 的銷貨單設為 `paid`。
- **「登記收款」連動更新**（`SalesNoteDetailDialog`：`receivePaymentMutation`）：寫 `accounting_entries`＋帳戶餘額後，**同時把 `sales_notes.payment_status` 更新為 `'paid'`**，並 invalidate `['admin-sales-notes']`/`['store-sales-notes']`（原本沒有，導致列表不刷新）。
- **前台「已收/未收」改看收款**：`AdminSalesNotes` 的 Tab（未收款/已收款）與彙總計數改以 `payment_status` 判斷（原用 `status`＝收貨）；`SalesNoteListTable` 新增 `PaymentStatusBadge`（已收款/未收款）並列顯示收貨＋收款雙狀態；`SalesNoteDetailDialog` 基本資訊區新增「收款狀態」；store 端 `SalesNotes.tsx` 同步帶 `payment_status`。
- **dd「單據匯入」修正**（`accounting/components/EntryForm.tsx`）：銷售單匯入從抓 `orders`（含未出貨/寄賣未確認單，看似抓出貨池）**改抓 `sales_notes`**，金額用 `sales_note_items × order_item.unit_price` 加總，顯示單號 `code`＋店名，`reference_type` 改為 `'sales_note'`；採購匯入維持 `purchase_orders`。
- **收支明細可查看來源單據**：新增 `accounting/components/ReferenceViewer.tsx`，依 entry 的 `reference_type`/`reference_id` 開啟詳情：`sales_note`→`SalesNoteDetailDialog`、`order`→`OrderDetailDialog`、`purchase_order`→內建唯讀檢視（供應商/日期/狀態/品項/已收/金額）。`EntriesTab` 在有 reference 時顯示 `Eye` 查看按鈕（桌機＋行動）。
- **統一收款狀態 RPC + 回退/刪除連動（2026-09-04）**：新增 `public.sync_sales_note_payment_status(p_sales_note_id uuid)`（SECURITY DEFINER，revoke public/anon、grant authenticated）——計算「該銷貨單只要有任一 `accounting_entries`（`reference_type='sales_note'`、`type='income'`、`payment_status IN ('paid','partial')`）→ `sales_notes.payment_status='paid'`，否則 `'unpaid'`」；`p_sales_note_id IS NULL` 直接 return。`useAccounting`（`accounting/hooks/useAccounting.ts`）三條 mutation 皆連動：`recordPaymentMutation`（付款後呼叫 RPC）、`reversePaymentMutation`（**回退＝完全刪除該收款分錄**＋回退帳戶餘額 income→`-paid_amount`/expense→`+paid_amount`＋呼叫 RPC）、`deleteEntryMutation`（接收 `AccountingEntry`，若已收款先回退帳戶餘額再刪除，並呼叫 RPC），皆 invalidate `['accounting-entries']`/`['accounts']`/`['admin-sales-notes']`/`['store-sales-notes']`。`EntriesTab`（`onDelete` 接收完整 `AccountingEntry`，修正先前 string/id 型別不符導致 `uuid "undefined"` 刪除失敗）於 `paid_amount>0` 時顯示 `RotateCcw`「回退付款」按鈕（桌機＋行動，`onReversePayment`），`AccountingPage` 以 confirm 確認後觸發 `reversePaymentMutation.mutate(entry)`。
- **編輯/新增收支 Dialog 獨立成組件 + 帳戶欄位（2026-09-04）**：新增 `accounting/components/EntryDialog.tsx`（包 `Dialog`＋`EntryForm`，供其他頁面重複使用），`AccountingPage` 改用之；`EntryForm` 新增 `accounts` prop 與「帳戶」下拉（`account_id`，顯示錢歸入/支出自哪個帳戶，編輯時可見）。`SalesNoteDetailDialog` 的 `existingPayment` 查詢改為 `paid_amount>0`＋`.limit(1)`（原只要存在任意 income 分錄即判定「已完成收款」、且 `maybeSingle` 遇到歷史重複列會報錯）——回退付款已刪除分錄後，`登記收款` 按鈕即可重新點選。
- **後台頁面改名**：`src/pages/admin/` 下 9 個 `index.tsx` 改名為語意化檔名（`accounting/AccountingPage.tsx`、`audit-logs/AuditLogsPage.tsx`、`categories/CategoriesPage.tsx`、`consignment/ConsignmentPage.tsx`、`inventory/InventoryPage.tsx`、`order-grid-templates/OrderGridTemplatesPage.tsx`、`products/ProductsPage.tsx`、`purchase-orders/PurchaseOrdersPage.tsx`、`repair-orders/RepairOrdersPage.tsx`），`routes/admin.tsx` 對應 import 已更新；並補上 `AdminReps` import（`@/pages/admin/Reps`，修復未定義錯誤）。

## 近期變更（AdminOrderForm 重構）

- `useStoreProductCache(storeId, brand?)` 新增第二參數 `brand`，查詢 `store_products` 時加 `.eq('brand', brand)` server-side 過濾
- **`AdminOrderForm` 拆為獨立元件**（`src/components/order/`）：
  - `OrderInfoCard.tsx`：訂單資訊＋備註區（含門市/供應商/目標門市選擇、出貨時間、寄賣模式開關、出貨倉設定 Collapsible 與逐項倉/來源下拉；`warehouseExpanded` 為其內部 local state）
  - `OrderItemsPanel.tsx`：訂單項目面板（CardHeader 可點擊收合，內含 `OrderItemsTable`；type `PanelState = 'items' | 'products' | null` 與 `OrderItemsPanel` 共用）
  - `ProductSelector.tsx`：商品選擇面板（CardHeader 含檢視模式切換 products/variants/gallery/table 與篩選按鈕；內含 `CatalogSidebar`（桌面固定側欄＋手機 filter sheet）＋ `ProductCatalog`；`catalogSidebarMaxHeight` prop 限制 `CatalogSidebar` 最大高度避免過度捲動；`bare` prop 略過外層 Card wrapper 供行動端 drawer 重複使用）
- 佈局（AdminOrderForm 以共用 JSX 變數 `orderInfoCard`／`orderItemsPanel`／`renderProductSelector(bare?)` 組合，桌面與行動端共用）：
  - **桌面（lg+）可收合左右佈局**（容器 `lg:h-[calc(100vh-320px)]`）：左欄（`flex-1`）上下堆疊「訂單資訊（頂、`shrink-0`）＋訂單項目（下、填滿剩餘）」，右側固定寬度（`lg:w-[390px]`）商品選擇側欄；**側欄可完全隱藏**（`desktopCatalogOpen` state，預設展開）——隱藏時寬度歸零、左側填滿，並在上方顯示「展開商品選擇」按鈕，側欄頂部有 X 圖示可隱藏；三者固定佔位、不因切換移位
  - **行動端（<lg）**：訂單資訊＋訂單項目正常上下堆疊顯示；商品選擇不內嵌，改為**右側 drawer**（`fixed inset-y-0 right-0 w-full max-w-md`，含標題＋關閉按鈕，內容用 `renderProductSelector(true)` bare 模式），未展開時以**固定底部右側浮動圓形按鈕**（`Package` 圖示）開啟；展開時浮動按鈕隱藏。行動 drawer 開關用獨立 `mobileCatalogOpen` state，不與 `activePanel` 混用
- ProductCatalog 加入品項走 Zustand（`useStoreDraft`），AdminOrderForm 透過 `useEffect` 同步到本地 `items` state
- 編輯 OrderItemsTable 時同步回 Zustand（`updateQuantity` / `updateItemPrice` / `removeItem`）
- 店家切換時自動 re-price 已有品項（從新 brand 的 `store_products` 取價格）
- 採購/寄賣選供應商時自動帶入 `supplier_product_mappings.vendor_unit_cost`
- **刪除 `AdminOrderEdit.tsx`**（dead code）：`/admin/orders/:orderId/edit` 路由已指向 `AdminOrderForm`，`AdminOrderForm` 本身就有 `isEditMode` 涵蓋所有編輯功能（讀取 order、更新 sort_order、toggleStatus、OrderItemsTable）

## 近期變更（產品表單改為獨立頁面）

- `ProductFormDialog` 抽出共用 `ProductFormBody`（同一檔案 `src/components/products/form/ProductFormDialog.tsx`），表單本體由 Dialog 包裝（`ProductFormDialog`，採購 `UnmappedResolver` 仍用）與新頁面共用
- 新增 `src/pages/admin/products/ProductFormPage.tsx`，註冊 `/admin/products/new` 與 `/admin/products/:productId/edit`
- **共用頁頭介面**：新增 `src/components/layout/PageHeaderContext.tsx`（`PageHeaderConfig` 介面：title/back/onBack/actions + `usePageHeader()`），`AppLayout` 提供 Provider 並把 `pageHeader` 傳給 `DesktopHeader`／`MobileHeader`；頁面呼叫 `setPageHeader(...)` 即於桌面＋手機共用同一組「返回＋標題（＋actions）」，路由切換自動清除。目前 `ProductFormPage` 使用，返回與標題及「預覽」按鈕（置於 actions）皆由這組 Header 呈現
- 預覽鈕以 `ProductDetailDialog`（`storeId=""` no-op 購物車）即時合併目前表單值（名稱/價格/分類/品牌/規格值）顯示快照
- 產品列表（`src/pages/admin/products/index.tsx`）「新增產品／編輯／複製」改為路由導航；`handleCopy` 改回傳新產品 id 由呼叫端導航（不再開 Dialog）；`ProductDialogs` 僅保留刪除／匯入／選取產品

## 近期變更（紙本列印版型重設計）

- 共用頁使用 `.doc-receipt-wrap` 包裹印刷用 HTML，列印時透過 `window.print()` 印出帶有圖片文字的 PDF（中文為經過 JPEG 圖片渲染，不依賴 jsPDF FontParser），QR Code 使用 `QRCodeSVG` 產生，列印按鈕觸發 `PrintDialog` 或直接 `window.print()`。CSS 類別 `.print-a4`／`.print-middle-cut`／`.print-no-margin`／`.print-hidden` 控制版型與顯示。
- **套件化共用元件 `SharedReceiptExport`（`src/pages/share/SharedReceiptExport.tsx`）**：`SharedSales.tsx` 與 `SharedOrder.tsx` 共用同一套列印能力。該元件負責：渲染「列印 / PDF / Excel」觸發按鈕 + `PrintDialog` + `.doc-receipt-wrap` 印刷版型 + 三向匯出邏輯（PDF `html2pdf` 圖片引擎／Excel `xlsx`）。版型含店名置中、meta＋QR 靠右、**品項顯示變體名稱（`variant ?? name`）**、**數量分頁**（採**兩層筆數**：前面無底部框頁用 `CHUNK_CAPACITY.max`、最後一頁含總計+備註框用 `last`——A4＝19/16、中一刀＝8/6；`buildPageSizes` 切塊、重複表頭、頁碼「第 N 頁 / 共 M 頁」、序號整單連續）、**統計列**（品項數 X 項／總件數 X 件／總金額）、**手寫備註區**。印刷版型以 **`createPortal(document.body)`** 掛到 body，且**僅在列印模式（`printMode` URL）或 PDF 擷取期間（`isCapturing`）才短暫掛載（`shouldRenderPrint`），平時完全不佔 DOM**——這是避免「一堆框線／按鈕消失」的根治做法（不依賴 CSS 隱藏）。掛載後以 `.is-printing-mode`（PDF 擷取）或 `@media print`（列印）顯示；`handleExport` 會先 `setIsCapturing(true)` → `await 100ms` 等渲染 → `ensurePrintClasses()` → `html2pdf().from(element).save()` → finally `setIsCapturing(false)` 卸載。
- **欄位寬度（2026-09-03）**：印表欄寬不依賴 `<colgroup>`/`ch`（部分渲染引擎與 html2canvas 不支援會失效，導致名稱欄退回依內容自動寬度、單行/換行寬度不一），改在**第一列 `HeaderRow` 的 `<th>` 直接設百分比寬度**（有價格版：# 5%／名稱 42%／數量 8%／單價 13%／小計 16%／備註 16%；無價格版：# 6%／名稱 60%／數量 14%／備註 20%）配合 `table-layout: fixed`。table-layout:fixed 以「第一列 cell 寬度」決定每欄寬（規格保證），故**所有欄含名稱皆跨頁一致、單行/換行同寬**；`.doc-name` 設 `overflow-wrap: break-word`、`.doc-table td` 設 `overflow:hidden`，長名稱只在同寬欄內折行、不撐開欄寬。
- **統一列高（2026-09-03）**：`.doc-table tr` 設固定高（`height:40px`，容納 2 行）+ `td` 固定 `line-height:1.35`、`overflow:hidden`，使**每列(row)高度一致**（不管名稱 1 行或折 2 行，皆等高）；長名稱最多顯示 2 行、超過截斷。
- **垂直框線（2026-09-03）**：印表中間欄不再顯示垂直框線，**僅備註欄（每列最右 `td:last-child`／表頭 `th:last-child`）保留左右垂直線**；其餘欄 `border-left/right:none` 只留水平框線（列間）。`.doc-empty`（填充空列）維持 `border-color:transparent` 全透明。
- **數字欄對齊（2026-09-03）**：單價與小計皆用 `formatCurrency`（`$` 前綴＋千分位＋`text-align:right`）使兩欄數字右緣對齊一致（單價原用 `toLocaleString()` 無 `$` 會與小計視覺偏移）。
- **列印模式只顯示列印檔（2026-09-03）**：`SharedOrder.tsx`／`SharedSales.tsx` 的 `?print=true` 時以**早期 return 只渲染 `<SharedReceiptExport printMode>`**（不渲染互動 Card／表格／按鈕），方便直接調版面；`SharedReceiptExport` 的按鈕與 PrintDialog 亦以 `!printMode` 包住（printMode 時完全不渲染互動 UI）。
- `PrintsOptions`（`src/components/PrintDialog.tsx`）為 `{ output:'pdf'|'excel', paperSize:'a4'|'middle-cut', margin:'standard'(固定), showPrice:boolean, showQR:boolean }`，於點擊「列印 / PDF / Excel」時彈出選擇（無「列印」輸出——`window.print` 會列印當前畫面而非檔案版面，故僅保留 PDF / Excel）。版型細節：標題「{title}：{單號}」（單號移至標題列）、頁碼「第 N 頁 / 共 M 頁」於頁面**右上角**、meta 區僅日期/狀態＋QR、商品名稱區域以每頁 `capacity` 筆填充空列維持**固定表格高度**、每頁底部**不再有備註**（僅保留最後一頁的備註框線區）。
- **Excel 匯出**（`src/pages/share/exportExcel.ts` 的 `exportDocExcel`）：以 xlsx 匯出表頭／店家／日期／明細（受 `showPrice` 控制是否含單價/小計）／統計／備註。
- `src/pages/share/SharedSales.tsx` 與 `SharedOrder.tsx` 保留各自螢幕互動 Card（收貨確認、Badge、訪客提示），僅將「列印按鈕＋印刷版型」改由 `<SharedReceiptExport … />` 提供。`SharedOrder` 支援 `?print=true&size=&margin=` URL 自動列印（`printMode` + `defaultPaperSize`/`defaultMargin`）。
- `src/index.css` 列印區塊：`.print-a4`（210mm 寬）／`.print-middle-cut`（241mm 寬）／`.print-no-margin`／`.print-hidden` 等列印輔助 class，並新增 `.doc-receipt-wrap`（螢幕上定位於畫布外，列印/html2pdf 擷取時顯示）、`.doc-page` 分頁、`.doc-table`／`.doc-title`／`.doc-summary-wrap` 等版型樣式。

## 近期變更（統一價格 unified_pricing）

- `products` 新增 `unified_pricing BOOLEAN`、`unified_wholesale_price NUMERIC`、`unified_retail_price NUMERIC`（migration `20260827000001_add_unified_pricing.sql`）
- 兩支 trigger：`trg_enforce_unified_variant_price`（變體寫入時強制價格=產品統一價）、`trg_sync_unified_price_to_variants`（產品切換/修改統一價時覆寫所有變體價格）
- `ProductFormDialog` 新增 DAIGO 風格「統一價格」核取方塊 + 統一批發價/零售價輸入；首次啟用會彈確認「將覆寫所有現有變體價格」
- `VariantSection` / `VariantBatchCreator` / `VariantEditDialog`：統一價商品隱藏/停用逐變體價格編輯，生成變體自動繼承統一價
- `BrandPricing`：統一價商品之連鎖客戶價格改以「產品層級」(`store_products.variant_id = null`) 儲存並套用至所有變體
- `useStoreProductCache`：統一價商品的門市價改取產品層級 `store_products`（忽略逐變體列），確保未來新增變體也吃到同一連鎖價
- 商品目錄 / 詳情顯示「統一價格」徽章；因變體價格皆相同，`calculatePriceRange` 自然顯示單一價格

## 近期變更（規格欄位 UI 統一 + SpecDialog 選項拖移）

- 新增共用件 `src/components/products/form/sections/specFieldUi.ts`（`QTY_GROUP_PALETTE`、`SpecVisibleInfo`、`buildDepChain`、`buildQuantityColorMap`、`resolveGroupColor`、`isHeadingSpec`）與 `SpecFieldHeader.tsx`（欄位標籤列：名稱＋必填＊＋第N組 pill＋依賴鏈＋數量組色塊）
- `DynamicSpecsFields`（產品規格畫面）與 `VariantSpecsMatrix`（變體規格矩陣）共用同一套標籤與 `SpecValueEditor`；矩陣「表格模式」（逐變體）與「單一模式」（一次套用全部變體）UI 一致、僅操作對象不同。單一模式 `applyToAll` 新增第 3 參數 `silent`，搭配 **1200ms debounce toast**（閒置後才彈「已同步至所有變體」），批次套用/複製按鈕維持即時
- 矩陣 `useCategorySpecs` 啟用 `includeDescendants`＋`includeTriggerDownstream` 對齊連動鏈；`VariantSpecsMatrixHandle` 新增 `getState()`（表單以 `__getVariantSpecs` 掛載）供預覽即時反映未儲存的變體規格值
- `SpecDialog.tsx`「選項/標籤定義」清單支援 dnd-kit 拖移重排（`SortableOptionItem`＋`GripVertical` 拖柄，`arrayMove` 更新 `specForm.options`），排序即下拉/單位欄位的顯示順序
- 「其他」自訂輸入（`SpecValueEditor` 的 `select`/`SearchableSelect`/`multiselect`）＋觸發 DSL `="input"`（見上方規格引擎 v6）＋ `SpecDialog` 連動觸發選值欄 `<datalist>` 建議框（該規格 options＋`input`）

## 近期變更（產品表單變體區整合表格範本 + Order Grid 批次維度）

- **`VariantSection`（`src/components/products/form/VariantSection.tsx`）整合 Order Grid 表格範本**：用 `useTableTemplates()` 篩出「含此產品任一變體」的 templates（`relevantTemplates`）；每個相關 template 在變體清單下方各渲染一個 `OrderGridRenderer` 獨立表格，`products` 只傳**此產品**（`gridProducts`，= product.variants 過濾本產品變體）且 `template_variants` 過濾成僅此產品子集（`gridTemplateFor`），故表格只顯示該產品變體套用模板顯示規則（不混其他產品）。資料源為 `product` prop（initialData，含 option/spec/device 完整資料）才能正確依維度渲染。
- **購物車接線**：`onDirectItemAdd`（button mode 每格「＋」）與 `onAddToCart`（toolbar「加入購物車」）皆接到既有 `store.addItem` 累加——因 `addItem` 只會 +1，數量 >1 時以 `getVariantQty` 讀現量再 `updateQuantity` 補足差額；`getCartQuantity` 接 `getVariantQty` 讓表格即時反映購物車既有數量。
- **Order Grid 批次維度（同名選項群組逐範本解析 id）**：`OrderGridBatchDimensionDialog.tsx` 批次選取 option 群組時同步記住群組**名稱**（`onConfirm` 回傳 `optionGroupNames`）；`OrderGridTemplateList.tsx` 新增 `resolveOptionGroupId(template, name, fallbackId)`——對每張範本依其變體所屬產品的 `option_groups` 找「同名」群組的 id（找不到才回退批次選的 id），對 row/col/tab 各維度逐範本解析後再 `updateTemplate`。理由：同名「顏色」群組在不同產品有不同 `option_group_id`，統一寫一個 id 會導致部分產品找不到值、grid 空（顯示「無法產生 grid」）。

## 近期變更（業務管理 + StorePicker 統一 + 成本變體主導）

- **`useAuth.tsx` 自動選店修復（2026-09-04）**：`fetchRoles` 在設定 `repAssignedStores` 後，若 `currentStoreId` 為空，自動選擇第一個已分配店家（`repStores[0].store_id`），確保業務登入/刷新時顯示已分配店家，不再停在「請先選擇店鋪」。
- **Reps.tsx 店家分配 per-rep state 修復（2026-09-04）**：將單一 `grantStoreId` 改為 per-rep 的 `grantStoreIds` state（`Record<string, string[]>`）；`grantMutation.onSuccess` 額外 invalidate `['admin-reps-stores']`，解決分配後列表無法即時同步的問題。
- **StorePicker 統一（2026-09-04）**：`Stores.tsx`（店鋪管理→人員 tab）的指派與邀請對話框改用 `StorePicker`（搜尋、多選/單選、店家代碼顯示）；`OrderFilters.tsx`（訂單列表頁首）的店鋪篩選改用 `StorePicker`（保留「全部店鋪」選項）；`Users.tsx` 的指派/邀請對話框待改。
- **應發分潤彙總（2026-09-04）**：業務列表新增「應發分潤」欄，查詢每業務名下非取消訂單（`orders` JOIN `order_items`），加上全體業務成本 map（`admin-rep-costs-all`），計算 `max(0, 售價−業務成本)×佣金比例`，顯示分潤總額與單數，作為 admin 分潤登記依據。
- **成本 tab 變體主導（2026-09-04）**：`/admin/reps` 成本 tab 改用 `useProductCache()` 取得含 variants 的產品資料，產品可展開設定逐變體成本（`variant_id` 非 null）；無變體產品維持產品層級（`variant_id=null`）。支援批次「全部儲存」（`saveAll` 一次提交所有 dirty entries）；`costMutation` / `deleteCostMutation` 已擴充 `variantId` 參數。

## 近期變更（訂單永久分享 + 分享路徑修正）

- **訂單永久分享（2026-09-04）**：`orders.access_token` 改為建立時即產生（`crypto.randomUUID()` 客戶端 / `gen_random_uuid()` 後端 RPC），訂單從出生起即可分享。`OrderDetailDialog` 分享按鈕因 `access_token` 非空而正常顯示。
- **銷貨單獨立 token**：`ship_from_pool`、`direct_ship_order` 出貨時**不再讀取/清除訂單的 `access_token`**，銷貨單一律獨立產生新 token。`delete_sales_note` 亦不再將 token 保存回訂單。
- **分享路徑修正**：4 處銷貨單分享連結從錯誤的 `/share/sales-note/` 修正為 `/share/sale/`（對齊路由定義 `src/routes/shared.tsx`）。
- **Migration**：`20260904000002_permanent_order_share_token.sql`——改寫 `create_order_with_sales_note`（orders INSERT 加 `access_token`）、`ship_from_pool` / `direct_ship_order`（移除 token reuse/clear）、`delete_sales_note`（移除 token 保存回訂單）。
- **分享 RPC UUID 型別修正（2026-09-04）**：`get_shared_order_details` / `get_shared_sales_note_details` 的 `p_token TEXT` 與 `access_token UUID` 欄位比對時報 `operator does not exist: uuid = text`，改為 `p_token::UUID` 轉換。`get_shared_sales_note_details` 同步補回 `shipped_at` 欄位。前端 `SharedSales.tsx` 的 `confirmReceiveMutation` 改用 RPC 回傳的 `sales_note.id`（UUID）更新，不再用 URL 參數的 code。

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
