# Order Manager Pro — 資料庫 schema 與商業邏輯詳情

> 本文為 `AGENTS.md` 的補充文件，**只在涉及資料庫/schema/商業邏輯的任務時才讀取**。
> Schema 權威來源為 `supabase/migrations/`（72 支 SQL）；`src/integrations/supabase/types.ts` 為自動產生。
> 由 AI 持續維護，新增/修改 table、RPC、trigger、enum 後需同步更新。

## 1. 資料表總覽（public schema）

> 表數會隨版本變動（live DB 與 types.ts 可能未同步最新 migration），以 migrations 為準。

### 權限與使用者
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `profiles` | 使用者資料 | id(=auth.users)、email、full_name、phone、line_id、telegram_id |
| `user_roles` | 系統角色 | user_id、role(`system_role`) |
| `stores` | 門市 | name、code、brand、owner_id、address、phone |
| `store_users` | 門市成員 | user_id、store_id、role(`store_role`) |
| `invitations` | 門市邀請 | email、token、role、status(`invitation_status`)、expires_at、store_id |

### 商品與品牌
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `products` | 商品主表（精簡） | name、code、description |
| `product_variants` | 變體 | product_id、name、sku、barcode、retail_price、wholesale_price、status(`product_status`) |
| `product_images` | 圖片 | entity_id、entity_type、url、storage_path、is_cover、sort_order |
| `product_option_groups` / `product_option_values` / `product_variant_options` | 選項（顏色/規格群組） | group/values/variant 三方關聯 |
| `brands` | 品牌 | name、abbreviation、sort_order |
| `brand_series` | 品牌系列 | brand_id、name、slug、image_url、sort_order |
| `product_brands` | 商品↔品牌（多對多） | product_id、brand_id、is_primary |
| `product_series_links` | 商品↔系列 | product_id、brand_series_id |
| `store_products` | 門市定價 | product_id、variant_id、wholesale_price、retail_price、brand |
| `product_colors` | 顏色對照（變體顏色） | code、name、hex_code、sort_order、is_active |

### 分類與規格
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `categories` | 分類 | name、slug、sort_order |
| `category_hierarchy` | 分類父子層級 | parent_id、child_id |
| `product_category_links` | 商品↔分類 | product_id、category_id、variant_id |
| `specification_definitions` | 規格定義 v6 | name、type、expected_type(`spec_value_type`)、options、configuration、dsl_schema_json、quantity_source_id |
| `specification_triggers` | 規格條件觸發 | source_spec_id、target_spec_id、condition_dsl、priority、max_depth_limit、**relation_type**（`visibility` 預設｜`quantity` 數量複製） |
| `category_spec_links` | 分類↔規格 | category_id、spec_id、sort_order、is_manual |
| `entity_spec_values` | 規格值 | entity_id、entity_type(`spec_entity_type`)、spec_id、category_id、value(JSONB)、parent_id、instance_uuid、lifecycle_state |

### 手機型號庫
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `device_brands` | 手機品牌 | name、slug、logo_url、banner_url |
| `device_models` | 型號（1065 筆） | brand_id、name、aliases、device_type、device_series、release_date、screen_size、specifications(JSONB) |
| `device_model_groups` | 型號群組 | name、description、is_active、deleted_at |
| `device_model_group_items` | 群組↔型號 | group_id、model_id、position |
| `device_model_group_history` | 群組變更紀錄 | group_id、action、old_data、new_data |
| `entity_model_relations` | 產品/變體↔型號/群組 | product_id、variant_id、model_id、group_id、relation_type、reason、sort_order(INT，保留「批次建立變體」時的型號/群組選取順序) |
| `entity_bindings` | 產品綁定（主/附屬） | product_id、variant_id、bound_product_id、bound_variant_id、binding_type |
| `storefront_items` | 店面展示清單 | product_id、variant_id、model_id、display_name、slug、status |

### 訂單 / 銷貨 / 出貨
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `orders` | 訂單 | store_id、code、status(`order_status`)、source_type(`order_source_type`)、created_by、notes、access_token、consignment_mode(BOOL，整單寄賣模式) |
| `order_items` | 訂單明細 | order_id、product_id、variant_id、store_id、quantity、unit_price、shipped_quantity、status(`order_item_status`)、selected_model_name、sort_order(INT，品項顯示順序) |
| `sales_notes` | 銷貨單 | store_id、code、status(`sales_note_status`)、shipped_at、received_at、created_by、access_token、payment_status(text：`unpaid`/`paid`，收款狀態，與 status 收貨狀態分離) |
| `sales_note_items` | 銷貨單明細 | sales_note_id、order_item_id、quantity |
| `shipping_pool` | 出貨池（待出貨累積） | order_item_id、quantity、store_id、created_by |

### 供應商 / 採購
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `suppliers` | 供應商 | name、contact_name、phone、email、is_active |
| `purchase_orders` | 採購單 | supplier_id、status(`purchase_order_status`)、order_date、expected_date、received_date、total_amount |
| `purchase_order_items` | 採購明細 | purchase_order_id、product_id、variant_id、quantity、received_quantity、unit_cost、sort_order(INT，品項顯示順序，新/匯入品項取現有 MAX+1)、source_order_ids、source_quantities(JSONB `{orderId: 數量}`，記錄每個來源訂單貢獻量，供精確扣量與防止重複採購) |
| `supplier_import_configs` | 供應商 Excel 匯入設定 | supplier_id、header_row、mapping_config(JSONB) |
| `supplier_product_mappings` | 供應商商品對應 | supplier_id、vendor_product_id、internal_product_id、vendor_unit_cost |

### 寄賣（統一模板 v1）
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `consignment_orders` | 寄賣單（雙方向統一） | code(`CS-YYMMDD-XXXXX`)、direction(`receive_from_supplier`/`send_to_store`)、supplier_id/store_id（依方向擇一，CHECK 強制）、status(`draft`/`active`/`settled`/`cancelled`)、source_order_id（訂單轉寄賣時回填 orders.id；**v1.4 起 send_to_store 一建立即同步建來源 order 並回填**）、received_at/received_by（店家確認收貨，v1.3）；send_to_store 非 draft/cancelled 強制 source_order_id（CHECK `chk_consignment_send_to_store_source_order`） |
| `consignment_order_items` | 寄賣品項 | consignment_order_id、product_id、variant_id、quantity、unit_price（建議售價/出貨價）、unit_cost（進貨成本）；**order_item_id（v1.4，FK→order_items ON DELETE SET NULL，鏡像來源 order_items）** |
| `consignment_sales_reports` | 店家銷售回報（審核層） | status(`pending`/`confirmed`/`rejected`)、quantity、sale_price（可選，應對打折）、confirmed_by/at |
| `consignment_sales` | 統一銷售帳本 | direction、source_type(`store_report`/`customer_order`)、report_id、sales_note_id、order_item_id、quantity、unit_price、unit_cost、reversed |
| `consignment_settlements` | 結算 | settlement_type(`supplier_payment`/`store_receivable`/`commission`/`convert_purchase`)、status(`pending`/`paid`)、amount、account_id |
| `consignment_returns` / `consignment_return_items` | 退回單 | direction、status；return_items 綁 consignment_order_item_id + quantity |
| `consignment_order_item_summary`（VIEW） | 品項統計（計算不落庫） | received/shipped/returned_to_supplier/returned_from_store/sold/remaining_quantity |

### 庫存（最新重構）
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `warehouses` | 倉庫 | name、code、type、include_in_actual、include_in_available |
| `product_inventory` | 庫存餘額 | product_id、variant_id、warehouse_id、quantity，UNIQUE(product_id, variant_id, warehouse_id) |
| `inventory_movements` | 庫存異動流水 | product_id、variant_id、warehouse_id、quantity_change、balance_after、source_type、purchase_order_id/sales_note_id、reference_code |

### 會計
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `accounts` | 帳戶 | name、type、balance、is_active |
| `accounting_categories` | 會計分類 | name、type、description、is_active |
| `accounting_entries` | 會計分錄 | account_id、category_id、type、amount、paid_amount、payment_status(`payment_status`)、transaction_date、due_date、reference_id/type、**counterparty_name**（2026-09-09：對象名稱＝店家/供應商/客戶） |

- **收款狀態連動**：`sales_notes.payment_status`（`unpaid`/`paid`）與收貨狀態 `status` 分離；`public.sync_sales_note_payment_status(p_sales_note_id uuid)`（SECURITY DEFINER，revoke public/anon、grant authenticated）統一計算「該銷貨單只要有任一 `accounting_entries`（`type='income'`、`payment_status IN ('paid','partial')`，且 **entry row `reference_type='sales_note'` 直接綁定** 或 **`accounting_entry_references` 子表有該單據**（OR 兩路徑，2026-09-09 修復））→ `paid`，否則 `unpaid`」，供付款/回退/刪除/建立四流程連動（`useAccounting` 的 `recordPaymentMutation`/`reversePaymentMutation`/`deleteEntryMutation`/`createEntryMutation`、`SalesNoteDetailDialog.receivePaymentMutation`）。**counterparty_name**：建立銷貨單/採購/維修收支分錄時由 `EntryForm.buildSubmitData` 從 `docItems[0].name` 寫入（店名/供應商名）；既有資料 migration 回填（銷貨→店家、採購→供應商、維修→客戶，含 description 推斷）。

### 維修單
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `repair_orders` | 維修單主表 | code(`RO-YYYYMMDD-XXXXX`)、store_id、status(`repair_order_status`)、客戶/裝置/帳務/人員/時間欄位 |
| `repair_order_items` | 維修品項（服務+零件） | repair_order_id、item_type(`repair_item_type`)、service_name、part_name、quantity、unit_cost、unit_price、**purchase_order_item_id（所用進貨批次，FK→purchase_order_items）、is_stock_deducted** |
| `repair_order_status_history` | 狀態變更歷史 | repair_order_id、from_status、to_status、changed_by、note |
| `repair_order_summary`（VIEW） | 彙總含利潤/毛利率/人員 | ⚠️ 含 `auth.users` email，前端未使用，已 REVOKE anon/authenticated 全數存取 |
| `purchase_order_items`（附加） | 進貨批次 FIFO 記帳 | `consumed_quantity`（已被維修單耗用累計，剩餘＝received_quantity−consumed_quantity） |

### 系統 / 資料版本控制 / 其他
| 表 | 說明 | 關鍵欄位 |
|---|---|---|
| `data_versions` | 每表版本（快取校驗核心） | table_name PK、version(`YYMMDD-XXXX`)、last_triggered_by |
| `data_change_logs` | 變更事件 log（Diff 引擎來源） | table_name、record_id、action、version_tag |
| `data_snapshots` | 全量快照 | table_name、data_json(JSONB)、last_sequence_id |
| `system_sequences` | 流水號計數器 | name PK、current_value |
| `audit_logs` | 稽核紀錄 | entity_type、entity_id、action、old_value、new_value、performed_by、store_id |
| `notifications` | 通知 | user_id、store_id、title、message、link、read |
| `market_listings` | 媒合市場刊登 | author_id、listing_type(`market_listing_type`)、main_category、price、status、contact_method |
| `filter_groups` / `filter_group_items` | 前台篩選群組 | filter_type、name、slug、icon_url |
| `table_templates` / `table_template_variants` | 訂單表格範本 | col_config、row_config、tab_config(JSONB) |

## 2. Enums

- `system_role`: admin | customer | rep | fixengineer
- `store_role`: founder | manager | employee
- `order_status`: pending | processing | shipped
- `order_source_type`: frontend | admin_proxy | consignment
- `order_item_status`: waiting | partial | shipped | out_of_stock | discontinued | cancelled
- `sales_note_status`: draft | shipped | received
- `product_status`: active | discontinued | preorder | sold_out
- `purchase_order_status`: draft | ordered | partial_received | received | cancelled
- `payment_status`: unpaid | partial | paid
- `spec_value_type`: string | number | boolean | array | object
- `spec_entity_type`: product | variant
- `spec_instance_state`: active | orphaned | migrated | deleted
- `repair_order_status`: pending | diagnosing | quoting | awaiting_approval | awaiting_parts | repairing | ready | delivered | cancelled
- `repair_item_type`: service | part
- `invitation_status`: pending | accepted | expired
- `market_listing_type`: buy | sell | service
- `market_listing_status`: active | draft | completed | closed
- `market_contact_method`: line | phone | telegram

> 注意：`repair_orders`/`repair_order_items`/`repair_order_status_history` 目前不在 `types.ts`（types.ts 是自動產生，可能尚未重新產生）。

## 3. RLS 概況

- RLS helper 函式：`has_role(system_role)`、`is_store_member(store_id)`、`get_store_role(store_id, user_id)`、`bind_user_to_store(p_user_id, p_store_id, p_role)`
- **業務（rep）helper**：`is_rep(user_id)`、`get_rep_commission_rate(user_id)`（回傳 `user_roles.commission_rate`）、`is_rep_store(user_id, store_id)`（業務是否被分配到該店家）
- 授權模式：admin 全權限；門市成員對自己 store_id 的資料有權限；業務對自己建立的訂單（`orders.sales_rep_id = auth.uid()`）與名下店家（`is_rep_store`）資料有權限
- ⚠️ **10 張表 RLS 未啟用**（anon key 可直接讀寫）：`categories`、`specification_definitions`、`category_spec_links`、`category_hierarchy`、`product_category_links`、`data_change_logs`、`data_snapshots`、`storefront_items`、`table_templates`、`table_template_variants`
- 啟用 RLS 前需先建立 policies，否則會鎖死所有存取

## 3.5 業務（rep）身分系統（2026-09-04）

- `system_role` enum 新增 `'rep'`（跨店、非單店成員）；登入後由 `useAuth` 讀取，進 `/admin`。
- **新表**：
  - `rep_store_assignments(id, rep_id→auth.users, store_id→stores, assigned_at, UNIQUE(rep_id,store_id))`：業務↔店家分配；RLS：admin 全權（`has_role(admin)`）、業務只讀自己（`auth.uid()=rep_id`）。
  - `rep_product_costs(id, rep_id→auth.users, product_id→products, variant_id→product_variants, cost NUMERIC DEFAULT 0, UNIQUE(rep_id,product_id,variant_id))`：業務自有進貨成本；RLS：admin 全權、業務只讀自己。
  - `rep_commission_payouts(id, rep_id→auth.users, sales_note_id→sales_notes, amount NUMERIC, paid_date DATE DEFAULT CURRENT_DATE, note TEXT, created_by→auth.users, created_at, UNIQUE(rep_id,sales_note_id))`：業務分潤發放登記（一筆銷貨單對一業務一次發放）；RLS：admin 全權（`has_role(admin)`）、業務只讀自己（`auth.uid()=rep_id`）。
- **欄位**：`user_roles.commission_rate`（NUMERIC(5,2)，業務級固定比例，ADMIN 設定）；`orders.sales_rep_id→auth.users`（業務建立/負責的訂單，`idx_orders_sales_rep`）。
- **Helper**：`is_rep(user_id)`、`get_rep_commission_rate(user_id)`（回傳 commission_rate，無則 0）、`is_rep_store(user_id, store_id)`（業務是否分配到店家）。皆 SECURITY DEFINER STABLE。
- **RLS 更新**：
  - `stores` SELECT：admin / store member / `is_rep_store`。
  - `orders`：INSERT 允許 admin 或 rep 在名下店家建單（`is_rep AND is_rep_store(store_id)`）；SELECT 允許 admin / store member / `sales_rep_id=auth.uid()`；UPDATE 允許 admin / pending 的 store member / `sales_rep_id=auth.uid()`。
  - `sales_notes` / `sales_note_items` SELECT：admin / store member / `is_rep_store(store_id)`。
  - `order_items` SELECT/INSERT：以 `orders` 權限為準（含 `o.sales_rep_id=auth.uid()`）。
- **`update_order_with_items` 授權加固**：允許 admin / store member / `v_order.sales_rep_id=auth.uid()`。
- **佣金公式**（前端 `useRepCommission` 換算；後端發放 RPC 亦重算同公式）：佣金 = Σ max(0, (售價 − 業務成本) × 數量) × commission_rate / 100，成本優先序 = `order_items.unit_cost` 快照（>0）→ `rep_product_costs`（逐變體→產品層級 `variant_id IS NULL`）→ **進貨成本（`product_variants.wholesale_price`，未設定時預設值）** → 0（2026-09-07）。佣金明細頁另行查 `accounting_entries`（`reference_type='sales_note'`、`type='income'`、`paid_amount>0`）顯示登記收款時間。
- **分潤發放 RPC（2026-09-05，併入會計模組）**：
  - `upsert_rep_product_costs(p_rep_id uuid, p_items jsonb)`（SECURITY DEFINER，僅 admin）：批次寫入業務成本（2026-09-05 起取代逐筆 upsert/delete）。`p_items` = `[{product_id, variant_id, cost}]`；`cost` 為 json null＝刪除該列；負值 raise；產品層級（variant null）先刪後插避免 UNIQUE 對 NULL 不生效之重複列；回傳 `{upserted, deleted}`。變體輸入框未設定時以「預設 $X（進貨成本）」提示（fallback 見 8.x 佣金公式）。
  - `register_rep_commission_payout(p_rep_id uuid, p_sales_note_id uuid, p_paid_date date, p_note text, p_account_id uuid, p_category_id uuid, p_description text, p_created_by uuid) RETURNS jsonb`（SECURITY DEFINER，`set search_path=public,extensions`，僅 admin）：單一交易內 **內部重算佣金**（不接受外部傳入金額）＋ INSERT `rep_commission_payouts`（UNIQUE(rep_id,sales_note_id) 擋重複）＋ INSERT `accounting_entries`（`type='expense'`、`reference_type='rep_payout'`、`reference_id=payout_id`、`paid_amount=amount`、`payment_status='paid'`）＋ `accounts.balance -= amount`；回傳 `{payout_id, amount}`。
  - `revoke_rep_commission_payout(p_payout_id uuid)`（SECURITY DEFINER，僅 admin）：依 `reference_type='rep_payout'` 找支出分錄→回衝 `accounts.balance += amount`→刪分錄→刪 payout。
  - 兩者皆 `revoke ... from public, anon; grant ... to authenticated`（內部再以 `has_role(auth.uid(),'admin')` 把關）。
  - seed：`accounting_categories` 新增「業務分潤」expense 分類。
- ⚠️ 出貨僅 admin 處理（業務不出貨）；RLS 已預留，系統穩定後可下放。

## 4. 版本控制系統（快取校驗的骨幹）- `data_versions.table_name` 與實際表名**不完全一致**：
  - `specs` ← specification_definitions / category_spec_links / specification_triggers（由 `trigger_bump_specs_version` 觸發）
  - 其餘多為同名（products、categories、device_models、product_variants、entity_model_relations、brand_series、storefront_items、product_images、device_model_groups/items 等）
- `bump_data_version(p_table_name, p_source_table)`：INSERT ... ON CONFLICT DO UPDATE version+1（**舊版為 INTEGER 遞增；新版已改 `YYMMDD-XXXX` 格式**，隨表 trigger 各自實作，例如 repair_orders 用 `to_char(now(),'YYMMDD') || '-' || LPAD(random()*10000)`）
- 版本格式：`YYMMDD-XXXX`，字串字典序即時間序（前端 `versionCache`/`CacheService.isStale` 直接字串比較）
- `data_change_logs`：record_id、action(INSERT/UPDATE/DELETE)、version_tag，供 Edge Function 做 event compaction + batch fetch
- `data_snapshots`：全量快照 + `last_sequence_id`，冷啟動或斷層時使用
- Edge Function `check-data-version`：`sync_mode` = `full`（冷啟動/斷層）或 `incremental`；`serverSequenceId` 以 data_versions 為權威來源
- ⚠️ Edge Function 查 `sync_table_metadata` 取得 PK 欄位，但**該表不存在於任何 migration**，查詢永遠失敗並回退 `'id'`（目前尚可運作，因主表 PK 皆為 id）

## 5. 流水號（system_sequences + trigger）

- `generate_sequential_code()` BEFORE INSERT trigger：
  - orders：`OD{YYMMDD}{5碼}`，seq key = `order_YYMMDD`
  - sales_notes：`SL{YYMM}{門市碼}{4碼}`，門市碼 = store.code（null 時取 store.id 前 4 字元），seq key = `sales_YYMM_{store_id}`
- 維修單：`generate_repair_order_code()` → `RO-YYYYMMDD-XXXXX`（掃當日最大序號+1）
- 寄賣單：`trgfn_generate_consignment_code()` → `CS-YYMMDD-XXXXX`，seq key = `consignment_YYMMDD`

## 6. 庫存系統邏輯（最新重構，warehouse 路線）

### 6.1 資料模型
- 3 個預設倉：`own`（自有，計入實際+可賣）、`supplier_consignment`（供應商寄賣，計入實際不含可賣）、`defective`（瑕疵）
- `product_inventory`：唯一鍵 (product_id, variant_id, warehouse_id)
- **寄賣所有權不落 warehouse**：`inventory_movements.inventory_owner`（`self`/`supplier_consignment`/`store_consignment`）標記誰擁有，`product_inventory` 維持各倉總量合併，拆帳靠計算
- `inventory_movements`：`source_type` CHECK 約束綁定單據（新版）：
  - `purchase_receipt` / `purchase_return` → 需 `purchase_order_id`
  - `sales_shipment` / `sales_note_deletion` / `customer_return` → 需 `sales_note_id`
  - `consignment_in_receipt` / `consignment_in_return` / `consignment_out_shipment` / `consignment_out_sale` / `consignment_out_return` / `consignment_sale_reversal` / `consignment_shipment_reversal` → 需 `consignment_order_id`（FK 綁 `consignment_order_id`，`purchase_order_id` 必空）
  - `scrap` / `transfer` / `manual_adjustment` / `system_recalculation` → 兩者皆空
  - `sales_shipment` 與 `sales_note_deletion` 各有 partial unique index（防重複扣/加）
  - **`inventory_movements.order_item_id`（2026-09-05）**：sales_shipment / sales_note_deletion 記錄來源 `order_item_id`（FK→order_items，ON DELETE SET NULL）；兩條 unique index 改為 `(sales_note_id, order_item_id) WHERE ... AND order_item_id IS NOT NULL`——仍防「同一 order_item 在同一張銷貨單重複扣」，但**允許同變體不同 order_item 分行**（拆單補寄/瑕疵換貨）。歷史 180 筆 `sales_note_id IS NULL` 之舊資料無法回填（維持 NULL、不在索引涵蓋內）
- `sales_note_items.inventory_source_type`（`self`/`supplier_consignment`/`store_consignment`）：**每行**記錄來源，一張銷貨單可混合多來源
- **退貨標記（2026-09-06，migration `20260906000004`）**：`sales_note_items.returned_quantity`／`purchase_order_items.returned_quantity`（INTEGER NOT NULL DEFAULT 0，退貨累計）。退貨以 `inventory_movements` 記錄（`customer_return` 需 `sales_note_id`；`purchase_return` 需 `purchase_order_id`，來源單據 FK 相對應），自動經 trigger 同步 `product_inventory`（銷貨退貨回勾 source_type 之倉、採購退貨自該倉扣除）。新表：`sales_note_returns`（sales_note/warehouse/reason/status/total_refund/entry_id/reference_code/created_by）＋`sales_note_return_items`（sales_note_item_id/product/variant/quantity/unit_price/refund_amount）、`purchase_order_returns`＋`purchase_order_return_items`（units 同採購）。RLS：銷貨類 admin 全權＋門市 SELECT 自家（`is_store_member`）；採購類僅 admin。會計：退款 expense 分類「客戶退貨退款」、沖帳 income 分類「供應商退貨沖帳」（種子），`accounting_entries.reference_type` 分別為 `sales_note`/`purchase_order`，並回寫退貨表 `entry_id`

### 6.2 Trigger（核心不變式）
- `trg_sync_inventory_on_movement`：BEFORE INSERT，INSERT INTO product_inventory ON CONFLICT DO UPDATE quantity += quantity_change，並回寫 `balance_after`
- 結論：**任何庫存變動一律透過 insert inventory_movements 達成**，不直接改 product_inventory

### 6.3 關鍵 RPC（皆 SECURITY DEFINER，search_path=public,extensions）
| RPC | 功能 |
|---|---|
| `ship_from_pool(p_store_ids, p_created_by, p_notes, p_shipped_at, p_warehouse_id, p_warehouse_map, p_source_map, p_consignment_override_map)` | 從出貨池批次出貨：依門市建 sales_note(status=shipped) → 產生 sales_note_items → 更新 order_items.shipped_quantity/status → 扣庫存 → 清空該門市 pool → 更新 order.status；`p_source_map` 逐項指定庫存來源（self 扣 own 倉 / supplier_consignment 走 allocate_inventory）。**寄賣判定**：`p_consignment_override_map`（order_item_id→boolean）有該 item 時以 override 為準，否則回歸 `orders.consignment_mode`；寄賣品項只寫 sales_note_items(inventory_source_type='store_consignment')、不扣自有庫存。⚠️ **v1.2 起改單一 canonical 簽名（舊 overloads 已全數移除）**，v1.3 起寄賣品項不進 sales_note_items（純寄賣店家 sales_note_id=NULL），單店送完後呼叫 `create_consignment_shipment_layer` 自動建寄賣單。**2026-09-05**：sales_shipment movement 寫入 `order_item_id`（來自 pool 的 order_item），支持同單同變體多列 |
| `remove_items_from_shipping_pool(p_pool_ids uuid[], p_created_by uuid)` | **批次回滾成訂單（移出出貨池，2026-09-03）**：單一 RPC 一次寫入取代前端逐筆 `DELETE FROM shipping_pool`；守門 `p_pool_ids` 非空。收集受影響 order_id 集合 → `DELETE FROM shipping_pool WHERE id = ANY(p_pool_ids)` → 對每個受影響訂單，僅當**出貨池已無該訂單任何剩餘品項**且 `status='processing'` 才回退 `pending`（對齊「全數移出才回退」）。回傳 `{deleted_count, reverted_order_ids}` |
| `direct_ship_order(p_order_id, p_created_by, p_notes, p_shipped_at, p_warehouse_id, p_warehouse_map, p_source_map)` | 訂單直接轉銷貨：**v1.3 起單一 canonical 7-arg 簽名（舊 overloads 已全數移除）**。非寄賣：建 sales_note → 為剩餘數量建 items → 更新 order_items → 扣庫存 → order 標 shipped；寄賣（orders.consignment_mode=true）：**不建 sales_note**（回傳 sales_note_id=NULL）、依剩餘數量建寄賣層 + movement，order 標 shipped；**v1.5.1**：寄賣與一般分支出貨時皆逐項 `DELETE FROM shipping_pool`。**2026-09-05**：movement 寫入 `order_item_id` |
| `create_order_with_sales_note(p_store_id, p_created_by, p_notes, p_items JSONB, p_shipped_at, p_warehouse_id, p_consignment_mode)` | 下單即出貨：**v1.3 起單一 canonical 7-arg 簽名（舊 overloads 已全數移除）**。一般：建 order(source_type=admin_proxy, status=shipped) + sales_note + items + 扣庫存；`p_items[]` 逐項可帶 `inventory_source_type`。`p_consignment_mode=true` 時訂單標寄賣、items 一律 store_consignment、**不開銷貨單**、跳過 own 扣庫存、結尾呼叫 layer。**2026-09-05**：movement 寫入 `order_item_id` |
| `create_consignment_shipment_layer(p_order_items JSONB, p_warehouse_id, p_created_by)` | 訂單轉寄賣中間層（v1.1 新增，v1.2 改判據，v1.3 改簽名）：**v1.3 起改收 `p_order_items`（JSONB 陣列，order_items 全欄位），舊 `(p_sales_note_id, p_warehouse_id, p_created_by)` 簽名已移除**；find-or-create `consignment_order`(send_to_store, source_order_id, draft/active) + `consignment_order_items`（既有 order_item 回填） + `consignment_out_shipment` movement（owner=store_consignment，sign 為負）；**v1.4 改寫**：依 `consignment_order_items.order_item_id` 比對重用既有寄賣品項（草稿鏡像路徑不再重複建列）、既有草稿單轉 active；被 ship_from_pool / direct_ship_order / create_order_with_sales_note / create_consignment_shipment 呼叫；**v1.5.1**：出貨時逐項 `DELETE FROM shipping_pool`（對應 order_item_id） |
| `delete_sales_note(p_sales_note_id)` | 刪銷貨單：**consignment 來源不得直刪** → reverse `consignment_sales.reversed=true` + 反向 movement（`consignment_sale_reversal`/`consignment_shipment_reversal`）；非寄賣回退 order_items + sales_note_deletion 補庫存 + 回復 shipping_pool；`received` 狀態禁止刪除。**2026-09-05**：sales_note_deletion movement 寫入 `order_item_id`。**2026-09-09（migration `20260909000003`＋`_with_reference_code`）**：`RETURNS void`→`RETURNS JSONB`（DROP 後重建），並加守門——`received` 已收貨／已有會計分錄（`accounting_entries`＋`accounting_entry_references` two-path，如收款）／已有業務佣金發放（`rep_commission_payouts.sales_note_id`）／寄賣確認銷售未 reversed 時**擋下**回 `{ok:false, reason, adopted_by}`；通過才執行上述回退邏輯，成功回 `{ok:true}`。**庫存異動稽核（同批修補）**：FK `sales_note_id` 為 `ON DELETE SET NULL`（刪除銷貨單時歷史 movement 的 FK 會被清空），回補的 `sales_note_deletion` / `consignment_*_reversal` movement 現帶入 `reference_code`（= 刪除前的銷貨單 `code`），確保 FK 被 SET NULL 後仍可依 `reference_code` 追溯原始單號（歷史 `sales_shipment` movement 本來就有 `reference_code`）。⚠️（2026-09-01）舊 overload `(p_sales_note_id, p_warehouse_id)` 已移除，避免 PostgREST HTTP 300 |
| `delete_purchase_order_if_empty(p_purchase_order_id)` | **採購單刪除守門（2026-09-09, migration `20260909000004`）**：僅 admin（`has_role`）；替代前端原生 `DELETE FROM purchase_orders`（後者遇已收貨會撞 CHECK 拋模糊錯誤、無法回滾庫存/會計）。擋下條件：任一 item `received_quantity>0`（回「已收貨，請改用採購退貨」）、`inventory_movements.purchase_order_id` 存在（收貨/退貨/寄賣入庫殘留異動）、已有會計分錄（`accounting_entries`＋`accounting_entry_references` two-path：採購付款/運費月結/跨單結帳）——任一命中回 `{ok:false, reason, adopted_by}`；全數乾淨才 `DELETE FROM purchase_orders`（items FK CASCADE）。RETURNS `{ok:true}`；`REVOKE FROM PUBLIC, anon`，GRANT authenticated |
| `receive_purchase_items(p_items JSONB)` | 採購入庫：依 items 逐筆 insert purchase_receipt movement（own 倉） |
| `reorder_purchase_order_items(p_items JSONB)` | **採購品項排序（2026-09-08，migration `20260908000000`）**：僅 admin（`has_role`）；p_items＝`[{id, sort_order}]` 遞增序批次寫入（前端拖曳/名稱表頭排序後以 index+1 持久化）。既有資料 backfill 預設＝每張採購單依 `COALESCE(變體名稱, 產品名稱) DESC NULLS LAST`（tiebreak created_at）；新/匯入品項由前端取現有 `MAX(sort_order)+1` 排在末尾 |
| `adjust_inventory(p_id, p_new_quantity, p_created_by, p_note)` | 手動調整：算 diff → insert manual_adjustment movement |
| `recalculate_inventory(p_created_by)` | 系統重算：以 received - shipped 重算 own 倉餘額，差異 insert system_recalculation movement |
| `unlink_orders_from_purchase_order(p_purchase_order_id, p_order_ids UUID[])` | 解除訂單↔採購單連結（2026-09-01 新）：逐品項移除被解除訂單的來源連結並**精確扣除未收貨數量**（依 `source_quantities`；多來源舊資料為 NULL→只解除不扣量）；剩餘來源空＋無收貨→刪列；已收貨的保留；重算 total_amount 與狀態。RETURNS JSONB `{removed_item_count, updated_item_count,...}`，供前端批次「解除採購」與採購單明細解除用 |
| `process_sales_note_return(p_sales_note_id, p_items JSONB, p_warehouse_id, p_reason, p_refund_account_id, p_created_by)` | **銷貨退貨（2026-09-06, migration `20260906000004`）**：僅 admin（`has_role`）；銷貨單 status 須 `shipped`/`received`；逐項 FOR UPDATE 檢查 `returned_quantity ≤ quantity - returned_quantity`；回勾庫存以 `customer_return` movement（帶 sales_note_id＋order_item_id）、items 表寫入 `sales_note_return_items`；退款金額預設 qty×unit_price（`refund_amount` 可覆寫）、總額>0 時自動開「客戶退貨退款」expense 分錄（`reference_type='sales_note'`）並 `accounts.balance -= total`（未指定帳戶 RAISE）；回填 header `entry_id`；RETURNS JSONB `{ok, return_id, total_refund, items}` |
| `process_purchase_return(p_purchase_order_id, p_items JSONB, p_warehouse_id, p_reason, p_credit_account_id, p_created_by)` | **廠商退貨（2026-09-06）**：僅 admin；逐項可退上限 `received_quantity - returned_quantity`；`purchase_return` movement（帶 purchase_order_id）自指定倉（預設 own）扣庫存、寫入 `purchase_order_return_items`；沖帳金額預設 qty×unit_cost、總額>0 時自動開「供應商退貨沖帳」income 分錄並 `accounts.balance += total`（未指定帳戶 RAISE）；回填 header `entry_id`；RETURNS JSONB `{ok, return_id, total_credit, items}`。兩支皆 `REVOKE FROM PUBLIC, anon`（僅 authenticated 可 CALL） |
| `delete_order_if_unadopted(p_order_id)` | **完整刪除未被採用的訂單（2026-09-09, migration `20260909000001`＋`20260909000003`＋`fix_delete_order_use_shipped_quantity`）**：僅 admin（`has_role`）；依序檢查「被採用」引用並回傳**採用明細** `adopted_by`（array of `{kind, code?, label}`，銷貨單/寄賣單/採購單附 `code` 單號）——`sales_note_items`（FK NO ACTION）、`shipping_pool`(FK CASCADE，存在即擋避免靜默丟池列)、`consignment_orders.source_order_id`、`consignment_order_items`/`consignment_sales.order_item_id`、**`order_items.shipped_quantity > 0`**（已出貨但未回補的庫存異動；**不再檢查 `inventory_movements` 存在性**——庫存已歸零的歷史異動紀錄不擋刪除）、`sales_note_return_items.order_item_id`、`purchase_order_items.source_quantities ? p_order_id::text`（JSONB 無 FK）、`accounting_entries`＋`accounting_entry_references`(reference_type='order')——任一命中回 `{ok:false, reason, adopted_by}`，全數乾淨才 `DELETE FROM orders`（order_items/parent 子行 FK CASCADE）；`source_type='consignment'` 鏡像單一律拒絕。RETURNS `{ok:true}` |

### 6.3b 寄賣 RPC（v1，皆 SECURITY DEFINER）
| RPC | 功能 |
|---|---|
| `receive_consignment_items(p_consignment_order_id, p_items JSONB, p_created_by)` | 廠商方向收貨：逐項 insert `consignment_in_receipt` movement（supplier_consignment 倉，owner=supplier_consignment）；draft 單自動轉 active |
| `create_consignment_shipment(p_consignment_order_id, p_created_by, p_notes, p_shipped_at)` | 店家方向出貨（v1.3 改寫，**v1.4 重用既有來源 order**）：依**尚未出貨數量**（`order_quantity - shipped_quantity`）建 order(source_type='consignment', status=shipped, consignment_mode=true) + order_items + `consignment_out_shipment` movement；**不再建立 sales_note**（寄賣出貨只是商品移轉），回填 `consignment_orders.source_order_id` 並轉 active；**v1.4**：已有 `source_order_id` 則直接重用該來源 order（不再重建），品項已有 `order_item_id` 則累加 shipped_quantity/標 shipped/partial（不再重建），無則補建並回填；**v1.5.1**：出貨時逐項 `DELETE FROM shipping_pool`（維持「已出貨 ⇒ 不在 pool」）；回傳 order/sales_note 資訊（sales_note 為 NULL）。⚠️ 出貨量**不能用** summary.`remaining_quantity`（那是「店家手上未售」＝shipped−sold−returned，未出貨時為 0） |
| `confirm_consignment_receipt(p_consignment_order_id, p_created_by)` | **店家確認收貨（v1.3 新）**：僅 send_to_store 方向、已出貨、未收貨的 active 單可確認；寫入 received_at/received_by；非門市成員 RAISE |
| `allocate_inventory(p_product_id, p_variant_id, p_quantity, p_source, ...)` | FIFO 分攤：source='self' 僅回結構化 allocation 不寫入（呼叫端沿用原流程）；source='supplier_consignment' 依收貨時間序鎖定候選品項、逐批 insert `consignment_out_sale` movement + `consignment_sales`(customer_order)，不足即 RAISE |
| `report_consignment_sale(p_consignment_order_item_id, p_quantity, p_sale_price, p_note, p_created_by)` | 店家回報銷售：檢查方向=send_to_store + **已收貨（received_at 非空）** + 可回報數量（扣除 pending 回報）→ insert `consignment_sales_reports`(pending)；回傳 report_id |
| `report_consignment_sale_by_product(p_store_id, p_product_id, p_quantity, p_variant_id, p_sale_price, p_note, p_created_by)` | **依商品回報（v1.3 新）**：對店家所有未售出的寄賣品項依 FIFO 攤分數量，跨寄賣單建立 pending 回報（單筆回報可能對應多個 consignment_order_item_id）；回傳回報筆數；非門市成員 RAISE |
| `confirm_consignment_sales(p_report_ids UUID[], p_confirmed_by)` | 後台審核店家回報（v1.3 改寫）：逐筆驗證 pending + 剩餘量 → insert `consignment_sales`(store_report)；**依店家批次開立收款銷貨單**（`sales_notes` status='received'，逐筆建立 sales_note_items + `consignment_out_sale` movement），回填 `consignment_sales.sales_note_id/order_item_id`；回傳開立銷貨單數 |
| `return_consignment_items(p_consignment_order_id, p_items JSONB, p_created_by, p_note)` | 退回：廠商方向 insert `consignment_in_return`（supplier_consignment 倉 -）／店家方向 `consignment_out_return`（own 倉 +）；建 `consignment_returns` 單 |
| `reverse_consignment_shipment(p_consignment_order_id, p_created_by, p_note)` | **出貨回滾（v1.5 新）**：整單回滾店家方向出貨（見下方 v1.5 說明），RETURNS JSONB `{consignment_order_id, source_order_id, reversed_items, reversed_quantity}`；成功時扣回出貨、品項放回 shipping_pool（**覆寫 quantity 非累加**，v1.5.1）、寄賣單回 draft、來源 order_items 回 waiting/來源訂單全回滾時降 processing |
| `settle_consignment(p_consignment_order_id, p_settlement_type, p_amount, p_account_id, p_note, p_created_by)` | 結算：方向與類型配對（receive→supplier_payment、send→store_receivable）；insert `consignment_settlements`(paid)；累計已付≥應付時自動 order 標 `settled`；v1 僅支援前兩種 type |

> **訂單轉寄賣（v1.1）**：後台建立訂單時可整單切換「寄賣模式」（`orders.consignment_mode`）。出貨（pool / direct ship / 下單即出貨）時由 `create_consignment_shipment_layer` 自動同步建立 send_to_store 寄賣單（find-or-create，`source_order_id` 回填），後段回報→審核→結算→退回沿用既有機制。此路徑與「寄賣單獨立建立→出貨」並存。

> **出貨池逐項轉寄賣（v1.2）**：`ship_from_pool` 新增 `p_consignment_override_map`（order_item_id→boolean），一般（非寄賣模式）訂單可在出貨池逐項切「寄賣」出貨（混單允許）；`create_consignment_shipment_layer` 同步改依 `sales_note_items.inventory_source_type` 判斷，兩者一致。注意：override 出貨**不會**改寫 `orders.consignment_mode`（訂單列表 Badge 仍依整單旗標）。

> **寄賣出貨不開銷貨單（v1.3）**：語意改為「`sales_note` 只代表『確認賣掉的部分』的收款憑證」。店家寄賣出貨（獨立寄賣單 / 訂單寄賣模式 / 出貨池逐項寄賣）一律只建 order + 寄賣層 + movements、**不建 sales_note**；店家確認收貨（`confirm_consignment_receipt`）後才能回報銷售（`report_consignment_sale`/`report_consignment_sale_by_product`）；後台審核（`confirm_consignment_sales`）時才依店家批次開立 `sales_notes`(status='received') 作為收款單。`create_consignment_shipment` 補建來源 order 並回填 `source_order_id`（所有非 draft/cancelled 的 send_to_store 寄賣單皆需有來源 order，CHECK 強制）。

> **寄賣草稿＝真實來源訂單（v1.4）**：send_to_store 寄賣單**一建立即同步建來源 `orders`**（`source_type='consignment'`、`consignment_mode=true`、`status='pending'`）並回填 `consignment_orders.source_order_id`；品項同步建 `order_items`（`status='waiting'`）並回填 `consignment_order_items.order_item_id`。如此草稿即為「所有訂單」pending tab 的可勾選真實訂單（可確認/轉出貨池/編輯/商品模式看數量），出貨走 `ship_from_pool`/`direct_ship_order` 時由 `create_consignment_shipment_layer` 依 `order_item_id` 重用既有寄賣品項；`create_consignment_shipment` 亦重用來源 order/items（不再重建）。migration `20260804000001_consignment_draft_source_order.sql`：加 `order_item_id` 欄、改寫 layer/shipment、並對既有草稿做 backfill（補 pending 來源 order + waiting items + 回填）。前端 `useConsignment.ts` 的 create/add/remove/cancel 同步鏡像（cancel 僅在來源 order 仍 pending 時刪除）。

> **出貨回滾＋draft 品項編輯（v1.5）**：`reverse_consignment_shipment(p_consignment_order_id, p_created_by, p_note)`（migration `20260804000002`，RETURNS JSONB `{consignment_order_id, source_order_id, reversed_items, reversed_quantity}`）整單回滾 send_to_store 出貨。守門（RAISE EXCEPTION）：僅 `send_to_store`＋`active`＋`received_at IS NULL`＋無未 reversed 的 `consignment_sales`＋無 `pending` 的 `consignment_sales_reports`。回滾流程：每項「尚未回滾數量」＝view summary `shipped_quantity`（已含 reversal 扣減，天然支援回滾後再回滾）→ insert `consignment_shipment_reversal`（數量－）＋ `consignment_out_shipment` 反向 movement（own 倉，sign＋）→ 對應來源 `order_items` 回 `waiting`、`shipped_quantity=0` → 品項依 `source_order_id` 對應門市的 `shipping_pool` **覆寫**（非累加）→ 寄賣單回 `draft` → 來源訂單所有非取消品項皆回 waiting 時降 `processing`（否則維持 shipped/partial）。重出貨重用同一來源訂單與品項。**pool 不變式（v1.5.1 修補）**：維持「order_items 已出貨 ⇒ `shipping_pool` 無該品項」——`create_consignment_shipment`/`create_consignment_shipment_layer`/`direct_ship_order`（寄賣＋一般分支）出貨時逐項 `DELETE FROM shipping_pool`（migration `20260805000001`），否則回滾→重出貨後 pool 殘留可再被出貨池出貨造成重複出貨；回滾時 pool 回補用「覆寫」（`SET quantity = reversed`）避免與回滾後再「轉出貨池」的既有列疊加。migration `20260805000002`：`000005` 重寫時覆寫掉 `000004` 的 `::order_item_status` cast，依 `000004` 同款修法補回。已收貨者守門擋下，導向既有 `return_consignment_items`。draft 寄賣單品項編輯（前端 `EditItemsDialog`）：改數量/價格或新增/刪除，send_to_store 且 `order_item_id` 存在時同步覆寫 `order_items.quantity/unit_price`（draft 未出貨安全）、新增品項比照 v1.4 同步建來源 `order_items`、刪除同步刪來源 item。migration `20260804000003`：修正 view NULL 陷阱——FILTER 零列時 SUM() 回 NULL，`-SUM(ship) - SUM(reversal)` 整式被 COALESCE 誤算成 0；改各項先 `COALESCE(..., 0)` 再相減（shipped_quantity 與 send_to_store 的 remaining_quantity 皆適用）。migration `20260804000004`：修正既有 `create_consignment_shipment` 的 `ERROR: 42804` bug——`CASE WHEN ... THEN 'shipped' ELSE 'partial'` 回傳 text 無法隱式轉 `order_item_status` enum，加 `::order_item_status` cast。

### 6.4 訂單/品項狀態轉換規則
- order_item status：shipped_quantity=0 → `waiting`；0<shipped<quantity → `partial`；≥quantity → `shipped`
- order status：全部 items shipped/cancelled/discontinued → `shipped`；刪單後無任何已出貨 item → 回退 `processing`
- 出貨僅限 order.status ∈ {processing, pending}

## 7. 規格引擎 v6

- `specification_definitions`：定義規格（type + options + configuration），`quantity_source_id` 表示「數量規格」引用
- `entity_spec_values`：實際值以 JSONB 存於 value；`parent_id` + `instance_uuid` + `spec_id` 組成路徑 key（前端 `pathKey = ${parentId}:${spec_id}:${instance_uuid}`）
- `specification_triggers`：條件 DSL（`condition_dsl` JSONB），source 規格值觸發 target 規格顯示；`relation_type='quantity'` 表示數量複製（source 為數值型來源、target 為被複製下游，複製份數=source 值），`condition_dsl` 為 `{}`
  - `condition_dsl.on_value` 特殊值：`'*'`＝任何非空；`'input'`＝自訂輸入（值不在該規格 `options` 內，由前端 `specTree.checkSpecTriggerMatch` 帶入 `spec.options` 判定）
- RPC：
  - `sync_product_specs_v6(p_category_id, p_entity_id, p_entity_type, p_new_data)` → 同步規格值（含繼承/孤立處理）
  - `migrate_historical_specs_to_v6()` → 歷史資料遷移
  - 註：`get_visible_specs_v6` / `safe_eval_dsl` 兩支未使用的 RPC 已於 2026-08-25 移除；規格可見性/連動評估統一由前端 `src/utils/specTree.ts` 的 `getVisibleSpecsTree` 負責，後端不再實作評估邏輯
- 前端實作：`src/utils/SpecEngine.ts`、`specLogic.ts`、`specTree.ts`、`specSerializer.ts`、`specFormatter.ts`、`useSpecStore`

## 8. 其他商業邏輯

- **共享連結**：orders / sales_notes 有 `access_token`；`get_shared_order_details(p_identifier, p_token)` / `get_shared_sales_note_details(p_identifier, p_token)` 供未登入查詢
- **邀請流程**：`invitations`（token）+ `accept_invitation(p_invitation_id)` RPC + `cleanup_expired_invitations()` 定期清理
- **品牌定價**：`upsert_brand_product_prices(p_brand, p_products JSONB)`、`upsert_store_products_batch(p_items JSONB)` 批次寫入門市定價
- **實體綁定**：`entity_bindings`（主/附屬產品）、`get_bound_product_ids` / `get_bound_variant_ids`
- **型號解析**：`get_variant_effective_models(p_variant_id)` 回傳變體有效型號（含繼承 group）
- **訂單表格範本**：`table_templates` 儲存 col/row/tab 設定（JSONB），`table_template_variants` 綁定變體
- **市場**：`market_listings` + `expire_market_listings()` 過期任務
- **稽核**：`audit_logs` 記錄關鍵動作（含 old/new value JSONB）
- **跨 schema email 解析（2026-09-07，migration `20260907000005_repair_assignee_emails_rpc.sql`）**：⚠️ `auth.users` 在 auth schema，PostgREST 預設 `db-schemas` 不含 auth，**不能對其做 embed**（`repair_orders?select=assigned_tech:assigned_to(email)` 報 400 PGRST200，schema reload 無效）。改用 SECURITY DEFINER RPC `repair_assignee_emails()` 回傳 `{user_id, email, full_name}`（統整 `repair_orders.assigned_to/created_by` 與 `repair_order_status_history.changed_by` 的使用者），僅 grant execute to authenticated；前端 `useRepairOrders.useRepairAssigneeMap()` 產生 id→email map 供列表/詳情解析。任何新 embed 對 `auth.users` 一律不可用。

## �Τ@����]unified_pricing�^

- products.unified_pricing BOOLEAN�Bunified_wholesale_price NUMERIC�Bunified_retail_price NUMERIC�]migration 20260827000001_add_unified_pricing.sql�^
- 	rg_enforce_unified_variant_price�G���� INSERT/UPDATE �ɭY���ݲ��~ unified_pricing=true�A�j�� wholesale_price/retail_price = ���~�Τ@���]����~�|�ҵL�k���������}���^
- 	rg_sync_unified_price_to_variants�G���~����/�ק�Τ@���ɡAUPDATE �Ҧ� product_variants ���Τ@��
- �s��Ȥ����]store_products�^��Τ@���ӫ~�H���~�h�� (ariant_id = null) �x�s�A��Ҧ�����]�t���ӷs�W�^�Τ@�ͮġFuseStoreProductCache ��Τ@���ӫ~�����v���� store_products �C�A������~�h�ŦC

## 9. 服務型商品 + A+B 加購 + 運費月結（2026-09-06，migration 20260906000001~0003）

### 9.1 products / categories 前端顯示與商品類型
- `products.item_type` TEXT 預設 'product'：`product`（一般，進訂單目錄）／`shipping`（運費，不進目錄、**不扣庫存**、可月結）／`packaging`（包裝＝庫存商品＋可作為 A+B 加購品）／`repair_part`（維修零件）。**取代昔 `is_repair_part`**（migration 已將 `is_repair_part=true` 遷移為 `item_type='repair_part'` 並 DROP 該欄）。
- `products.is_hidden` BOOLEAN 預設 false：前端（門市目錄／大眾前台）顯示開關，後台仍可管理。`categories.is_hidden` 同義為分類層。
- `sync_storefront_items(p_product_id)` 已改：`is_hidden=true` 或 `item_type NOT IN ('product','packaging')` 的產品直接清除 `storefront_items`（不進大眾前台）。

### 9.2 庫存排除（shipping）
- `trgfn_skip_shipping_inventory()`：`inventory_movements` 的 **BEFORE INSERT** trigger（`trg_a_skip_shipping_inventory`）。因 BEFORE ROW trigger 依 name 字母序觸發（`trg_a_` 先於 `trg_sync_inventory_on_movement`），對 shipping 型商品 `RETURN NULL` 使整列跳過（含 `product_inventory` 同步）。出貨 RPC 無需針對 shipping 特別分支。

### 9.3 A+B 加購綁定
- 表 `product_addon_bindings`：`parent_product_id`/`parent_variant_id`（可 NULL＝產品層級）、`addon_product_id`/`addon_variant_id`、`quantity`、`sort_order`、`trigger_condition JSONB`（預留）。UNIQUE(parent_product_id, parent_variant_id, addon_product_id, addon_variant_id)；RLS：authenticated 可讀、admin 管理；變動 trigger bump `products` 資料版本。
- 前端：`AddonBindingManager`（產品表單→「綁定」tab 下方，只有編輯模式；父產品層級綁定，選候選商品＋可選變體＋數量）。加入訂單時 `useOrderDraftStore` 的 `useStoreDraft().addItem` 包裝會先產生 `temp_key`（`T{timestamp36}{rand}`）寫入父行，再以 module-level 5 分鐘快取查綁定、自動帶出加購子行（`item_type='packaging'`，`customItemId='addon:{bindingId}'` 累加、`temp_key`/`parent_temp_key` 串接父行）。子行經 `create_order_with_sales_note` 的兩輪 temp_key/parent_temp_key 對應鏈結為父子行（見 9.5）。

### 9.4 order_items 新欄位
- `parent_order_item_id`（FK→order_items, ON DELETE CASCADE）：A+B 父子行實體鏈結（shipped 流程由 temp_key 對應後回填）。索引 `idx_order_items_parent_order_item(order_id, parent_order_item_id)`。
- `unit_cost` NUMERIC 預設 0：**成本快照**，佣金計算優先（其次 `rep_product_costs`，再其次產品層級，最後**進貨成本 `product_variants.wholesale_price`**，2026-09-07）。佣金 RPC 重算公式 = `COALESCE(NULLIF(oi.unit_cost, 0), rep_cost(變體), rep_cost(產品層級), pv.wholesale_price, 0)`。
- `shipping_payment` TEXT：`monthly`＝月結（可納入運費結帳），NULL/其他＝隨單收費。

### 9.5 出貨 RPC 父子行對應（create_order_with_sales_note / update_order_with_items）
- payload 新欄位 `temp_key`/`parent_temp_key`（前端 queue 產生，`T...` 格式），insert 時寫入 `order_items.temp_key/parent_temp_key`；之後第二輪 pass 依 `parent_temp_key` → `temp_key` 把父子行對應到 `parent_order_item_id`（UPDATE order_items SET parent_order_item_id）。
- `unit_cost`/`shipping_payment` 一併隨 RPC payload 寫入。

### 9.6 運費月結帳本 + 會計連動（2026-09-07 依物流公司＝採購商彙總）
- `products.supplier_id`（UUID NULL，FK→suppliers ON DELETE SET NULL，索引僅非空）：運費型商品的所屬物流公司（採購商）。商品表單於 `item_type='shipping'` 顯示必填下拉（採購商 active 清單）。
- 表 `shipping_settlement_periods`：`supplier_id`（→suppliers）、`period_start/period_end`（range CHECK）、`total_amount`、`is_settled`、`settled_at`、`entry_id`(→accounting_entries, ON DELETE SET NULL)、`note`、`created_by`。**唯一鍵＝`(supplier_id, period_start, period_end)`**（`WHERE supplier_id IS NOT NULL` 部分唯一）；`carrier_product_id` 保留為 nullable 相容欄位（新結算一律 NULL，改用 supplier_id）。RLS：authenticated 讀、admin 管理。
- RPC（SECURITY DEFINER）：
  - `register_shipping_settlement(p_supplier_id, p_order_item_ids UUID[], p_period_start DATE, p_period_end DATE, p_paid_date DATE, p_account_id UUID, p_category_id UUID, p_description TEXT, p_note TEXT, p_created_by UUID)`：取 `order_items.shipping_payment='monthly'` 且其所屬產品 `products.supplier_id=p_supplier_id` 的品項（join orders＋products 驗證每家、依訂單彙總 quantity×unit_price），**排除已被該物流公司任何 settled 期別結過帳的訂單**（`accounting_entry_references r JOIN shipping_settlement_periods sp ON sp.entry_id=r.entry_id AND r.reference_type='order' AND r.reference_id=item.order_id AND sp.supplier_id=p_supplier_id` EXISTS）；同訂單多品項彙總一筆 `accounting_entry_references`；寫一筆母支出分錄（type='expense'、amount=彙總、連同 references）＋ period 列（is_settled=true、settled_at、entry_id）；扣帳戶餘額。RETURNS `{period_id, entry_id, total_amount, order_count}`。重複：以 (supplier_id, period) 部分唯一避免同區間重複。
  - `revoke_shipping_settlement(p_period_id)`：刪除對應 `accounting_entries` 分錄（其 references 與 period 因 ON DELETE CASCADE / entry_id 鏈結一併清除），並依 entry 回衝帳戶餘額（expense 分錄 +amount）。僅 admin。
- 前端：`useShippingSettlement`（`ShippingSettlementSubmission={supplierId, orderItemIds, periodStart, periodEnd, paidDate, accountId, categoryId?, description?, note?}`，`settleMutation`/`revokeMutation`）；EntryForm「運費結帳」Tab＝物流公司（採購商）下拉（join 含運費型商品）＋期間起訖＋月結品項複選（附「運費品項」欄，金額系統計算），`onShippingSettleSubmit` 接線到 AccountingPage 與 `ShippingSettlementsPage`（`/admin/shipping-settlements`，結算紀錄表顯示物流公司名）。

### 9.7 佣金批次發放改走 EntryDialog + 成本快照顯示
- `register_batch_rep_commission_payout(p_rep_id, p_sales_note_ids UUID[], p_paid_date DATE, p_account_id UUID, p_category_id UUID, p_description TEXT, p_created_by UUID)`：以**關聯單據（母子單）**方式一次寫一筆母支出分錄（`accounting_entry_references` 逐筆 sales_note）＋多筆 `rep_commission_payouts`；金額一律後端重算（見 9.4），不可覆蓋。RETURNS `{entry_id, total_amount, count}`。
- 前端：`useCommissionPayout` 新增 `bulkRegisterPayout`（`BatchRegisterPayoutPayload = {repId, salesNoteIds[], paidDate, accountId, categoryId?, description?}`）。EntryForm「佣金發放」改**複選**（全選 / 已選 N 筆＋合計，單筆→`onPayoutSubmit`、多筆→`onBatchPayoutSubmit`）。`EntryDialog` proxy 新 props。`RepCommissionPage` 批次按鈕改開 EntryDialog（`prefill.payout = {repId, salesNoteIds}`）。佣金明細頁（RepCommissionPage / useRepCommission）成本顯示優先取 `order_items.unit_cost` 快照（>0 時），其次 rep_product_costs、再其次進貨成本。
- `entry_id` FK 關係：`rep_commission_payouts.entry_id` / `shipping_settlement_periods.entry_id`（後者 ON DELETE SET NULL）→ `accounting_entries`。