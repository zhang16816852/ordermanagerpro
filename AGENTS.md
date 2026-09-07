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
- **佣金機制**：`user_roles.commission_rate`（ADMIN 設定業務級固定比例）+ `rep_product_costs`（業務自己的進貨成本，ADMIN 維護）；佣金 = max(0, 售價 − 業務成本) × commission_rate。佣金計算基於**銷貨單**（`sales_notes`），非訂單；透過 `sales_note_items → order_items` 串接取得品項資料。佣金歸屬採「依店家分配自動歸屬」（`store_id → rep_store_assignments`），不依賴 `sales_rep_id`。**成本優先序（2026-09-07）**：`order_items.unit_cost` 快照（>0）→ `rep_product_costs`（變體→產品層級）→ **進貨成本（變體批發價 `product_variants.wholesale_price`，未設定時預設值）** → 0；前端 `useRepCommission`（`src/hooks/useRepCommission.ts`）與兩支發放 RPC 同步此優先序。
- **新表**：`rep_store_assignments`（業務↔店家）、`rep_product_costs`（rep/product/variant → cost，UNIQUE(rep_id,product_id,variant_id)）、`rep_commission_payouts`（發放登記：rep/sales_note → amount/paid_date/note，UNIQUE(rep_id,sales_note_id)，含 `entry_id` FK 串接 `accounting_entries` 採 `ON DELETE CASCADE`，RLS：admin 管理、業務可看自己）；`orders.sales_rep_id`；helper `is_rep()`/`get_rep_commission_rate()`/`is_rep_store()`；`update_order_with_items` 授權加固（允許 `sales_rep_id = auth.uid()`）。**發放 RPC（2026-09-05）**：`register_rep_commission_payout`（SECURITY DEFINER，內部重算佣金後寫 payout＋`accounting_entries` expense 分錄＋綁定 `entry_id`＋扣帳戶餘額；僅 admin）、`register_batch_rep_commission_payout`（批次發放，以關聯單據母子單 `accounting_entry_references` 方式一次寫入一筆母支出分錄與多筆 payouts）與 `revoke_rep_commission_payout`（透過刪除會計分錄觸發 CASCADE 刪除 payout 並回衝餘額；僅 admin）。
- **利潤/佣金顯示**：業務儀表板（`RepDashboard`，由 `Dashboard.tsx` 依 `isRep` 分流）、訂單列表（`OrderTableView`「估佣（利潤）」欄 + 行動 `OrdersCardView` 行）、訂單詳情（`OrderDetailDialog` 底部利潤/估佣）、銷貨單列表頂部彙總（`AdminSalesNotes` 依 `isRep` 顯示業務利潤/估佣）。
- 業務管理 UI：`/admin/reps`（`src/pages/admin/Reps.tsx`，3 tabs：業務列表+佣金設定、店家分配、成本設定）；admin 側欄「業務管理」。
- **應發分潤彙總（2026-09-04）**：業務列表中新增「應發分潤」欄，供 admin 檢視每業務待發放的分潤總額與單數（聚合業務名下非取消訂單的明細，佣金 = max(0, 售價−業務成本)×比例），即「業務列表」內即可作分潤登記之依據。數字可點擊導入佣金明細頁。
- **佣金明細頁（2026-09-05）**：`/admin/reps/:userId/commission`（`src/pages/admin/RepCommissionPage.tsx`），顯示該業務名下店家的銷貨單明細（店家名、銷貨單編號、品項、售價、成本、利潤、佣金），可展開每筆銷貨單查看品項級明細（名稱欄只留品項名＋編號，「數量 ×N ・ 單價 $X ・ 成本 $Y」放中段，右三欄銷售額/利潤/佣金對齊表頭）。**登記收款時間（2026-09-05）**：連動會計模組——查 `accounting_entries`（`reference_type='sales_note'`、`type='income'`、`paid_amount>0`）顯示每筆銷貨單的登記收款日期/帳戶/金額，並提供「收款登記日期」篩選（**起日 ~ 迄日區間**，仿 OrderFilters）。**分潤發放登記（2026-09-05，已併入會計模組）**：發放邏輯**併入 `EntryForm` 的「佣金發放」Tab**（`EntryForm.tsx` 新增 `view='payout'`，`onPayoutSubmit`；新共用 sink `useCommissionPayout` `src/hooks/useCommissionPayout.ts`）——選業務→列出待發放銷貨單（系統計算佣金、排除已發放）→選一筆→付款帳戶＋分類（預設「業務分潤」expense，migration seed）＋發放日期＋說明；**金額由後端 RPC 重算不可手動**；「登記發放」在佣金明細頁與會計頁皆改用 `EntryDialog`（`prefill.payout` 帶入業務/單號）。**批次登記發放**需先選「發放帳戶」（批量扣款用）。撤銷發放走 RPC 回衝帳戶餘額並刪除支出分錄。表格含「分潤發放」欄與發放狀態／**發放日期區間**篩選；頂部卡片改為 5 張：佣金比例、銷貨單數、名下店家、**已發放分潤**、**待發放分潤**。支援搜尋、收款狀態篩選。
- **訂單/銷貨單業務篩選（2026-09-05）**：訂單列表（`OrderFilters`）與銷貨單列表（`AdminSalesNotes`）新增「業務」下拉篩選——選取業務後，依 `rep_store_assignments` 取得其名下店家 IDs，以 `.in('store_id', ...)` 過濾單據。
- **店家選擇統一（2026-09-04）**：人員管理與指派對話框已統一改用 `StorePicker` 組件（`src/components/ui/StorePicker`），包含搜尋、多選/單選、店家代碼顯示。`Stores.tsx`（店鋪管理→人員 tab）的指派/邀請對話框、`Users.tsx`（人員管理）的指派/邀請對話框、`OrderFilters.tsx`（訂單列表頁首）的店鋪篩選已統一改用 `StorePicker`。`Stores.tsx` 店鋪管理 tab 的「所有店鋪」篩選下拉保留原有形式（僅篩選用）。
- **業務身分設定入口（2026-09-04）**：`/admin/stores`（`Stores.tsx` 人員管理 tab）每列「系統角色」（`UserCog`）按鈕可設定使用者為 `rep`（業務）/`admin`/`customer`，寫入 `user_roles`（`customer`＝清除系統角色）；角色篩選下拉含「業務」。原先無處可把使用者設為 rep，此為唯一入口。
- ⚠️ 出貨僅 admin 處理（業務不出貨）；系統穩定後可下放（RLS 已預留）。
- **使用者自動選店修復（2026-09-04）**：`useAuth` 在設定 `repAssignedStores` 後，若 `currentStoreId` 為空，自動選擇第一個已分配店家，確保業務登入/刷新時能顯示已分配店家，不再顯示「請先選擇店鋪」。
- ⚠️ 成本設定已改為**變體主導**：`/admin/reps` 成本 tab 使用 `useProductCache()` 取得含 variants 的產品資料，可展開每個產品設定逐變體成本（`variant_id` 非 null）；無變體產品維持產品層級（`variant_id=null`）。⚠️ **統一改批次送出（2026-09-05）**：刪除逐筆 upsert/delete mutation，統一走單一 RPC `upsert_rep_product_costs(p_rep_id, p_items jsonb)`（SECURITY DEFINER，僅 admin，`{product_id, variant_id, cost}` array；`cost` 為 null＝刪除該列）一次交易完成全部「全部儲存」的 upsert＋delete（含產品層級先刪後插避免 NULL 重複列）；逐列「儲存」按鈕已移除，全部編輯皆靠「全部儲存」批次送出；`rep_product_costs` unique key 為 `(rep_id,product_id,variant_id)`。**預設＝進貨成本（2026-09-07）**：未設定業務成本時，佣金一律以「進貨成本（變體批發價 `product_variants.wholesale_price`）」為預設成本；變體輸入框未設定時以 placeholder 顯示「預設 $X（進貨成本）」，審核時前端與兩支發放 RPC 的 fallback 皆已從 0 改為進貨成本。

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

- **品項排序（2026-09-02）**：`order_items` 新增 `sort_order INTEGER NOT NULL DEFAULT 0`（migration `20260902000001`，並以 `created_at,id` backfill 既有資料）。**A 階段**＝「固定持久排序」：建立/新增品項時依當時順序寫入循序 `sort_order`；讀取時 `useOrdersList` / `StoreOrderList` 的 `order_items` 子查詢加 `.order('sort_order', { foreignTable: 'order_items' })`，詳情元件（`OrderDetailItemsTable`/`OrderDetailItemsCards`）再以 `sort_order` 客戶端排序確保順序穩定。**B 階段（已完成）**＝編輯頁拖曳排序 UI：在共用元件 `OrderItemsTable.tsx` 內建 dnd-kit 拖曳（`GripVertical` 拖柄，桌機 table + 行動 cards），`AdminOrderForm`（create/edit）、`AdminOrderEdit` 皆傳入 `onReorder`，拖曳後本地 `items` 順序更新。`OrderReviewPanel` 結帳確認頁亦有 dnd-kit 拖曳（已可持久化）。⚠️ 舊資料沒有 sort_order 時 backfill 已補齊。**C 階段（名稱排序 + edit-mode 持久化）**＝點擊「名稱」欄位標題可循環 default → A→Z → Z→A（`OrderItemsTable` 維護 `nameSort` state，排序經 `onReorder` 路由，拖曳時自動重設為 default）。`AdminOrderForm`/`AdminOrderEdit` 的 edit-mode 查詢加 `.order('sort_order', { foreignTable: 'order_items' })`，儲存時**所有品項**（含既有）寫入 `sort_order: index+1`，使拖曳與名稱排序結果可持久化。**D 階段（批次儲存 + 軟刪除）**＝編輯訂單儲存改走單一 RPC `update_order_with_items(p_order_id, p_notes, p_items jsonb, p_deleted_item_ids uuid[])`（migration `20260903000002`，SECURITY DEFINER，單一交易內完成 update notes + upsert 品項 + delete 移除品項），取代前端逐筆 `for...of` 的 N+1 呼叫；`p_items` 每元素含 `id`（null＝新品項由伺服器 insert，非 null＝既有品項 update）+ `product_id`/`variant_id`/`quantity`/`unit_price`/`selected_model_name`/`sort_order`。移除既有品項改**軟刪除**：`AdminOrderForm` 先從列表隱藏並存進 `pendingDeletedIds`，toast 提供「還原」按鈕（8 秒內可插回原位），按「儲存變更」時才把 `pendingDeletedIds` 一次隨 RPC 提交；新品項（`isNew`）仍直接移除。`AdminOrderEdit.tsx` 已刪除（dead code），編輯路由指向 `AdminOrderForm`。**E 階段（銷貨單與分享頁同步排序，2026-09-05）**＝後台（`pages/admin/SalesNotes.tsx`）與門市（`pages/store/SalesNotes.tsx`）及會計（`ReferenceViewer.tsx`）在查詢 `sales_note_items` 時納入關聯之 `order_items.sort_order`，並對品項做排序後傳入 `SalesNoteDetailDialog`（組件內亦建 `sortedItems` 防禦排序）；分享頁 RPC（`get_shared_order_details` 與 `get_shared_sales_note_details`）改由 `jsonb_agg` 配合 `ORDER BY oi.sort_order, oi.created_at` 輸出，前端 `SharedOrder.tsx` 與 `SharedSales.tsx` 以原生陣列排序防禦對齊，確保「訂單詳情、銷貨單詳情、分享訂單、分享銷貨單」四處品項順序完全一致。
- **拆分行（同變體多行出貨，2026-09-05）**：訂單/出貨允許「同變體拆成多列」（如 ×2 中一行正常、一行單價 0 的瑕疵換貨/補寄）一同出貨。若依賴出貨池則每行是獨立 `order_item`、自動成立；若**下單即出貨**（`create_order_with_sales_note`）或**編輯既有訂單**（`update_order_with_items`/`AdminOrderForm`），需先拆分成多列 order_item（每列各自出貨）。**後端**：`inventory_movements` 新增 `order_item_id`（FK→order_items, ON DELETE SET NULL），`idx_invmov_unique_shipment`/`idx_invmov_unique_deletion` 由 `(sales_note_id, product_id, variant_id, warehouse_id)` 放寬為 `(sales_note_id, order_item_id) WHERE ... AND order_item_id IS NOT NULL`——仍防同一 order_item 重複扣、但允許同變體不同 order_item 共存一張銷貨單；4 支出貨/刪單 RPC（`create_order_with_sales_note`/`ship_from_pool`/`direct_ship_order`/`delete_sales_note`）NEW INSERT 皆帶 `order_item_id`（migration `20260905000005`）。歷史 `sales_note_id IS NULL` 舊資料無法回填（維持 NULL、不在索引涵蓋內）。**前端**：`OrderItemsTable` 新增 `onSplit`＋拆分行按鈕（`CopyPlus`，可編輯且 `quantity>1` 時顯示，桌機表格＋行動卡片皆支援），經 `OrderItemsPanel` 透傳；`AdminOrderForm.handleSplitItem` 原行減 1、插入數量 1 的 `isNew` 新行（temp id），並同步 `draft.updateQuantity` 總量（合成 id 才有效，免與草稿 merge 效果衝突）。購置/轉採購單彙整按 `(product, variant)` 加總→兩行併一筆 quantity=2，不變。
- **直接轉銷貨單預存修正（2026-09-09）**：`AdminOrderForm` 的「轉銷貨單／寄賣出貨」（`directShipMutation`）先前**直接**呼叫 `direct_ship_order`（RPC 只讀 DB `order_items`），導致拆分後未先儲存就直接出貨時，拆分行（`isNew` 暫存列）遺失、銷貨單品項缺漏與總數錯誤。修正：抽出共用 `buildItemsPayload()`（`updateOrderMutation`/`directShipMutation` 共用），出貨前**先 `update_order_with_items` 持久化拆分/刪除結果**（失敗即中止）再呼叫 `direct_ship_order`；列表頁批次出貨（讀 DB）不受影響。
- **完整刪除訂單（2026-09-09，migration `20260909000001`）**：RPC `delete_order_if_unadopted(p_order_id)`（SECURITY DEFINER，僅 admin）——檢查訂單是否已被引用（`sales_note_items`、`shipping_pool`、`consignment_orders.source_order_id`／`consignment_order_items`／`consignment_sales`、`sales_note_return_items`、`purchase_order_items.source_quantities`(jsonb 含此單)、`accounting_entries`＋`accounting_entry_references`(reference_type='order')），任一命中回 `{ok:false, reason, adopted_by}`；庫存異動改檢查 `order_items.shipped_quantity > 0`（已出貨但未回補的數量）而非 `inventory_movements` 存在性——庫存已歸零的歷史異動紀錄不擋刪除。`source_type='consignment'` 鏡像單一律拒絕。前端：`BatchActionBar`（pending/processing tab、orders view）新增「刪除」按鈕（桌機 pill＋行動 footer），`OrderDetailDialog` 新增選擇性 `onDeleteOrder` prop（admin 列表傳入才顯示「刪除訂單」），`OrderListPage.deleteOrderMutation` 逐單呼叫、成功計數、失敗彙總 reason toast（失敗時拼上 `adopted_by` 採用明細如「（銷貨單 SL…、採購單 PO…）」）。
- **刪除銷售單守門（2026-09-09，migration `20260909000003`）**：`delete_sales_note` 由 `RETURNS void` 改為 `RETURNS JSONB`（DROP 後重建，避免型別衝突），刪除前加守門——`status='received'` 已收貨／已有會計分錄（`accounting_entries`、`accounting_entry_references` two-path，如收款）／已有業務佣金發放（`rep_commission_payouts`）／寄賣確認銷售已記帳（`consignment_sales` 未 reversed）時**擋下**並回傳 `{ok:false, reason, adopted_by}`，防止刪單造成會計/帳戶餘額孤兒（原本分錄以 `reference_type='sales_note'` 字串關聯、刪單不會清理）。前端 `SalesNotes.tsx deleteMutation` 改解析 JSONB 回傳，`ok!==false` 才成功，reason 以 toast 顯示（hint「請先處理會計/佣金/寄賣紀錄」）。
- **採購單刪除守門 RPC `delete_purchase_order_if_empty`（2026-09-09，migration `20260909000004`）**：SECURITY DEFINER 僅 admin，取代前端原生 `DELETE FROM purchase_orders`（後者遇已收貨採購單撞 CHECK 拋模糊錯誤、無法回滾庫存/會計）——已收貨（任一 item `received_quantity>0`）／已有庫存異動（`inventory_movements.purchase_order_id`）／已有會計分錄（`accounting_entries`＋`accounting_entry_references` two-path）時擋下回傳 `{ok:false, reason, adopted_by}`，未收貨乾淨單才 DELETE（items FK CASCADE）。前端 `usePurchaseOrders.deleteOrderMutation` 改呼叫 RPC、失敗顯示 reason toast。

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
- **採購品項排序（2026-09-08，migration `20260908000000`）**：`purchase_order_items` 新增 `sort_order`；既有資料 backfill 預設＝每張採購單依變體名稱（無變體回退產品名稱）降冪；新/匯入品項取現有 `MAX(sort_order)+1` 排末尾。前端採購單詳情表格支援 **dnd-kit 拖曳調整**（`GripVertical` 拖柄）＋**點「產品名稱」表頭循環 default→昇冪→降冪→default**（鏡像 `OrderItemsTable`；排序基準 `variant.name ?? product.name`），皆經 `onReorder` 走 RPC `reorder_purchase_order_items(p_items jsonb)`（SECURITY DEFINER，僅 admin）以 index+1 批次持久化；`cancelled` 單停用。
- 關鍵 RPC：`ship_from_pool`、`direct_ship_order`、`create_order_with_sales_note`、`delete_sales_note`、`receive_purchase_items`、`adjust_inventory`、`recalculate_inventory`、`unlink_orders_from_purchase_order`、`remove_items_from_shipping_pool`、`process_sales_note_return`、`process_purchase_return`、`delete_order_if_unadopted`
- **出貨池批次回滾成訂單（2026-09-03）**：`remove_items_from_shipping_pool(p_pool_ids UUID[], p_created_by UUID) RETURNS JSONB`（SECURITY DEFINER）——批次把選取出貨池品項移回訂單（移出出貨池），**單一 RPC 一次寫入**取代前端逐筆 `DELETE FROM shipping_pool`；刪除 pool 列後，僅當該訂單在出貨池**已無任何剩餘品項**且狀態為 `processing` 時才回退為 `pending`（對齊「全數移出才回退」），回傳 `{deleted_count, reverted_order_ids}`。前端 `ShippingPool.tsx` 改用品項級 checkbox 批次選取（每店家表頭「全選」＋列 checkbox＋`Undo2`「回滾成訂單」批次按鈕，含行動端 footer），並**移除原逐筆 Trash2 刪除**
- **出貨池排序（2026-09-09，migration `20260908000002`＋`20260909000005`）**：`shipping_pool.sort_order`（每店家獨立）與 `sales_note_items.sort_order`；`ship_from_pool` 依 `sp.sort_order, sp.created_at` 建立銷售單品項並以 `v_sort_counter` 寫入 `sales_note_items.sort_order`（多單合併出貨順序持久化）。前端 `ShippingPool.tsx` 以 dnd-kit 逐店家拖曳排序（`SortablePoolRow`＋`DndContext` 包整個 `<Table>`），拖曳結果經 RPC `reorder_shipping_pool_items(p_items jsonb)`（SECURITY DEFINER，僅 admin，grant authenticated）以 index+1 持久化；表頭排序（商品/數量/單價/小計/加入時間）觸發時清 `localOrder` 立即生效。**寫入路徑自動派號**：BEFORE INSERT trigger `trg_shipping_pool_auto_sort_order` 於 `sort_order<=0` 時指派「該店家目前 `MAX(sort_order)+1`」，14 支 INSERT INTO shipping_pool 的 RPC（下單轉出貨/刪單回滾/寄賣回滾等）皆不用逐支改；既有資料已 backfill（每店家依 created_at 給 1..N）。**出貨前回寫目前順序**：`shipMutation`（確認出貨）會先對每個選取店家依 `sortedGroups`（表頭排序＋拖曳的當下顯示順序）呼叫 `reorder_shipping_pool_items` 回寫 DB，再呼叫 `ship_from_pool`，確保銷貨單品項照「畫面上看到的順序」建立。銷貨單顯示（admin/store SalesNotes、會計 `ReferenceViewer` 等 9 處查詢）已改 `.order('sort_order', { foreignTable: 'sales_note_items' })` 並以 `sales_note_items.sort_order`（非來源 `order_items.sort_order`）排序，多單合併出貨時順序才正確。
- **退貨模組（2026-09-06，migration `20260906000004`）**：`sales_note_items.returned_quantity`／`purchase_order_items.returned_quantity`（預設 0 的退貨累計）＋4 張退貨表（`sales_note_returns`/`sales_note_return_items`、`purchase_order_returns`/`purchase_order_return_items`，RLS：銷貨類 admin 全權＋門市 SELECT 自家、採購類僅 admin）。RPC `process_sales_note_return`（銷貨退貨回勾庫存 `customer_return` movement＋「客戶退貨退款」expense 分錄扣帳戶）、`process_purchase_return`（採購退貨自庫存扣除 `purchase_return` movement＋「供應商退貨沖帳」income 分錄加帳戶）；金額皆後端重算（qty×unit_price/unit_cost），帳戶未指定且金額>0 時 RAISE。前端：銷貨單明細（`SalesNoteDetailDialog`）「退貨登記」→`SalesReturnDialog`（admin 限定，`enableReturn={!isRep}`）、列表「已退貨」徽章；採購單明細「廠商退貨」→`PurchaseReturnDialog`。`inventory_movements.source_type` 沿用既有 `customer_return`/`purchase_return` CHECK 值。

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

**向後相容 VIEW 復原（2026-09-09）**：遠端資料庫缺少 `device_model_links`／`device_model_group_links`／`device_model_exclusions`／`product_effective_models_base` 這 4 個由 `20260602213529_consolidate_entity_model_relations.sql` 定義的 VIEW（該 migration 未記入遠端）；`sync_storefront_items` 執行時參考到缺漏的 VIEW 會 42P01，導致新增/編輯變體失敗。已以 migration `20260909000000_recreate_device_model_link_views.sql` 重建（CREATE OR REPLACE VIEW，冪等），`entity_model_relations` 實表與前端邏輯不受影響。若日後又出現 `relation "public.device_model_links" does not exist`，先確認這 4 個 VIEW 是否存在。

**10 張表 RLS 未啟用**（任何人持 anon key 可直接讀寫）：`categories`、`specification_definitions`、`category_spec_links`、`category_hierarchy`、`product_category_links`、`data_change_logs`、`data_snapshots`、`storefront_items`、`table_templates`、`table_template_variants`。修復前需先補對應 policies。

## 近期變更（銷貨單收款狀態 + 會計模組）

- **`sales_notes.payment_status`（2026-09-04）**：新增收款狀態欄位（`text`，`unpaid`/`paid`，預設 `unpaid`），與收貨狀態 `status`（draft/shipped/received）**分離**。migration `add_sales_note_payment_status` 回填：凡 `accounting_entries` 有 `reference_type='sales_note'` 且 `type='income'` 且 `payment_status='paid'` 的銷貨單設為 `paid`。
- **「登記收款」連動更新**（`SalesNoteDetailDialog`：`receivePaymentMutation`）：寫 `accounting_entries`＋帳戶餘額後，**同時把 `sales_notes.payment_status` 更新為 `'paid'`**，並 invalidate `['admin-sales-notes']`/`['store-sales-notes']`（原本沒有，導致列表不刷新）。
- **前台「已收/未收」改看收款**：`AdminSalesNotes` 的 Tab（未收款/已收款）與彙總計數改以 `payment_status` 判斷（原用 `status`＝收貨）；`SalesNoteListTable` 新增 `PaymentStatusBadge`（已收款/未收款）並列顯示收貨＋收款雙狀態；`SalesNoteDetailDialog` 基本資訊區新增「收款狀態」；store 端 `SalesNotes.tsx` 同步帶 `payment_status`。
- **dd「單據匯入」修正**（`accounting/components/EntryForm.tsx`）：銷售單匯入從抓 `orders`（含未出貨/寄賣未確認單，看似抓出貨池）**改抓 `sales_notes`**，金額用 `sales_note_items × order_item.unit_price` 加總，顯示單號 `code`＋店名，`reference_type` 改為 `'sales_note'`；採購匯入維持 `purchase_orders`。
- **收支明細可查看來源單據**：新增 `accounting/components/ReferenceViewer.tsx`，依 entry 的 `reference_type`/`reference_id` 開啟詳情：`sales_note`→`SalesNoteDetailDialog`、`order`→`OrderDetailDialog`、`purchase_order`→內建唯讀檢視（供應商/日期/狀態/品項/已收/金額）。`EntriesTab` 在有 reference 時顯示 `Eye` 查看按鈕（桌機＋行動）。
- **統一收款狀態 RPC + 回退/刪除連動（2026-09-04）**：新增 `public.sync_sales_note_payment_status(p_sales_note_id uuid)`（SECURITY DEFINER，revoke public/anon、grant authenticated）——計算「該銷貨單只要有任一 `accounting_entries`（`reference_type='sales_note'`、`type='income'`、`payment_status IN ('paid','partial')`）→ `sales_notes.payment_status='paid'`，否則 `'unpaid'`」；`p_sales_note_id IS NULL` 直接 return。`useAccounting`（`accounting/hooks/useAccounting.ts`）三條 mutation 皆連動：`recordPaymentMutation`（付款後呼叫 RPC）、`reversePaymentMutation`（**回退＝完全刪除該收款分錄**＋回退帳戶餘額 income→`-paid_amount`/expense→`+paid_amount`＋呼叫 RPC）、`deleteEntryMutation`（接收 `AccountingEntry`，若已收款先回退帳戶餘額再刪除，並呼叫 RPC），皆 invalidate `['accounting-entries']`/`['accounts']`/`['admin-sales-notes']`/`['store-sales-notes']`。`EntriesTab`（`onDelete` 接收完整 `AccountingEntry`，修正先前 string/id 型別不符導致 `uuid "undefined"` 刪除失敗）於 `paid_amount>0` 時顯示 `RotateCcw`「回退付款」按鈕（桌機＋行動，`onReversePayment`），`AccountingPage` 以 confirm 確認後觸發 `reversePaymentMutation.mutate(entry)`。
- **會計雙寫入路徑修復 + 對象欄位（2026-09-09，migration `20260909000002`）**：根因＝`EntryForm.buildSubmitData` 的 list view 過去**硬把 `accounting_entries.reference_type/reference_id` 設為 `null`**（只寫 `accounting_entry_references` 子表），導致：① 銷貨單收款後編輯/查詢時 `existingPayment` 找不到分錄、可重複收款；② `useAccounting` 的 `deleteEntry/recordPayment` 的 `if (entry.reference_type==='sales_note')` guard 永遠 false，`sync_sales_note_payment_status` RPC 永不觸發。修法：① **`sync_sales_note_payment_status` RPC 改同時查 entry row 與 `accounting_entry_references` 子表**（OR 兩路徑，向下相容歷史資料）；② `EntryForm.buildSubmitData` list view 在 `docItems.length>0` 時把**第一筆單據的 type/id 寫入 entry row** 並新增 `counterparty_name=firstDoc.name`（店名/供應商名）；③ `accounting_entries` 新增 **`counterparty_name text`**（回填：銷貨單→店家名、採購單→供應商名、維修單→客戶名，含 description 推斷）；④ `useAccounting.createEntryMutation` 建立後依 entry row 與 references 子表逐筆呼叫 RPC 同步收款狀態；⑤ `deleteEntryMutation`/`recordPaymentMutation` 改為同時掃 entry row 與 references 子表的銷貨單 IDs 再呼叫 RPC；⑥ `SalesNoteDetailDialog.existingPayment` 改先查 `payment_status==='paid'` 再找分錄（entry row→references 子表兩路徑）；`receivePaymentMutation` 改呼叫 RPC（不再直接 `update payment_status='paid'`）；⑦ `EntriesTab` 桌面表格新增「對象」欄（`counterparty_name`，truncate）＋行動卡片顯示。前端類型 `src/pages/admin/accounting/types.ts` 新增 `counterparty_name`。
- **編輯/新增收支 Dialog 獨立成組件 + 帳戶欄位（2026-09-04）**：新增 `accounting/components/EntryDialog.tsx`（包 `Dialog`＋`EntryForm`，供其他頁面重複使用），`AccountingPage` 改用之；`EntryForm` 新增 `accounts` prop 與「帳戶」下拉（`account_id`，顯示錢歸入/支出自哪個帳戶，編輯時可見）。`SalesNoteDetailDialog` 的 `existingPayment` 查詢改為 `paid_amount>0`＋`.limit(1)`（原只要存在任意 income 分錄即判定「已完成收款」、且 `maybeSingle` 遇到歷史重複列會報錯）——回退付款已刪除分錄後，`登記收款` 按鈕即可重新點選。
- **後台頁面改名**：`src/pages/admin/` 下 9 個 `index.tsx` 改名為語意化檔名（`accounting/AccountingPage.tsx`、`audit-logs/AuditLogsPage.tsx`、`categories/CategoriesPage.tsx`、`consignment/ConsignmentPage.tsx`、`inventory/InventoryPage.tsx`、`order-grid-templates/OrderGridTemplatesPage.tsx`、`products/ProductsPage.tsx`、`purchase-orders/PurchaseOrdersPage.tsx`、`repair-orders/RepairOrdersPage.tsx`），`routes/admin.tsx` 對應 import 已更新；並補上 `AdminReps` import（`@/pages/admin/Reps`，修復未定義錯誤）。

## 近期變更（會計模組：多幣別帳戶 + 帳戶互轉 + 跨單結帳）

### 多幣別帳戶（2026-09-04）
- `accounts` 新增 `currency` 欄位（text，NOT NULL DEFAULT 'TWD'），支援 TWD/USD/JPY/CNY/EUR/HKD/KRW/GBP
- `AccountForm` 新增幣別下拉選擇；`AccountsTab` 每個帳戶卡片顯示幣別 Badge + `formatCurrency(balance, currency)`
- `StatsCards` 多幣別帳戶分組顯示餘額，`formatCurrency` 改傳入 currency 參數
- Migration：`20260904000004_account_currency.sql`

### 帳戶互轉 + 幣值換算（2026-09-04）
- `accounting_entries` 新增欄位：`transfer_to_account_id`（目的地帳戶）、`exchange_rate`、`original_currency`、`original_amount`
- `accounting_categories.type` 擴展新值：`transfer`（帳戶互轉）、`currency_exchange`（幣值換算）、`topup`（儲值）、`settlement`（跨單結帳）
- `EntryForm` 依分類 type 分流：普通收支（維持原樣）、帳戶互轉（來源/目的地帳戶 + 同幣別直接轉/跨幣別帶匯率換算）、跨單結帳（母子單）
- 轉帳類型在 `EntriesTab` 顯示「來源帳戶 → 目的地帳戶」箭頭 + 幣別/匯率資訊
- `useAccounting` 的 `createEntryMutation` 處理轉帳：從來源帳戶扣款、加入目的地帳戶；`deleteEntryMutation` 反向回退雙帳戶餘額
- Migration：`20260904000005_accounting_transfer_fields.sql`

### 跨單多筆結帳（母子單）（2026-09-04）
- 新表 `accounting_entry_references`：`entry_id`（母單 FK）、`reference_type`（order/sales_note/purchase_order/repair_order）、`reference_id`、`item_name`、`amount_applied`
- `EntryForm` settlement 模式：選來源帳戶 → 選關聯單據類型（訂單/銷貨單/採購單/維修單）→ 從列表勾選加入 → 自動帶入原始金額可微調 → 母單金額自動加總
- `EntriesTab` settlement 類型顯示關聯單據摘要（N 筆單據 + 各筆金額）
- `useAccounting` 的 `entries` 查詢對 settlement 類型自動 fetch `accounting_entry_references`
- Migration：`20260904000006_accounting_entry_references.sql`

### 會計分類管理擴展
- `CategoryForm` 新增 transfer/settlement/topup/currency_exchange 四種分類類型可選
- `CategoriesTab` 分四組顯示：收入類型、支出類型（維持原樣）+ 特殊類型（transfer/currency_exchange/topup）+ 結帳類型（settlement），每類有獨立圖示與顏色

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
- **佣金歸屬邏輯改為依店家分配（2026-09-04）**：訂單的佣金歸屬改為「依店家分配自動歸屬」（`store_id` → `rep_store_assignments`），不再依賴 `sales_rep_id`。Reps.tsx 與 RepDashboard 皆改用 `.in('store_id', assignedStoreIds)` 查詢訂單，透過 `storeToReps` 對應表（`store_id → rep_ids[]`）計算每業務佣金。一筆訂單若該店家有多業務，所有被分配的業務皆計入佣金（不拆分）。
- **成本 tab 變體主導（2026-09-04）**：`/admin/reps` 成本 tab 改用 `useProductCache()` 取得含 variants 的產品資料，產品可展開設定逐變體成本（`variant_id` 非 null）；無變體產品維持產品層級（`variant_id=null`）。支援批次「全部儲存」（`saveAll` 一次提交所有 dirty entries）；`costMutation` / `deleteCostMutation` 已擴充 `variantId` 參數。

## 近期變更（訂單永久分享 + 分享路徑修正）

- **訂單永久分享（2026-09-04）**：`orders.access_token` 改為建立時即產生（`crypto.randomUUID()` 客戶端 / `gen_random_uuid()` 後端 RPC），訂單從出生起即可分享。`OrderDetailDialog` 分享按鈕因 `access_token` 非空而正常顯示。
- **銷貨單獨立 token**：`ship_from_pool`、`direct_ship_order` 出貨時**不再讀取/清除訂單的 `access_token`**，銷貨單一律獨立產生新 token。`delete_sales_note` 亦不再將 token 保存回訂單。
- **分享路徑修正**：4 處銷貨單分享連結從錯誤的 `/share/sales-note/` 修正為 `/share/sale/`（對齊路由定義 `src/routes/shared.tsx`）。
- **Migration**：`20260904000002_permanent_order_share_token.sql`——改寫 `create_order_with_sales_note`（orders INSERT 加 `access_token`）、`ship_from_pool` / `direct_ship_order`（移除 token reuse/clear）、`delete_sales_note`（移除 token 保存回訂單）。
- **分享 RPC UUID 型別修正（2026-09-04）**：`get_shared_order_details` / `get_shared_sales_note_details` 的 `p_token TEXT` 與 `access_token UUID` 欄位比對時報 `operator does not exist: uuid = text`，改為 `p_token::UUID` 轉換。`get_shared_sales_note_details` 同步補回 `shipped_at` 欄位。前端 `SharedSales.tsx` 的 `confirmReceiveMutation` 改用 RPC 回傳的 `sales_note.id`（UUID）更新，不再用 URL 參數的 code。

## 近期變更（維修單模組重構 + 型號規格/版本）

- **Migration**：`20260905000000_repair_order_evolution.sql`（防禦性 `IF NOT EXISTS` 寫法）——修正原始 `20260702000000_create_repair_orders.sql` 從未成功套用的問題（其用了不存在的 1 參數 RLS helpers）。新 migration 內所有 RLS 一律用 **2 參數** `is_store_member(auth.uid(), store_id)`／`has_role(auth.uid(), 'admin'::public.system_role)`（本專案 helper 僅有 2 參數版本）。⚠️ 已於 2026-09-05 套用至遠端（`repair_order_evolution`）；`inventory_movements.source_type` 含 `repair_part_usage`，FK 綁定 CHECK 沿用舊約束寬鬆度（既有 sales_shipment/sales_note_deletion 有 `sales_note_id` NULL 的歷史資料），**新增約束勿再收緊**。
- **零件＝商品**：`products` 新增 `is_repair_part BOOLEAN`；維修零件是普通商品但不進訂單選購目錄（`useStoreProductCache` 過濾掉），庫存由採購模組進貨、維修單出料時以 RPC `deduct_repair_part_stock(p_repair_order_id, p_item_id, p_product_id, p_variant_id, p_quantity, p_created_by, p_purchase_order_item_id DEFAULT NULL)` 扣「自有倉」庫存（`warehouses.code='own' OR type='自有倉'`），RPC 回 `{ok:false, error}` 表示庫存不足/批次問題。產品表單（`IdentificationFields`）新增「此為維修零件」勾選。`repair_order_items.is_stock_deducted` 記錄是否已扣庫存；後台維修單編輯僅「新插入」的零件項目才扣庫存（既存項目更新不重扣，避免重複扣）。
- **密碼鎖**：`repair_orders` 新增 `device_lock_type ('none'|'numeric'|'pattern')`、`device_passcode`（數字密碼）、`device_passcode_pattern`（9 宮格點選順序，如 `"1-5-9"`，鍵盤排列 123/456/789）。共用元件 `src/components/repair/LockInput.tsx`。
- **型號規格＋版本組合**：`device_models.specifications` JSONB 存選項清單（`colors/storage_options/ram_options/cpu_options`）與 `versions[]`（version_name/color/storage/ram/cpu/is_default，is_default 互斥）；`DeviceModelDialog` 可視化編輯，儲存時 `DeviceModelManager.syncModelSpecs` 同步 `device_model_spec_options`／`device_model_versions` 兩張新表。維修單表單選型號後版本可直接套用，有選項時顏色/容量/RAM/CPU 變 Select、CPU 存 `device_specs.cpu`。
- **外觀/功能檢查**：`repair_device_checklists`（category=appearance|functional、is_checked、note、sort_order、store_id）＋ `repair_checklist_library`（常用項目詞庫，存檔時 `upsert_repair_checklist_library` 累計 usage_count）；唯 store_id 為 NULL 的 Library 項目自動帶入新單。共用元件 `src/components/repair/ChecklistEditor.tsx`。
- **型號選擇**：共用元件 `src/components/repair/ModelPicker.tsx`（裝置類型＋廠牌篩選、INPUT 提示、清除）；零件選擇用 `src/components/repair/RepairPartSelect.tsx`（`products.is_repair_part=true`＋自有倉庫存、回傳 product/variant/part_name/unit_cost，成本取 `base_wholesale_price`/variants.`wholesale_price`）。
- **表單 UI**：admin `new.tsx` 手機版 6 分頁（customer/device/issues/checklist/items/fees）＋sticky 頂部 tab＋sticky 底部儲存列，桌面 3 欄；store `new.tsx` 單欄式（僅服務項目、不扣庫存）；兩者皆支援 `:id/edit` 既有編輯。後台維修單內建「叫料/進貨」導向 `/admin/purchase-orders`。
- **詳情頁**：admin/store `detail.tsx` 顯示鎖類型與內容（圖形鎖以 `1 → 5 → 9` 順序顯示）、CPU、外觀/功能檢查卡、零件「已扣庫存」Badge；`useRepairOrderDetail` 查詢已帶 `checklists:repair_device_checklists(*)`。
- **客戶資訊可選**：`repair_orders.customer_name` 已 DROP NOT NULL，測試單可無客戶。

## 近期變更（店家端 / 接案人流程分離，2026-09-05）

- **設計決策**：店家端（門市收件→派發→交還客戶）與接案人（接單→維修作業）流程分離。**不動表**（沿用 `repair_order_status` enum：`pending`+`assigned_to NULL`＝開放待接案；`pending`+`assigned_to=X`＝指派給接案人；「接單」＝`assigned_to=自己`＋`status='diagnosing'`；`ready`＝完工待取件；交還＝`delivered`）；金流暫不處理。
- **接案人身份**：目前即 `user_roles.role='admin'` 的使用者（就是使用者本人）；RPC `list_repair_contractors()`（migration `20260905000001_repair_contractors_rpc.sql`，SECURITY DEFINER）回傳 admin 使用者的 id/email/full_name。⚠️ 因店家成員受 profiles RLS 限制讀不到別人姓名，故用 RPC 而非 user_roles SELECT policy；`user_roles` 欄名是 `role`（`public.system_role`）。未來 MARKET 上線再換正式接案人角色。
- **前端 hook**：`useRepairOrders` 新增 `useRepairTechnicians()`（接案人清單）、`acceptAndStartMutation`（接單，toast「已接單」）、`deliverMutation`（交還客戶）；詳情查詢加入 `store:store_id(name)`。型別 helper 在 `src/types/repair.ts`（`REPAIR_ORDER_WORKING_STATUSES`/`REPAIR_ORDER_CLOSED_STATUSES`/`isRepairOrderAcceptable`/`isRepairOrderWorking`/`isRepairOrderClosed`/`REPAIR_ASSIGNMENT_LABELS`）。
- **店家端**（`src/pages/store/repair-orders/`）：`new.tsx`「發布與指派」卡裡選接案人（`__open__`＝「開放待接案（不指定）」）；`index.tsx` 分頁（全部/待接案/維修中/已完工）＋接案人欄＋`ready` 單「交還客戶」；`detail.tsx` 顯示接案人＋`ready` 交還按鈕。
- **接案人（admin 工作台）**（`src/pages/admin/repair-orders/`）：`RepairOrdersPage.tsx` 改為工作台分頁（待接案/我處理中/全部/已完成，`tab`/`search` 走 URL 參數）＋`pending` 單「接單」按鈕；`new.tsx`「指派技師」→「接案人」、新增單預設 `assigned_to=自己`、費用卡文案改「工資（估）」／「毛利（估）」（欄位不動）；`detail.tsx`「指派與來源」卡（來源店家＋接案人）＋`pending` 可「接單」。

## 近期變更（FixEngineer 角色 + 多機型拆單 + 零件成本 FIFO，2026-09-07）

- **FixEngineer 角色（migration `20260907000002_fixengineer_rpc_and_rls.sql`）**：`user_roles.system_role` 新增 `fixengineer`（維修人員）；RPC `can_access_repair_order(p_repair_order_id)`（SECURITY DEFINER）回 JSON `{ok, can_view, can_edit, store_id, status, assigned_to}`——FixEngineer 只能存取「待接案（`assigned_to IS NULL`）或自己已接（`assigned_to=auth.uid()`）且 `status NOT IN ('partially_delivered','delivered','cancelled')`」的單；`useAuth` 新增 `isFixEngineer`（`system_role='fixengineer'` 即為，非『admin 兼任』）。**權限模型**：actor 四種身分可存取（admin、店成員、指派到的 FixEngineer、`assigned_to=auth.uid()` 且 `has_role(auth.uid(),'admin')`＝接案人）；`system_role='fixengineer'` 的使用者一律**不能進 `/admin/*`**，跳獨立工作台 `/workshop`。
- **FixEngineer 工作台**：`src/routes/workshop.tsx`（`/workshop`、`/workshop/new`、`/workshop/:id`、`/workshop/:id/edit`）；`ProtectedRoute` 新增 `requireFixEngineer`；`config/navigation.ts` 新增 `fixengineerNavItems`（維修工作檯/新增維修單，base `repairBase()` 由 `/workshop` 自動判定），獨立於 admin 側欄（AppLayout `isFixEngineer` 時用 fixengineer 清單）；FixEngineer 可自建維修單（`assigned_to=自己`）；admin 在 `Stores.tsx` 人員管理 tab 的「系統角色」按鈕可設定使用者為 fixengineer。
- **多機型拆單（僅新增模式，admin + store）**：共用元件 `src/components/repair/DeviceBlockSection.tsx`（props 傳 `models`/`showRam`/`showSn`/`showDiagnostic`/`suggestions`，不用 underscore 暫存欄位）。admin `new.tsx`（create 多區塊、每區塊獨立「裝置/檢查表/項目/費用」＋`DeviceBlockSummaryCard` 區塊總覽、底部「新增一個裝置區塊」按鈕、桌面 2 欄、儲存時依區塊建 N 張單並各自 `saveItems`/`saveChecklists`，新增用直接 `supabase.insert` 迴圈避免 N 次 toast；edit 模式退回單一區塊）與 store `new.tsx` 皆走此共用元件。每單共用客戶/狀態/接案人；費用區由 `FeesFieldsSection` 呈現（store 模式隱藏折扣）。
- **建立零件自動綁機型**：`DeviceBlockSection` 關於 `ItemsFieldsSection` 底部（admin mode）有「建立零件」按鈕（傳 `onCreatePart(device_model_id)`）→ 開 `ProductFormDialog` 並**自動帶入當前機型**（`partModelId` 寫入變數），產品建立後自動寫入 `product_category_links`＋`device_model_ids`（新增/編輯皆涵蓋；`ProductFormDialog` reset 尊重 `initialData.device_model_ids`、標題無 id 時顯示「新增產品」）。
- **零件成本進貨批次 FIFO（migration `20260907000003_repair_part_fifo_cost.sql`）**：`purchase_order_items.consumed_quantity`（已耗用累計）＋ `repair_order_items.purchase_order_item_id`（所用進貨批次）；RPC `list_repair_part_batches(p_product_id, p_variant_id)`（SECURITY DEFINER、僅 authenticated）列出剩餘批次，排序 `COALESCE(received_date, order_date, created_at::DATE)` 最早優先（FIFO）；`deduct_repair_part_stock` 加第 7 參數 `p_purchase_order_item_id DEFAULT NULL`——指定時驗證該批次剩餘充足（不足回「該進貨批次剩餘不足」），NULL 時自動抓最早的足夠批次（無可用回「無可用進貨批次（請先進貨並收貨）」），扣銷後 `consumed_quantity + 數量` 並回填 `repair_order_items.unit_cost`＝批次成本；舊 6 參數 overload 已 DROP。前端 `RepairBatchSelect.tsx`（`queryKey ['repair_part_batches', ...]`，標籤「進貨 YYYY/MM/DD・單價 $X・剩 H」，無批次顯示「無可用進貨批次」）：admin part 行列下方「進貨批次」共用選單，選零件後自動預設 FIFO 第一筆、可手動換批，換批同步寫 `purchase_order_item_id`＋`unit_cost`；admin `new.tsx` `saveItems` 的 `deduct_repair_part_stock` 呼叫依插入列索引帶 `p_purchase_order_item_id`。
- **安全（`revoke_repair_order_summary`）**：advisor ERROR 級 lint `auth_users_exposed`——`repair_order_summary` VIEW 含 `auth.users` email 且預設 expose 給 anon；前端從未使用該 view，已 `REVOKE ALL ... FROM anon, authenticated` 止血。
- **接案人 email 顯示改走 RPC（2026-09-07，migration `20260907000005_repair_assignee_emails_rpc.sql`）**：`auth.users` 位於 `auth` schema，**PostgREST 預設 `db-schemas` 不含 `auth`，任何跨 schema 的 `assigned_to(email)` / `changed_by(email)` embed 皆報 400 `PGRST200`（schema cache 找不到 relationship）**——`NOTIFY pgrst,'reload schema'` 無效（屬於 config 層限制，非 cache 延遲）。修法：新增 SECURITY DEFINER RPC `repair_assignee_emails()`（回傳維修單相關 `assigned_to`/`created_by`/`changed_by` 使用者的 `user_id`/`email`/`full_name`，僅 authenticated 可執行，繞過 profiles RLS 唯讀列出參與維修流程使用者）；前端 `useRepairOrders.ts` 新增 `useRepairAssigneeMap()` 並**移除兩支 query 的 `assigned_tech:assigned_to(...)`、`status_history:...changed_by(...)` embed**；admin 工作台列表/詳情（`RepairOrdersPage`/`detail`），門市列表/詳情（`repair-orders/index`/`detail`）改以 `assignees[assigned_to]?.email`、`assignees[h.changed_by]?.email` 解析（workshop 路由重用 admin 頁面故同步生效）。⚠️ 未來不要再對 `auth.users` 做 PostgREST embed。

## 近期變更（服務型商品 + A+B 加購 + 運費月結 + 佣金成本快照，2026-09-06）

- **migration 20260906000001~0003 已套用遠端**：新增 `products.item_type`（`product`/`shipping`/`packaging`/`repair_part`，取代 `is_repair_part`，已遷移並 DROP）、`products.is_hidden`、`categories.is_hidden`（兩層前端顯示開關）；`product_addon_bindings`（A+B 加購綁定，RLS authenticated 讀/admin 管，變動 bump products 版本）；`order_items.parent_order_item_id`（父子行，ON DELETE CASCADE）＋`unit_cost`（成本快照，佣金優先）＋`shipping_payment`（`monthly`＝月結）；`shipping_settlement_periods`（運費月結帳本，UNIQUE(carrier, period)）；`trg_a_skip_shipping_inventory` BEFORE INSERT（依字母序先於 `trg_sync_inventory_on_movement`，shipping 型 `RETURN NULL` 一律不寫庫存）；`sync_storefront_items` 排除隱藏/非一般商品。
- **商品類型**：`shipping`＝運費（不進訂單目錄、不扣庫存、可月結）；`packaging`＝包裝（庫存商品＋可加購，進目錄且進前台，v1 未獨立 badge，統一料號即商品本體）；`repair_part`＝維修零件；`is_hidden` 前後台顯示開關，後台仍可管理。前端過濾：`useProductCache` 排除 `shipping`/`repair_part` 與 `is_hidden`；`RepairPartSelect` 改 `.eq('item_type','repair_part')`；`Catalog.tsx` categories 加 `.eq('is_hidden', false)`；商品表單 `IdentificationFields` 改 item_type 下拉＋is_hidden checkbox。
- **A+B 加購**：`AddonBindingManager`（產品表單→綁定 tab，父產品層級綁定：候選商品＋可選變體＋數量）；加入訂單時 `useStoreDraft().addItem` 包裝自動帶出加購子行（`item_type='packaging'`、`customItemId='addon:{bindingId}'` 累加、`temp_key`/`parent_temp_key` 串接父行；module-level 5 分鐘快取）。出貨/編輯 RPC payload 已帶 `temp_key`/`parent_temp_key`（兩輪對應回填 `parent_order_item_id`）＋`unit_cost`/`shipping_payment`。⚠️ pending（未出貨）批量 insert 無父子實體鏈結（子行獨立），僅 shipped 流程有完整串接。
- **運費月結（依物流公司＝採購商彙總，2026-09-07）**：`products.supplier_id`（運費型商品綁定所屬採購商，`IdentificationFields` 於 `item_type='shipping'` 時顯示必填下拉，物流公司統一於「採購管理→供應商」管理）；`shipping_settlement_periods` 唯一鍵由 `carrier_product_id` 搬移至 `(supplier_id, period_start, period_end)`（`carrier_product_id` 放寬 NULL 保留相容，新結算一律 NULL）。`register_shipping_settlement(p_supplier_id, p_order_item_ids uuid[], p_period_start/end, p_paid_date, p_account_id, p_category_id, p_description, p_note, p_created_by)`（SECURITY DEFINER，改以採購商過濾：品項 `.product.supplier_id=p_supplier_id` 且 `item_type='shipping'`，排除已由該物流公司結算的訂單；寫母支出分錄＋references＋period 並扣帳戶，RETURNS `{period_id, entry_id, total_amount, order_count}`）、`revoke_shipping_settlement(p_period_id)`（刪分錄回衝款、CASCADE 清除 references/period）。前端 `useShippingSettlement`（payload `{supplierId, orderItemIds, periodStart, periodEnd, ...}`）＋EntryForm「**運費結帳**」Tab（物流公司＝採購商下拉，列其運費型商品清單、月結品項複選附「運費品項」欄）＋`ShippingSettlementsPage`（`/admin/shipping-settlements`，結算紀錄表顯示物流公司名）。
- **佣金批次發放改走 EntryDialog**：`register_batch_rep_commission_payout(p_rep_id, p_sales_note_ids UUID[], p_paid_date, p_account_id, p_category_id, p_description, p_created_by)`（母支出分錄＋多筆 payouts，金額後端重算）。`useCommissionPayout.bulkRegisterPayout`＝`{repId, salesNoteIds[], paidDate, accountId, categoryId?, description?}`；EntryForm「佣金發放」改複選（單筆 `onPayoutSubmit`/多筆 `onBatchPayoutSubmit`）；`EntryDialog` proxy 新 props；`RepCommissionPage` 批次按鈕開 EntryDialog（`prefill.payout={repId, salesNoteIds}`）。佣金明細與 `useRepCommission.computeLine` 成本優先取 `order_items.unit_cost` 快照（>0）再回退 `rep_product_costs`。
- **EntryForm 新增兩個二級表單**：`FormView` 增加 `'shipping'`；`EntryPrefill` 擴充 `payout.salesNoteIds?` 與 `shipping?{carrierProductId?, orderItemIds?, periodStart?, periodEnd?}`；props 新增 `onBatchPayoutSubmit`/`onShippingSettleSubmit`（AccountingPage／ShippingSettlementsPage 接線）。

## 近期變更（變體批次建立：型號/群組選取順序保留，2026-09-08）

- **Migration `20260908000001_entity_model_relations_sort_order.sql`**：`entity_model_relations` 新增 `sort_order INT NOT NULL DEFAULT 0`（backfill 依「每實體模型在前（依 device_models.sort_order）、群組在後」給定穩定順序）。
- **選取順序統一**：`StandaloneDeviceModelSelectField` 新增 `selectionOrder`（`DeviceSelectionRef[]`＝`{id, type:'model'|'group'}`）與 `onOrderChange` props——provide 時作為顯示與 toggle 排序**唯一依據**（型號/群組可**交錯**選取並依點選順序排列），未 provide（如 `VariantEditDialog`）時沿用舊 `modelIds`/`groupIds`＋`onChange` 相容路徑。Badge 顯示改依選取順序，不再用目錄排序。
- **`VariantBatchCreator`**：`selectedModelIds`/`selectedGroupIds` 兩 state 合併為單一 `selectedDeviceRefs`（順序即生成順序）；`generateVariants` 兩條路徑（僅型號、含選項群組）皆以 `resolveDeviceItems()` 依 refs 順序生成變體（SKU/名稱/sort_order 同步反映）；`createMutation` 寫 `entity_model_relations` 時依 `selectedDeviceRefs` 順序寫入 `sort_order`；`loadExistingData` 改 `.order('sort_order')` 重建選取順序（跨對話保留）。
- **`entityRelationService.updateRelations`**：寫入 relations 時加序號 `sort_order`（產品/單變體編輯路徑亦持久化順序）。

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

## 近期變更（產品匯入/匯出更新）

- **P1 變體排序 round-trip**：`variant_sort_order` 欄位新增於匯出試算表；匯出時依 `sort_order` 排序變體列；兩條匯入路徑（統一產品匯入 + 變體 CSV 匯入）均能從該欄位讀取並寫入 DB `product_variants.sort_order`，確保排序於匯入/匯出間保持一致。
- **P2 型號/群組交錯順序**：`entityRelationService.updateRelations` 新增 `ordered` 參數（`{id, type}` 陣列），依序指派 `sort_order` 並在餘下項補遺；`parseModelString` 回傳 `ordered`（含 model/group/exclude 的交錯序列）並傳入 `updateRelations`；`productModelResolver` 新增 `orderedMap`（`entityId → rules` 依 `sort_order` 交錯產生 `device_model_rules`），`useProductCache` 於抓取 relations 時選 `sort_order, created_at` 並傳遞至 `buildModelMaps`；確保匯入後的 relations `sort_order` 可在重匯出時反映於 `適用型號` cell。
- **P3 系列欄修復**：`useProductExport.ts` 新增從 `brand_series` 抓取 id→name 對照表作為 `seriesMap`，並傳入 `generateProductExcel`，解決以往匯出「系列」永遠空白的問題。
- **已知問題（另案處理）**：Option 欄（`option:<groupId>`）目前匯入時被 `serializeSpecs` 靜默丟棄，選項值無法 round-trip。已記錄為已知問題，將於後續專案處理。
