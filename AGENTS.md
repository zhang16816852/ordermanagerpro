# Order Manager Pro — 專案記憶

本檔案由 AI 自動載入並**持續維護**。開新對話前請先完整閱讀本檔；詳細內容再依需求 lazy-load 下方指定文件。

## 近期變更（撤銷誤標退貨 ＋ `update_order_with_items` 授權守門修復，2026-09-30）

- **背景**：`line_type` 退貨功能上線後，誤把一般銷售品項標成退貨的事件難以復原（原本只能「處理退貨」走退庫存/退款，會憑空產生負庫存與退款分錄）。本次新增**撤銷**路徑，讓誤標可安全還原為一般銷售；同時修掉一個**安全性回歸**。
- **新 RPC `revert_order_return_line(p_order_item_id UUID, p_created_by UUID DEFAULT NULL) RETURNS JSONB`**（migration `20260930000002`，已套用遠端；`SECURITY DEFINER SET search_path = public, extensions`、僅 `authenticated` 可執行、內部 `has_role(auth.uid(),'admin')` 把關）：單一交易內① 若該品項已出貨進銷貨單（負數列）→ 移除該列並以 `upsert_sales_note_deletion_movement` 回沖庫存＋刪除原 `customer_return` movement（複用 `correct_sales_note` Phase 1 語意）② 設回 `line_type='sale'`／`return_status=NULL`／`is_repair=false`／清退貨 `line_note` ③ 出貨池回補（剩餘量>0 才放回）④ 訂單狀態收斂（可降回 `processing`）。**守門**（逐張綁定銷貨單檢查，第一張不符即擋並帶單號）：已收貨／會計分錄（entry row＋`accounting_entry_references` 雙路徑）／業務佣金已發放／未逆轉寄賣確認銷售／`inventory_source_type !== 'self'`。⚠️ **僅還原誤標、不做退款**（退款仍用 `process_order_return_lines` 且僅限 pending）。
- **前端**：`src/components/order/OrderReturnRevertDialog.tsx`（新建，335 行）——`OrderListPage` 持有 state，經 `OrderDetailDialog` 新增 `onRevertReturnLines?` callback 開啟；**按鈕顯示於任一 `line_type='return'`（不限 `return_status`）**，因誤標常已是 `stock`。被擋列 `opacity-70`＋停用輸入＋`BLOCK_HINTS` 人工指引；`SalesNoteDetailDialog` 補退貨／換貨徽章。
- **退貨列防誤加（既有 bug）**：`useSalesNoteCorrectQueries` 的 `orderCandidates` filter 引用未選取的 `oi.line_type` → 退貨列從未被排除（select 已補 `line_type`）。`shipping_pool` 候選改在 `CorrectAddTable` UI 停用退貨列數量輸入，並在 `SalesNoteCorrectDialog` 組 `p_items_to_add` 時再過濾一次；`PoolItem.order_item` 補 `line_type?`。
- **`useOrderFormMutations` line-type payload 慣例**：以 `lineTypeFields()` **固定成組**送 `line_type`／`line_note`／`return_status`／`is_repair`（非退貨列固定 `null`／`false`）——後端以 `elem ? 'line_note' : oi.line_note` 判斷「是否為 null」，省略 key 會保留舊值並觸發 `23514`（CHECK：僅 return 列可帶 return_status/is_repair）。三處（createPending／updateOrder／directShip preSave）皆已套用。
- **⚠️ 安全性回歸修復（migration `20260930000003`，已套用遠端）**：`update_order_with_items` 為 `SECURITY DEFINER`，但 `20260916000004`／`20260924000005` 的重發沿用 `20260903000002` 的 body，**遺漏**了 `20260904000001` 原本的授權檢查；遠端實測 `has_function_privilege('anon', …, 'EXECUTE') = true` → **任何持 anon key 者可改寫任意訂單的備註與品項**。已補回 admin / 店成員 / `sales_rep_id=auth.uid()` 守門，並 `REVOKE … FROM public, anon` ＋ `GRANT … TO authenticated`。
  - **⚠️ 三值邏輯坑（必讀，日後重發務必注意）**：原寫法 `IF NOT (has_role(…) OR is_store_member(…) OR sales_rep_id = auth.uid())` 在 **`orders.sales_rep_id IS NULL`**（多數非業務訂單）時整條 OR 鏈為 `NULL`，而 `IF NOT NULL` 不成立 → 守門被**完全略過**（實測非管理員成功改寫任意訂單備註）。正確寫法須**同時**：`v_uid := auth.uid()` 且 `v_uid IS NULL` 直接拒絕，**且三個 disjunct 一律 `COALESCE(…, false)`** 讓 OR 鏈恆為 TRUE/FALSE——**只加 `v_uid IS NULL` 仍不足夠**（第一次修正就是這樣漏掉的，遠端 `prosrc` 現 md5 `42a999a0068cb706b7c455f8a4765048`）。
  - 同 migration 併入**已收款守門的 `line_type` 判定**：原守門只比 `quantity`／`unit_price`，已收款訂單仍可把一般品項改成退貨列（或反向）。現以 `COALESCE(NULLIF(el->>'line_type',''), oi.line_type) <> oi.line_type` 併入 `v_affecting_changes`，reason 文案加上「或打單性質」。
- **遠端實測（`BEGIN…ROLLBACK`，全數回滾無殘留）**：T1 管理員正常路徑 `{ok:true}` 備註更新 ✓／T2 已收款改 `line_type` → `{ok:false, reason 含 SL2609ULH0010001}` ✓／T3 未收款改 `line_type` → `{ok:true}` 且 `line_type='return'`/`return_status='pending'` 落地 ✓／T4 非管理員非店成員非業務 → `not authorized`（修正前為 **NOT BLOCKED**）✓／T5 無 JWT → `not authorized` ✓／T6 該單業務 → `{ok:true}` ✓／T7 訂單不存在 → `order not found` ✓／T8 備註未被 T4/T5 寫入 ✓。撤銷 RPC 測試（未收款完整撤銷、數量 2、守門四種）亦全數通過，撤銷後自有倉仍 `-53`、`shipping_pool=0`、退貨列仍 3 筆。grants 實測 `anon_exec=false`／`auth_exec=true`／`public_exec=false`。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（69 warnings 皆既有；本批 3 個 `prefer-const` 與 1 個 `useMemo` dep warning 已修）、`npm run build` 通過（1m4s，僅既有 chunk-size 警告）。
- **⚠️ 套用紀錄**：`20260930000003` 首版套用遠端後才在測試中發現 COALESCE 需求，遠端最終 body 由直接 `CREATE OR REPLACE` 覆寫為檔案內容；檔案為權威來源，新環境 `supabase db push` 一次到位。

## 近期變更（分享收據：品項備註補「換貨」＋物流配送資訊移至 QR 旁，2026-09-30）

- **品項備註（分享頁）**：`SharedOrder`／`SharedSales` 的 `toReceiptItems` 改為 `[LINE_TYPE_NOTE[line_type], line_note].filter(Boolean).join('・')`，`LINE_TYPE_NOTE = { return: '退貨', exchange: '換貨' }`——**實體 `line_note` 仍優先**（`return` 列有真實備註如「退貨出貨入庫」照顯示），但 `line_note` 為空時**不再留白**：`exchange` 顯示「換貨」、`return` 顯示「退貨」。根因：實查 `order_items` 4 筆 `line_type='exchange'`（OD26092900001×3、OD26092500003）`line_note` 全為 NULL（**訂單打單 UI 本來就沒有逐品項備註輸入框**，只有訂單層 `OrderInfoCard` 的備註），故換貨列在收據備註欄全空。`sale` 類型無 label、備註為空則維持空白。
- **分享收據表頭右欄（物流）**：`SharedReceiptExport` 的 `ReceiptPage` 新增 props `deliveryType`／`trackingNumbers`；`配送方式` 從左欄 `.doc-meta` **移至右欄** `.doc-side`（新增 CSS：`.doc-side` flex、`gap:10px`、`.doc-side-info` 右對齊 12px、`.doc-side-line` `max-width:46vw` + `overflow-wrap:anywhere`），**僅 `deliveryType === 'logistics'` 且有單號時**追加一行 `物流單號：A、B`（多包裹以「、」串接）。QR 恆置於該資訊區右側；無配送資訊且關閉 QR 時右欄不渲染（維持原外觀）。
- **後端**：`supabase/migrations/20260930000001_share_rpc_delivery_type.sql`（**已套用遠端**）＝ `CREATE OR REPLACE` 三支分享 RPC（`get_shared_order_details`／`get_shared_sales_note_details`／`get_shared_consignment_details`），**doc 物件（`order`／`sales_note`／`consignment`）補回傳 `delivery_type`**；簽名不變、其餘欄位與驗證沿用線上最新 body，`GRANT EXECUTE` 補回 `anon`＋`authenticated`。⚠️ 重發時 `p_token` 需 `::text` 明確轉型（`share_token_for_code` 回 UUID，直接呼叫會 42883 函式不存在）。遠端實測 `SL2609BN0010001` 等 6 張 logistics 單：RPC `delivery_type='logistics'` 且 `shipments` 正確回傳。
- **三個分享頁接線**：`SharedOrder`／`SharedSales`／`SharedConsignment` 的 data interface 加 `delivery_type?` 與 `shipments?: { tracking_number?: string|null }[]`；共用取號 helper 放**新檔 `src/pages/share/receiptTracking.ts`**（`receiptTrackingNumbers` 去重去空）——**刻意不放 `SharedReceiptExport.tsx`**，避免多一條 `react-refresh/only-export-components` 警告。列印模式與一般模式**兩處**呼叫皆傳 `deliveryType`／`trackingNumbers`。
- **Excel 匯出一致化**：`exportExcel.ts` 的 `ExportDocExcelOptions` 加 `trackingNumbers?`，統計區在「配送方式」後補「物流單號」列（`SharedReceiptExport.handleExport` 傳入）。
- **驗證**：`npm run typecheck` 0 errors、`npx eslint src/pages/share/` 0 errors（3 warnings 皆既有）、`npm run build` 通過（1m22s，僅既有 chunk-size 警告）。

## 近期變更（批次建立變體 42883 修復＋表單內按鈕誤提交修復，2026-09-29）

- **問題 1｜`batch_upsert_product_options` 拋 42883「operator does not exist: jsonb ->> jsonb」**（用 `VariantBatchCreator` 批次建立變體時）：第 4/5 段的 key 查詢寫成 `(v_sku_to_id->>v_opt_row.value->>'sku')`，`->>` 為**左結合**，Postgres 實際解析為 `((v_sku_to_id ->> v_opt_row.value) ->> 'sku')` → 42883，整筆 transaction ROLLBACK。`20260910000003` 早已修過，但 **① 該 migration 從未套用遠端**（`supabase_migrations.schema_migrations` 查無紀錄）② 後來 `20260928000001`（tracking）**以舊 body 重發又把括號弄掉**，等於把線上改回壞版。
  - **修法**：新增 `supabase/migrations/20260929000001_fix_batch_upsert_product_options_operator.sql`（已套用遠端）＝ tracking_mode 支援 ＋ **正確括號** `(v_sku_to_id ->> (v_opt_row.value->>'sku'))` ＋ `20260910000002` 的 `jsonb_typeof` 防呆。`CREATE OR REPLACE`、**簽名不變**、前端零改動、types.ts 無需重產。⚠️ **教訓：重發（`CREATE OR REPLACE`）同一支 RPC 務必以「最新 body」為基底，不可從舊 migration 複製**，否則會把已修的 bug 還原回去；套用前務必比對線上 `prosrc`。
  - **驗證（遠端 `BEGIN…ROLLBACK`）**：以 admin claims 帶真實 payload（2 群組／4 值／2 變體／4 條 variant-option／1 條 model relation／tracking serial+batch）呼叫 → 全數正確落地、回滾後 0 殘留；線上 `prosrc` 已含括號＋harden＋tracking。
- **問題 2｜`VariantEditDialog` 內按 `VariantOptionsEditor` 的任何按鈕都會直接送出表單、關閉對話框並跳「變體已更新」**：shadcn `Button` **未預設 `type`**，HTML 預設為 `submit`；`VariantEditDialog` 的 `VariantOptionsEditor`/`ColorSelectField` 都在 `<form onSubmit={form.handleSubmit(onSubmit)}>` 內（`VariantBatchCreator` 不在 form 內故無此症），故「新增群組／新增項目／移除 X／批量貼上／全部套用／選擇顏色…」一按即 `updateMutation` → `toast.success('變體已更新')` + `onOpenChange(false)`，**使用者新增的群組根本沒存**。
  - **修法（雙層）**：① **`src/components/ui/button.tsx` 全域預設 `type="button"`**（`asChild` 時不套用，避免把無效的 type 塞給 `<a>`/`<Link>`）——已確認全站 7 個 `<form>`（`VariantEditDialog`／`BasicInfoForm`／`Auth`×2／`AcceptInvite`／`StoresTab`／`MappingConfigForm`）**皆有顯式 `type="submit"`**，故無破壞；② `VariantOptionsEditor.tsx` 與 `ColorSelectField.tsx` 內按鈕逐一補上顯式 `type="button"`（該元件會被嵌入表單，寫明確較保險）。
  - **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（69 warnings 皆既有）、`npm run build` 通過（僅既有 chunk-size 警告）。

## 近期變更（後台訂單表單：寄賣出貨供應商衝突修復＋pending 可直接出貨＋編輯頁寄賣開關＋草稿分桶與表頭持久化，2026-09-29）

- **分頁保留（使用者拍板）**：原曾評估移除「寄賣收貨／寄賣出貨」兩個分頁（與訂單列表「轉寄賣（草稿）」功能重疊），**使用者明確否決**——採「**分頁保留，但草稿獨立**＋修掉供應商/CHECK 衝突」最小修復路線。`OrderTypeValue` 維持四種不變。
- **變更 1｜寄賣出貨供應商/CHECK 衝突（根因）**：`send_to_store` 的 DB 約束 `chk_consignment_direction_partner` 要求 **`store_id NOT NULL` 且 `supplier_id IS NULL`**（`receive_from_supplier` 反之），但 `OrderInfoCard` 的 `consignment_send` 區塊**同時**要求並寫入供應商 → 一律 23514、此分頁**完全不可用**。修正：① `OrderInfoCard` 刪掉該區塊的供應商 Select，只留「目標門市」＋一行說明文字（結算對象為店家）；② `useOrderFormMutations.createConsignmentSendMutation` 移除 `if (!supplierId) throw` 與 insert 的 `supplier_id`（不帶→NULL）；③ `AdminOrderForm` 按鈕 `disabled` 移除 `!c.supplierId`；④ `useOrderFormQueries` 的 `suppliersList.enabled` 由 `orderType !== 'sales'` 收斂為 `orderType === 'purchase' \|\| 'consignment_receive'`（`storesList` 與 `supplierMappings` 的 enabled **不動**，寄賣出貨仍需門市清單與供應商成本自動帶價）；⑤ `OrderInfoCard.summaryLabel` 於 `consignment_send` 改顯示目標門市名（原顯示「未選供應商」）。`consignment_receive` 邏輯**完全正確、不動**。
- **變更 2a｜pending 也能直接出貨**：`direct_ship_order` 後端守門一直是 `status IN ('pending','processing')`，限制只在 UI（`AdminOrderForm` 僅 `status === 'processing'` 顯示按鈕）→ 改為 `['pending','processing'].includes(...)`。`directShipMutation` 內部已先跑 `update_order_with_items` 持久化拆分/編輯結果再出貨，**後端零改動**。`DirectShipDialog`（`src/components/orders/DirectShipDialog.tsx`）文案只依 `allConsignment` 決定「寄賣出貨/直接轉銷貨單」，無 processing 假設，**未改動**。業務（rep）仍不出貨。
- **變更 2b｜編輯頁加回寄賣模式開關（設計為「點擊即執行的動作」，非可儲存欄位）**：`update_order_with_items` 簽名**不含** `consignment_mode`，且 pending 單只翻 flag 沒草稿沒意義，故新增 `useOrderFormMutations.toggleConsignmentModeMutation`（吃 `next: boolean`）——**開啟**：`pending` → 呼叫既有 RPC `convert_order_to_consignment_draft(p_order_id, p_created_by)`（冪等、已有草稿回 `reused`；會鏡像品項並回填 `source_order_id`、把 `order_items.status` 轉 `waiting`）；`processing` → 僅 `orders.update({consignment_mode:true})`，實際寄賣單由出貨時 `direct_ship_order` 的寄賣分支經 `create_consignment_shipment_layer` 建立。**關閉**：先查 `consignment_orders` where `source_order_id=orderId ∧ direction='send_to_store' ∧ status IN ('draft','active','settled')`，**有任一筆就 throw**（toast 列出寄賣單號，提示先於寄賣管理頁取消）；查無或僅 `cancelled` 才 `orders.update({consignment_mode:false})`。⚠️ **絕不可用 `delete_consignment_draft_if_clean` 實作關閉**——其 pending 來源單分支會呼叫 `delete_order_if_unadopted` 刪掉真實訂單。`shipped`／`cancelled` 停用開關（前端 disabled ＋ mutation 雙重守門）、rep 前端 disabled ＋ mutation `throw`。`OrderInfoCard` 的「出貨時間＋寄賣模式開關」區塊條件由 `!isEditMode && orderType === 'sales'` 改為 **`(isEditMode || orderType === 'sales')`**（編輯模式以 `order?.consignment_mode` 為 checked 來源、描述文案改為編輯語境；出貨時間在編輯模式也顯示，因 `directShipMutation` 會用到 `shippedAt`）；controller 新增 `handleConsignmentModeChange`（建立模式→`setConsignmentMode`；編輯模式→`mutate`）。
- **變更 3a｜草稿分桶**（修分頁間草稿互串＋編輯污染建立中草稿）：`useAdminOrderFormController.draftKey` 由 `storeId || '_admin_new_order'` 改為 **建立：`storeId || \`_admin_new_${orderType}\``**（`_admin_new_sales` / `_purchase` / `_consignment_receive` / `_consignment_send`）／**編輯：`_edit_${orderId}`**。已選門市的銷售單維持用 `storeId`（保留與門市 `CartPanel` 購物車共用語意）。副作用修正：`useOrderFormStateSync:59` 編輯模式載入訂單時的 `clearDraft()` 現只清 `_edit_*` 桶，**不再誤清建立中草稿**。舊 `_admin_new_order` 桶一次性失效（可接受）。分頁切換另新增 `handleOrderTypeChange` 同步 `setSearchParams({type})`（`replace:true`），重新整理後分頁保留、URL 可分享。
- **變更 3b｜表頭欄位持久化**：`useOrderDraftStore` 新增 `OrderFormMeta` 型別與 `updateMeta(storeId, patch)` action（沿用既有 `partialize` 與 localStorage key **`order-drafts-storage`**，**不新增 key**；`OrderDraft.meta` 為 optional）。`notes` 沿用既有頂層欄位 ＋ `updateNotes`（原本 `AdminOrderForm` 從未呼叫，故備註完全不會保存）。`OrderFormMeta` 欄位：`supplierId/targetStoreId/expectedDate/supplierOrderNumber/shippedAt/warehouseId/consignmentMode/deliveryType/itemWarehouses/itemSources`。`updateMeta` 內「全欄為空值時 `meta=undefined`」避免殘留垃圾資料。controller 端 **hydrate 刻意寫在 render 階段**（`metaHydratedKey !== draftKey` 判斷，非 useEffect）——**必須早於 persist effect**，否則 persist effect 會以初值空字串覆寫既有草稿的 meta；persist effect 以 `isEditMode || metaHydratedKey !== draftKey` 雙重守門（編輯模式以伺服器為準、不 hydrate 不 persist）。5 條建立路徑 `onSuccess` 皆已呼叫 `draft.clearDraft()`，無殘留。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（69 warnings 皆既有）、`npm run build` 通過（28.26s，僅既有 chunk-size 警告）。**無 migration、無 RPC 變更、無 types.ts 重產**。遠端 `BEGIN…ROLLBACK` 實測四項：① `send_to_store`+`store_id`+`supplier_id NULL` insert **PASSED**（修正後路徑）② `send_to_store`+`supplier_id` **被 CHECK 擋下**（證實舊路徑為何壞）③ `receive_from_supplier`+`supplier_id` PASSED（現行路徑未動）④ `send_to_store` 無 `store_id` 被 CHECK 擋下。另實測 `convert_order_to_consignment_draft` 對 pending 單：回 `consignment_mode=true`、草稿 1 筆（`supplier_id NULL`/`source_order_id` 已回填/`store_id` 已填）、`consignment_order_items` 鏡像 1 筆、`order_items.status='waiting'`、**關閉守門查詢命中 1 筆**（故前端會正確 throw）。

## 近期變更（店鋪配送地址：收件人/電話恆可填 ＋「同營業地址」勾勾持久化，2026-09-29）

- **兩個使用者回報 bug**（皆在 `/admin/stores` 店鋪編輯對話框）：① 勾選「收件地址同營業地址」後**收件人／電話欄位整個消失**——原碼 `!sameAsBusiness && (<ShippingAddressFields/>)` 把整個配送欄位組（含收件人/電話輸入框）unmount，只剩 hidden input 送 `address.recipient/phone`，**無任何 UI 可輸入**（實查勾過勾的 BN001/YT001/EVANFIX001/33M001 四家 `recipient`/`phone` 全為 NULL）；② 勾勾狀態**完全沒保存**（`useState(false)` + 同步 effect 又 `setSameAsBusiness(false)`，`stores` 表也無對應欄位）→ 重新編輯必為未勾。
- **⚠️ 不可用「地址相同就推導勾選」代替**：migration `20260921000009` 已把多數既有店的 `business_*` 回填成＝配送地址，實測 39 家中 38 家四欄全等（多數是空值），推導會讓幾乎每家都顯示勾選 → 必須新增持久欄位。
- **後端（migration `20260928000002_stores_delivery_address_matches_business.sql` 已套用遠端）**：`stores` 新增 **`delivery_address_matches_business boolean NOT NULL DEFAULT false`**；回填＝「配送地址四欄與營業地址四欄全等**且 address 非空**」→ true，實查命中 **4/39**（大里店-山山通訊、美村店-艾凡修、宜蘭店-雅植通訊、長安店-寶諾通訊；GCPA001 地址不同維持 false、空地址店維持 false）。`stores` 無 data_version trigger（僅 `update_stores_updated_at`）→ **不需 bump**；`stores` 僅 `useStoresMutations.ts` 單一 insert/update 路徑，`NOT NULL DEFAULT false` 對舊 payload 向後相容。types.ts 已重產（純新增 324 行，順帶補齊先前未重產的 repair_parts/product_batches 等；UTF-8 no BOM）。
- **前端**：`ShippingAddressFields` 新增 **`hideAddress?: boolean`**（`hideContact` 的反向，隱藏完整地址/郵區+縣市/鄉鎮/詳細地址、保留收件人/電話）——既有 6 處呼叫端不傳 → 行為零變動。`StoresTab` 配送欄位組改為**無條件渲染**並傳 `hideAddress={sameAsBusiness}`，Label 依狀態切換（「配送地址（收件人/電話/郵區，供配送方式預填）」↔「配送收件人／聯絡電話（地址同營業地址）」）；`sameAsBusiness` 改由 `editingStore.delivery_address_matches_business` 初始化並於切換編輯對象的 effect 還原（取代原本的 `setSameAsBusiness(false)`）；新增 hidden input `delivery_address_matches_business`（`'true'/'false'`），`useStoresController.handleStoreSubmit` 轉 boolean。**維持「勾勾後改營業地址自動同步配送地址」**（複製 effect 保留，載入時重複複製同值冪等無害）。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（69 warnings 皆既有）、`npm run build` 通過（50.24s，僅既有 chunk-size 警告）；遠端 `BEGIN…ROLLBACK` 實測：以 admin claims 走前端同型 UPDATE（勾勾=true ＋ 只改收件人/電話 ＋ 地址帶營業值）回讀 `recipient=雅植通訊-王先生 / phone=0391234567 / flagged=true / addr_equal=true`；INSERT 帶新欄位與不帶新欄位（DEFAULT false）皆成功；回滾後 4 家旗標與 NULL 收件人原狀不變、測試列 0 殘留。

## 近期變更（維修零件型錄＋維修單零件選擇器，2026-09-27）

- **目的**：原先維修零件只有「直接選商品（`RepairPartSelect`）」，名稱要手打、不知道自己對應哪個裝置型號。本次新增**獨立零件型錄**（適用型號 × 零件名稱），並讓後台／門市維修單改用型錄選擇器。
- **三層設計（關鍵）**：上層 `repair_parts`＝型錄主檔（`device_model_id` NULL ＝ **通用零件**）；下層 `products(item_type='repair_part')`＝真正庫存實體（既有進貨/叫料/FIFO 扣料路徑**零改動**）；橋接 `repair_part_variants`＝零件↔實際實體多對多（多變體商品如 IP12 背蓋 6 色以 `spec_label` 記顏色，顏色**不**放 tags）。`repair_order_items` 為 **additive**：既有 `product_id`/`variant_id`/`part_name`/`unit_cost` 快照全數保留，另加 `repair_part_id`；`repair_part_id IS NULL` = 自訂材料（不可扣料/叫料）。
- **後端（migrations `20260927000002_repair_parts_catalog.sql`＋`20260927000003_backfill_repair_parts.sql` 已套用遠端）**：三表 + `repair_order_items.repair_part_id`；UNIQUE `COALESCE(device_model_id, zero-UUID), name`（NULL 不互斥的坑）、GIN(tags)、partial index(device_model_id, sort_order) WHERE is_active、partial UNIQUE(repair_part_id,product_id) WHERE variant_id IS NULL。RLS 完全比照 `repair_checklist_library`（admin FOR ALL ＋ authenticated SELECT，門市需讀型錄）。回填驗證：14 商品/44 變體 → **37 repair_parts、45 links、5 字典標籤、19 筆既有品項、2 個多變體組、2 個通用零件，orphan/nolink = 0**。⚠️ **`is_default` 無 DB 約束，恰有一筆預設連結由應用層維護**：`saveLinks` 以 `findIndex(is_default)` 正規化（**多筆預設時以第一筆為準、其餘取消**；無預設補第一筆），且刪除舊 links **必須在 `links.length===0` 早退之前**（否則無法清空連結）。types.ts 已重產。
- **前端共用層**：新 `src/hooks/useRepairParts.ts`（零件/links/庫存/標籤 CRUD ＋ `partLabelOf`／`resolveLinkOf` ＋ `useRepairPartProductOptions()` 供 links 編輯器與批次建立共用查詢）；新元件 `RepairPartPickerDialog.tsx`（搜尋/型號 scope/標籤過濾/多變體展開選擇）、`RepairPartPicker.tsx`（picker shell ＋ **catalog／manual 雙模式**，手動改名即清 `repair_part_id`+`product_id`+`variant_id` 轉自訂材料）、`RepairPartLinksEditor.tsx`（連線編輯，`setDefault` 互斥、移除預設自動補第一階）、`RepairPartFormDialog.tsx`（型錄 CRUD ＋ `onCreateProduct` 開 `ProductFormDialog` 作次要入口）、`RepairPartTags.tsx`（tag chips）。`RepairPartSelect.tsx`／`RepairPartSelectDialog.tsx` 保留未刪。
- **維修單接線**：`ItemsFieldsSection.tsx` 改用 `RepairPartPicker`（移除舊 `RepairPartSelect` 與其「建立零件」舊語意）＋ `onEditPart`；`DeviceBlockSection.tsx` 透傳 `onEditPart`/`onCreatePart`。Admin `repair-orders/new.tsx` 存/載 `repair_part_id` ＋ 開型錄表單（桌面/行動皆接）；**admin 保留扣料、採購項目與 `purchase_order_item_id` 行為**。Store `repair-orders/new.tsx` 亦存 `repair_part_id` 並以 `saveItems()` 同步新增/更新/刪除，**門市不觸發庫存扣減**。明細顯示：admin `RepairItemsSection` ＋ store `detail.tsx` 皆顯示 catalog tags；會計 `accounting/components/ReferenceViewer.tsx` 加 `repair_part:repair_part_id(id,name)` 顯示「型錄零件：…」；**`RepairReceipt.tsx` 刻意不顯示**（客戶收據用快照 `part_name`）。
- **維修零件管理頁（新）**：`/admin/repair-parts`（`src/pages/admin/repair-parts/RepairPartsPage.tsx` ＋ 側欄「維修零件」）——搜尋（名稱/型號/商品/SKU）、型號 scope（全部/僅本機型/通用）＋ 單一型號下拉、標籤多選過濾、顯示停用、桌機表格/行動卡片、庫存與成本/售價摘要、編輯/刪除（**有 links 時前端擋下**，避免誤刪影響型錄）、`RepairPartTagsManager.tsx`（標籤字典 CRUD）、`RepairPartBatchCreateDialog.tsx`（**批次建立**：列出尚未被型錄綁定的維修零件商品，勾選＋命名＋選型號（留空＝通用），多變體自動展開為 `spec_label` links，第一筆為預設）。`supplier_id` 暫存中繼資料，未接採購表單預帶。
- ⚠️ **編碼教訓**：不可用 PowerShell `Get-Content`/`Set-Content` 改寫 UTF-8 原始碼（曾把 `admin/repair-orders/new.tsx` 變成 BOM+亂碼，只能 `git checkout` 還原後重做）。改檔一律用 edit/write 工具。
- **既有 stale LSP（非本次）**：`admin/consignment/components/StoreViewTab.tsx` 報 `Cannot find module '@/components/ui/badge'/'button'/'@/lib/formatters'` 與 line 283 implicit any。
- **驗證**：`npm run typecheck` 0 errors；本批檔案 `eslint` 0 errors；`npm run build` 通過（僅既有 chunk-size 警告）。所有新檔/改檔經位元組檢查為 **UTF-8 no BOM、無 U+FFFD**。

## 近期變更（序號／批號追蹤完成，2026-09-27）

- **目的**：特定變體（如主機板序號、電池批號）進貨時需逐台/逐批記錄追蹤資料。變體可設 `product_variants.tracking_mode`（`none`/`serial`/`batch`），收貨時依模式輸入序號或批號並寫入 `product_batches`；庫存頁新增「批次/序號」tab 檢視。
- **後端（全部已套用遠端）**：`20260924000002_product_serial_tracking_schema.sql`（product_batches 表＋variants.tracking_mode）已於「訂單層退貨/換貨/送修（2026-09-24）」批次套用；本次 `20260927000001_serial_ship_surgical.sql` **surgical** 只改 **`receive_purchase_items`** 為 **3 參數單一簽名** `(p_items jsonb, p_warehouse_id jsonb DEFAULT NULL, p_lots jsonb DEFAULT NULL)`（先 DROP 舊 2 參數避免 PostgREST overload）。`p_lots[]`＝`{purchase_order_item_id, mode:'serial'|'batch', serials[]?|batch_number, unit_cost?}`，`purchase_order_item_id`＝p_items 的 `id`：`serial`＝每支序號一列 product_batches（quantity=1）＋逐台 movement；`batch`＝單列（quantity=GREATEST(qty,1)）＋單筆 movement；tracking 模式/數量不符 RAISE 整批回滾（回 `{ok:false, reason}` 的 EXCEPTION 沿用 delete/取消守門慣例）。其他 RPC（12 支出貨、vendor 分支、寄賣）**零改動**（md5 驗證過）；`create_consignment_shipment` 12 參數、`delete_sales_note`、`correct_sales_note` 皆不動。helpers md5 不變。⚠️ 變體選用 serial/batch 後舊單筆收貨路徑會擋下；`p_lots` 元素缺 `purchase_order_item_id` 時 postgres→JS `{}`（遺失複製），故空洞 data 轉成未收貨。追加 `20260928000001_batch_upsert_product_options_tracking.sql`（已套用遠端）：`batch_upsert_product_options` 的 `p_variants` 元素可帶 `tracking_mode`（INSERT 缺省＝'none'、ON CONFLICT 缺省保留原值），簽名不變、types.ts 無需重產。
- **types.ts 已重產**（`product_batches`、`product_variants.tracking_mode`、`receive_purchase_items` 3 參數 Args）。
- **前端**：
  - `VariantEditDialog` 新增「追蹤模式」Select（none/serial/batch，寫 `variants.tracking_mode`）。
  - **批次管理兩入口同批加入**：`VariantBatchCreator`（`useVariantBatchCreator` 新增 `trackingMode` state＋「預設追蹤模式」Select 控件，生成時寫入 `SharedVariant.tracking_mode`，經 `buildDedupedVariantsPayload`／RPC 落庫；`mergeWithExisting` 的 dbMatch 分支**保留既有變體原 tracking_mode** 不覆寫）；`BatchEditDialog`（`variantManagerTypes.ts` `FieldOptionType` 加 `'tracking'`＋FIELD_OPTIONS 加 `tracking_mode` 項，對話框渲染 dedicated Select 走 `handleBatchEdit` 泛型字串路徑）。`SharedVariant.tracking_mode` 為選填，`CopyProductDialog` 不受影響。
  - 共用層：`src/utils/lotTracking.ts`（`TrackingMode`/`LotInput`/`TRACKING_MODE_LABELS`/`trackingModeOf`/`parseSerials`/`isLotValid`）＋ `src/components/purchase/LotInputFields.tsx`（serial＝textarea 每行一支＋`已輸入 N/需 M` 檢核；batch＝批號＋批次成本；none 不渲染）。
  - 三收貨路徑全接線並校驗：`ReceivingTab`（查詢補 `variant:product_variants(name, sku, tracking_mode)`、lots state、追蹤品項下方列呈現、handleReceive 驗證）；`ReceiveForm`（採購明細收貨，同上）；`RepairPurchaseDialog`（零件變體另查 tracking_mode、直接收貨時 lots 齊全才送 `receive_purchase_items` 並組 p_lots）。`receiveItemsMutation`（usePurchaseOrders）由 items 帶 `lots?` 組 p_lots。`PurchaseOrdersPage`/`PurchaseOrderDetailDialog` 接線零改動（data 直接穿透）。
  - 庫存頁 `InventoryPage` 新增第四 tab「批次/序號」（`BatchesTab`，`product_batches` ╳ variants╱products╱purchase_orders embed＋搜尋序號/批號/商品/SKU）。
- **驗證**：typecheck 0 errors、lint 8 檔 0 problems、build 通過（僅既有 chunk-size 警告）；後端演練＋pg_proc 複查通過。

## 近期變更（寄賣共用視角桌機／手機雙排版，2026-09-26）

- **目的**：共用寄賣視角原本只有桌機表格（`ConsignmentPage` 店家視角與門市寄賣 Tab 在窄螢幕難以閱讀）。本次為**兩種視角各做桌機表格＋手機卡片**雙排版，並把切換標籤由「訂單／品項」改為「**全部訂單／商品**」。
- **檔案拆分（`src/components/consignment/`，薄殼門檻 <400）**：
  - `consignmentViewData.ts`（**新**）：衍生邏輯與型別——`buildPartnerGroups`／`buildPivotGroups`／`orderTotals`／`deliveredOf`／`directionLabel` ＋ `ViewMode`／`ColumnMode`／`PartnerGroup`／`PivotProduct`／`PivotGroup`／`OrderTotals`／`CollapseApi`。
  - `consignmentViewParts.tsx`（**新**）：`StatusBadge`／`ReceivedBadge`／`PartnerHeader`／`GroupFooter`／`ViewToolbar`。
  - `ConsignmentOrdersView.tsx`（**新**）：桌機表格逐欄原樣保留；手機＝每單一張卡，**品項預設收合**、收合時卡片右側顯示總額、展開用 Radix `Collapsible`＋`aria-label`（描述單號與收合狀態），**訂單展開 trigger 與查看／動作鈕維持 sibling**（延續上批對巢狀 button 的修正）。
  - `ConsignmentProductsView.tsx`（**新**）：桌機商品×日期矩陣逐欄原樣保留；手機＝每商品一張卡（商品名／給貨／剩餘／回報鈕）＋各日明細以 `Collapsible` 預設收合、**只列非零日期**；**另加產品名稱搜尋**（見下）。
  - `ConsignmentGroupedView.tsx`（**已由 544 行改為薄殼**）：維護 `viewMode`／`collapsedIds`／`columnMode` 三個 state，組出 `groups`／`pivotGroups` memo 後委派兩個 view ＋ `ViewToolbar`。**props 與三個 action slot 簽稱完全不變，門市／後台呼叫端零改動**。
- **兩項使用者決策**：
  - **手機商品視角不顯示「只看剩餘／全部欄位」按鈕**（`ViewToolbar` 的 `columnToggleOnMobile` 僅訂單視角為 `true`；商品視角恆 `all` 欄位，含手機各日明細已取代「只看剩餘」需求）。
  - **手機訂單卡品項預設收合**，桌機維持預設展開。
- **展開狀態解法（關鍵設計）**：單一 `collapsedIds: Record<string, boolean>` **override map** 同時服務兩種預設——`isCollapsed` 回傳 `!!collapsedIds[id]`（桌機未記錄＝展開）與 `collapsedIds[id] ?? true`（手機未記錄＝收合）兩個不同 `CollapseApi`；「全部展開／全部收合」寫入**所有**訂單的明確值，故切換任一視角／收合任一單皆跨視角一致。
- **商品視角搜尋（追加，2026-09-26）**：`ConsignmentProductsView` 頂部加產品名稱搜尋（`Input type="search"` ＋ `Search` 圖示前置、清除鈕 `X`，`aria-label` 皆有；`w-full sm:w-72`）。搜尋狀態為**該元件內部 `useState`**——薄殼以 `viewMode === 'orders' ? OrdersView : ProductsView` 二選一渲染，故切到訂單視角會 unmount、搜尋詞自動失效不殘留。`filteredGroups` 以 `useMemo([pivotGroups, keyword])` **同時過濾「無命中的整個群組」**（避免出現只有標頭的空卡）。無命中且 `keyword` 非空時顯示「查無符合『x』的產品」，有命中時顯示「共 N 項符合（全部 M 項）」。
  - ⚠️ **搜尋需比對兩個名稱**：顯示名 `name` 為**變體優先**（`variant?.name || product?.name`，全站慣例），故只比對 `name` 會讓「輸入產品名找不到變體列」。`ConsignmentProductRow` 新增可選 `productName?: string`（`buildPivotGroups` 以 `item.product?.name` 填入，**僅供搜尋比對、不用於顯示**），`hit()` 以 `name || productName` 任一命中為準。
  - 刻意**不做 debounce**：商品列數量小（單群組數十列），逐字過濾成本可忽略，實作更單純。
- **追加（2026-09-26）兩項手機排版修正**：
  - **頁面標題移交 sticky `MobileHeader`**：`PageHeaderConfig` 新增可選 **`mobileOnly?: boolean`**——`DesktopHeader` 據此略過 `title`／`actions`，`MobileHeader` 照常渲染。用途是「桌機頁面內自行渲染大型 h1」但手機想改用 sticky header 的頁面，避免兩個 Header 同時出現造成標題重複。`ConsignmentPage` 以 `useLayoutEffect(() => { setPageHeader({ title:'寄賣管理', mobileOnly:true }); return () => setPageHeader(null); }, [setPageHeader])` 掛上（**無 inline callback，deps 只留穩定的 `setPageHeader`，不重演「Maximum update depth」**），並把頁面內 h1＋說明改 `hidden md:block`、外層 `flex flex-wrap justify-end gap-2 md:justify-between`（手機只剩按鈕列、右對齊）。⚠️ 動作鈕**刻意不**搬進 header：`h-14` 內要同時塞標題＋「匯入／建立寄賣單」＋通知鈕會過於擁擠。
  - **手機商品卡「回報銷售」與「日期」同列**：`ConsignmentProductsView` 手機卡原本把 `renderProductActions`（門市＝回報銷售）與 `DateBreakdown`（N 個日期）疊成上下兩列，改為同一個 `flex items-center justify-end gap-2`（日期在左、動作鈕在右）。`hasProductActions` 為 false 時 `DateBreakdown` 維持原本獨立左對齊。
- **其他**：`ConsignmentProductRow` 新增可選 `dateCells?: ConsignmentProductDateCell[]`（`buildPivotGroups` 填入，供手機商品卡；**桌機仍由 `byDate` map 直接取格內值，不受影響**）與 `productName?: string`（供搜尋比對）；門市 `SalesNotes.tsx` 寄賣 Tab 訂單列「已出貨／已回報」計數由 `hidden sm:inline text-sm` 改為 `text-xs`（手機可見、不超寬）。
- **慣例**：斷點用 `md`（768px，與 `useIsMobile` 一致）＋純 CSS `hidden md:block`／`md:hidden`（兩分支同時掛載、未用 JS 判斷）；Tailwind `hidden` 於 display 群組排序在 `flex` 之後，故 `GroupFooter` 以 `hidden md:flex`／`flex md:hidden` 兩份渲染切換。
- ⚠️ **`OrderBlock` 泛型陷阱**：從泛型元件內部呼叫另一泛型子元件時，TS 推論會把 `T` 塌縮成其 constraint（`onView`／slot 報「`ConsignmentViewOrder` 不 assignable to `T`」）。解法是**顯式型別引數** `<OrderBlock<T> …>`。
- **本批修掉兩個潛在 bug（皆 typecheck 抓不到，靠逐欄數與跨時區實測發現）**：
  - `ConsignmentProductsView` 的 `pivotColSpan` 原為 `dates.length + 2`，但 `all` 欄位實際是 商品＋n 日期＋合計＋剩餘＝**n+3**（先前因有操作鈕而湊巧正確）。空品項列 `colSpan` 少一欄會撐破表格。`ConsignmentOrdersView` 的 `itemColSpan`（5/3＋操作）經逐欄核對**正確**，未動。
  - `buildPivotGroups` 的日期標籤原以 `new Date(dateKey)` 取月日；`dateKey` 是已正規化的 `YYYY-MM-DD`，`new Date()` 會視為 **UTC midnight**，在負時區（實測 `America/New_York` 顯示 9/25 而非 9/26）**整組退一天**。改為直接拆字串的 `labelOf()`。`dateKeyOf()` 仍以 local getter 正規化來源時戳（與訂單卡 `toLocaleDateString('zh-TW')` 一致），**勿**一併改成 UTC。
- **無 query／migration／RLS／後端改動**；`src/pages/admin/consignment/components/OrderListTab.tsx`（純訂單視角）不動。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（69 warnings 皆既有；較上批少 1 條＝舊 `ConsignmentGroupedView` 因同檔匯出 `getStatusBadge`/`directionLabel` 觸發的 `react-refresh` 警告已消失）、本批 7 檔單獨 eslint 0 problems、`npm run build` 通過（32.48s，僅既有 chunk-size 警告）。

## 近期變更（寄賣呈現元件共用化＋維修收款同步修復，2026-09-25）

- **目的（兩件事）**：① 門市 `/sales-notes?tab=consignment` 與後台寄賣頁**重用同一套呈現元件**，兩者都提供「訂單／全部訂單品項」視角切換；② 修正關聯維修單收款後的付款狀態同步、cache 失效與既有資料回填。
- **共用元件（新建 `src/components/consignment/`）**：
  - `consignmentViewTypes.ts`：`ConsignmentViewOrder`／`ConsignmentViewItem`／`ConsignmentViewItemSummary`／`ConsignmentProductRow` 等**與具體單據解耦**的 view 型別。
  - `ConsignmentGroupedView.tsx`：**泛型元件** `<T extends ConsignmentViewOrder>`——後台傳入原始 `ConsignmentOrder`（`onView` 收到完整單據）、門市傳入 view shape；props 含 `orders`／`summaries`／`isLoading`／`onView?` ＋ **action slots** `renderOrderActions(order)`、`renderItemActions(order,item,summary)`、`renderProductActions(productRow)`、`emptyState?`。
  - 內建：訂單／品項視角切換、只看剩餘↔全部欄位、全部展開／收合、依店家或供應商分組、狀態／收貨徽章、訂單與群組小計 footer。**訂單展開鈕與查看／動作鈕為 sibling**（修正原 `StoreViewTab` 的巢狀 button 問題）。
  - **品項視角矩陣**＝商品列 × 日期欄（`shipped_at || received_at || created_at`），格內為該日給貨數；商品以 **`product_id:variant_id`** 為 key（不用名稱，避免同名商品誤合併）。
  - **品項回報目標自動挑最舊可回報**（`PivotProduct.defaultReportTarget`）：`eligible = received_at 有值 && remaining_quantity > 0 && status !== 'cancelled'`，依日期升冪、日期相同再依單號排序取第一筆——使用者點「回報銷售」直接開啟該筆，**不再要求選擇**。
- **後台接線**：`src/pages/admin/consignment/ConsignmentPage.tsx` import 改指共用元件，`<StoreViewTab>` 改為 `<ConsignmentGroupedView>`（props 相同）；舊 `src/pages/admin/consignment/components/StoreViewTab.tsx` **已刪除**（功能完整搬移進共用元件）。
- **門市接線**：`src/pages/store/SalesNotes.tsx` 寄賣 Tab 移除原本 inline 的一堆 `Card`＋table（連帶移除只用於該區的 `Card*`／`Badge`／`formatCurrency` import），改渲染共用元件：
  - query select 補 `created_at`、`shipped_at`，nested 補 `products(id,…)`／`product_variants(id,…)`（`ConsignmentItem`／`ConsignmentOrderRow` 介面同步補欄位）。
  - 新增 `consignmentViewOrders` memo 映射成 `ConsignmentViewOrder[]`（`direction` 固定 `send_to_store`、`store` 取 `storeId`＋`storeRoles[0]`；`orderList` 亦包 `useMemo` 避免 `[]` 每次 render 新建造成 deps 抖動）。
  - 三個 slot：訂單列＝已出貨／已回報件數＋「確認收貨」（沿用既有 `confirmReceiptMutation`）；品項列＝「回報銷售」（沿用既有 `openReport(orderId, itemId)`，其內已驗證收貨／剩餘並預設數量為全部剩餘）；商品列＝自動帶入最舊可回報單筆的「回報銷售」。
  - **無 migration／RLS／後端改動**。
- **維修收款同步修復（migration `20260925000002_backfill_repair_payment_status.sql` 已套用遠端並驗證）**：根因＝`SalesNoteDetailDialog.receivePaymentMutation` **只**對 sales_note ids 呼叫 `sync_sales_note_payment_status`，完全漏掉同一筆分錄綁定的維修單（跨單結帳把維修單加進單據清單時，`repair_orders.payment_status` 停在 `unpaid`）。
  - `SalesNoteDetailDialog.receivePaymentMutation`：收集 entry row ＋ `references` 子表的 `reference_type='repair_order'` ids（Set 去重）逐一呼叫 `sync_repair_order_payment_status`，失敗 `throw`（與 sales_note 路徑一致）。
  - `useAccounting.createEntryMutation`：原本 `await rpc(...)` **忽略回傳 `error`** 且重複呼叫 → 改為 Set 去重 ＋ `if (e) throw e`（對齊 `updateEntryMutation`／`recordPaymentMutation` 既有寫法）。
  - 新增 `invalidateRepairQueries()` helper，以 `queryKey: ['repair_order']` **前綴**失效，同時涵蓋列表 `['repair_orders', storeId||'all']` 與詳情 `['repair_order', id]`（原只失效 `['repair_orders']`，詳情頁不刷新）；套用於 create／update／delete／recordPayment 四條 mutation。
  - 回填 migration 以與 `sync_repair_order_payment_status` **完全相同**的判定規則全表雙向重算（`type='income'` ＋ entry row／`accounting_entry_references` 子表兩路徑），`is distinct from` 保護故可重複執行。**遠端實測**：14 張維修單中 1 張 mismatch（`RO-20260924-00001`，entry `a3c3f1f2-…` amount/paid_amount 9770、payment_status=paid，但 repair 為 unpaid），回填後 **0 mismatch**；`BEGIN…ROLLBACK` 內連呼 RPC 兩次仍 `paid`（冪等）。
  - ⚠️ **語意不變**：仍為「任一關聯 `type='income'` 分錄即 `paid`」，未改為 partial 或帳戶餘額判定。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（70 warnings 皆既有，本批 5 檔單獨 eslint 0 problems）、`npm run build` 通過；回填 migration 於 `BEGIN…ROLLBACK` 先驗證僅影響 1 列再套用。

## 近期變更（六項使用者回報修復＋訂單層退貨沿線補齊，2026-09-25）

- **⑥ 退貨列漏網補齊三處**：
  - **出貨池判定**：`useOrderListDerived.ts` 的 `allPendingItems`（品項視圖）與 `orderPoolGroupedItems`（整單轉出貨池）補 **`!isReturnLine(item)`**（原僅 `aggregatedItems` 有濾，誤讓 `line_type='return'` 的 pending 列混入 ShipToPoolDialog 兩條路徑並寫入 `shipping_pool`）。此為 ShipToPoolDialog「沒有納入判定」的根因（其為純展示、判定在上游）。
  - **銷貨單品項備註 badge**：`SalesNoteDetailDialog` `SalesNoteItem` 加 `lineNote`；admin/store 兩端 `sales_note_items` 的 `order_items` embed 補 `line_note`、dialogData mapping 帶出 `lineNote`，桌機＋行動品項列渲染「備註：…」muted 小字。
  - **分享收據備註欄**（migration `20260925000001_share_rpc_line_note.sql` 已套用遠端並實單驗證）：`get_shared_order_details` 的 items 補 `line_note`，`get_shared_sales_note_details` 的 items 補 `line_type`＋`line_note`；`SharedReceiptExport` `ReceiptItem` 加 `note?` 並渲染進表格既有備註欄 cell（原本恆空）；`SharedOrder`/`SharedSales` 以共用 `toReceiptItems` 帶入每列 `line_note`（return 列沿用 `[退貨]` 前綴＋負數量，note 自動回退「退貨」）。
- 補充前次六項修復摘要見下方「近期變更（六項使用者回報修復＋delete_order_if_unadopted 修復，2026-09-25）」。

- **① 訂單詳情 return 數量轉負顯示**：`OrderDetailItemsTable`/`OrderDetailItemsCards` 的 quantity cell 依 `(item.line_type ?? 'sale') === 'return'` 顯示 `-item.quantity`（不加小計欄）。
- **②⑥ 銷貨單修正（correct_sales_note）回滾不完整**：migration `20260924000010_correct_sales_note_downgrade.sql`（已套用遠端並 harness 驗證）——Phase 1 移除列由 `shipped_quantity→0` 改**回退多出貨量**（`-p_items_to_remove 對應列之移除量`，允許「該列因其他銷貨單出貨而餘量」）；`status` 由 `waiting` 改**回退舊值**（`waiting`→`waiting`，`shipped`→`processing`）；`order_items` 總出貨量歸零時訂單收斂 `pending`。③ `p_new_items`（完全新品）建立訂單補 `line_type`（JOIN variant ids 解 line_type，解不到回退 'sale'）。④ `process_sales_note_return` 品牌供應商回退修正（未列入本次）。
- **③ 出貨池欄位錯位**：`OrderItemsDesktopTable.tsx` L177/L281 改 `showPriceSync &&` 恆渲染 checkbox 欄；非 sale 列灰顯 `—`，sale 列才顯示勾選框（off-canvas 酷似欄位移動的根因）。mobile 不需改。
- **④ 轉寄賣（草稿）按鈕位置**：`BatchActionBar.tsx` 於 **pending** tab（desktop L100＋mobile L333，`!isRep`）新增「轉寄賣（草稿）」，processing tab 的該按鈕已移除。
- **⑤ 寄賣草稿取消＝完整刪除（migration `20260924000011_delete_consignment_draft_if_clean.sql` 已套用遠端並 harness 驗證）**：新 RPC `delete_consignment_draft_if_clean(p_consignment_order_id UUID)`（SECURITY DEFINER、僅 admin）——守門 `status='draft'`＋無 `inventory_movements`/`consignment_sales_reports`/`consignment_sales`/`consignment_settlements`/`consignment_returns` 參照；DELETE consignment（items 靠 FK CASCADE）後，若 `source_order_id` 指向 pending 普通訂單再呼叫 `delete_order_if_unadopted` 一併刪除（先刪寄賣解除該 RPC 的 `consignment_orders.source_order_id` 阻塞；來源單刪除失敗 RAISE 整筆回滾）。`useConsignment.cancelOrderMutation` 對 draft 走此 RPC；`OrderDetailDialog` confirm 文案依 draft 條件化（草稿「完整刪除」/非草稿「取消」）。
- **`delete_order_if_unadopted` 既有 bug 修復**（migration `20260924000012_fix_delete_order_if_unadopted_po_code.sql` 已套用遠端）：採購單守門誤參照 **`po.code`**（`purchase_orders` 無此欄，自 `20260909000003` 起潛藏，凡訂單被採購單採用即 42703）改為 **`COALESCE(po.supplier_order_number, po.id::text)`**。此修復為 ⑤ RPC 排障時於 harness 發現並補齊（前端僅用 `adopted_by[].label`，不受 `code` 值影響）。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（70 warnings 皆既有）、`npm run build` 通過；⑤ RPC harness（T1 乾淨草稿連同來源訂單刪除／T2 非 draft 擋下／T3 有 movement 擋下／T4 來源被採用 RAISE 回滾）全 PASS。

## 近期變更（訂單層退貨/換貨/送修，2026-09-24）

- **目的**：銷往門市的商品可於**訂單層**處理退貨/換貨/送修，不開銷貨單：退貨可退庫存並退款；換貨/送修（`is_repair`）僅標記結清、不退款不異動庫存。前後端接線完成（Phase 2/3），並全線「退貨列不出貨、不計需求、不進採購/寄賣、佣金與分享頁淨扣」。
- **後端（local migrations 均已套用遠端；⚠️ 套用順序**：只套 00002、**不可套 00003**——00003 在 00005 之後套用會覆寫 return-line-aware ship RPC）**：
  - `20260924000002_product_serial_tracking_schema.sql`（早於本次的序號追蹤 schema，已套用並修 trigger bug：`EXCLUDED.quantity` 同步 `product_inventory`＋`product_batch_inventory`）。
  - `20260924000004_order_line_type.sql`：`order_items` 新增 **`line_type`**（`sale`/`exchange`/`return`，NOT NULL DEFAULT 'sale'）、**`line_note`**、**`return_status`**（`pending`/`stock`/`exchange`/`repaired`，僅 return 列）、**`is_repair BOOLEAN`**（僅 return 列）；CHECK 約束 `chk_order_item_line_type`／`chk_order_item_return_status_scope`／`NOT is_repair OR line_type='return'`；部分索引 `idx_order_items_line_type`。既有 `sales_note_return_items` 歷史資料封存為 `return_status='stock'`（已退庫存、無退款）。重建 `delete_order_if_unadopted`：退貨守門改看 `line_type='return'`（不再參照舊表）。
  - `20260924000005_order_return_line_processing.sql`：① 出貨路徑一律排除 `line_type='return'`（`create_order_with_sales_note`/`ship_from_pool`/`direct_ship_order`/`create_consignment_shipment_layer`/`convert_order_to_consignment_draft`/`update_order_with_items` 之刪除品項檢查等）；② `process_order_return_lines(p_line_ids UUID[], p_action TEXT DEFAULT 'stock', p_warehouse_id UUID, p_refund_account_id UUID, p_category_id UUID, p_description TEXT, p_created_by UUID)`（SECURITY DEFINER、單一交易、`jsonb_agg` 回 `{ok:false, reason}`）——action 僅 `stock/exchange/repaired`；僅處理 `line_type='return' AND return_status='pending'`，含 `is_repair` 或非 pending 全批次擋下（`{ok:false, reason}`）；**stock**－逐列退庫存：有庫存批次（`product_batch_inventory`）時回補建立日/過期日為 NULL 的批次列，`inventory_movements`（`inventory_owner='self'`）＋手動回寫 balance；無庫存批次則以既有 `_fifo_consume` 主鍵回寫（回補日期的批次列若已存在則直接 UPDATE 原列）。**退款**：`total_refund > 0` 時必填 `p_refund_account_id`（null→`{ok:false, reason}`），寫 `accounting_entries` income 分錄（負 `unit_price`、品項名＋「退貨退款」）+「客戶退貨退款」expense 分類（未指定 `p_category_id` 時 fallback：查 `accounting_categories.type='expense' AND name='客戶退貨退款'`，無→`{ok:false, reason}`）+ `accounting_entry_references`（reference_id=return line id）；**exchange**→標記 `return_status='exchange'`；**repaired**→標記 `return_status='repaired'`；③ `create_consignment_shipment_layer` 讀取並 RAISE（return 不進層）。
  - `20260924000006_fix_process_order_return_inventory_owner.sql`：修正 `process_order_return_lines` 的**批次回補與主鍵回寫**路徑（`v_batch_key` 用 `b.inventory_owner='self'` 過濾批次列、`_fifo_consume` 以 `WHERE b.inventory_owner='self' AND b.product_id=... AND b.variant_id IS NOT DISTINCT FROM ... AND b.warehouse_id=... AND COALESCE(b.expiry_date=batch_expiry期...` 精確匹配）——避免「同商品無批次列」時誤配錯誤庫存列。
  - `20260924000007_share_order_line_type.sql`：`get_shared_order_details` 於 items 暴露 `line_type/return_status/is_repair`，供分享頁淨扣。
- **前端**：
  - 打單性質（建立/編輯訂單）：`useAdminOrderFormController` 的 `onUpdateLineType`（僅 `orderType==='sales'` 可用）寫回 local items `lineType`；`useOrderFormStateSync` merge 以 spread 保留 `lineType/lineNote/returnStatus/isRepair`（draft store 無 `updateItem`，勿依賴）。
  - **`src/components/order/OrderReturnProcessDialog.tsx`（新）**：admin 訂單詳情「處理退貨」按鈕開啟——選取 pending return 列（`line_type==='return' && return_status==='pending'`）、action select（退庫存退款／標記換貨／標記送修歸還）、stock 時顯示倉庫（`useWarehouses` 預設 `defaultWarehouse`）＋退款帳戶＋退款會計分類（expense）＋退款總計；呼叫 `process_order_return_lines`（`(supabase.rpc as any)`），`{ok:false}` 拋錯 toast；成功 invalidate `['admin-orders']`/`['inventory-list']`/`['accounts']`/`['accounting-entries']`。
  - 詳情徽章：`LineTypeBadge`（`src/components/order/LineTypeBadge.tsx`，新；含 `sale/exchange/return` 與 return 的 `pending/stock/exchange/repaired` 微牌）已嵌入 `OrderDetailItemsTable`/`OrderDetailItemsCards`（adapter `{lineType: item.line_type ?? 'sale', isRepair: item.is_repair ?? false, returnStatus: item.return_status ?? null}`）；admin 列表 `useOrdersList` select 已含 `line_type/return_status/is_repair/line_note`。
  - **總額與彙總淨扣**：`orderListUtils.getOrderTotal`（return 列負號）＋`isReturnLine`；`OrderDetailDialog.getTotalAmount` 同規則；`getOrderShipmentStatus`（admin orderListUtils＋store local）排除 return 列（純 return 單視為 shipped）；`useOrderListDerived`（`allPendingItems`/`aggregatedItems`/`poItemsFromOrders`/`poItemsSource`/`orderPoolGroupedItems`）與 `useOrderListPageController`（倉庫預帶入）、`OrderListDialogs`（轉寄賣計數、DirectShip contexts）全排除 `line_type='return'`（⚠️ 2026-09-25 補齊：原 `allPendingItems`/`orderPoolGroupedItems` 漏濾，已於「⑥ 退貨列漏網補齊」修正）；`StoreOrderList`（local `getOrderTotal`/`getOrderShipmentStatus`/items 視圖）同規則。
  - **佣金**：`useRepCommission.computeLine/computeOrder` 接受 `lineType?`，return 列貢獻 0；呼叫端（`OrderDetailDialog`、`useOrderListDerived.commissionByOrder`）帶 `lineType: i.line_type`。後端發放 RPC 以銷貨單為基（return 不出貨不影響）。
  - **分享頁**：`SharedOrder` 由 RPC 帶回 `line_type`，`toReceiptItems` 將 return 列數量轉**負**並加名稱前綴 `[退貨] `，`SharedReceiptExport` 的 `calcReceiptTotals`（`qty * unit_price` 加總）與中一刀/A4 明細自動淨扣（含運費計算）。`SharedSales`/`SharedConsignment`/`SharedCustomerStatement` 皆以銷貨單/寄賣單為基，return 列永不出貨故不需改。
  - **死碼移除**：`src/components/sales/SalesReturnDialog.tsx` 已刪（其 RPC `process_sales_note_return` 已刪除）；`SalesNoteDetailDialog`/`SalesNotes.tsx` 移除 `enableReturn`/退貨登記入口。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（70 warnings 皆既有）、`npm run build` 通過。⚠️ LSP `@/` alias 噪音僅 `OrderComposer.tsx`/`AdminOrderCheckout.tsx`（死檔，與本次無關）。

## 近期變更（客戶對帳單分享，2026-09-24）

- **目的**：admin 銷貨單頁新增「對帳單」——選店家（客戶）＋日期區間產生一組分享連結，瀏覽者**免登入**即可看到區間內全部銷售單據與價格，逐單可展開明細並可深層開啟單張分享頁；管理員可改標題或刪除連結。
- **後端（migration `20260924000001_customer_statement_shares.sql` 已套用遠端；`20260924000002` 不存在，強化版為同一批 `20260924000001` 內 CREATE OR REPLACE 後再以 `get_shared_customer_statement` 強化重發，實為兩次 apply）**：
  - 新表 **`customer_statement_shares`**：id/title/store_id/date_from/date_to/access_token（隨機永久 token，同 orders）/created_by/created_at；RLS ENABLE＋唯一 policy「僅 admin」（`has_role(auth.uid(),'admin')`，FOR ALL TO authenticated）；**不進 types.ts → 前端統一 `(supabase as any).from('customer_statement_shares')`**。
  - 新 RPC **`get_shared_customer_statement(p_statement_id text, p_token text)`**（SECURITY DEFINER、`SET search_path TO 'public'`、`REVOKE ... FROM PUBLIC, anon` 後 `GRANT EXECUTE ... TO anon, authenticated`）：驗證 id＋隨機 token（**不支援決定性 token**），非法 uuid 走 `EXCEPTION WHEN invalid_text_representation → RETURN NULL`；store 缺失亦回 NULL。回傳 `{statement{...}, store{...}, notes[{id,code,status,payment_status,shipped_at,notes,shipping_fee,delivery_method_title,access_token,items[{product_name,variant_name,quantity,unit_price,sort_order}]}]}`——日期基準**出貨日 shipped_at**（`>= date_from AND < date_to+1 day`、`shipped_at IS NOT NULL`），notes 依 `shipped_at, code, id` 升冪、items 依 `COALESCE(sni.sort_order,0), oi.sort_order, oi.created_at`。
  - **遠端驗證（BEGIN…ROLLBACK）**：11 張單全數回傳、title/store 正確、錯誤 token→NULL、非法 uuid→NULL、`anon`/`authenticated` EXECUTE 權限均 true。（`has_table_privilege('anon','customer_statement_shares','SELECT')=true` 是 Supabase 預設 grant 基線，RLS 無 anon policy 即擋，與全站一致。）
- **前端**：
  - `src/hooks/useCustomerStatements.ts`：`CustomerStatement` 型別、`statementShareLink(id, token)`、`useCustomerStatements()`（list query `["customer-statement-shares"]` ＋ create/updateTitle/delete mutations，成功 invalidate）。⚠️ cast 必須寫 `(supabase as any).from(...)`，寫 `(supabase.from(...) as any)` 會過不了 `.from()` 參數型別檢查。
  - `src/components/sales/CustomerStatementDialog.tsx`：list/create/created 三視圖；`StorePicker` 單選＋Calendar 日期範圍（預設本月 1 號~今天）、標題自動產生可內聯改、建立後顯示連結＋`QRCodeSVG`、刪除 confirm；stores 用 queryKey `["admin-stores"]` 與 SalesNotes 共用（react-query 去重）。
  - `src/pages/admin/SalesNotes.tsx`：CardHeader 加「對帳單」按鈕（`ReceiptText`，僅 `!isRep`，緊鄰既有「匯入」）＋`statementOpen` state。
  - `src/pages/share/SharedCustomerStatement.tsx`（**新**）＋路由 `src/routes/shared.tsx` 加 `/share/statement/:statementId`（公開、無 auth guard）：`useParams`＋`token` searchParam → `(supabase.rpc as any)('get_shared_customer_statement')`；標題卡＋彙總卡（張數/總件數/總金額，前端由 items 計算）＋每單 `Collapsible` 展開（品項表＋小計/運費/合計＋備註＋「檢視完整單據」新分頁連結 `/share/sale/{code}?token={access_token}`）；**價格一律顯示、無連動 `SharedReceiptExport`**；找不到/失效 → Alert「無法讀取對帳單」。
- **文件**：已同步 `AGENTS.md`＋`.agent/ARCHITECTURE.md`（routes 表＋架構段）＋`.agent/DATABASE.md`（表格＋5.1 分享存取權）。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（68 warnings 皆既有）、`npm run build` 通過。

## 近期變更（多單收款狀態同步修復＋查找單據＋既有資料回填，2026-09-23）

- **根因**：銷貨單詳情的「登記收款」（`SalesNoteDetailDialog` 的 `receivePaymentMutation`）送出後**只對 `note.id`（清單開啟的那張）呼叫 `sync_sales_note_payment_status`**——若使用者在收款對話框內把 B 單加進單據清單，`accounting_entry_references` 已寫入 B，但 B 的 `sales_notes.payment_status` 仍 `unpaid`（實際資料 SL2609TOP0010003、SL2609LAIKE0010002 已受影響）。另有編輯路徑：`updateEntryMutation` 原本**完全忽略 `references`**（AccountingPage 編輯送出時丟掉子表資料、也不 sync）。
- **前端修復**：
  - `SalesNoteDetailDialog.receivePaymentMutation`：收集 entry row 綁定單＋`references` 子表全部 `sales_note` id（Set 去重）逐一呼叫 sync。
  - `useAccounting.updateEntryMutation`：新增 `references?` 參數——送出時「先讀舊 refs → 刪子表 → 重建子表（`reference_type/reference_id/item_name/amount_applied`）」並對**新舊** `sales_note`/`repair_order` 全部 id 同步收款狀態 RPC；`AccountingPage.tsx` 編輯送出改傳 `{ id, ...data, references }`。
  - `useEntryFormController`：`addDocItem`/`removeDocItem` 在「說明（description）」為空或為自動格式（`/^(銷貨單收款|收款|付款|跨單結帳|採購單付款)`）時**連動重組**為 `銷貨單 SL...、...；採購單 PO...` 多單格式（使用者手寫說明不被覆寫）。
  - `EntryDocListFields` 新增「查找單據」搜尋框（`Search` icon＋`docSearch` state，client-side 過濾單號/名稱/店家/供應商/客戶/機型，空結果顯示 `查無符合「…」的單據`，切換 Tab 自動清空）；`useEntryDocQueries` 銷貨單候選清單 `.limit(50 → 200)` 方便查找較舊單據。
- **回填（migration `20260923000003_backfill_accounting_payment_status.sql` 已套用遠端）**：① 全部 `sales_notes.payment_status` 依 RPC 判定重算（paid/partial income 且 entry row **或** references 子表命中→`paid`），事後驗證 **119 張全數 0 mismatch**；② `counterparty_name` 補 NULL——補 entry row 直接綁定的銷貨單（店家名）/採購單/維修單（⚠️ 原 `20260909000002` 回填只用 `suppliers.company_name`，遠端欄名是 `name`，本 migration 以 `sp.name` 正確回填）。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（68 warnings 皆既有）、`npm run build` 通過。

## 近期變更（寄賣出貨配送參數＋出貨地址同步至店鋪＋店家預設配送類型，2026-09-23）

- **目的**：把「配送類型優先」的配送流程補完到寄賣出貨（`create_consignment_shipment` 支援 `p_delivery_type/p_delivery_method_id/p_shipping_fee/p_shipping_cost/p_tracking_*`＋`p_shipping_address`）與三支出貨 Dialog（訂單列表/表單 DirectShipDialog、寄賣 ShipDialog、出貨池 ShipDialog）——物流出貨可選配送方式＋地址，寄賣出貨後可把收件地址寫回店鋪，店家配送預設類型 `stores.default_delivery_type` 優先。
- **店家預設配送類型（migration `20260923000001_store_default_delivery_type.sql` 已套用遠端）**：`stores` 新增 `default_delivery_type text`（nullable，`delivery|logistics|pickup`）；既有資料以 `default_delivery_method_id` join `delivery_methods.type` 回填。`useStoreDeliveryDefaults` 的 `fromStore(store)` 改為 **`default_delivery_type` 優先**（無則以 `default_delivery_method_id` 的方法型別推導，未指定→`'delivery'`）。`StoresTab` 對話框新增「預設配送類型」`DeliveryTypePicker`（hidden input 送 `default_delivery_type`），`useStoresController.handleStoreSubmit` 讀取寫入。⚠️ 配送類型為整店層級，「同步至店鋪」**僅回寫地址五欄＋收件人/電話**，不回寫 `default_delivery_*`。
- **後端（migration `20260923000002_extend_consignment_shipment_delivery.sql` 已套用遠端並驗證）**：
  - **`create_consignment_shipment` 4 參數 → 12 參數**（先 DROP 舊精確簽名 `(UUID,UUID,TEXT,TIMESTAMPTZ)` 再 CREATE，單一簽名避免 PGRST203）：尾參數 `p_delivery_type/p_delivery_method_id/p_shipping_fee/p_shipping_cost/p_tracking_company/p_tracking_number/p_tracking_url/p_shipping_address jsonb`（全 DEFAULT）。配送解析走共用 `public._resolve_delivery`：`logistics`＋方法 → `upsert_shipment` 建 **1 包**（fee/cost＝方法值可覆寫、tracking）＋寫寄賣單方法快照與 `shipping_address = COALESCE(shipping_address, p_shipping_address)`＋`delivery_type`；`delivery` → 套用（預設）送貨方法快照、不建包；`pickup` → 只寫類型。
  - **`convert_order_to_consignment_draft`**：建立寄賣草稿時自來源訂單複製 `delivery_type`＋`shipping_address`（後續寄賣出貨繼承）。
  - **驗證（遠端 BEGIN…ROLLBACK）**：logistics（建 1 包＋方法快照「郵局 - 同縣市…」＋fee150/cost120＋地址）／delivery（套「送貨」快照 0 費、不建包）／pickup（只寫類型不建包）三型 PASSED，皆產正式碼 `CS{YYMM}{店碼}{流水}`。
- **前端寄賣**：
  - `types.ts` `ConsignmentOrder` 補 `delivery_type?/delivery_method_id?/delivery_method_title?/delivery_method_code?/shipping_address?/shipping_fee?/shipping_cost?`；`OrderDetailDialog` 以 `useShipments('consignment_order', order?.id)` 判斷 `hasDelivery = delivery_type==='logistics' || 已有包裹`，**僅 `{hasDelivery && }` 渲染 `<ParcelManager>`**（非物流不再空顯示包裹管理）。
  - `components/ShipDialog.tsx` 重寫為自含 form：`['store-info', storeId]` 查店家（含 `default_delivery_*`）、`ShippingDeliveryFields`（類型＋物流方式/追蹤）、logistics 時展開 `ShippingAddressFields`＋「套用店家最新地址」＋**同步至店鋪 checkbox**（地址與店家異動自動勾選、套用店家地址後不勾）；初始化 effect 改用 `[storeId, storeInfo?.id]` deps＋`didInitRef`——訂單既有快照只套一次、店家資料非同步到齊後再補店家預設（有方法/地址才補，不覆寫使用者已選）；logistics 未選方式時禁用確認鈕。
  - `useConsignment.shipMutation` 擴充 `{orderId, note?, storeId?, syncToStore?, delivery?}`：RPC 帶 `p_delivery_type`（僅 logistics 附 `p_delivery_method_id/p_tracking_*`）、`p_shipping_address`（`undefined` 被 supabase-js 丟棄）；`syncToStore && logistics && 地址非空 && storeId` 時出貨後回寫 `stores` 的 `recipient/phone/postal_code/city/district/address`；invalidate 增 `['stores']/['store-info']`。
- **前端出貨池（`src/pages/admin/shippingPool/`）**：`ShipDeliveryState` 加 `sync_to_store?`；`useShipDelivery` 新增 `setStoreSync`；`ShipDialog` 每店家 logistics 地址區下方新增「**出貨後將配送地址同步至店鋪**」checkbox（配送地址與店家不一致時自動勾選、不主動取消）；`useShippingPoolMutations.shipMutation` 於 `ship_from_pool` 成功後對「logistics 且 sync_to_store 且地址非空」店家回寫 `stores` 地址五欄＋收件人/電話，並 invalidate `['stores']/['store-info']`。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（68 warnings 皆既有）、`npm run build` 通過；types.ts 已重新產生（UTF-8 no BOM）；RPC 簽名遠端確認 `create_consignment_shipment` 單一 12 參數。

## 近期變更（配送 Quick Ship Dialog 共用化：兩支 DirectShipDialog 合併，2026-09-22）

- **共用元件 `src/components/orders/DirectShipDialog.tsx`（新）**：合併「後台訂單列表批次直接出貨」與「AdminOrderForm 直接出貨」兩支原本重複的 Dialog。統一以 `DirectShipOrderContext[]` 描述每一筆目標訂單（`id/code/storeName/consignmentMode/deliveryType/deliveryMethodId/deliveryMethodTitle/defaultDeliveryMethodId/items[{id,productId,variantId,name,quantity}]`），並以受控 `ShippingDeliveryValue`（`deliveryType/deliveryMethodId/trackingCompany/trackingNumber/trackingUrl`）＋`ShippingDeliveryFields` 呈現配送欄位。**開啟時繼承第一筆訂單**：其 `delivery_type` → 店家 `default_delivery_method_id` 的方法型別（`deliveryTypeOfMethod`）→ 預設 `'delivery'`；物流方式沿用訂單既有 `delivery_method_id`，未有則帶入店家預設方式。`onConfirm(delivery, orderIds)` 僅在 `logistics` 型別才附帶 `deliveryMethodId`/追蹤三欄。`allConsignment` 由 `orders` 內部推導（寄賣全部時標題「寄賣出貨」、一般「直接轉銷貨單」並以 `onItemSourceChange` 是否存在切換「寄賣訂單顯示品項列／顯示資訊提示」——列表模式要選倉、表單模式不扣自有庫存）。
- **兩呼叫端改薄 adapter**：列表批次 `OrderListDialogs.tsx`（props 維持原形，內部把 `Order[]`＋`selectedOrderIds` 映射成 contexts 並委派共用元件，移除 `allSelectedConsignment` prop）、表單 `src/pages/admin/orders/form/DirectShipDialog.tsx`（維持原 props 形狀、`re-export type DirectShipDelivery`）。`useOrderListMutations` 的 `directShipMutation` 改收 `{ orderIds, notes, delivery? }` 並對 `direct_ship_order` 傳 `p_delivery_type`（僅 logistics 附 `p_delivery_method_id/p_tracking_company/p_tracking_number/p_tracking_url`）。`useOrdersList` select 補 `delivery_type/delivery_method_id/delivery_method_title`＋`stores.default_delivery_method_id`；`types/order.ts` `Order` 補 `delivery_type?`、`stores.default_delivery_method_id?`。
- **共用店家配送預設 hook `src/hooks/useStoreDeliveryDefaults.ts`（新）**：包 `useDeliveryMethods({ includeInactive: true })`，提供 `methodOf(id)`／`typeOf(id)`／`fromStore(store)`（依 `store.default_delivery_method_id` 解析 `{method, type}`，未指定→預設 `'delivery'`），統一「店家預設方式 → 配送類型」的推導。接線：① `useAdminOrderFormController` 建立模式（sales）於 `storeInfo` 就緒且 `deliveryType` 未選時自動套用店家預設類型；② `useShipDelivery` 新增 `applyStoreDefaultType(storeId, store)`（`appliedTypeKeys` 每家一次，`resetStores` 同步清空），透過 `ShippingPool`→`ShipDialog` 於對話框 `open` 時逐店套用（`StoreWithAddress` 補 `default_delivery_method_id?`，`ShippingPool` stores select 補該欄）；③ 表單 DirectShipDialog adapter 新增 `defaultDeliveryMethodId?`／`deliveryType?` props（create mode `order` 為 null 時由 controller 帶入 `storeInfo.default_delivery_method_id` 與目前選擇的配送類型）。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（68 warnings 皆既有）、`npm run build` 通過。死碼 `AdminOrderCheckout.tsx`/`OrderComposer.tsx`、`/admin/orders/new` route、「代訂訂單」按鈕於前次變更時移除。

## 近期變更（配送類型優先：訂單只存類型，物流才建包裹，2026-09-22）

- **目的**：配送流程改「先選類型」——`delivery`（送貨，帶預設送貨方式快照、**不建包裹**）／`logistics`（物流，自動建 1 個包裹＝方式/費用/成本/追蹤）／`pickup`（自取，不寫配送方式）。物流細項（方式/價格/追蹤）**只屬銷售單／寄賣單層**，訂單層只存 `delivery_type`。
- **後端（migration `20260922000001_delivery_type_first.sql` 已套用遠端並驗證）**：
  - `orders`/`sales_notes`/`consignment_orders` 新增 **`delivery_type text`**（nullable）；既有資料以既有 `delivery_method_id` join `delivery_methods.type` 回填（無方法→`'delivery'`），**回填結果 0 NULL**（全部既有單皆有方法快照＝delivery 或 logistics）。
  - **4 支 RPC 單一簽名收斂（tail 加 `p_delivery_type text DEFAULT NULL`，先 DROP 舊精確簽名再 CREATE，避免 PGRST203 overload）**：`create_consignment_shipment_layer`(14)、`create_order_with_sales_note`(15)、`direct_ship_order`(15)、`ship_from_pool`(17，尾參數順序 `…p_delivery_overrides, p_delivery_type, p_shipping_cost, p_tracking_company, p_tracking_number, p_tracking_url`)。
- **配送解析共用 helper（migrations `20260922000002_consolidate_shipping_rpcs.sql`＋`20260922000003_fix_resolve_delivery_unassigned_record.sql` 已套用遠端並以 BEGIN…ROLLBACK 驗證）**：新增內部函式 **`public._resolve_delivery(p_delivery_type text DEFAULT NULL, p_delivery_method_id uuid DEFAULT NULL, p_use_method_type_fallback boolean DEFAULT true) RETURNS jsonb`**（SECURITY DEFINER、`SET search_path = 'public','extensions'`、REVOKE public/anon/authenticated 不對外），收斂 4 支 RPC 內聯重複的三塊邏輯——① 方法驗證＋快照（type/name/code/price/cost，`is_active` 才可、否則 RAISE「配送方式不存在或已停用」）② 類型推導 `COALESCE(p_delivery_type, 方法type, 'delivery')`（第三參數 `false` 時**不回退方法類型**，`COALESCE(p_delivery_type,'delivery')`，供 ship_from_pool override 用）③ `delivery` 且未指定方法時套用**預設送貨方法**（`type='delivery' AND is_default AND is_active`）快照。回傳鍵 `delivery_type/method_id/method_title/method_code/method_price/method_cost`。4 支 RPC 皆改呼叫 helper（signature 不變、僅 CREATE OR REPLACE）。⚠️ **0003 修 bug**：0002 首版在 `p_delivery_method_id IS NULL` 時 `v_snap`（RECORD）未賦值，② 取 `v_snap.type` 會拋 **PL/pgSQL 55000「record not assigned yet」**——0003 改以獨立標量 `v_method_type`（恆為已賦值）取代 record 欄位取值。驗證：helper 5 檢查＋`direct_ship_order` pickup/logistics/delivery 三型＋`ship_from_pool` delegate-override 皆於 `BEGIN…ROLLBACK` 內 PASSED（logistics 建 1 包、delivery 套預設方法不建包、pickup 不寫方法包裹）。
  - 行為：`v_delivery_type = COALESCE(p_delivery_type, 方法.type, 'delivery')`；`logistics`＋有方法 → `upsert_shipment` 建 **1 包**（fee/cost=方法值、tracking）＋寫銷售單/寄賣單方法快照；`delivery` → 套用預設送貨方式快照（`is_default AND type='delivery'`，不建包裹）；`pickup` → 只寫類型。`ship_from_pool` 每店家 override（`p_delivery_overrides`）可帶 `delivery_type`（優先於全局，L790）；override 有 parcels 時仍逐包裹。
- **前端**：
  - `src/components/shipping/DeliveryMethodPicker.tsx` 新增 `DeliveryType`（`'delivery'|'logistics'|'pickup'`）、`DELIVERY_TYPES`、`TYPE_LABEL`、`DeliveryTypePicker`（三段選單）、`deliveryTypeOfMethod(method)`；`useDeliveryMethods` 加 `type?` 過濾。
  - 新增 `src/components/shipping/DeliveryTypeCard.tsx`（type-only 卡片）；`AdminOrderForm` 的 renderDeliveryCard 改 type-only，方法/包裹全交由出貨 RPC 產生。
  - `useAdminOrderFormController`：`deliveryMethodId`/`shippingAddress`/`deliveryMethods` state 全移除，改 **`deliveryType`/`setDeliveryType`**（型別驅動）；`useOrderFormStateSync` 由 `order.delivery_type` 還原；`useOrderFormMutations` 新增匯出 `DirectShipDelivery` 型別、createPending 只插 `delivery_type`、update 只寫 `delivery_type`、`create_order_with_sales_note` 只傳 `p_delivery_type`、`directShipMutation` 改收 `delivery?: DirectShipDelivery`（logistics 時附 `p_delivery_method_id`＋`p_tracking_*`）。
  - `DirectShipDialog.tsx` 整支重寫為自含 form 版：型別三段選單＋物流方法選取（`useDeliveryMethods({includeInactive:true})`）＋追蹤欄＋自動建 1 包說明；物流未選方法時禁用確認鈕並提示；`onConfirm(delivery)` 呼叫 controller。
  - **ShippingPool**（`src/pages/admin/shippingPool/`）：`ShipDeliveryState` 加 `delivery_type`；`useShipDelivery` 新增 `setStoreType`、預設 `'delivery'`、移除 `defaultMethodId`（方法改由 RPC 伺服器端解析）；`ShipDialog` 每店家顯示 `DeliveryTypePicker`（logistics 才展開地址＋包裹列），groupTotal **含包裹費**（`商品小計＋運費＝總計`）；`buildDeliveryOverrides` 每店家帶 `delivery_type`（不再要求 parcels 非空才寫 override，delivery/pickup 也帶類型）。
  - **ParcelManager dirty 修復**：`dirty = editable && (original ? fromDraft(original,d) : hasContent)`——新增空包只要任一欄位有內容即可顯示「儲存」。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（69 warnings 皆既有＋DeliveryMethodPicker 共用模組 react-refresh）、`npm run build` 通過；types.ts 已重新產生（UTF-8 no BOM）。

## 近期變更（修復 typecheck no-op＋清除 9 個既有型別錯誤，2026-09-21）

- **根因**：`package.json` 的 `typecheck` 為 `tsc --noEmit`，但根 `tsconfig.json` 是 solution-style（`"files": []` ＋ `references`）——非 `-b` 的 `tsc` 不遍歷 references，**不檢查任何檔案、永遠 0 errors**（LSP 才是真實來源）。
- **修正**：`typecheck` 改為 `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json`；並清掉揭露的 9 個既有錯誤（`src/` 全數 0 errors）：
  - `ShippingAddressValue` 由 `interface` 改 `type`（取得隱式 index signature，修 `useOrderFormMutations.ts` 244/335、`AdminOrderCheckout.tsx` 213 的 `ShippingAddressValue→Json` 不相容）。
  - `useOrderListMutations.ts` 138：`convert_order_to_consignment_draft` 的 `Json` 回傳改以 `data as { ok?: boolean } | null` 讀取。
  - `VariantModelMatrixModelsTab.tsx`：`filteredModels` 型別由 `DeviceModel[]`（`@/types/device-models`）改為 `DeviceModelOption[]`（`@/hooks/useDeviceModels`，實際來源）。
  - `DeviceModelDialog.tsx` 49/56：新增 `asSpecs(v)`（`unknown → Record<string, unknown>`）取代直接 spread `Json`。
  - `DeviceModelManager.tsx` 459/474：`@/types/device-models` 的 `FullDeviceModel*` 與 `pages/admin/products/hooks/useDeviceModels.ts` 的 `DeviceModel*` 改用 **`Omit<Row,'specifications'>`** 覆寫 `specifications?: Record<string, any> | null`，消除 `Json & Record` 交集造成的來源/目標不相容。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（66 warnings 皆既有）、`npm run build` 通過。

## 近期變更（三種單據批次匯入：訂單/銷貨/寄賣，2026-09-22）

- **目的**：供系統遷移回填既有資料。後台訂單/銷貨/寄賣三頁各新增「匯入」按鈕，共用 `DocImportDialog`，支援 Excel/CSV 上傳或「貼上內容」、下載範本、逐群組預覽驗證、錯誤群組隔離、匯入結果明細（實際單號）。
- **後端（migration `20260921000012_doc_import_batch_rpcs.sql` 已套用遠端）**：三支 batch RPC（SECURITY DEFINER、僅 admin、逐群組子交易隔離、回傳 `{total, success, results[], errors[]}`）＋共用 resolver helper：
  - `import_orders_batch`：群組＝`{store_code, order_code?, order_date?, status?('pending'|'processing'), notes?, items:[{sku,name?,quantity,unit_price?,unit_cost?}]}`；`pending` 不產號（order_code 可留空，由 trigger 產號）、`processing` 交由 trigger 產 OD 單號；每群組建立 orders＋order_items（含 sort_order）。
  - `import_sales_notes_batch`：群組自附 `sales_code`（自帶單號）；自動建立 admin_proxy/shipped 來源訂單＋shipped 銷貨單＋自有倉 `sales_shipment` movement `-qty`（trigger 同步庫存與帶出 `order_items.unit_price`）；銷貨單號由 trigger 依店家+出貨日產 `SL{YYMM}{店碼}{流水}`。
  - `import_consignment_batch`：群組＝`{direction('send_to_store'|'receive_from_supplier', 支援中文別名), store_code | supplier_code, consignment_code?, order_code?, shipped_date?, status?('draft'|'active'), notes?, items[]}`；**自帶 code 走「INSERT draft（trigger 會覆寫成 CS-DRAFT-...)→UPDATE status='active' 且 code=自訂值」路徑保留自訂碼**；`send_to_store`＋active 會建立來源訂單（`source_type='consignment'`、shipped、品項同步回填 order_item_id）＋`consignment_out_shipment` `-qty`；`receive_from_supplier`＋active 寫 `consignment_in_receipt` `+qty`（供應商倉）；draft 不寫 movement、不建來源訂單。
  - 共用 resolver：`import_resolve_item`（sku→products.product_variants 或 name→products）、`import_resolve_store`（stores.code）、`import_resolve_supplier`（**`suppliers` 沒有 code 欄，僅以 `name` 比對**）。
  - ⚠️ Admin guard 實測：`has_role(auth.uid(),'admin')` 對 NULL uid 回傳 **FALSE**，MCP/無 JWT 直接呼叫會被擋（`僅管理員可匯入...`）；SQL 測試需先 `SELECT set_config('request.jwt.claims','{"sub":"<admin-user-id>","role":"authenticated"}', true);`。子交易隔離＝某群組錯誤（找不到商品/店家）只回該群組 `errors[]`，不影響其他群組。
- **前端（零新增依賴）**：`src/utils/docImport.ts`（共用解析/驗證：中英欄位別名、normalizeDate、Excel/CSV/貼上解析、`rowsToImportGroups` 依單號欄分組、逐群組驗證、`importGroupPayload` 組 RPC payload、`downloadImportTemplate`、`IMPORT_RPC_NAMES`/`IMPORT_QUERY_KEYS`）＋`src/components/orders/DocImportDialog.tsx`（上傳/貼上分頁、預覽表格、群組錯誤高亮、結果面板、成功後 invalidate queryKey）。三頁接線：`OrderListPage`（OrderListHeader 匯入按鈕，僅 admin）、`SalesNotes`（CardHeader 匯入按鈕，僅 `!isRep`）、`ConsignmentPage`（標題列匯入按鈕）。
- **驗證**：`npx tsc --noEmit -p tsconfig.app.json` 僅既有 4 個錯誤（DeviceModelDialog/Manager，非本次改動）；`npm run lint` 0 errors（66 warnings 皆既有）；`npm run build` 通過。後端三支 RPC 已於 BEGIN…ROLLBACK 實測通過。

## 近期變更（供應商編輯＋物流公司身分指派 UI，2026-09-21）

- **背景**：`suppliers.is_logistics_company` 是**身分牌**（同一供應商可同時是採購供應商＋物流公司）；配送方式 `type='logistics'` 綁定此類供應商、運費月結 `list_settleable_shipments(p_supplier_id)` 亦以此篩選。但先前**無任何 UI** 可設定（`SupplierForm` 只能新增、無此欄位、無編輯；前端 `Supplier` 型別亦缺此欄）。
- **前端**：`purchase-orders/types.ts` 的 `Supplier` 補 `is_logistics_company: boolean`；`usePurchaseOrders` 新增 `updateSupplierMutation`（update by id，成功 invalidate `['suppliers']`／`['delivery-methods-logistics-suppliers']`／`['shipping-suppliers']`；`createSupplierMutation` 亦補後兩者）；`SupplierForm` 新增 `initial?` prop 支援編輯（含「物流公司」Checkbox，按鈕依 `initial?.id` 顯示「儲存」/「新增」）；`SupplierTab` 新增 `onEdit` prop＋每卡「編輯」按鈕＋`is_logistics_company` 時顯示「物流」徽章；`PurchaseOrdersPage` 新增 `editingSupplier` state＋編輯 Dialog（`key={editingSupplier.id}` 確保換單重掛載）。
- **驗證**：`npm run lint` 0 errors（66 warnings 皆既有）、`npm run build` 通過；`npm run typecheck` 0 errors（typecheck script 已修復，見上方）。

## 近期變更（配送參數 RPC 收斂單一簽名，根治 PGRST203，2026-09-21）

- **根因**：Phase B/C 加配送參數時用 `CREATE OR REPLACE FUNCTION`，但**新簽名（尾端增參數）與舊簽名不同 → Postgres 不覆寫、而是「新舊 overload 並存」**。PostgREST 以具名參數解析時，只要請求參數集合是多個 overload 的子集（前端 `undefined` 會被 supabase-js 丟掉，如未選配送方式/未填出貨時間）就無法選出唯一函數 → **PGRST203「Could not choose the best candidate function」**（報錯「很多轉去銷售單」的元兇：後台訂單列表批次「轉銷貨單」`direct_ship_order` 只傳 6 具名參數、恆歧義；`create_order_with_sales_note` 少傳配送參數時同樣歧義）。同型前例：`correct_sales_note` 原 5 參數版已於 `20260911000009` DROP。
- **修正（migration `20260921000011_collapse_overloaded_rpcs.sql` 已套用遠端）**：每個函數名**只保留「最長、尾參數含 DEFAULT」的簽名（語意超集）**，DROP 其餘短版——共 8 個：`create_consignment_shipment_layer`(保留9)、`create_order_with_sales_note`(10)、`direct_ship_order`(10)、`ship_from_pool`(12)、`adjust_inventory`(4)、`receive_purchase_items`(2)、`bump_data_version`(2)、`compare_product_row`(保留3，4 參數版為純相容 wrapper)。**前端零改動**。
- ⚠️ **教訓（避免重蹈）**：凡 RPC 要「尾端加 DEFAULT 參數」，**不可**與舊短簽名並存（會成為 overload）；應直接 DROP 重建單一新簽名（`DROP FUNCTION` 後 `CREATE OR REPLACE` 尾參數全預設），或新開 migration 收斂。
- **驗證（遠端）**：`pg_proc` 8 函數名皆單一簽名、authenticated GRANT 皆在；`BEGIN…ROLLBACK` 內以 6 具名參數呼叫 `direct_ship_order` 正常解析並建銷貨單（SL2609GCPA0010005，回滾後無殘留）。
- **types.ts 已重新產生**（`npm run supabase:types`，此檔 Windows 產出 UTF-16LE+BOM 已確認轉回 UTF-8 no BOM 成功）；`npm run typecheck` 0 errors、`npm run lint` 0 errors（66 warnings 皆既有）。

## 近期變更（寄賣單號改遞補制，2026-09-21）

- **根因**：`next_consignment_code`（migration `20260916000003`）以 `system_sequences` 的**新 key `consignment_{YYMM}_{store_id}`** 累加產號。店家既有單號（如 SMALLP001 的 `CS2609SMALLP0010001/0002`，屬舊 key 世代）**未回填這組新 key** → 店家首次產號又從 1 起，生成 `…0001`（與既有單撞號、`consignment_orders.code` 有 UNIQUE → 23505）。
- **修正（migration `20260921000010_consignment_code_reuse_gaps.sql` 已套用遠端）**：`next_consignment_code` 改為**遞補制**（與銷貨單一致）——以既有 `consignment_orders.code` 為唯一真值，找「該店家該月份」**第一個空缺號碼**（`store_id IS NOT DISTINCT FROM` 分群，receive_from_supplier 共用 'SP'），`pg_advisory_xact_lock(hashtext(v_seq_key))` 防並行；不再依賴 `system_sequences`（舊 consignment_* 序列 key 成孤立、無害）。驗證：SMALLP001 → `CS2609SMALLP0010003`、全新店家 → `CS2609{店碼}0001`、SP → `CS2609SP0001`。
- ⚠️ **共享已知風險**：因改遞補制，刪單後重用空缺號碼 + 決定性分享 token（`share_token_for_code`）⇒ 持舊單決定性連結者會看到新單（同 sales_notes 的已知權衡，見下方「決定性分享 token」段落）。

## 近期變更（地址自動分欄＋郵區反查＋店家營業地址＋AdminOrderForm 預設配送方式，2026-09-21）

- **`ShippingAddressFields` 新增「完整地址（自動分欄）」欄＋郵遞區號可編輯失焦反查**（`src/components/shipping/ShippingAddressFields.tsx`）：頂部新增全寬「完整地址」輸入（例：`640雲林縣斗六市鎮南里中山路286-3號`，郵區可省略），**失焦**時以 `parseTaiwanAddressText` 解析，僅覆寫非空欄位（postal/city/district/address）並將欄位內容更新為 `formatAddress(...)` 規範化結果。該欄為元件內部 `useState`（不綁 `value`），**單向鏈避免循環**：local→parent 只在 blur 寫回、parent→local 只經 effect（deps 用 `vPostal/vCity/vDistrict/vAddress` primitive 值，非 `v` 物件 identity）。郵遞區號欄移除 `readOnly`（恆可編輯），`onBlur` 以 `getCityDistrictOfPostal` 反查並 `patch({city,district})`（查不到不動）。新增 `hideContact` prop（隱藏收件人/電話，供營業地址用）。全站使用者（DeliveryCard/CheckoutForm/AdminOrderCheckout/AdminOrderForm/ShipDialog/StoresTab）一次生效。
- **`taiwanAddress.ts` 新增層級反查工具**（`src/utils/taiwanAddress.ts`）：`cityOfDistrict(district)`（鄉鎮→所屬縣市，如 斗六市→雲林縣；跨縣市同名如「東區」取首筆）、`getCityDistrictOfPostal(postal)`（郵區前 3 碼→縣市/鄉鎮）；`parseTaiwanAddressText` 改用它並新增「無郵區、只有鄉鎮 → 反查縣市」分支（**郵遞區號非必填**，採「縣市→鄉鎮→剩餘」層級拆分）。
- **店家營業地址（migration `20260921000009_stores_business_address.sql` 已套用遠端）**：`stores` 新增 `business_address/business_city/business_district/business_postal_code`（與配送/收件地址 `address/city/district/postal_code/recipient/phone` 分開）；回填既有店家＝原配送地址快照。`StoresTab` 對話框新增「營業地址」欄位組（`ShippingAddressFields hideContact prefix="store-biz-addr"`）＋勾選「**收件地址同營業地址（自動複製地址欄）**」（勾選時 effect 將營業地址 postal/city/district/address 複製到配送地址，收件人/電話保留；營業地址變更時同步）；hidden inputs 補 `business_*`，`useStoresController.handleStoreSubmit` 讀取寫入；列表（桌機/行動）於營業地址與配送地址不同時多顯示一行「營業：…」。⚠️ 該勾勾的**收件人/電話消失**與**狀態未保存**兩個 bug 已於 2026-09-29 修復（見上方最新條目：改用 `hideAddress` ＋ 新欄位 `delivery_address_matches_business`）。
- **AdminOrderForm 預設配送方式修復**：`useOrderFormQueries` 的 order.stores embed 與 storeInfo select 補 `default_delivery_method_id`；`useAdminOrderFormController` 既有 per-store effect（`appliedStoreAddressKeyRef` 每家一次）內加 `setDeliveryMethodId(prev => prev || store.default_delivery_method_id || null)`（functional 更新，edit mode 仍由 `useOrderFormStateSync` 以 `order.delivery_method_id` 優先；effect deps 不含 shippingAddress → 地址分欄 blur 不重跑，無循環）。
- **types.ts 已重新產生**（`npm run supabase:types`，含 stores.business_*）。
- **驗證**：`npx tsc --noEmit` 0 errors、`npm run lint` 0 errors（66 warnings 皆既有）、`npm run build` 通過。

## 近期變更（物流管理統包頁＋地址組件優化＋店家收件人，2026-09-21）

- **物流管理統包頁（`src/pages/admin/logistics/LogisticsPage.tsx`，路由 `/admin/logistics` 已註冊＋側欄「物流管理」取代原「運費月結/配送方式」兩項）**：「配送方式」與「運費月結」統一為單頁，`?tab=delivery-methods|shipping-settlements` URL 路由（預設 delivery-methods）。`LogisticsPage` 自持 PageHeader（物流管理），下方 `Tabs` 嵌入兩子頁；`DeliveryMethodsPage`／`ShippingSettlementsPage` 新增 optional `embedded` prop（embedded 時隱藏各自 PageHeader、僅右上角保留動作按鈕列——「新增送貨/物流/自取」三顆／「運費結帳」一顆，避免雙標題）。舊路由 `/admin/delivery-methods`、`/admin/shipping-settlements` 改 `<Navigate>` redirect 到 `/admin/logistics?tab=...`（`src/routes/admin.tsx`，新增 `Navigate` import）。
- **`ShippingAddressFields` 縣市/鄉鎮市區改 `SearchableSelect`**（`src/components/shipping/ShippingAddressFields.tsx`，移除 shadcn `Select`）：縣市 options＝`getTaiwanCities().map(c=>({id:c,name:c}))`；鄉鎮 options＝`getDistrictsOfCity(v.city).map(d=>({id:d,name:d,subLabel:「郵遞區號 ${getPostalOf(...)}」}))`（subLabel 顯示 郵遞區號）；onChange `id||''` 餵回既有 `handleCity/handleDistrict`（維持級聯＋郵區自動帶出＋清空時 `''`→清郵區）；無縣市時鄉鎮 `disabled`、placeholder「請先選擇縣市」。全站使用處（DeliveryCard/CheckoutForm/AdminOrderCheckout/AdminOrderForm/ShipDialog/StoresTab）一次生效。
- **店家收件人欄位（migration `20260921000008_stores_recipient.sql` 已套用遠端）**：`stores` 新增 `recipient text`（收件人姓名）。`StoresTab` 對話框：移除獨立「電話」欄（與 `ShippingAddressFields` 內電話重複），配送地址區塊改為唯一來源（收件人/電話/郵區/縣市/鄉鎮/地址），hidden inputs 補 `recipient/phone`（`address.recipient`→stores.recipient、`address.phone`→stores.phone），`useStoresController.handleStoreSubmit` 讀取寫入；桌面列表「地址」欄顯示「收件人：X ・ 電話」＋完整地址（郵區+縣市+鄉鎮+詳細）、行動卡片同。**「套用店家最新地址」帶收件人/電話**：`AdminOrderCheckout`（`recipient: store.recipient||store.name`、`phone: store.phone`，query 補 `phone,recipient`）、`CheckoutForm`（同，`StoreInfoWithAddress` 介面＋query 補）、`useShipDelivery.applyStoreAddressFromStores`（`StoreWithAddress` 加 `phone/recipient`，address 帶 `recipient: store.recipient||store.name`、`phone: store.phone`）＋`ShippingPool` stores query 補欄位、`useOrderFormQueries` order.stores 與 storeInfo select 補 `recipient`。`useAdminOrderFormController` 維持既有「名稱/電話由操作者填寫」語意不動。
- **types.ts 已重新產生**（`npm run supabase:types`，含 stores.recipient；⚠️ Windows 下 CLI 產 UTF-16LE+BOM，已用 PowerShell 轉回 UTF-8 no BOM 否則 ESLint 報 binary）。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（既有 warnings 不變）、`npm run build` 通過。

## 近期變更（後台結帳頁補配送資訊，2026-09-21）：後台結帳頁原本完全沒有配送欄位與傳參（Phase D 只做了門市 `CheckoutForm`）。現補上：`AdminOrderCheckout` 的 store query 加 `postal_code/city/district/address/default_delivery_method_id`，`useDeliveryMethods()` 取方法清單，`useRef` 首次載入套用店家預設方式＋店家最新地址（僅一次、空地址才預填，行為同 `useAdminOrderFormController`）；`useCreateOrder`（pending 模式）戴入 `deliveryMethod/shippingAddress`，shipped 模式 `create_order_with_sales_note` 加傳 `p_delivery_method_id/p_shipping_fee/p_shipping_address`（未選方式完全維持舊行為）。`OrderReviewPanel` 新增 optional 配送 props（defaultFee 0）+「**配送摘要＋編輯**」：預設只顯示一列摘要（Truck 圖示＋方式名＋地址一行，`truncate`），點「編輯」才展開 `DeliveryCard`（收合/展開切換），不展開就不佔版面（配合「縮小」需求）；總額區改為商品金額／運費／總計三列（總計＝totalAmount+deliveryFee）。僅 `AdminOrderCheckout` 使用，props 全 optional 不破壞其他呼叫端。驗證：`npm run typecheck` 0 errors、`npm run lint` 0 errors（66 warnings 皆既有）、`npm run build` 通過。

## 近期變更（後台訂單表單配送資訊可展開/收合，2026-09-21）

`AdminOrderForm`（含 controller）把「配送資訊」加進面板切換系統，仿既有 `activePanel` 模式：`DeliveryCard` 新增 optional `activePanel/onTogglePanel/collapsed` props（點標題展開/收合、收合時只剩標題列＋Chevron）；`PanelState` 加 `'delivery'`（`OrderItemsPanel.tsx`）、controller `activePanel` state 型別同步加。桌面 lg+ 五種分支──`null`（預設平衡）、`information`（訂單資訊展開＋配送收合標題）、**`delivery`（新：配送資訊展開＋訂單資訊收合標題，右側訂單項目＋商品選擇）**、`items`（訂單＋配送都收合標題，商品選擇右側收合）、`products`（左側只剩訂單資訊＋配送資訊標題、訂單項目填滿剩餘左高，商品選擇右側寬）。**商品選擇被選取時左右加大、左側訂單/配送只剩標題、訂單項目恆顯示標題**。行動版不變。其他呼叫端（CheckoutForm/OrderReviewPanel）未傳新 props，行為不受影響。驗證：`npm run typecheck` 0 errors、`npm run lint` 0 errors（66 warnings 皆既有）、`npm run build` 通過。

## 近期變更（物流系統重構 Phase D：門市結帳＋分享含運，2026-09-21）

- **Phase D-1 ✅ 門市結帳選方式＋套用店家預設（`src/components/order/CheckoutForm.tsx`＋`src/hooks/useCreateOrder.ts`）**：`CheckoutForm` 重寫——以 queryKey `["store-info", storeId]` 讀自家 stores（含 `default_delivery_method_id/postal_code/city/district/address`），`useEffect` 首次載入套用店家預設方式到 `deliveryMethodId` state；渲染共用 `DeliveryCard`（方式下拉＋收件地址＋「套用店家最新地址」）；總額區顯示商品金額／運費／總計（含 MobileFooter）。`useCreateOrder` 新增 optional `deliveryMethod?/shippingAddress?` 參數：`orders.insert` 帶 `delivery_method_id/delivery_method_title/delivery_method_code/shipping_fee`（＝method.price，nullable）＋`shipping_address`（空值存 null）；return 增 `shippingFee`/`grandTotal`。三呼叫端相容（`Checkout.tsx`/`AdminOrderCheckout.tsx`/`OrderComposer.tsx` 皆 optional 不破壞）。
- **Phase D-2 ✅ 總額含運費（列表＋分享/列印/匯出）**：
  - `orderListUtils.ts`：`getOrderTotal(items, shippingFee?)` 加 `shippingFee || 0`；已更新呼叫端 `OrderTableView`/`OrdersTableView`/`OrdersCardView`（prop 型別改 `(items, shippingFee?) => number`、傳 `order.shipping_fee`）、`StoreOrderList`（本地 fn＋select 補 `shipping_fee`）、`useOrdersList`（admin select 補 `shipping_fee`）、`useOrderListDerived`（total_amount 排序傳 shipping_fee）。
  - `SharedReceiptExport`：`SharedReceiptProps` 新增 optional `shippingFee?/deliveryMethodTitle?`；`LastPageSummary` 秀「配送方式」列＋「運費」列（`canShowPrice && fee>0`）＋「總金額＝totalAmount+fee」；`exportDocExcel` 亦加 `shippingFee?/deliveryMethodTitle?`（Excel 相應欄位）。三分享頁 `SharedOrder/SharedSales/SharedConsignment` 介面補 `shipping_fee?/delivery_method_title?` 並傳入（printMode＋webPreview 兩處）。
- **Phase D-3 ✅ 月結 UI 以成本**：C-6 已完成（`EntryShippingFields` 成本欄、`list_settleable_shipments`、`ShippingSettlementsPage`「以物流成本結算」），本 Phase 無新增。
- **驗證**：`npm run typecheck`（0 errors）、`npm run lint`（0 errors，警告皆既有）、`npm run build` 通過。
- **剩餘（待做）**：無——Phase A~D **全部完成**（物流系統重構收尾）。見下方「物流系統重構（Phase A–D 計畫）」段落。

## 近期變更（物流系統重構 Phase C：後台 UI，2026-09-21）

- **Phase C-2 ✅ `/admin/delivery-methods`（`src/pages/admin/DeliveryMethodsPage.tsx`，路由已註冊＋側欄「配送方式」）**：配送方式管理頁——物流/送貨/自取分群顯示、price/cost 雙欄、物流公司下拉（僅 `suppliers.is_logistics_company`）、追蹤網址模板（純文字「（以 tracking_number 佔位符替換）」，勿在 JSX text 用 `{}` 大括號）；建置/編輯/停用走 `delivery_methods` 表（RLS admin 管理）。`DeliveryMethodOption`（`src/components/shipping/DeliveryMethodPicker.tsx`）已含 `is_active/sort_order/supplier_id/tracking_url_template/fee_payment`。
- **Phase C-1 ✅ 共用元件**：`src/utils/taiwanAddress.ts`（全台 368 區郵區資料、`getTaiwanCities/getDistrictsOfCity/getPostalOf`）、`src/components/shipping/DeliveryMethodPicker.tsx`（`useDeliveryMethods()` 加 `includeInactive`、`DeliveryMethodPicker` 支援 `allowNone`、「__none__」→null）、`src/components/shipping/ShippingAddressFields.tsx`（`ShippingAddressValue`＋`isEmptyShippingAddress`，級聯自動帶郵區）。
- **Phase C-3 ✅ AdminOrderForm 配送卡片**：`src/components/shipping/DeliveryCard.tsx`（方式下拉＋收件地址＋「套用店家最新地址」），已渲染於 AdminOrderForm（桌面 information/items/products 左欄＋行動端），僅 `orderType==='sales'` 顯示。接線詳情：
  - `useOrderFormQueries.ts`：`stores` embed 與 `storeInfo` select 補 `postal_code/city/district/address`。
  - `useAdminOrderFormController.ts`：`deliveryMethodId`/`shippingAddress` state＋`useDeliveryMethods()`＋`applyStoreAddress`（`appliedStoreAddressKeyRef` 每家一次，空地址才預填）；傳給 mutations 與 stateSync。
  - `useOrderFormStateSync.ts`：edit mode 從 `order.delivery_method_id`＋`order.shipping_address` 同步。
  - `useOrderFormMutations.ts`：`getDeliveryDetails()`/`deliverySnapshot()`——createPending 的 `orders.insert` 帶 `delivery_method_id/title/code/shipping_address`；updateOrder（RPC `update_order_with_items` **不含配送欄位**）於 RPC 成功後另以 `supabase.from('orders').update(snap)`；`create_order_with_sales_note`/`direct_ship_order` 傳 `p_delivery_method_id/p_shipping_address`（`p_shipping_fee: undefined` 讓 RPC 回退 method.price）。
  - `DirectShipDialog` 新增配送摘要（方式＋地址一行）唯讀顯示。
- **Phase C-4 ✅ ship_from_pool 動態包裹列（migration `20260921000006` 已套用遠端）**：
  - **新 RPC 簽名尾端加 `p_delivery_overrides jsonb DEFAULT NULL`**（12 參數，舊 9/11 參數版本保留向後相容）——`{ "<store_id>": { "address": {...}, "parcels": [{ delivery_method_id, fee, cost, tracking_company, tracking_number, tracking_url, note }] } }`。同一店家（＝1 張銷貨單）**拆多包共享地址**（地址寫入 `sales_notes.shipping_address` 僅一次）；逐包 `upsert_shipment`；包裹未選方式（方法 id null）該包跳過；純寄賣店家（無銷貨單、走 layer）僅取首包方式/fee/address 帶入 `create_consignment_shipment_layer`。
  - 前端：`useShipDelivery` hook（`src/pages/admin/shippingPool/useShipDelivery.ts`，per-store deliveryMap/address/parcels、`ensureStores`/`applyStoreAddressFromStores`（僅首次 per store）/`setParcelCount`/`updateParcel`）＋`ShipDialog` 每店家配送卡片（ShippingAddressFields＋「套用店家最新地址」＋寄送件數→動態包裹列：方式/實收/成本/追蹤公司/追蹤號碼）＋`buildDeliveryOverrides()`（`useShippingPoolMutations.ts`）組 RPC payload。
- **Phase C-5 ✅ 三層詳情 dialogs 包裹管理＋Stores 地址/預設方式**：
  - **共用 `useShipments` hook（`src/hooks/useShipments.ts`）**：`useShipments(docType, docId)` 依 `shipments` 表抓包裹清單（`doc_type`+`doc_id`，RLS authenticated SELECT）；`useShipmentMutations(docType, docId)` 包 `upsert_shipment`/`delete_shipment` RPC（逐包帶 `delivery_method_id/fee/cost/fee_payment/tracking_company/tracking_number/tracking_url/shipped_at/note`，成功後 invalidate shipments＋`admin-orders`/`admin-sales-notes`/`store-sales-notes`/`consignment-orders`）。
  - **共用 `ParcelManager`（`src/components/shipping/ParcelManager.tsx`）**：依 docType/docId 列出包裹，每包「DeliveryMethodPicker＋實收/cost＋追蹤公司/號碼/網址＋備註」＋刪除；`editable={false}` 時唯讀（方法名＋費用＋追蹤單行）；「新增包裹」開空白包；「儲存」僅在 dirty 時顯示（`fromDraft` 逐欄比對）；未存包可整包刪除。已插入三層詳情：
    - `OrderDetailDialog`（`src/components/order/OrderDetailDialog.tsx`）：新增 `parcelEditable` prop（預設 false）；`getTotalAmount` 加 `shipping_fee`；渲染配送/運費列＋`ParcelManager docType="order"`。`OrderListPage`/`ReferenceViewer`（accounting）傳 `parcelEditable`，store 端不傳。
    - `SalesNoteDetailDialog`（`src/components/sales/SalesNoteDetailDialog.tsx`）：`SalesNoteDetail` 型別補 `shipping_fee/shipping_cost/delivery_method_id/title/code/shipping_address`；`totalAmount` 加 `shipping_fee`；新增 `parcelEditable` prop；配送/包裹區塊 `<ParcelManager docType="sales_note">`。Admin `SalesNotes.tsx` 傳 `parcelEditable={!isRep}`。
    - 寄賣 `OrderDetailDialog`（`src/pages/admin/consignment/components/OrderDetailDialog.tsx`）：渲染 `<ParcelManager docType="consignment_order" editable={!isSupplier}>`（send_to_store 可管理包裹、receive 唯讀）。
  - **Stores 編輯地址＋預設方式（`stories/StoresTab.tsx`＋`useStoresController.ts`）**：店鋪 dialog 新增「配送地址」（`ShippingAddressFields` 級聯郵區）＋「預設配送方式」（`DeliveryMethodPicker allowNone`）；`useEffect` 依 `editingStore`/dialog 開關同步；hidden inputs 送 `street_address/postal_code/city/district/default_delivery_method_id`；`handleStoreSubmit` 讀取寫入 stores 表（`updateStoreMutation`/`createStoreMutation`）。既有 `address` 欄為「詳細地址」快照不變。
- **Phase C-6 ✅ 運費結帳改以 shipments.cost＋包裹清單（migration `20260921000007_list_settleable_shipments.sql` 已套用遠端）**：
  - **新 RPC `list_settleable_shipments(p_supplier_id)`**（SECURITY DEFINER，僅 admin）——列出該物流公司（`suppliers.is_logistics_company`）**未結算**的月結包裹（`shipments.fee_payment='monthly'`、該方法所屬配送方式綁定該物流商、且未被任何已結算期間涵蓋）；回傳欄位 `id/doc_type/doc_id/doc_code/method_id/method_title/method_code/fee/cost/fee_payment/tracking_company/tracking_number/tracking_url/shipped_at/note`（`doc_code` 依 doc_type join orders/sales_notes/consignment_orders 取 code）。
  - 前端 `useEntryShippingQueries.ts`：`shippingSuppliers` 改取 `suppliers.is_logistics_company=true`；`shipSettleItems` 改呼叫 RPC `list_settleable_shipments` 並 map 為新 `ShipItem`（`amount=cost`）。`EntryFormTypes.ts`：`ShipItem`＝`{ id, docType?, docCode, methodTitle, trackingCompany?, trackingNumber?, shippedAt?, cost, fee?, amount }`；`ShippingSettlementSubmission.orderItemIds→shipmentIds`；`EntryPrefill.shipping.orderItemIds→shipmentIds`。`useEntryFormController.ts`：init 自 `prefill?.shipping?.shipmentIds`、submit payload 送 `shipmentIds`。`useShippingSettlement.ts`：payload `{ shipmentIds, ... }`、RPC 送 `p_shipment_ids`、回傳型別 `{ period_id, entry_id, total_amount, shipment_count }`（toast「已結算運費 N 包」）。
  - `EntryShippingFields.tsx` 表格改為包裹清單欄位：單據 code／配送方式／出貨日期／追蹤號碼／成本（勾選＝全選/取消全選），「已選 N 包運費，結算金額（系統計算）」。
  - `ShippingSettlementsPage.tsx`：refs 查詢改 `reference_type='shipment'`（不再 order），code 依 shipments.doc_type 分別 join orders/sales_notes/consignment_orders 解析；「涵蓋訂單→涵蓋包裹」、空狀態文案改「請先將配送方式設為月結並於出貨時建立包裹」。
- **驗證**：`npm run typecheck` 0 errors、`npm run lint` 0 errors（既有 warnings）、`npm run build` 通過；migration 已套用遠端（`pg_get_function_arguments` 確認 3 版簽名共存）。
- **剩餘 Phase C（待做）**：無（C-1~C-6 全部完成）。**Phase D（✅ 全部完成）**：依上方「Phase D」段落（門市結帳選方式＋套用店家預設、分享/列印/匯出總額含運、月結 UI 以成本）。

- **設計定案**：運費/model 從「`products.item_type='shipping'` 偽商品」重構為「配送方式獨立資料表」、包裹級紀錄；全站三層單據（訂單/銷貨單/寄賣單）整合配送方式＋價格＋收件地址。詳細設計見下方「物流系統重構（Phase A–D）」段落。
- **Migration `20260921000001_delivery_methods_schema.sql`（已套用遠端）**：
  - 新表 **`delivery_methods`**：`code/name/type(delivery|logistics|pickup)/supplier_id/price(客人實收)/cost(物流成本，可≠price)/fee_payment(one_time|monthly)/tracking_url_template/is_default/is_active/sort_order`；RLS＝admin 管理、authenticated SELECT。含 CHECK「logistics 必綁 supplier_id」。
  - 新表 **`shipments`**：包裹＝運費唯一收支單位，`doc_type(order|sales_note|consignment_order)+doc_id` 多型、delivery_method 快照（id/title/code）、`fee`(預設帶 method.price 可逐包改)、`cost`(預設帶 method.cost)、`tracking_company/number/url`、`shipped_at/note`；RLS 同上。
  - `suppliers.is_logistics_company`（物流公司身分牌）；`stores.default_delivery_method_id`＋`postal_code/city/district`。
  - 單據層（orders/sales_notes/consignment_orders）：`delivery_method_id/title/code`＋`shipping_fee`(＝SUM(shipments.fee))＋`shipping_cost`(＝SUM(shipments.cost))＋`shipping_address jsonb {recipient,phone,postal_code,city,district,address}`。**地址為快照**，預填自 stores、不自動回填。
  - seed `DELIVERY_DEFAULT`（送貨，type=delivery、price/cost 0、is_default）。
  - **既有資料回填**：12 個運費變體→12 筆 logistics 方法（code=SKU、price=cost=變體批發價），原 shipping 商品 `is_hidden=true` 保留歷史；自動建「郵局」物流供應商（`is_logistics_company=true`）；既有 97 訂單/93 銷貨單/2 寄賣單補「送貨」方式＋地址自門市快照。
- **Migration `20260921000002_consolidate_logistics_suppliers.sql`（已套用遠端）**：修復首版轉入誤「每變體一間供應商」，整併為 **1 間「郵局」**、12 支方法重新指向、刪除 11 間無參照孤兒。
- ⚠️ 教訓：取代「偽商品」的第一版 DO loop 是**逐變體**建供應商；已改為「逐產品解析供應商，變體為內層 loop」；若日後重跑此段，請確認整產品共用一間。
- **驗證（遠端）**：delivery_methods=13（1 送貨+12 物流）、logistics supplier=1（郵局）、orders_with_delivery=97/sales_notes=93/consignment=2、shipments=0（原無運費品項訂單）。
- ⚠️ 現況：Phase B DB 層（migration 4–6）已完成——四支出貨 RPC 已加配送參數、`register_shipping_settlement` 改以 shipments.cost 彙總並 join delivery_methods（reference_type='shipment'）、三分享 RPC 回傳 delivery＋shipments＋含運欄位。**Phase C-1~6 全部完成**（配送方式管理頁/共用元件/AdminOrderForm 配送卡片/ShipDialog 動態包裹列/詳情 dialogs 包裹管理/Stores 地址編輯/運費結帳轉 shipments.cost）；**Phase D 全部完成**（門市結帳選方式＋套用店家預設、分享/列印/匯出總額含運、月結 UI 以成本）。

### 物流系統重構（Phase A–D 計畫）
- **Phase A（✅ DB/schema/回填）**：見上。
- **Phase B（✅ DB 層，migration `20260921000003~06`）**：
  - `upsert_shipment`/`delete_shipment`＋`_recompute_doc_shipping`（內部 helper，寫包裹後自動 SUM fee/cost 回寫單據層並補方法快照，REVOKE 僅 postgres）。
  - 四支出貨 RPC 新增 `p_delivery_method_id/p_shipping_fee/p_shipping_address`（尾端 DEFAULT）並**於 `20260921000011` 收斂為單一最長簽名**（⚠️ 勿與舊短簽名並存，會造成 PostgREST PGRST203，詳見上方「配送參數 RPC 收斂單一簽名」）：`create_consignment_shipment_layer`(9)+`create_order_with_sales_note`(10)+`direct_ship_order`(10)+`ship_from_pool`(11→12，Phase C-4 再加 `p_delivery_overrides`)。寄賣分支轉 layer（每寄賣單 1 包）、一般分支每銷貨單 1 包＋$upsert_shipment；傳入時回寫單據層快照與 shipping_address（`COALESCE` 保留既有值）；未傳方式完全維持舊行為。**Phase C-4（migration `20260921000006`）另給 `ship_from_pool` 加了 12 參數版 `p_delivery_overrides jsonb DEFAULT NULL`**（per-store parcels，見上方 Phase C-4）。
  - `register_shipping_settlement` 重寫：`p_order_item_ids` 語意改為 **`p_shipment_ids`（包裹 id）**，以 `SUM(shipments.cost)` 結給物流公司、join `delivery_methods` 驗證 supplier、reference_type='shipment' 防重複結算；**前端已於 Phase C-6 跟上（送 shipmentIds）**。
  - 三分享 RPC 回傳單據層 `delivery_method_id/title/code/shipping_fee/shipping_cost/shipping_address`＋`shipments[]`（每包 id/delivery_method 快照/fee/cost/fee_payment/tracking/shipped_at/note）。
  - ⚠️ 教訓：**`shipments` 表實際欄位是 `delivery_method_id/title/code` 三欄分存（連同迁移 3 一致），不是 jsonb `delivery_method` 快照**。分享 RPC 與月結 RPC 首版誤用 `sh.delivery_method->>'id'`，執行時才 42703；已以 `20260921000006_fix_delivery_method_columns` 修正。日後讀取包裹方式一律用 `delivery_method_id/title/code` 欄位。
- **Phase C（✅ C-1~C-6 全部完成）**：後台 `/admin/delivery-methods`（配送方式管理頁：物流/送貨/自取群組、price/cost 雙欄、物流公司下拉、追蹤網址模板）；`AdminOrderForm`/`OrderComposer` 配送卡片（方式下拉＋收件人/電話/縣市/鄉鎮/郵區/地址＋「套用店家最新地址」）；`ShipDialog`「寄送件數→動態包裹列」＋每包 方式/實收/成本/追蹤；三層詳情 dialogs 包裹管理；`Stores` 編輯地址＋預設方式；`useShippingSettlement`/`EntryForm`/`EntryShippingFields` 「運費結帳」改以 shipments.cost＋包裹清單（`list_settleable_shipments` RPC）。**重複性功能組件化**：共用 `ShippingAddressFields`、`DeliveryMethodPicker`、`src/utils/taiwanAddress.ts`（內建全台 368 區郵區資料、regex 整串解析、分段級聯、郵區自動帶出）。
- **Phase D（✅ 全部完成）**：門市結帳選方式＋套用店家預設（`CheckoutForm`/`useCreateOrder`）；分享/列印/匯出總額含運費（`getOrderTotal`、`SharedReceiptExport`、`exportDocExcel`）；月結 UI 以成本（C-6 已含）。**物流系統重構 Phase A~D 全數完成**。

## 近期變更（訂單列表桌面批次動作修復 + 缺貨排除需求，2026-09-20）

- **桌面漏掉商品視圖批次動作（`BatchActionBar.tsx`）**：原本「加入出貨池／轉採購單／標記停產/取消」的 `viewMode === 'items'` 區塊只寫在**行動端底欄**，桌面浮動選單無此段 → 桌面上勾選品項後看不到任何動作。已於桌面選單補上同區塊（`rounded-full shadow-inner` 樣式），並把選單容器改 `max-w-[95vw] flex-wrap justify-center` 避免按鈕溢出。
- **缺貨(`out_of_stock`) 排除（全管線一致化，`useOrderListDerived.ts` 等）**：`out_of_stock` 原為有定義狀態卻無排除邏輯。現比照 `cancelled`/`discontinued`：① `allPendingItems` 與 `aggregatedItems` 需求計算排除（**訂單總攬不再把缺貨品項記入需求**）；② `allCancelledItems` 納入並可「還原待出貨」（`ItemTableView` 徽章改三態：`已取消`／`缺貨`／`已停售`）；③ `poItemsFromOrders`/`poItemsSource` 排除（缺貨品項不進採購單）；④ 收尾判斷 `getOrderShipmentStatus`（`orderListUtils`/`OrderTableView`）、`syncOrdersMutation`、directShip 倉庫帶入等處一致視 `out_of_stock` 為已處理。⚠️ 目前全站仍**無 UI 可把品項設為 `out_of_stock`**（`cancelItemsMutation` 僅支援 `cancelled`/`waiting`），此為相容未來資料的防呆。
- **驗證**：`npm run typecheck`（0 errors）、`npm run lint`（0 errors，62 warnings 既有）、`npm run build` 通過。

## 近期變更（採購單詳情對話框更名 `PurchaseOrderDetailDialog` + 品項搜尋，2026-09-20）

- **更名（`src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx` → `PurchaseOrderDetailDialog.tsx`）**：為避免與訂單系統 `OrderDetailDialog`（`src/components/order/OrderDetailDialog.tsx`）及寄賣頁 `OrderDetailDialog`（`src/pages/admin/consignment/components/OrderDetailDialog.tsx`）同名混淆，元件／Props 一併更名為 `PurchaseOrderDetailDialog`／`PurchaseOrderDetailDialogProps`（`git mv` 保留歷史，僅 `PurchaseOrdersPage.tsx` L8/L337 引用，UI 行為不變）。
- **品項表格搜尋（`PurchaseOrderDetailDialog.tsx`）**：頂部新增搜尋列（L447 input、L456「共 N 項符合」）—— trim＋toLowerCase 比對「產品名／變體名／SKU／產品 code／`vendor_product_id`／`vendor_product_name`／來源訂單字串（`sourceOrderMap[id] || id.slice(0,8)`）」。`visibleItems` memo（L138，`isFiltering` 時比對、否則回全量；`getMappingKey` 已前移至 L136 避免閉包 TDZ）驅動表格（`SortableContext` L499、`visibleItems.map` L501/L518）與空狀態分流 L509「查無符合的品項」／L526「目前無任何品項」；**全量資料不受影響**——L306/L325 `localItems.map`（匯出/存檔組裝）與 `liveTotal`（L126）維持全量；`isFiltering` 時停用拖曳排序（L175/L187）。

## 近期變更（編輯訂單 Maximum update depth 修復，2026-09-16）

- **根因**：`AdminOrderForm.tsx` 以行內箭頭 `onToggleStatus: () => c.toggleStatusMutation.mutate()` 傳給 `useAdminOrderFormHeader`，每次 render 皆產生**新函數 identity**；該 hook 的 `useLayoutEffect` deps 又含 `onToggleStatus`/`navigate`/`navigateBack` → 每次 render effect 重跑並 `setPageHeader(新物件)` → `PageHeaderProvider` 更新 → 所有 `usePageHeader` consumer（含 AppLayoutContent 與 AdminOrderForm 自身）重 render → 新箭頭 → effect 重跑 → **無限迴圈**（報錯位置在 SidebarNav/AppLayout tree，實為 context 迴圈表象）。
- **修法（`useAdminOrderFormHeader.tsx`，僅此一檔）**：回呼一律存進 `callbacksRef`（每 render 更新 ref.current，不放入 deps），effect 內自 ref 取值呼叫；dep array 改只留純值（`setPageHeader`/`isEditMode`/`orderIdVal`/`orderCodeVal`/`orderStatusVal`/`orderConsignmentMode`/`displayStoreName`/`orderType`/`isTogglePending`）。此模式對未來任何「呼叫端傳入不穩定回呼」皆免疫。`ProductFormPage` 的 setPageHeader effect 因 `handlePreview`/`initialData` 皆已 useCallback/useMemo 穩定，無此問題。

## 近期變更（訂單/出貨池/銷售-寄賣數量關係守門補強，2026-09-16）

- **Migration `20260916000004_strengthen_quantity_guards.sql`（已套用遠端）**：為「訂單 ↔ 出貨池 ↔ 銷售單/寄賣單」間 4 支轉換 RPC 補上**二次數量驗證**（全部只 REPLACE body、簽名不變，前端零改動）：
  - **`ship_from_pool`**：每項出貨前檢查 `pool.quantity ≤ order_items.quantity - shipped_quantity`，超賣直接 `RAISE EXCEPTION '出貨池品項 % 欲出貨 % 件，但訂單尚未出貨僅剩 % 件…'`（修補原本完全信賴 pool 建池正確、無二次驗證的洞）。
  - **`create_consignment_shipment`**：重用既有來源 `order_items`（`v_oi_id IS NOT NULL` 分支）時，檢查 `v_oi_shipped + v_ship_qty > v_oi_qty` 即 RAISE（防止寄賣重複/超量出貨）；`order_item_id` NULL 的新建分支不受影響。
  - **`create_consignment_shipment_layer`**：加低成本 sanity bound——傳入出貨量 `v_qty > v_oi.quantity`（order_item 宣告總量）即 RAISE。⚠️ 本層**刻意不讀 `shipped_quantity`**：三支呼叫端（ship_from_pool/direct_ship/create_order）都在呼叫前已先更新 shipped_quantity，讀剩餘量會誤判；剩餘量驗證由呼叫端負責。
  - **`update_order_with_items`**：新增兩組不依賴收款狀態的守門（`{ok:false, reason}` 格式，前端 `useOrderFormMutations` 已會解析 toast）——① 刪除既有品項若 `shipped_quantity > 0` 一律擋下（原本靠 `sales_note_items` FK 拋模糊錯誤）；② 既有品項新 `quantity` 不可低於 `shipped_quantity`（防止負剩餘）。
- **驗證（遠端 BEGIN…ROLLBACK）**：`ship_from_pool` 故意塞超額 pool 列→正確 RAISE 且交易回滾、無殘留；正常剩餘量出貨成功；`update_order_with_items` 改量/刪除已出貨品項皆回 `{ok:false, reason}`。

## 近期變更（直轉銷售單清出貨池 + 回補殘留修復，2026-09-16）

- **根因**：`direct_ship_order` 一般分支只把「剩餘未出貨量」全寫進銷貨單，**不曾 `DELETE FROM shipping_pool`**（僅寄賣分支經 layer 清池）→ 有出貨池品項的訂單直轉銷售單後，池內殘留同一品項（STALE 列）。後續 `delete_sales_note`／`correct_sales_note` 回補池採「累加」（`pool_qty + 退回量`）→ 疊上殘留列 ⇒ **出貨池數量翻倍（×2）**（OD26091600001 已出現此情況：池 qty 2 vs 訂單 qty 1、pool 4 vs qty 2 等）。另有 `OD26091400012`：兩池列各 8、商品 qty 5，總池量 16 遠超剩餘 5。
- **Migration `20260916000005_fix_direct_ship_pool_cleanup.sql`（已套用遠端）**：三修並行，前端零改動：
  - **`direct_ship_order`**：寄賣＋一般兩分支，逐項 `UPDATE shipped` 後立即 `DELETE FROM shipping_pool WHERE order_item_id = ...`（維持「已出貨 ⇒ 不在出貨池」不變式，與 `ship_from_pool`／`create_consignment_shipment_layer` 一致）。
  - **`delete_sales_note` / `correct_sales_note`**（移除分支）：回補後加「上限防呆」——回補後剩餘量 ≤ 0 → 刪除殘留列；> 0 但 pool 超過剩餘量 → 截斷至剩餘量。覆蓋合法累加（同 item 多單正確）與殘留超量（stale + 累加 = ×2）兩種路徑。
  - **既有資料修復**（order_item 級重建，非列級）：① `remaining <= 0` 的池列全部刪除（68→22）；② 多列且 `SUM(pool) > remaining` 時，先刪該 item 全部列，再重建**單列 = 剩餘量**（沿用最早列之 store/warehouse/sort_order），正確修復 OD26091400012（池 16→5）與 OD26091600001（46 列 ×2 全清）。
- **遠端驗證**：修復後 `shipping_pool` 全 22 列，`rows_for_fully_shipped = 0`、`over_remaining = 0`；3 支函式守門均已 live（`direct_ship_order` 清池✓、`delete_sales_note`/`correct_sales_note` 上限防呆✓）。

## 近期變更（決定性分享 token + 寄賣單號碼依 shipped_at，2026-09-16）

- **決定性分享 token（migration `20260916000002_share_token_deterministic.sql`，已套用遠端）**：`sales_notes`＋`consignment_orders` 的分享 `access_token` 改為「由單號 code 決定性推導」——新表 `public.app_secrets`（key/value，RLS 僅 admin policy `app_secrets_admin_all`）＋seed `share_token_v1`（`encode(gen_random_bytes(32),'hex')`）；新 RPC **`share_token_for_code(p_code TEXT) RETURNS UUID`**（SECURITY DEFINER，`SET search_path = public`，revoke public/anon、grant authenticated）＝ `extensions.hmac(p_code::bytea, secret::bytea, 'sha256')` 前 16 bytes 組 UUID 8-4-4-4-12（⚠️ 需 schema-qualify `extensions.hmac`，pgcrypto 在 extensions schema，`search_path=public` 下裸 hmac 會 42883）。**驗證改 OR 條件**：(storage `access_token = p_token::UUID` **或** `share_token_for_code(code) = p_token::UUID`)——不回填既有資料、不覆寫 stored token，RPC 預生成的隨機回傳 token 仍有效、舊 QR 不失效；「刪除單號重用」時舊決定性連結會指到新單（使用者已知悉接受，見下方已知風險）。`get_shared_sales_note_details`／`get_shared_consignment_details`（SECURITY DEFINER）重發改用此 OR 驗證，前者 items 改依 `COALESCE(sni.sort_order,0), oi.sort_order, oi.created_at` 排序、後者回傳新增 `shipped_at`；`orders` 維持隨機永久 token 不動。pgcrypto 亦由本 migration `CREATE EXTENSION IF NOT EXISTS`。
- **寄賣單號碼改依出貨時間（migration `20260916000003_consignment_code_by_shipped_at.sql`，已套用遠端；產號於 `20260921000010` 改遞補制）**：`consignment_orders` 新增 **`shipped_at TIMESTAMPTZ`**；新 RPC **`next_consignment_code(p_shipped_at, p_store_id)`**（SECURITY DEFINER）產 **`CS{YYMM}{店碼}{0001}`**（YYMM 看出貨月份，fallback created_at/NOW；店碼取 `stores.code`，receive_from_supplier 或無碼時 fallback `'SP'`；流水 4 位）。⚠️ **流水採遞補制**（`20260921000010`）：以既有 `consignment_orders.code` 找「該店家該月份第一個空缺號碼」（同銷貨單），不再依賴 `system_sequences`。`trgfn_generate_consignment_code` 改 **BEFORE INSERT OR UPDATE OF status**：INSERT draft → 暫存碼 `CS-DRAFT-{id 前 8 碼}`（唯一性依 uuid 前 8 hex，且 BEFORE trigger 看得到 default 已套用產生的 id）；INSERT 非 draft → 正式碼；UPDATE draft→active 且 code 為 `CS-DRAFT-%`/NULL → 換正式碼（月份看 shipped_at）。
- **`create_consignment_shipment_layer` 改 canonical 6 參數**（drop 舊 3 參數 `(jsonb,uuid,uuid)`）：`(p_store_id uuid, p_created_by uuid, p_order_items jsonb, p_shipped_at timestamptz DEFAULT NULL, p_notes text DEFAULT NULL, p_warehouse_id uuid DEFAULT NULL)`——INSERT 帶 `shipped_at`、既有 draft 轉 active UPDATE 也帶；倉庫 fallback `COALESCE(p_warehouse_id,(SELECT id FROM warehouses WHERE code='own'))`。**三支呼叫端全部重發並串 `p_shipped_at`**：`ship_from_pool`（8 參數，保留遠端 audit_logs／整池 DELETE／ANY()-in 回滾／FOREACH 收斂 body，僅 layer call 改 5 參數 `(v_store_id,p_created_by,v_consignment_items,v_shipped_at,p_notes)`）、`direct_ship_order`（7 參數，consignment 分支 call 6 參數＋warehouse）、`create_order_with_sales_note`（7 參數，consignment 分支 call 6 參數）。`create_consignment_shipment` 重發：落地 `shipped_at=COALESCE(p_shipped_at,NOW())`＋activation UPDATE 帶上＋回傳加 `'code'`（修復原 `p_shipped_at` dead param、且補全「下單即出貨／出貨池」路徑的寄賣碼月份正確）。前端零改動（useConsignment 仍傳 `p_shipped_at: null`、分享按鈕用 stored token）。
- ⚠️ **已知風險（不法規避，2026-09-21 更新：寄賣單亦改遞補制）**：`sales_notes` code 採遞補制（`generate_sequential_code` NOT EXISTS 重用空缺序號）＋決定性 token ⇒ 刪掉一單再產生同號新單時，**持舊單決定性分享連結者會看到新單**（隨機 stored token 連結不受影響）。**2026-09-21 起 `consignment_orders` code 亦改遞補制**（`next_consignment_code`，見上方「寄賣單號改遞補制」段落），與 sales_notes 共享相同風險。使用者已於 2026-09-16 拍板接受此權衡（銷貨單）；若日後不可接受，需改回累加制或於決定性 token 中混入建立時間。

## 近期變更（銷貨單刪除 23505 修復，2026-09-16）

- **根因**：`correct_sales_note` 對**同一品項「先移除（Phase 1 寫 `sales_note_deletion` movement）再加回（Phase 2 寫 `sales_shipment`）」**同張銷貨單後，`delete_sales_note` 對該 `order_item_id` 又要 **INSERT 另一筆 `sales_note_deletion`**，撞上部分唯一索引 `idx_invmov_unique_deletion`（`(sales_note_id, order_item_id) WHERE source_type='sales_note_deletion' AND order_item_id IS NOT NULL`，migration `20260905000005` 定義）→ 23505、整支 RPC 交易回滾、單刪不掉。次級殘留：舊出貨路徑的 `sales_shipment` movement `order_item_id` 為 NULL，`correct_sales_note` Phase 1 只依 order_item_id 刪舊 shipment，刪不到這些 NULL 列（僅 ledger 歷史，不影響帳面）。
- **Migration `20260916000001_fix_sales_note_deletion_merge.sql`（已套用遠端）**：新增共用 **`public.upsert_sales_note_deletion_movement(p_sales_note_id, p_order_item_id, p_product_id, p_variant_id, p_warehouse_id, p_quantity, p_reference_code, p_created_by)`**（SECURITY DEFINER，`REVOKE ... FROM public, anon, authenticated`；**僅供 delete/correct 兩支內部呼叫，不開放直接執行**，避免任意加庫存）——若 `(sales_note_id, order_item_id)` 已有 `sales_note_deletion` 列則**累加（UPDATE `quantity_change`＋`balance_after`）**並**手動同步 `product_inventory.quantity`**（BEFORE INSERT trigger `trg_sync_inventory_on_movement` 只對 INSERT 生效，UPDATE 不會自動扣/加），否則照舊 INSERT（trigger 處理）。`delete_sales_note`（非寄賣分支）與 `correct_sales_note`（Phase 1 移除非寄賣分支）皆改呼叫此 helper，其餘 log 完全複製原 migration 不變。驗證：於遠端 `BEGIN...ROLLBACK` 內呼叫 `delete_sales_note` 成功回滾、品項 `shipped_quantity→0/waiting`、出貨池回補，無 23505。

## 近期變更（大型元件拆分 Phase 1–4：全站 16 支 ≥400 檔案已拆，2026-09-13）

分批把 55 支 ≥400 行的過大檔案拆成「型別檔＋queries/mutations hook＋子視圖元件＋薄殼」組合，全程 **UI 行為不變**；每批 `npm run typecheck`（0 errors）＋`npm run lint`（0 errors，59 warnings 皆既有）＋`npm run build` 通過。規則：薄殼不做型別 re-export；純型別檔／純元件檔不觸發 react-refresh 警告；拆分後子視圖自行持有原屬父元件的 state/effect/遞迴 renderer，行為保持一致。

- **`CatalogSidebar` 拆分（`src/components/products/catalog/`，818→244 薄殼，本批）**：新 `catalogSidebarTypes.ts`（CatalogSidebarProps＋4 section props＋`getFilterConfig`）、`sidebarPrimitives.tsx`（SectionHeader/SectionSkeleton/EmptyState）、`CategoryFilterSection`（持有 expandedCategories）、`BrandSeriesFilterSection`（持有 expandedBrands）、`DeviceModelFilterSection`（持有 modelSearch/expandedDeviceBrands/expandedDeviceSeries＋自動展開 effect＋deviceModelTree/deviceModelLookup/deviceBrandNameMap/總數 memo＋隱藏守門「`totalDeviceModelCount===0 && !modelSearch` 時 return null」，故殼不再需要 model 相關 memo）、`SpecFilterSection`（包既有 `AdvancedSpecFilters`）。4 importer（`ProductSelector`、store `Catalog.tsx`、`ProductsPage`、`OrderComposer`）完全不用改。
- **`SalesNoteCorrectDialog` 拆分（`src/components/sales/`，809→236 薄殼，本批）**：新 `salesNoteCorrectTypes.ts`（CorrectAddItem/CorrectNewItem/PoolItem/OrderItemCandidate/NoteReference/PriceChange/itemLabel）、`useSalesNoteCorrectQueries.ts`（`otherNoteRefs`/`poolItems`/`orderCandidates` 三支 query，從 dialog 抽出）、`CorrectPriceTable`（改價表，`onPriceEdit` 由殼傳 setter 邏輯）、`CorrectRemoveTable`（勾選移除）、`CorrectAddTable`（出貨池＋訂單未出貨兩區塊）、`CorrectNewItemSection`（內含 newItemDraft/options/handleAddNewItem 處理，`products` 以 `any[]` 傳入）、`CorrectSummary`（確認區）。僅 `SalesNoteDetailDialog.tsx:12` import，不受影響。
- 先期完成：`EntryForm`(1684)、`OrderListPage`(1363)、`AdminOrderForm`(1368)、`Stores`(1049)、consignment `OrderDetailDialog`(914)、repair `detail.tsx`(903)、`DeviceBlockSection`(819)、`OrderItemsTable`(839)、`ShippingPool`(826，新目錄 `src/pages/admin/shippingPool/`)。過程中修復落網 importer：`useOrderFormMutations.ts` 改由 `@/components/order/orderItemsTypes` import `OrderItemRow`（原本誤 import `OrderItemsTable`）；`src/types/repair.ts` 改由 `deviceBlockTypes` import。
- **剩餘 53 支仍 ≥400**（`npm run` 掃描），薄殼門檻目標 <400：`Stores` 846、`VariantBatchCreator` 825、`Reps` 777、`VariantManager` 772、`OrderListPage` 757、`SpecValueEditor` 756、`AdminOrderForm` 751、`VariantSection` 721、`RepCommissionPage` 720、`AcceptInvite` 688 等，續拆時仍以「型別/hook/子視圖/薄殼」手法並依上述位址慣例。

## 近期變更（維修收款＋維修單日期＋採購類型＋銷貨匯出＋寄賣雙視角＋變體名稱單一顯示，2026-09-12）

- **維修單收款（migration `20260912000001_repair_payment_status.sql`）**：`repair_orders` 新增 `payment_status`（`unpaid`/`paid` 預設 `unpaid`）；新 RPC `public.sync_repair_order_payment_status(p_repair_order_id)`（SECURITY DEFINER，revoke public/anon、grant authenticated）——計算「該維修單若有任一 `accounting_entries`（`type='income'`、`payment_status IN ('paid','partial')`，entry row `reference_type='repair_order'` 直接綁定 **或** `accounting_entry_references` 子表有該單據）→ `paid`」；`NULL` 直接 return。前端：`useAccounting.createEntryMutation` 收款後呼叫同步（並 invalidate `['repair_orders']`）；`delete_accounting_entry` RPC（`20260911000006`）收集 `v_repair_order_ids` 於回退後迴圈同步；維修單詳情（admin＋store）新增「登記收款」按鈕開 `EntryDialog`（`prefill.repair` 帶 `repairOrderId/repairCode/storeId/customerName/description`，`EntryForm` repair 模式寫 `reference_type='repair_order'`）＋列表（`RepairOrdersPage`/store index）每列顯示收款狀態 `PaymentStatusBadge`。
- **維修單日期（migration `20260912000002_repair_order_date.sql`）**：`repair_orders` 新增 `order_date DATE NOT NULL DEFAULT CURRENT_DATE`（單據日期）；admin/store「新增/編輯」表單日期輸入預設今天，卡片顯示 `單據日期` 與 `建立於`。⚠️ lint 慣例：字串中勿混入全形空格（`no-irregular-whitespace`）。
- **採購單類型（migration `20260912000003_purchase_orders_purpose.sql`）**：`purchase_orders` 新增 `purpose`（`general`/`repair_parts`）；`RepairPurchaseDialog` 建立時寫 `'repair_parts'`；`usePurchaseOrders` 新增 `PurchaseOrderFilters`（`supplierId/purpose/status/dateFrom/dateTo`，server-side `.eq/.gte/.lte`＋queryKey 依賴）；`PurchaseOrdersPage` 篩選列（供應商/類型/狀態/日期區間 Popover＋Calendar zhTW＋清除篩選）；`OrderListTab` 新增「類型」欄＋`getTypeBadge`（維修叫料 violet／一般進貨 secondary，mobile card badge）。
- **銷貨單勾選匯出（Excel）**：`SalesNoteListTable` 新增 `selectable/selectedIds/onSelectionChange`（桌面 checkbox 欄＋表頭全選、mobile card checkbox）；`AdminSalesNotes` 加選取工具列（已選 N 張／取消／匯出 Excel，`import("xlsx")` 動態載入）。格式：每單表頭列（銷貨單 code、店家、日期、類型）＋品項列（變體單一名、數量、單價、銷售金額=qty×unit_price）＋單張小計＋總計（N 張・共 X 件・總額）；檔名 `銷貨單匯出_yyyyMMdd.xlsx`、sheet「銷貨單」。
- **寄賣雙視角（`ConsignmentPage`）**：新增訂單視角／店家視角切換（searchParams `'view'` 持久化）；店家視角由共用元件 `src/components/consignment/ConsignmentGroupedView.tsx` 呈現（原 `StoreViewTab.tsx` 已刪除，見上方 2026-09-25／09-26 段落），`send_to_store` 依目標店家分組、`receive_from_supplier` 依供應商分組（`consignment_order_items` 以 `quantity×unit_price` 加總），組內列出各單 code/狀態/日期/總額＋查看。
- **變體名稱單一顯示（全站 UI）**：顯示品項名稱一律「**有變體只顯示變體名，無變體才回退產品名**」，不再「產品 - 變體」並陳；**商品卡容器（代表整支商品，如商品卡片/Dialog 標題）保留產品名**。已改：`OrderItemsTable`（`getComponentInfo` 已優先 variant，修正 compact 重複「name - variant」與詳情子列）、`ItemsTableView`、admin `orders/list` 的 `ItemTableView`/`AggregateTableView`/`AggregateCardsView`、store `SalesNotes`（寄賣回報表）、PO `PurchaseOrderDetailDialog`/`ReceivingTab`/`ImportFromOrdersDialog`、consignment `OrderDetailDialog`（明細＋編輯品項）/`ReportsTab`、`OrderReviewPanel`、`CartPanel`、`OrderGridProductPicker` badge、`useInventory`（name＝variant、specs 欄改顯示所屬產品名）、`ProductDetailDialog` 加入購物車 toast、accounting `ReferenceViewer`、分享/列印（`SharedReceiptExport` 原即 `variant ?? name`）、`SalesNoteDetailDialog` 原即 variant 優先、維修單零件名 already `part_name || variant?.name || product?.name`，皆無需更動。`npm run typecheck`＋`npm run lint`（0 errors，62 warnings 為既有）＋build 成功。

## 專案一句話

手機/3C 通路訂單管理系統：後台管理（商品/品牌/庫存/採購/會計/出貨）+ 門市端（訂單/銷貨/維修/收貨）+ 媒合市場，採「Supabase 後端 + IndexedDB 離線優先快取」架構。

## 近期變更（變體生成共用層 + 兩入口去重，2026-09-12）

- **共用邏輯層 `src/utils/variantGeneration.ts`（單一真值）**：`VariantBatchCreator`（`/admin/products` 批次建立變體）與 `CopyProductDialog`（複製產品 wizard）重複的「變體產生＋payload 組裝」全部抽到此模組，SKU／名稱／排序／payload 規則兩入口完全一致，**改動本檔＝兩入口同時生效**。核心 API：
  - 型別：`OptionValueInput`（含 `wholesalePrice/retailPrice/hexCode`）、`OptionGroupInput`、`SharedVariant`（＝舊 GeneratedVariant，含 `optionValueIds/_modelGroupId/_modelGroupType/_dbId`）、`ModelItem`、`ModelItemRef`、`VariantEditableField`、`OptionGroupRef`、`OptionGroupSuggestion`、`GenerateVariantCombo`。
  - 生成：`getActiveGroups`（name＋有值）、`cartesianProduct`、`generateVariantCombos(input)`（笛卡爾：第一群組 outer、型號 inner；無群組時直接 `modelItems` 逐一建）、`buildVariantPayload`（套價格／barcode，unified 覆寫逐值價）、`resolveVariantPrices`。
  - 輔助：`createOptionValue/createOptionGroup`、`skuPartOf/normalizeSegment/parseVariantNumber/isColorGroupName/isPredefinedColorValue`、`buildPriceMap`、`findLibraryColor`/`resolveColorValue`（色彩庫比對，name→code）、`getColorGroupValueIds/getActiveValueLabels`。
  - payload：`buildGroupsPayload`、`buildDedupedVariantsPayload`（SKU 去重）、`buildVariantOptionsPayload`、`buildModelRelationsPayload`（依是否有逐變體 `_modelGroupId` 自動切 per-variant／全變體×全部 refs 模式）、`estimateComboCount`。
- **共用元件 `src/components/products/variant/`（新目錄）**：`VariantOptionsEditor.tsx`（群組卡＋`ColorSelectField` 色彩庫＋每值 名稱/SKU值/批發/零售/色碼＋批量貼上 Dialog＋分類建議欄 props `suggestions/suggestionsLoading/onImportSuggestion/onImportAllSuggestions`，全受控 props `groups/onChange`）與 `VariantPreviewTable.tsx`（`variants: SharedVariant[]/onUpdate/onRemove/disablePrices` 可編輯表格，價格用 `parseFloat||0`）。
- **`VariantBatchCreator.tsx` 重構**：移除本機 `OptionValueInput/OptionGroupInput/GeneratedVariant/OptionValueTable/cartesianProduct/isColorGroupName/findLibraryColor` 及 payload 組裝，全部改引用共用層＋兩元件；**保留** VBC 特有的 suggestions 抓取、barcode 列表、預設價＋unified 提示、`mergeWithExisting`/`identityKey`（含 DB 快照 smart merge）、`diffSummary`（新增/更新/保留/孤立清單）、`batch_upsert_product_options` RPC、`checkVariantReferences`＋orphan 確認 Dialog、`delete_variant_if_safe` 清理。
- **`CopyProductDialog.tsx` 重構**：選項 Tab 改用 `VariantOptionsEditor`（升級為 VBC 全功能版：色彩庫＋每值批發/零售價＋批量貼上＋SKU 值輸入）；預覽 Tab 改用 `VariantPreviewTable`；可用變體計算改用共用 `estimateComboCount`；`buildVariants` 改用 `generateVariantCombos`＋`buildVariantPayload`；payload 組裝改用共用 builder。**行為守則**：`currentSignature` 與 `optionsChanged` 快照**含每值 `wholesalePrice/retailPrice`**（改價即標 preview stale／觸發重建，避免 RPC 舊價覆寫新編輯）；Copy 型號語意為「全部變體 × 全部 refs」（非逐變體），故 handleCopy 對 `variantsForRegen` 先 strip 掉 `_modelGroupId/_modelGroupType` 再送 `buildModelRelationsPayload`；`loadOriginalData` 的 value 補 `wholesalePrice/retailPrice=''` 對齊共用型別。
- ⚠️ 慣例：jsonb RPC payload 一律直接傳 JS 陣列（不 `JSON.stringify`）；`npm run typecheck`＋`npm run lint` 通過、build 成功。

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
npm run typecheck    # tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json
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
`StoreOrderList.tsx` 用 React Query 直接查 Supabase（orders + order_items + 產品資訊），非走快取。建立訂單走 `useCreateOrder` → insert orders → insert order_items；後台「下單即出貨」走 `create_order_with_sales_note` RPC。後台建立訂單可整單切換**寄賣模式**（`orders.consignment_mode`），出貨時由 `create_consignment_shipment_layer` 自動同步建立 send_to_store 寄賣單（`source_order_id` 回填）；寄賣出貨不開銷貨單，店家確認收貨並回報銷售、後台審核後才開立收款銷貨單（v1.3）。後台訂單列表（`src/pages/admin/orders/list/`）在「訂單」tab 的批次操作除「轉銷貨單」外，尚有「轉寄賣（草稿）」與「轉出貨池」（將整單剩餘品項加入 shipping_pool）。「所有訂單」會顯示 send_to_store 寄賣草稿為**真實來源訂單**：寄賣單一建立即同步建 `orders`（`source_type='consignment'`、`consignment_mode=true`、`status='pending'`）並回填 `consignment_orders.source_order_id`，品項同步建 `order_items` 並回填 `consignment_order_items.order_item_id`（前端 `useConsignment.ts` 的 create/add/remove/cancel 皆同步鏡像）；故草稿在 pending tab 可勾選、批次操作、編輯、商品模式可見數量，出貨時由 `create_consignment_shipment` 重用該來源訂單標 shipped；`receive_from_supplier` 不顯示於訂單列表。

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
- 關鍵 RPC：`ship_from_pool`、`direct_ship_order`、`create_order_with_sales_note`、`delete_sales_note`、`correct_sales_note`、`receive_purchase_items`、`adjust_inventory`、`recalculate_inventory`、`unlink_orders_from_purchase_order`、`remove_items_from_shipping_pool`、`process_sales_note_return`、`process_purchase_return`、`delete_order_if_unadopted`
- **出貨池批次回滾成訂單（2026-09-03）**：`remove_items_from_shipping_pool(p_pool_ids UUID[], p_created_by UUID) RETURNS JSONB`（SECURITY DEFINER）——批次把選取出貨池品項移回訂單（移出出貨池），**單一 RPC 一次寫入**取代前端逐筆 `DELETE FROM shipping_pool`；刪除 pool 列後，僅當該訂單在出貨池**已無任何剩餘品項**且狀態為 `processing` 時才回退為 `pending`（對齊「全數移出才回退」），回傳 `{deleted_count, reverted_order_ids}`。前端 `ShippingPool.tsx` 改用品項級 checkbox 批次選取（每店家表頭「全選」＋列 checkbox＋`Undo2`「回滾成訂單」批次按鈕，含行動端 footer），並**移除原逐筆 Trash2 刪除**
- **出貨池排序（2026-09-09，migration `20260908000002`＋`20260909000005`）**：`shipping_pool.sort_order`（每店家獨立）與 `sales_note_items.sort_order`；`ship_from_pool` 依 `sp.sort_order, sp.created_at` 建立銷售單品項並以 `v_sort_counter` 寫入 `sales_note_items.sort_order`（多單合併出貨順序持久化）。前端 `ShippingPool.tsx` 以 dnd-kit 逐店家拖曳排序（`SortablePoolRow`＋`DndContext` 包整個 `<Table>`），拖曳結果經 RPC `reorder_shipping_pool_items(p_items jsonb)`（SECURITY DEFINER，僅 admin，grant authenticated）以 index+1 持久化；表頭排序（商品/數量/單價/小計/加入時間）觸發時清 `localOrder` 立即生效。**寫入路徑自動派號**：BEFORE INSERT trigger `trg_shipping_pool_auto_sort_order` 於 `sort_order<=0` 時指派「該店家目前 `MAX(sort_order)+1`」，14 支 INSERT INTO shipping_pool 的 RPC（下單轉出貨/刪單回滾/寄賣回滾等）皆不用逐支改；既有資料已 backfill（每店家依 created_at 給 1..N）。**出貨前回寫目前順序**：`shipMutation`（確認出貨）會先對每個選取店家依 `sortedGroups`（表頭排序＋拖曳的當下顯示順序）呼叫 `reorder_shipping_pool_items` 回寫 DB，再呼叫 `ship_from_pool`，確保銷貨單品項照「畫面上看到的順序」建立。銷貨單顯示（admin/store SalesNotes、會計 `ReferenceViewer` 等 9 處查詢）已改 `.order('sort_order', { foreignTable: 'sales_note_items' })` 並以 `sales_note_items.sort_order`（非來源 `order_items.sort_order`）排序，多單合併出貨時順序才正確。
- **退貨模組（2026-09-06，migration `20260906000004`）**：`sales_note_items.returned_quantity`／`purchase_order_items.returned_quantity`（預設 0 的退貨累計）＋4 張退貨表（`sales_note_returns`/`sales_note_return_items`、`purchase_order_returns`/`purchase_order_return_items`，RLS：銷貨類 admin 全權＋門市 SELECT 自家、採購類僅 admin）。RPC `process_sales_note_return`（銷貨退貨回勾庫存 `customer_return` movement＋「客戶退貨退款」expense 分錄扣帳戶）、`process_purchase_return`（採購退貨自庫存扣除 `purchase_return` movement＋「供應商退貨沖帳」income 分錄加帳戶）；金額皆後端重算（qty×unit_price/unit_cost），帳戶未指定且金額>0 時 RAISE。前端：銷貨單明細（`SalesNoteDetailDialog`）「退貨登記」→`SalesReturnDialog`（admin 限定，`enableReturn={!isRep}`）、列表「已退貨」徽章；採購單明細「廠商退貨」→`PurchaseReturnDialog`。`inventory_movements.source_type` 沿用既有 `customer_return`/`purchase_return` CHECK 值。

### 寄賣系統（統一模板 v1）
- `consignment_orders`（direction = receive_from_supplier | send_to_store，status = draft | active | settled | cancelled，訂單轉寄賣時 `source_order_id` 回填，v1.3 起 send_to_store 非 draft/cancelled 皆強制有 source_order_id）+ `consignment_order_items` + `consignment_order_item_summary`（VIEW，統計計算不落庫）
- `consignment_sales_reports`（店家回報審核層 pending/confirmed/rejected）→ 確認後寫入 `consignment_sales`（統一銷售帳本，direction + source_type = store_report | customer_order）
- `consignment_settlements`（supplier_payment / store_receivable，v1 僅此兩種，付清自動 settled）+ `consignment_returns` / `consignment_return_items`
- 寄賣所有權以 `inventory_movements.inventory_owner` 標記（不落 warehouse），`product_inventory` 維持總量
- **訂單轉寄賣（v1.1）**：後台訂單可整單切換寄賣模式（`orders.consignment_mode`）；`ship_from_pool` / `direct_ship_order` / `create_order_with_sales_note` 出貨時經 `create_consignment_shipment_layer` 自動同步建 send_to_store 寄賣單
- **訂單列表「轉寄賣」＝建立草稿不立即出貨（2026-09-08，migration `20260908000004_convert_order_to_consignment_draft.sql`）**：新 RPC `convert_order_to_consignment_draft(p_order_id, p_created_by)`（SECURITY DEFINER，`SET search_path = public, extensions`，REVOKE anon/PUBLIC，GRANT authenticated）——守門：訂單存在、`source_type <> 'consignment'`、`status='pending'`、有未出貨量（`quantity - shipped_quantity > 0`，排除 cancelled/discontinued）；既有 `consignment_mode=true` 且已有 `send_to_store` draft/active 寄賣單時**重跑回傳既有草稿**（`reused:true`，不重複建立）。動作：`consignment_mode=true`（維持 `pending`、品項維持 `waiting`）＋建立 `consignment_orders`（`send_to_store`、`store_id`、`status='draft'`、`source_order_id`、`created_by`、note＝訂單備註）＋逐項鏡像 `consignment_order_items`（`order_item_id` 回填、`quantity = quantity - shipped_quantity`、沿用 `unit_price`/`unit_cost`）＋**不建 inventory_movements、不扣庫存、不開銷貨單**。前端 `OrderListPage.convertToConsignmentMutation` 由舊「先標 `consignment_mode=true` 再逐單 `direct_ship_order`」改呼叫此 RPC；對話框/按鈕文案改「轉寄賣（草稿）／確認轉寄賣／待轉寄賣（未出貨）」。未出貨品項可在寄賣管理草稿頁手動調整後再出貨（`create_consignment_shipment`）。
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
- 共享連結用 `access_token`（UUID）+ `get_shared_order_details`/`get_shared_sales_note_details`/`get_shared_consignment_details` RPC；路由 `/share/order/:orderId`、`/share/sale/:salesNoteId`、`/share/consignment/:consignmentId`。**客戶對帳單分享（2026-09-24）**：`customer_statement_shares` 表＋`get_shared_customer_statement` RPC（見上方近期變更）＋路由 `/share/statement/:statementId`。
- 訂單與銷貨單各自有獨立的 `access_token`：訂單建立時即產生（永久可分享），銷貨單出貨時獨立產生（不共用訂單 token）
- `delete_sales_note` 不再將 token 保存回訂單（訂單有自己的永久 token）
- **寄賣單分享（2026-09-08，migration `20260908000003_consignment_share_token.sql`）**：`consignment_orders` 新增 `access_token UUID DEFAULT gen_random_uuid()`（NOT NULL，建立即產生）；新 RPC `get_shared_consignment_details(p_identifier TEXT, p_token TEXT)`（SECURITY DEFINER，依 id 或 code ＋ token 驗證，回傳 `{consignment, items}`，GRANT anon＋authenticated）；新分享頁 `src/pages/share/SharedConsignment.tsx`＋`/share/consignment/:consignmentId` 路由；寄賣頁 `OrderListTab`（列表）與 `OrderDetailDialog`（標題）皆加「分享」按鈕複製 `/share/consignment/{code}?token={token}` 連結。3 個分享頁（SharedOrder/SharedSales/SharedConsignment）× 2 模式（螢幕/換頁）皆支援「換頁模式」，比照 `SharedReceiptExport` 的 `CHUNK_CAPACITY` 分頁邏輯（`webPreview` prop），CSS `.doc-receipt-web-preview` 使寄賣分享亦可在網頁直接分頁檢視。
- **訂單列表寄賣 badge（2026-09-08）**：`useOrdersList` 新增查詢 `consignment_orders`（`direction='send_to_store' AND status NOT IN ('draft','cancelled')`）並產生 `consignmentBySourceOrderId` map（`source_order_id → {id, code}`）；`OrderTableView` 與 `OrdersCardView` 的「寄賣」badge 判斷改為 `consignment_mode || consignmentBySourceOrder.has(id)`，涵蓋 `consignment_mode=false` 但逐項轉寄賣（有相關 `send_to_store` 寄賣單）的訂單
- 維修單：`repair_orders` + `repair_order_items` + `repair_order_status_history`

## ⚠️ 已知問題 / 安全注意

**向後相容 VIEW 復原（2026-09-09）**：遠端資料庫缺少 `device_model_links`／`device_model_group_links`／`device_model_exclusions`／`product_effective_models_base` 這 4 個由 `20260602213529_consolidate_entity_model_relations.sql` 定義的 VIEW（該 migration 未記入遠端）；`sync_storefront_items` 執行時參考到缺漏的 VIEW 會 42P01，導致新增/編輯變體失敗。已以 migration `20260909000000_recreate_device_model_link_views.sql` 重建（CREATE OR REPLACE VIEW，冪等），`entity_model_relations` 實表與前端邏輯不受影響。若日後又出現 `relation "public.device_model_links" does not exist`，先確認這 4 個 VIEW 是否存在。

**10 張表 RLS 未啟用**（任何人持 anon key 可直接讀寫）：`categories`、`specification_definitions`、`category_spec_links`、`category_hierarchy`、`product_category_links`、`data_change_logs`、`data_snapshots`、`storefront_items`、`table_templates`、`table_template_variants`。修復前需先補對應 policies。

**✅ `npm run typecheck` no-op 已修復（2026-09-21）**：根 `tsconfig.json` 為 solution-style（`"files": []` ＋ `references`），舊 script `tsc --noEmit`（非 `-b`）不遍歷 references → **不檢查任何檔案、永遠 0 errors**。已於 `package.json` 改為 **`tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json`**，並清掉當時揭露的 **9 個既有型別錯誤**（`ShippingAddressValue` interface→type 取得隱式 index signature 修 `Json` 不相容；`DeviceModelOption[]` 取代 `DeviceModel[]`；`specifications` 用 `Omit<Row,'specifications'>` 覆寫避免 `Json` 交集；`Json` RPC 回傳加 `{ ok?: boolean }` cast）。現 `npm run typecheck` 0 errors、`npm run lint` 0 errors / 66 warnings、`npm run build` 通過。

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
- **列印模式（2026-09-03，printMode 顯示網頁 2026-09-08 修正）**：`SharedOrder.tsx`／`SharedSales.tsx`／`SharedConsignment.tsx` 的 `?print=true` 時以**早期 return 只渲染 `<SharedReceiptExport printMode webPreview>`**（不渲染互動 Card／表格／按鈕），方便直接調版面；`webPreview` 使印刷版型**直接渲染在網頁上**（不再全白、等同「換頁」外觀），`printMode` 保留 600ms 後自動 `window.print()`；`SharedReceiptExport` 的按鈕與 PrintDialog 以 `!printMode` 包住（printMode 時完全不渲染互動 UI）。列印版型以 `createPortal(document.body)` 掛到 body（僅 PDF 擷取期間），`@media print` 會覆寫 `.doc-receipt-web-preview`（去 max-width/邊框/陰影並還原 `.doc-page` 分頁），確保 webPreview 樣式不洩漏進列印。
- **分享頁預設畫面＝列印版型（2026-09-09）**：三個分享頁移除「螢幕／換頁」切換與 shadcn Card+Table 卡片表格，預設畫面直接渲染 `SharedReceiptExport webPreview`（與列印版面一致、所見即所得）。`SharedReceiptExport` 新增 `pagination` prop（預設 `true`）＋內部工具列（`webPreview && !printMode` 才顯示，`print:hidden`）：「分頁／連續」pill 開關＋A4/中一刀紙張 select（state 初始化自 `defaultPaperSize`，保留 `?size=` 支援；連帶修掉 SharedConsignment 原先 `onChange={() => {}}` 的壞下拉）。CSS：`.doc-receipt-web-preview` 基底改平面（無外框/圓角/陰影/800px 卡框）；連續模式（`:not(.doc-receipt-paginated)`）維持內容高度＋dashed 頁間分隔；分頁模式（`.doc-receipt-paginated`）`.doc-page` 以真實紙張 `width:210mm`／`min-height:297mm`（中一刀 `241mm×140mm`）逐頁顯示成紙張（wrap `overflow-x:auto` 讓中一刀可橫向捲動）；`@media print` 加 clamp 去除分頁模式紙張外框/固定尺寸，列印輸出維持不變。頁頭保留 Badge、`SharedSales`「確認收貨」按鈕、訪客提示（皆 `print:hidden`）。
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

## 近期變更（變體批次建立改用單一交易 RPC，2026-09-10）

- **根因**：`VariantBatchCreator` 的 `createMutation` 原本採「先全刪、再逐筆重建」且無 transaction——先 DELETE `product_variant_options`/`product_option_values`/`product_option_groups`、再 N+1 支 HTTP INSERT；刪除永遠成功、插入可能失敗 → 舊資料已刪無法復原，導致某些產品（如 CITYBOSS 硬派5倍強化玻璃貼，23 變體）option groups / variant_options 全空（`entity_model_relations` 正常）。
- **Migration `20260910000001_batch_upsert_product_options.sql`**：新 RPC `public.batch_upsert_product_options(p_product_id, p_groups, p_variants, p_variant_options, p_model_relations)`（SECURITY DEFINER，`SET search_path = public`，REVOKE public/anon、GRANT authenticated）——把整個 destroy-then-rebuild 包在**單一 database transaction** 內（任一環節失敗自動 ROLLBACK）。payload 以「客戶端臨時 id（ref）」串接，RPC 內解析為實際 UUID：
  - `p_groups`：`[{ref, name, values:[{ref,label,value,hex_code}]}]`
  - `p_variants`：`[{sku,name,barcode,wholesale_price,retail_price,sort_order}]`（依 sku 去重、onConflict `sku` upsert）
  - `p_variant_options`：`[{sku, group_ref, value_ref}]`
  - `p_model_relations`：`[{sku, model_id?|group_id?, sort_order}]`（relation_type 固定 `include`；先刪該產品變體所有 include 再重建）
  - 最後 `PERFORM public.sync_storefront_items(p_product_id)`。
  權限：僅 `has_role(auth.uid(),'admin')` 通過，否則回 `{ok:false, reason}`。
- **前端 `VariantBatchCreator.tsx`**：`createMutation.mutationFn` 改為組上述 5 個 payload（`groupsPayload`/`dedupedVariants`/`variantOptionsPayload`/`modelRelationsPayload`）後**單次呼叫 RPC**，並解析 `{ok:false}` 回傳拋錯；移除所有逐筆 delete/insert。型號關聯維持原租 per-variant / 全變體 兩種模式，僅改依 `sku` 串接。
- **⚠️ jsonb 參數傳遞慣例（2026-09-10 根因）**：呼叫 jsonb 參數 RPC（`p_groups`/`p_variants`/`p_items`/`p_variant_options`/`p_model_relations` 等）時，**一律直接傳原始 JS 陣列/物件，勿 `JSON.stringify()` 包裹**。`JSON.stringify` 後 supabase-js 送出的值是「JSON 字串」→ PostgREST 把 jsonb 參數解碼成 **string scalar** → RPC 內 `jsonb_array_elements(scalar)` 拋 `cannot extract elements from a scalar（22023）` 且整筆交易 ROLLBACK。全 codebase 正確範例：`Reps.tsx`（`upsert_rep_product_costs` 的 `p_items: items`）、`AdminOrderForm.tsx`（`update_order_with_items` 的 `p_items: payload`）、`ShippingPool.tsx`（`reorder_shipping_pool_items` 的 `p_items: payload`）。
- **防呆（migration `20260910000002_batch_upsert_product_options_harden.sql`）**：`batch_upsert_product_options` 在每個 `jsonb_array_elements` 前以 `jsonb_typeof` 檢查，非陣列視為空陣列，避免誤送 scalar 時拋錯（簽名不變）。其他 RPC 若收 jsonb 陣列，建議比照。
- **運算子優先順序修復（migration `20260910000003_fix_batch_upsert_product_options_operator.sql`）**：`batch_upsert_product_options` 內 `(v_sku_to_id->>v_opt_row.value->>'sku')` 因 `->>` 左結合性被 Postgres 解析為 `(v_sku_to_id ->> v_opt_row.value) ->> 'sku'`，觸發 `operator does not exist: jsonb ->> jsonb (42883)` 錯誤。加上括號 `(v_sku_to_id ->> (v_opt_row.value->>'sku'))`、`(v_group_ids ->> (v_opt_row.value->>'group_ref'))`、`(v_value_ids ->> (v_opt_row.value->>'value_ref'))`、`(v_sku_to_id ->> (v_rel_row.value->>'sku'))` 修正。
- ⚠️ `npm run supabase:types`（Supabase CLI）在 Windows 會把輸出的 `types.ts` 寫成 **UTF-16LE**，導致 ESLint「File appears to be binary」解析錯誤（tsc 不受影響）——重新產型別後若 lint 報此錯誤，用 PowerShell 把 `src/integrations/supabase/types.ts` 轉回 UTF-8 no BOM 即可。

## 近期變更（銷貨單修正 correct_sales_note + reverse_consignment_shipment bug 修復，2026-09-11）

- **Migration `20260911000007_correct_sales_note.sql`＋`20260911000008_correct_sales_note_add_price_updates.sql`**：RPC `correct_sales_note(p_sales_note_id UUID, p_items_to_remove UUID[] DEFAULT '{}', p_items_to_add JSONB DEFAULT '[]', p_new_items JSONB DEFAULT '[]', p_created_by UUID DEFAULT NULL, p_price_updates JSONB DEFAULT '[]') RETURNS JSONB`（SECURITY DEFINER，僅 admin）——在**不失效 QR code / access_token**（欄位不動）的前提下修正已出貨銷貨單的品項與價格。⚠️ 原 5 參數版本已於 `20260911000009` DROP，現為**單一 6 參數**簽名（避免 PostgREST overload 歧義）。
  - **守門**：銷貨單存在、`status <> 'received'`、無會計分錄（`accounting_entries`＋`accounting_entry_references` two-path）、無 `rep_commission_payouts`、無未 reversed 的 `consignment_sales`；追加來源**僅限同店家**（.eq store_id 比對，跨店擋下）。
  - **Phase 1 移除**（`p_items_to_remove`＝sales_note_item ids）：先 DELETE 舊 `sales_shipment` movement 釋放 `(sales_note_id, order_item_id)` unique 索引 → 新增 reversal movement 回勾庫存 → 回退 `order_items.shipped_quantity/status` → 品項**退回出貨池**（`shipping_pool` 依 `UNIQUE(order_item_id)` 採 SELECT/UPDATE 或 INSERT，`trg_shipping_pool_auto_sort_order` 自動派號）→ DELETE sales_note_item。
  - **Phase 2 追加**（`p_items_to_add`＝`[{order_item_id, quantity}]`，可來自出貨池或同店家訂單未出貨量）：檢查剩餘未出貨量 `quantity - shipped_quantity >= quantity` → 新增 sales_note_item（`sort_order = MAX+1`）→ 依 `order_items.inventory_source_type` 扣庫存（store_consignment 走 `allocate_inventory`，其餘 `inventory_movements` `sales_shipment`）→ 回填 `shipped_quantity/status` → 從出貨池移除該 order_item。
  - **Phase 3 完全新品**（`p_new_items`＝`[{product_id, variant_id?, quantity, unit_price}]`）：先建 `orders`（`source_type='admin_proxy'`、`status='shipped'`、`consignment_mode=false`、店名如「系統自動建立（銷貨單修正）」＋`p_created_by`）＋ `order_items`（status='shipped'、`shipped_quantity=quantity`、`unit_price` fallback `unified_wholesale_price/unified_retail_price`）→ 再建 sales_note_item（`inventory_source_type='self'`）→ 扣損庫存 `sales_shipment`。
  - **Phase 4 價格更新（2026-09-11）**（`p_price_updates`＝`[{order_item_id, new_unit_price}]`）：**直接改 `order_items.unit_price`**——`sales_note_items` 無自有價格欄，所有讀取（銷貨單總額、分享頁、會計、佣金）皆由 `order_item.unit_price` FK 動態取得，故單一資料源改價自動同步，不會雙價斷點。守門：`new_unit_price>=0`、order_item 須屬此銷貨單；其他**已收款**銷貨單引用同一 order_item 時 RAISE 擋下；未收款引用不擋、收集於回傳 `price_updates[].other_affected_sales_notes` 供前端警示。
  - **Phase 5**：touch `sales_notes.updated_at`、受影響訂單全數出貨時收斂為 `shipped`、回傳 items 快照＋`price_updates[]`（`old_unit_price/new_unit_price/order_code/other_affected_sales_notes`）；`REVOKE ALL...GRANT EXECUTE TO authenticated`。
- **前端 `src/components/sales/SalesNoteCorrectDialog.tsx`（新建）**：四個區塊——**⓪ 修改價格**（每列原價＋可編輯「調整為」輸入＋差異金額，改價即時顯示 `+/-` 紅綠；同 `order_item` 被其他銷貨單引用時顯示警示——**已收款**引用會**禁用該列輸入**（
`blockedPaid`）並紅字標示不可改價，未收款引用顯示黃色「同步影響其它 SL…」；提交附 `p_price_updates` 並在確認區列出每筆「原價 → 新價」與同步影響單據）**；① 目前品項 checkbox 勾選移除（退回出貨池）；② 追加品項（同店家出貨池＋訂單未出貨量兩個區塊，各自數量輸入上限）；③ 完全新品（`SearchableSelect` 產品/變體 + 數量/單價，加入後可刪除，UI 明示「將自動建立新訂單」）。底部顯示原始/修正後總額（含調價差異）與新品警示；提交經 `(supabase.rpc as any)('correct_sales_note', ...)`，成功 invalidate `admin-sales-notes`/`store-sales-notes`/`admin-orders`/`shipping-pool-items`/`inventory-list`。**須「移除／追加／新品／調價」至少其一才可送出**。
- **`SalesNoteDetailDialog`**：`SalesNoteDetail` 新增 `store_id`；`SalesNoteItem` 新增 `orderItemId`＋`orderCode`（供改價與影響訂單顯示）；新增 `enableCorrect?` prop（預設 false）；`enableCorrect && note.status !== 'received' && note.payment_status !== 'paid'` 時顯示「修正」按鈕（Pencil，藍色），渲染 `<SalesNoteCorrectDialog>`。Admin `SalesNotes.tsx` 傳 `enableCorrect={!isRep}`、`dialogData` 補 `store_id`＋查詢加 `order_id`/`order:orders(code)`；Store 端與 `ReferenceViewer` 未接線（維持預設 false，已同步 `store_id` 修正 TS）。
- **`reverse_consignment_shipment` bug 修復（`20260804000002`）**：移除會誤配商品的 lookup（篩 `oi.source_order_id IS NOT NULL`＋`LIMIT 1` 卻**無 product/variant 條件**），保留以 product/variant＋`source_order_id` 精確比對的既存路徑。

## 近期變更（安全刪除守門全面化，2026-09-11）

- **產品／變體刪除守門（migration `20260911000003`）**：新 RPC `delete_product_if_safe(p_product_id)` 與 `delete_variant_if_safe(p_variant_id)`（SECURITY DEFINER，僅 admin）——取代前端對 `products`／`product_variants` 的**裸 DELETE**（原本 FK 拋模糊錯誤或 CASCADE 靜默刪掉 store_products 等）。逐項檢查 order_items、sales_note_items（經 order_item_id）、purchase_order_items、inventory_movements、product_inventory、consignment_order_items、repair_order_items、supplier_product_mappings（僅變體）任一命中即回 `{ok:false, reason, adopted_by:[{kind,label}]}` 擋下。
- **維修單刪除守門（migration `20260911000004`）**：新 RPC `delete_repair_order_if_safe`——檢查 `repair_order_items.is_stock_deducted`（已扣庫存無法回補）、`purchase_order_item_id`（已綁定進貨批次）、`inventory_movements.repair_order_id`（含 source_type='repair_part_usage'）、accounting_entries 引用；同時**補齊 repair_orders 的 admin DELETE RLS policy**（原 schema 僅 store 成員/接案人有 DELETE 權，admin 會被擋）。前端 `useRepairOrders.deleteMutation` 改呼叫 RPC，admin 詳情頁新增「刪除」按鈕（原 mutation 從未接線）。
- **已收款訂單編輯守門（migration `20260911000005`）**：`update_order_with_items` 改 `RETURNS JSONB`（DROP 後重建）——若訂單有 `payment_status='paid'` 的銷貨單（經 sales_note_items→order_items 關聯），擋下「影響會計」的變更（刪除既有品項／新增品項／既有品項 quantity 或 unit_price 與 DB 不一致），僅允許備註與 sort_order 變更；被擋時回 `{ok:false, reason, adopted_by:[{kind:'paid_sales_note', code}]}`。前端 `AdminOrderForm` 兩處呼叫（updateMutation／directShip preSave）皆解析 `ok:false` 並拋錯，toast 顯示完整原因。
- **會計分錄刪除原子化（migration `20260911000006`）**：新 RPC `delete_accounting_entry(p_entry_id)`（SECURITY DEFINER，僅 admin）——單一交易內：收集受影響銷貨單 IDs（entry row＋references 子表兩路徑）→ 回退帳戶餘額（income/expense 反向、transfer/currency_exchange/topup 來源+目的地雙帳戶）→ 解除 `shipping_settlement_periods.is_settled`→ 刪 references＋entry → 對每張銷貨單執行 `sync_sales_note_payment_status`。前端 `useAccounting.deleteEntryMutation` 改呼叫此 RPC（原多步非原子直接 delete，會毀損 shipping_settlement_periods 狀態並跳過收款狀態同步）。
- **寄賣取消守門**：`useConsignment.cancelOrderMutation` 由直接 `DELETE FROM consignment_orders` 改為**依狀態分流**（RPC 見上方 ⑤）——`draft`＝走 `delete_consignment_draft_if_clean`（完整刪除草稿＋鏡像 pending 來源訂單，被引用時回 `{ok:false}` toast）；非 `draft`＝標 `status='cancelled'`，若來源訂單仍 `pending` 先以 `delete_order_if_unadopted` 刪除來源訂單。
- 所有守門 RPC 遵循既有慣例：`SECURITY DEFINER`、`SET search_path = public`、`has_role(auth.uid(),'admin')`、`REVOKE ALL ... FROM public, anon`、`GRANT EXECUTE ... TO authenticated`；前端一律用 `(supabase.rpc as any)`（未進 types.ts 型別，勿手改 typegen）。

## 近期變更（變體選項改用 RPC 原子化，2026-09-12）

- **Migration `20260912000000_upsert_variant_options.sql`**：新 RPC `public.upsert_variant_options(p_variant_id UUID, p_items JSONB) RETURNS JSONB`（SECURITY DEFINER，`SET search_path = public`，REVOKE public/anon、GRANT authenticated）——將 `VariantEditDialog` 的 `manageVariantOptions`（原本逐筆 delete/insert + orphan 清理，5~8 次前端 HTTP，非交易）搬進**單一資料庫 transaction** 內完成：
  - **選項值對齊**：依 `group_id` + `(label OR value) = p_label` 找既有值；不存在則 INSERT（`value=label`、`sort_order=MAX+1`）。
  - **顏色 hex_code 自動填入**：組名匹配 `~* '(顏色|色|color)'` 時，查 `product_colors`（trim 小寫 name / trim 大寫 code）取 `hex_code`；既有值 `hex_code` 為 NULL 時補 UPDATE，不覆寫已有值。解法是：前端新建 color option value 時 hex_code 為空的根因。
  - **連結重建**：DELETE → INSERT `product_variant_options`。
  - **orphan 清理**：該產品所有群組的值中，無任何變體使用的 `product_option_values` 自動刪除（比前端 scope 更完整、DB 即時來源）。
  - 版本 trigger（`increment_product_option_values/groups/variant_options_version`）自動 bump，不手動。**不呼叫 `sync_storefront_items`**（顏色不影響店頭顯示名）。
  - 守門回傳 `{ok:false, reason}`；`p_items` 直接傳 JS 陣列、不 `JSON.stringify`。
- **前端 `src/components/products/VariantEditDialog.tsx`**：移除 `getHexCodeForColor`、`resolveOptionValueId`、`manageVariantOptions` 三個函式，新增共用 `upsertVariantOptions` 呼叫 RPC（兩處：create/update mutation）。

- **Migration `20260911000002_fix_duplicate_product_rpc.sql`**：重寫 `duplicate_product_with_variants` RPC，修復 3 個 bug + 補齊缺失功能：
  1. **`emr_exactly_one_entity` 違規（根因）**：舊版 variant-level `entity_model_relations` 複製時**同時設定 `product_id` 與 `variant_id`**，違反 CHECK constraint（要求僅能擇一）。修正為 variant-level 設 `product_id=NULL, variant_id=new_variant_id`。
  2. **`product_variant_options` 永不連結（隱性 bug）**：舊版以 SKU 比對新舊變體（`old_pv.sku = pv.sku`），但新 SKU 帶 `-COPY-XXXX` 後綴，永遠不匹配→選項群組/值建立了但變體未連結。修正為使用**臨時表 `_variant_id_map`**（`old_id → new_id`）精確對應。
  3. **`sort_order` 未複製**：`entity_model_relations` 舊版 INSERT 未含 `sort_order`，全部預設 0。修正為複製時帶入原始 `sort_order`。
  4. **`product_addon_bindings` 缺失**：A+B 加購綁定完全未複製，修正為逐筆複製。
  5. **`products` 欄位遺漏**：新增複製 `unified_pricing`、`unified_wholesale_price`、`unified_retail_price`、`item_type`、`is_hidden`、`supplier_id`。
- **最佳化：product-level → variant-level 下放**：因所有產品皆有變體，product-level `entity_model_relations` 已無必要。新版 RPC 不再建立 product-level 關係，而是**將 product-level 關係下放至每個變體**（`variant_id=new_variant_id, product_id=NULL`），並以 `NOT EXISTS` 防止與變體自身關係重複。複製後的新產品所有型號綁定皆為 variant-level，方便後續在「變體型號」tab 直接替換型號群組。
- **⚠️ 已有 product-level `entity_model_relations` 的清理**：目前資料庫中所有產品的 entity_model_relations 已皆為 variant-level（`product_level_relations=0`），product-level copy 在舊版 RPC 中實際上不會產生衝突行（因無 product-level 來源），但修復後的新產品仍以 variant-only 方式建立。

## 專案慣例

- 文件與程式碼註解使用**繁體中文**
- 除非明確要求，**不要新增程式碼註釋**
- 沿用既有 library，引入新套件前先檢查 package.json
- import 用 `@/` 別名（對應 `src/`）
- 程式碼變更後跑 `npm run typecheck` 與 `npm run lint`
- jsonb 參數 RPC（`p_items`/`p_groups`/`p_variants` 等）一律**直接傳 JS 陣列/物件**，**勿 `JSON.stringify()`**（詳見「變體批次建立改用單一交易 RPC」的 ⚠️ 慣例）
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

## 近期變更（複製產品 wizard + 變體批次編輯防孤兒，2026-09-10）

### 複製產品 wizard（`src/components/products/CopyProductDialog.tsx`，新增）
- 產品列表「複製」改開三頁籤 wizard（基本資訊／型號群組／選項群組）＋預覽摘要（名稱、SKU 前綴、模型數、預估變體數 vs 原數）；`ProductsPage.tsx` 的 `onCopy` 改為開此 Dialog（`forceRefresh`＋導航 `onCopied`）。
- **變體預覽（2026-09-12）**：新增第四頁籤「變體預覽」——「生成變體預覽」按鈕依目前「選項群組 × 型號群組 × SKU 前綴」笛卡爾展開出**確切變體清單**（SKU＝`前綴-選項值…(-型號)`），可直接編輯每列的 SKU／變體名稱／條碼／批發價／零售價／刪除該列；價格預設取自原產品第一個變體。生成時記錄 signature（群組＋refs＋前綴），選項/型號/前綴後續變更會顯示「請重新生成」警示；複製時：signature 相符 → 用（含編輯的）清單，否則依目前選項現場重建（避免過時清單）。摘要卡片改顯示「已生成 N 個」並列原變體數。
- **執行邏輯（`handleCopy`）**：先 `duplicate_product_with_variants` 完整複製（含變體、option groups/values/variant_options、entity_model_relations、entity_spec_values、images、category_links、addon_bindings，變體 SKU 帶 `-COPY-XXXX` 後綴，RPC 未變）。
- **智能分流（避免累贅複製後孤兒）**：
  - 「選項群組結構有改」→ 先 `DELETE product_variants`（全新複製無引用）再 `batch_upsert_product_options` 依「SKU 前綴＋選項值」重新生成變體、選項連結與模型關聯。
  - 「僅型號群組有改」→ 直接刪除並重插新變體的 `entity_model_relations`（`sort_order` 依選取順序）。
  - 「皆未改」→ 直接用 RPC 複製結果（沿用 `-COPY-XXXX` SKU），不再重建。
  - 判別基準：`optionsChanged`＝現在選項群組（name/label/value）與載入原產品的快照 `originalGroupsRef` JSON 比較；`modelsChanged`＝`selectedDeviceRefs` 與 `originalDeviceRefsRef` 的 `type:id` 鍵比較。

### 變體引用檢查（`src/utils/variantReferenceCheck.ts`，新增）
- `checkVariantReferences(variantIds)` 批次查 **7 張業務表**（`order_items`／`purchase_order_items`／`inventory_movements`／`product_inventory`／`consignment_order_items`／`repair_order_items`／`supplier_product_mappings(internal_variant_id)`）回傳 `{ok, referenced:[{variant_id, variant_sku, table, label, count}]}`；`groupReferencesByVariant` 依變體聚合（含 SKU）。對齊 `delete_variant_if_safe`（migration `20260911000003`）的守門表清單。

### VariantBatchCreator smart merge + 防孤兒（`src/components/products/form/VariantBatchCreator.tsx`）
- **既有 DB 快照**：`loadExistingData` 時將 DB 變體（含 `_dbId`）存入 `existingDbVariantsRef`。
- **Smart merge**：`mergeWithExisting` 除與「前一次生成」比對外，另以 `identityKey`（optionValueIds 排序＋modelGroupId）比對 **DB 快照**——命中時**保留既有 SKU**（`sku: dbMatch.sku`），讓 `batch_upsert_product_options` 依 SKU UPSERT 就地更新（新增值不會再造成同組合重複變體）；命中標記 `_dbId`。
- **孤兒偵測與清理**：合併後 SKU 不在 payload 的 DB 變體＝潛在孤兒。儲存（`handleSave`）時先 `checkVariantReferences`：
  - 全部未引用 → 存入 `orphanCleanupRef`，RPC 成功後逐個 `delete_variant_if_safe` 清除。
  - 部分被引用 → 彈出確認 Dialog（列出每變體引用來源 Badge，如「訂單品項 ×3」），可「返回調整」或「仍要儲存（被引用者保留）」；被引用者保留原樣（失去選項連結）。
- **diff 顯示**改為「新增 N／更新 N（既有就地更新）／保留 N」＋孤兒警示清單（取代原先「移除⋯僅提示，儲存時不會刪除」的誤導文案）；`updated` 命中時價格變動仍以 Amber 提示「原有手動修改已覆寫」。
- ⚠️ 沿用既有慣例：jsonb payload 直接傳 JS 陣列（不 `JSON.stringify`）、RPC 呼叫 `(supabase.rpc as any)`、`npm run typecheck`＋`npm run lint` 通過、build 成功。
