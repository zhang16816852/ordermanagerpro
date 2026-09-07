# Order Manager Pro — 前端架構詳情

> 本文為 `AGENTS.md` 的補充文件，**只在涉及前端架構/資料流的任務時才讀取**。
> 由 AI 持續維護，重大變更後需同步更新。

## 1. 入口與初始化（src/App.tsx）

```
App 掛載 → CacheService.init() 完成前顯示「載入中...」
  → 就緒後渲染 QueryClientProvider → TooltipProvider → Toaster/Sonner → BrowserRouter → AuthProvider → AppRoutes
```

- `CacheService.init()`（src/services/cacheService.ts）是單例 Promise，初始化流程：
  1. 清理 legacy localStorage keys
  2. `versionCache.preload()`：從 Supabase `data_versions` 表預載所有版本對照（src/services/versionCache.ts）
  3. 把每個 IDB store 載入 `memoryStorage`（src/services/memoryStorage.ts），含 schema 版本驗證（不符則清空 store 強制重抓）

## 2. 路由結構（src/routes/）

| 檔案 | 路由 | 權限包裝 |
|---|---|---|
| `index.tsx` | `/`、`/market`、`/market/:id` + 組合以下所有路由 | `RootRedirect`（依 isAdmin 跳轉）、`ProtectedRoute` |
| `admin.tsx` | `/admin/*`（約 20 條，含 `/admin/consignment`） | `ProtectedRoute requireAdmin` + `AppLayout` |
| `store.tsx` | `/dashboard`、`/orders`、`/cart`、`/catalog`、`/sales-notes`、`/receiving`、`/accounting`、`/team`、`/audit`、`/notifications`、`/market/create`、`/market/my-listings`、`/consignment-sales`、維修單 4 條 | `ProtectedRoute` + `AppLayout` |
| `shared.tsx` | `/auth`、`/invite/:token`、`/share/order/:orderId`、`/share/sale/:salesNoteId`、`*`（404） | 無（公開） |

- `ProtectedRoute`（src/components/ProtectedRoute.tsx）+ `AppLayout`（src/components/layout/AppLayout.tsx）
- 注意：`store.tsx` 中 `StoreRepairOrderEdit` 與 `StoreRepairOrderNew` 都 import 自 `repair-orders/new`（共用同一元件）
- **維修店家端/接案人分離（2026-09-05）**：店家端`store/repair-orders/*`（收件→派發接案人→`ready` 交還客戶）與接案人工作台 `admin/repair-orders/RepairOrdersPage.tsx`（待接案/我處理中，`pending` 單「接單」＝`assigned_to=自己`＋`diagnosing`）流程分離。接案人清單來自 RPC `list_repair_contractors()`（`useRepairTechnicians`），店家端 `new.tsx` 以 `__open__` 哨兵值代表「開放待接案（不指定）」；類型 helper 在 `src/types/repair.ts`（`isRepairOrderAcceptable`／`isRepairOrderWorking`／`isRepairOrderClosed` 等）。
- **維修單人員 email 解析改走 RPC map（2026-09-07）**：`auth.users` 為跨 schema 表，PostgREST 不支援其 embed（400 PGRST200），故 `useRepairOrders.ts` 的 list/detail query **移除 `assigned_tech:assigned_to(...)` 與 `changed_by_user:changed_by(...)` embed**；改以 `useRepairAssigneeMap()`（RPC `repair_assignee_emails()`）取得 `id → {email, full_name}` 地圖，於 `RepairOrdersPage`、admin/store `detail`、store `index`（含 workshop 重用頁）以 `assignees[order.assigned_to]?.email` 解析。
- 產品表單（2026-08-28）：`/admin/products/new` 與 `/admin/products/:productId/edit` 為獨立頁面（`src/pages/admin/products/ProductFormPage.tsx`）；表單本體抽成 `ProductFormBody`（`src/components/products/form/ProductFormDialog.tsx`），由 Dialog 包裝（`ProductFormDialog`，供採購 `UnmappedResolver` 使用）與頁面共用。產品列表「新增產品／編輯／複製」改走路由導航，不再開啟模態 Dialog
- **變體區整合 Order Grid 表格範本（2026-08-31）**：`VariantSection`（`src/components/products/form/VariantSection.tsx`）用 `useTableTemplates()` 篩出「含此產品任一變體」的 templates（`relevantTemplates`），每個相關 template 在變體清單下方各渲染一個 `OrderGridRenderer` 獨立表格——`products` 只傳此產品（`gridProducts` = product.variants 過濾本產品變體）、`template_variants` 過濾成僅此產品子集（`gridTemplateFor`），故表格只顯示該產品變體套用顯示規則（不混其他產品）。資料源為 `product` prop（initialData，含 option/spec/device 完整資料）。購物車接線：`onDirectItemAdd`（button 每格「＋」）與 `onAddToCart`（toolbar）皆接既有 `store.addItem` 累加（`addItem` 只 +1，數量>1 時用 `getVariantQty` 讀現量＋`updateQuantity` 補差額），`getCartQuantity` 接 `getVariantQty` 即時反映購物車既有數量
- **Order Grid 批次維度（2026-08-31）**：同名選項群組在不同產品上有不同的 `option_group_id`（例：「顏色」在 imos 16 Pro = `0fa9fa8f`、在 imos 16/16 Plus = `7ce10abd`）。批次修改維度時若統一寫入一個 id，會導致部分產品「無法產生 grid」。**`OrderGridBatchDimensionDialog.tsx`** 批次選取 option 群組時同步記住群組**名稱**（`onConfirm` 回傳 `optionGroupNames`）；**`OrderGridTemplateList.tsx`** 新增 `resolveOptionGroupId(template, name, fallbackId)`——對每張範本依其變體所屬產品的 `option_groups` 找「同名」群組的 id（找不到才回退批次選的 id），對 row/col/tab 各維度逐範本解析後再 `updateTemplate`（目前 `useTableTemplates` 的 `updateTemplate` 不 catch error，需確保範本資料完整）
- **共用頁頭介面（PageHeaderContext）**：新增 `src/components/layout/PageHeaderContext.tsx` 提供 `PageHeaderConfig`（`title` / `back` / `onBack` / `actions`）介面 + `usePageHeader()` hook；`AppLayout` 以 Provider 包覆並將 `pageHeader` 傳給 `DesktopHeader`（返回＋標題顯示於左側、actions＋通知於右側）與 `MobileHeader`（漢堡選單＋返回＋標題＋actions＋通知），路由切換（`pathname`）時於 render 階段自動清空。任一頁面呼叫 `setPageHeader({ title, back, actions })` 即可在桌面／手機兩邊共用同一組頁頭；目前僅 `ProductFormPage` 使用（含「預覽」按鈕置於 actions）
- **規格欄位 UI 統一（2026-08-28）**：新增共用件 `src/components/products/form/sections/specFieldUi.ts`（`QTY_GROUP_PALETTE`、`SpecVisibleInfo`、`buildDepChain`、`buildQuantityColorMap`、`resolveGroupColor`、`isHeadingSpec`）與 `SpecFieldHeader.tsx`（欄位標籤列：名稱＋必填＊＋第N組 pill＋依賴鏈＋數量組色塊）。`DynamicSpecsFields`（產品規格畫面）與 `VariantSpecsMatrix`（變體規格矩陣，`src/components/products/form/sections/VariantSpecsMatrix.tsx`）共用同一套標籤與編輯器（`SpecValueEditor variantMode`）。矩陣的「表格模式」（逐變體操作）與「單一模式」（一次套用全部變體）UI 一致、僅操作對象不同；單一模式 `applyToAll` 第 3 參數 `silent` 搭配 1200ms debounce toast，批次/複製按鈕維持即時。矩陣 `useCategorySpecs` 啟用 `includeDescendants`＋`includeTriggerDownstream` 對齊連動鏈，`VariantSpecsMatrixHandle` 新增 `getState()`（產品表單以 `__getVariantSpecs` 掛載）供預覽即時反映未儲存的變體規格值。**「其他」自訂輸入（2026-08-29）**：`SpecValueEditor`（`OTHER_OPTION='其他'`）在 `select`/`SearchableSelect`/`multiselect` 選項含「其他」時顯示自訂文字框（個例、不回寫 options，單選附「採用選項值」建議 chips）；`SpecDialog` 連動觸發選值欄改 `<datalist>`（options＋`input`）建議框。觸發 DSL 新增 `on_value='input'`（值非空且不在 options）由 `specTree.checkSpecTriggerMatch` 判定，依賴鏈與邏輯樹顯示為「自訂輸入」
- **SpecDialog 選項拖移（2026-08-28）**：`src/pages/admin/categories/components/SpecDialog.tsx` 的「選項/標籤定義」清單支援 dnd-kit 拖移重排（`SortableOptionItem` 元件＋`GripVertical` 拖柄，`arrayMove` 更新 `specForm.options`），排列順序即下拉選單／單位欄位之顯示順序

## 3. 狀態管理（src/store/）

| Store | 用途 |
|---|---|
| `useSpecStore` | 規格定義/分類快取（`fetchSpecs`、`fetchCategories`，接受 Edge Function 增量資料）。**版本感知自動刷新（2026-08-28）**：`refreshIfStale(notify=true)` 以 `CacheService.fetchServerVersions()` 比對 `data_versions`（30 秒節流），`specs`/`categories` 落後才 `fetchSpecs(true)`/`fetchCategories(true)`；刷新且 `notify` 時經 `BroadcastChannel('spec-store-refresh')` 廣播（其他 tab 以 `refreshIfStale(false)` 收，無回圈）；首次呼叫啟動 30 秒 heartbeat，讓閒置頁面也自動跟上。商品表單（`ProductFormDialog` active effect）與 `DynamicSpecsFields`／`VariantSpecsMatrix` mount 時皆改呼叫 `refreshIfStale()`（取代純 `fetchSpecs()`），徹底修復「分類管理新增規格後商品表單仍顯示舊快照」 |
| `useDeviceModelStore` | 型號資料快取（`fetchData`） |
| `useOrderDraftStore` | 門市購物車草稿（items/notes/totalAmount，key 為 storeId） |
| `useFilterStore` | 商品篩選狀態 |
| `useColorStore` | 顏色對照 |

## 4. 離線快取與同步核心（src/services/）

### 4.1 CacheService（facade，src/services/cacheService.ts）
- `CACHE` 常數定義 7 個快取：products、specs、categories、deviceModels、storefront、productImages、brandSeries
  - 每項含 `key`（localStorage 舊 key）、`schema`（schema 版本）、`versionKey`（對應 data_versions 的 table_name）、`idbStore`
- 主要 API：
  - `get(key, schemaVersion, ttl?)`：同步讀取記憶體快取；schema 不符或過期則清除
  - `set(key, data, dataVersion, schemaVersion)`：同步寫 memory + 非同步寫 IDB（陣列走 `idbReplaceAll`，其餘走 envelope）
  - `dedupe(key, fn)`：重複請求去重
  - `isStale(local, server)`：版本字串比較（`YYMMDD-XXXX` 字典序即時間序）
  - `fetchServerVersions()`：一次抓全部 data_versions

### 4.2 IndexedDB Adapter（src/services/indexedDBAdapter.ts）
- DB 名 `omp-cache`，版本 1，7 個 data store + 對應 `<store>_meta`
- `idbReplaceAll`：兩個 transaction（clear+putAll → setMeta）達成「原子替換」
- `idbClearAll`：登出/重置用

### 4.3 versionCache（src/services/versionCache.ts）
- 啟動時預載 data_versions 到 Map；`isStale(local, tableName)` 提供快速版本比較

### 4.4 SyncManager（src/services/syncManager.ts）
- `checkServerSequence(tableName, lastSequenceId)`：呼叫 Edge Function，最多重試 2 次
- `performGlobalDataSync(forceFull?)`：依序同步 specs → categories → products(+variants) → device_models → brand_series，記錄各項最終版本
- `updateAndPropagateProducts`：樂觀寫入快取 + 廣播 `optimistic-product-cache-update` window 事件
- 版本工具：`formatTaipeiTime`、`packVersion`、`unpackVersion`

### 4.5 其他 services
- `batchProcessor.ts`：批次處理
- `entityRelationService.ts` / `entityBindingService.ts`：產品/型號關聯與綁定
- `imageStorageService.ts`：圖片上傳（Supabase Storage）

## 5. 資料讀取 Hooks（src/hooks/）

| Hook | 用途 |
|---|---|
| `useAuth.tsx` | 登入/角色管理（systemRoles / storeRoles / currentStoreId） |
| `useCache.ts` | 通用 stale-while-revalidate 快取 hook（核心） |
| `useProductCache.ts` | 產品快取 + `syncProducts()` 全量同步邏輯（拼裝 variants/分類/型號/規格/選項/封面圖）；`useStoreProductCache` 額外疊加門市定價 |
| `useBrandSeriesCache.ts` | 品牌系列快取 |
| `useDeviceModels.ts` | 型號 |
| `useCategorySpecs.ts` / `useDictionaryCache.ts` | 分類規格/字典 |
| `useCreateOrder.ts` | 建立訂單 mutation（insert orders → order_items） |
| `useRepairOrders.ts` | 維修單 CRUD |
| `useSupabaseAction.ts` | 通用 supabase action（含錯誤訊息） |
| `useBrands.ts`、`useProductColors.ts`、`useProductSearch.ts`、`useNotifications.ts`、`useTableTemplates.ts` | 各自領域資料 |

## 6. 產品快取同步細節（useProductCache.ts）

`syncProducts()` 全量拉取並組裝：
1. `products` + `variants:product_variants(*)` + 分類/系列/品牌關聯（單次 join 查詢）
2. 並行分頁抓取（`fetchAllPages`，每頁 1000 筆）：entity_model_relations、device_model_groups、entity_spec_values、product_images(cover)、product_option_groups、product_variant_options
3. 建立索引 Map（型號關聯 `buildModelMaps`、specsMap、coversMap、選項資料）
4. 組裝 `ProductWithDetails`：含 `effective_model_names`、`spec_values`、`option_groups`、`variants` 等
5. `setProductCache` 寫回快取並廣播事件

## 7. 訂單資料流（門市端）

- **列表**：`StoreOrderList.tsx` 用 React Query 直接查 Supabase（非走快取）：orders + order_items + products/product_variants，依 status tab 過濾
- **建立**：`useCreateOrder` → insert `orders` → insert `order_items`
- **編輯**：`StoreOrderEdit.tsx`（讀取單筆 + 更新）
- **後台下單即出貨**：`create_order_with_sales_note` RPC（DB 端一次完成 order + sales_note + inventory movement）
- **出貨池**：`ShippingPool.tsx` 用 `ship_from_pool` RPC 依門市批次出貨；另用 `remove_items_from_shipping_pool` RPC（2026-09-03）批次將選取品項「回滾成訂單（移出出貨池）」——品項級 checkbox 選取（每店家表頭全選＋列 checkbox＋`Undo2` 批次按鈕，行動端亦有 footer），取代原本逐筆 `DELETE`（效能優化、一次寫入）
- **整單寄賣模式**（v1.1）：`AdminOrderForm.tsx` 建立訂單時可切換「寄賣模式」Switch → 送 `create_order_with_sales_note(p_consignment_mode)` 或 pending insert 帶 `orders.consignment_mode=true`；出貨（pool / direct ship / 下單即出貨）時 DB 端 `create_consignment_shipment_layer` 自動建 send_to_store 寄賣單
  - `ShippingPool.tsx`：查詢帶 `order:orders(code, consignment_mode)`，寄賣品項出貨 Dialog 不顯示倉/來源選擇（固定 store_consignment）
  - 訂單列表/明細顯示「寄賣」Badge（`OrderTableView.tsx`、`OrdersCardView.tsx`、`OrderInfo.tsx`）
- **出貨池逐項轉寄賣**（v1.2）：`ShippingPool.tsx` 出貨 Dialog 新增「寄賣」Switch（僅一般訂單品項）→ 逐項組 `p_consignment_override_map` 傳 `ship_from_pool`（DB 依此建 store_consignment 層）；同時將「出貨倉/庫存來源」兩欄合併為單一「出貨來源」欄（自有倉＋供應商寄賣 FIFO，批次查 product_inventory 顯示庫存）。`AdminOrderCheckout.tsx`（經 `OrderReviewPanel`）也加寄賣 Switch → 送 `p_consignment_mode` 並隱藏逐列倉/來源選擇器
- **寄賣出貨不開銷貨單**（v1.3）：寄賣品項出貨（pool / direct ship / 下單即出貨 / 獨立寄賣單）一律不建立 sales_note；店家端「確認收貨」後回報銷售、後台審核確認才開立 `sales_notes`(status='received') 收款單。前端呼叫皆為 7 named args（`direct_ship_order` / `create_order_with_sales_note` 唯一簽名）：`AdminOrderCheckout.tsx`、`AdminOrderForm.tsx`（新增 `consignmentMode` Switch、按模式切換按鈕/toast/共享連結）、`OrderListPage.tsx`、`ShippingPool.tsx`（出貨成功 toast 依回傳 `sales_note_id` 顯示寄賣語意）
- **寄賣草稿＝真實來源訂單**（v1.4）：send_to_store 寄賣單一建立即同步建來源 `orders`（pending / `source_type='consignment'` / `consignment_mode=true`）與 `order_items`（waiting），回填 `consignment_orders.source_order_id` + `consignment_order_items.order_item_id`；「所有訂單」（`useOrdersList.tsx`）因此直接列出真實草稿訂單——可勾選、批次操作（確認/轉出貨池）、編輯、商品模式看數量，無需再在前端假列合併（先前 `isConsignmentDraft` 假列方案已移除）。出貨由 `create_consignment_shipment_layer`/`create_consignment_shipment` 重用既有來源 order/items。`useConsignment.ts` 的 createOrder/addItem/removeItem/cancelOrder 皆同步鏡像並 invalidate `['admin-orders']`；AdminOrderForm/AdminOrderEdit 來源顯示補「寄賣」

- **出貨回滾＋draft 品項編輯**（v1.5）：DB 端 `reverse_consignment_shipment` RPC（見 DATABASE.md）整單回滾 send_to_store 出貨；前端兩入口：
  - 寄賣頁 `OrderDetailDialog.tsx`：`action === 'reverse'` → `ReverseDialog`（確認＋備註，呼叫 `reverseShipmentMutation`，destructive 樣式）；`action === 'edit'` → `EditItemsDialog`（draft 單品項數量/價格可編輯、Trash 刪除既有品項、Plus 加入品項列選商品/規格，儲存時依序 `updateItemMutation`/`addItemMutation`/`removeItemMutation` 並 toast「品項已更新」）。按鈕顯示條件：回滾出貨＝`!isSupplier && active && !received_at`；編輯品項＝draft
  - 「所有訂單」`OrderTableView.tsx`：`statusTab === 'shipped' && order.consignment_mode` 顯示 RotateCcw 圖示 → `OrderListPage.tsx` `handleReverseShipment` 先查 `consignment_orders`（`source_order_id`＋`send_to_store`＋`active`）→ `Reverse Consignment Shipment Dialog`（備註＋確認）呼叫 RPC，成功 invalidate admin-orders/consignment/shipping-pool/inventory-*
- **`BatchActionBar` 批次列修正**（v1.5）：`OrderListPage.tsx` 計算 `hasConsignmentSelection`/`hasNormalSelection`/`allSelectedConsignment` 三旗標傳入；processing tab「轉銷貨單」「轉寄賣」僅 `hasNormalSelection` 顯示、「寄賣出貨」（沿用 `onDirectShipOrders` → `direct_ship_order` RPC，寄賣單出貨不開銷貨單）僅 `hasConsignmentSelection` 顯示、混合選取時兩組之間加 `w-px` 分隔線、「轉出貨池」恆顯示；`DirectShipDialog` 於 `allSelectedConsignment` 時標題「寄賣出貨」、描述改寄賣語意、確認鈕「確認寄賣出貨」；`directShipMutation` 成功 toast 依選取是否全為寄賣改顯示「已寄賣出貨 N 個訂單」

## 7b. 寄賣系統 v1（前端）

- **後台 `/admin/consignment`**（`src/pages/admin/consignment/`）：
  - `index.tsx`：Tabs（寄賣單 / 銷售回報審核，審核 tab 帶 pending 數 badge）
  - `hooks/useConsignment.ts`：資料 queries（suppliers/stores/products/orders/pendingReports/accounts/warehouses）+ `useOrderDetail`（內嵌查 items + summary + settlements + sales）+ mutations（createOrder / addItem / removeItem / cancelOrder / receiveItems / ship / confirmReports / rejectReport / returnItems / settle / updateItem / reverseShipment），全部用 `useSupabaseAction`（自動 toast + invalidate）。`invalidateAll` 已納入 `['shipping-pool']`/`['shipping-pool-items']`；`updateItemMutation`（send_to_store 且 `order_item_id` 存在時同步鏡像 `order_items.quantity/unit_price`）、`reverseShipmentMutation`（rpc `reverse_consignment_shipment`，invalidate consignment/admin-orders/shipping-pool/inventory-*）
  - `components/`：`OrderListTab.tsx`、`CreateOrderDialog.tsx`、`OrderDetailDialog.tsx`（內嵌 Receive/Ship/Return/Settle/Reverse/Edit 六 Dialog）、`ReportsTab.tsx`
  - 建立流程兩步：insert 表頭（`code='TMP'`，trigger 產 `CS-YYMMDD-XXXXX`）→ 逐筆 addItem；方向 `receive_from_supplier` 選供應商、`send_to_store` 選門市
  - 明細數量/金額以 view `consignment_order_item_summary` 為準；退回/回報上限 = `remaining_quantity`
  - v1.3：出貨訊息改「已出貨（店家寄賣…）」、審核成功提示「已依店家開立收款銷貨單」、`OrderDetailDialog` ShipDialog 說明改「不開立銷貨單」、send_to_store 單已收貨時顯示綠色收貨橫幅（received_at）
- **門市端 `/sales-notes`**（`src/pages/store/SalesNotes.tsx`，v1.3 起為母頁）：Tabs（`?tab=consignment` 寄賣銷售回報 / `?tab=sales-notes` 銷貨單確認收貨）。寄賣 tab 查 direction=send_to_store active 單 + items + summary，Dialog 填數量/實際售價/備註 → `report_consignment_sale` RPC；銷貨單 tab 為原列表＋確認收貨 Dialog。`/consignment-sales` 舊路由改 `<Navigate to="/sales-notes" replace />`；sidebar 合併為單一「寄賣/銷貨」入口；`ConsignmentSales.tsx` 已刪除
- **逐項庫存來源選擇**（`inventory_source_type`）：
  - `src/components/order/OrderReviewPanel.tsx`：optional props `itemSources` / `onItemSourceChange`，SortableRow 加來源 Select（self / 供應商寄賣）；另支援 `consignmentMode` / `onConsignmentModeChange`（寄賣時隱藏逐列倉/來源、改顯示「店家寄賣」）
  - `src/pages/admin/ShippingPool.tsx`：出貨 Dialog 合併為單一「出貨來源」欄（自有倉／供應商寄賣 FIFO），組 `p_source_map` + `p_consignment_override_map` 傳 `ship_from_pool`
  - `src/pages/admin/AdminOrderForm.tsx` / `AdminOrderCheckout.tsx`：`itemSources` state，payload 帶 `inventory_source_type`、`direct_ship_order` 組 `p_source_map`；寄賣模式訂單隱藏來源選擇
- **AdminOrderForm 元件拆分**（近期重構）：`src/components/order/` 新增 `OrderInfoCard.tsx`（訂單資訊＋備註＋出貨倉/寄賣設定）、`OrderItemsPanel.tsx`（訂單項目）、`ProductSelector.tsx`（商品選擇，含 CatalogSidebar＋ProductCatalog＋檢視模式；`bare` prop 略過 Card wrapper 供行動 drawer 重用）。`AdminOrderForm` 以共用 JSX 變數 `orderInfoCard`／`orderItemsPanel`／`renderProductSelector(bare?)` 組合桌面與行動端。桌面（lg+）容器 `lg:h-[calc(100vh-320px)]`：左欄（`flex-1`）上下堆疊「訂單資訊（頂、`shrink-0`）＋訂單項目（下、填滿剩餘）」，右側固定寬度（`lg:w-[390px]`）商品選擇側欄，**可完全隱藏**（`desktopCatalogOpen` state）——隱藏時寬度歸零、左側填滿、上方顯示「展開商品選擇」按鈕，側欄頂部有 X 圖示收合。行動端（<lg）訂單資訊＋訂單項目內聯堆疊，商品選擇改**右側 drawer**（`fixed inset-y-0 right-0 w-full max-w-md`，關閉按鈕＋`renderProductSelector(true)` bare），未展開時以底部右側浮動圓形按鈕（`Package` 圖示）開啟、展開時隱藏；drawer 開關用獨立 `mobileCatalogOpen` state。`catalogSidebarMaxHeight` prop 限制 CatalogSidebar 最大高度
- **拆分行（同變體多行出貨，2026-09-05）**：`OrderItemsTable.tsx` 新增 `onSplit` prop＋拆分行按鈕（lucide `CopyPlus`，桌機表格最後一欄＋行動卡片右上，`isEditable && item.quantity > 1` 才顯示），經 `OrderItemsPanel.tsx` 透傳；`AdminOrderForm.handleSplitItem`：原行 `quantity-1`、於 `index+1` 插入 `quantity=1` 的 `isNew:true` 暫存行（id = `${base.id}__split-${Date.now()}` 避免與草稿 merge 衝突），並在使用者以成品目錄加入（合成 id）時同步 `draft.updateQuantity` 總量；save payload 對 `isNew` 行 id=null，`update_order_with_items` / pending insert 即為兩筆獨立 order_item。後端配套（`inventory_movements.order_item_id`＋放寬唯一索引＋4 支 RPC 帶入）見 `.agent/DATABASE.md` §6、migration `20260905000005`
- **退貨模組 UI（2026-09-06，migration `20260906000004`）**：
  - `src/components/sales/SalesReturnDialog.tsx`：銷貨退貨對話框。每品項輸入退貨數（上限 `quantity - returnedQuantity`）、倉庫選取（`useWarehouses`）、退款開關＋帳戶選取（`accounts` prop）、原因；RPC `process_sales_note_return`（金額與剩餘量由後端重算/驗證），成功 invalidate `admin-sales-notes`/`store-sales-notes`/`accounts`/`accounting-entries`/`inventory-list`
  - `SalesNoteDetailDialog.tsx`：`SalesNoteItem` 加 `returnedQuantity?: number`；props 加 `enableReturn`（預設 false，admin 專用；業務 `isRep` 為 false）。accounts query `enabled: open && (enablePayment || enableReturn)`。桌機表格＋行動卡片在 `returnedQuantity>0` 顯示「已退 N」橙色 Badge；狀態 shipped/received 且 `enableReturn` 時顯示「退貨登記」按鈕（RotateCcw 灰/橙），觸發 `<SalesReturnDialog>`
  - `src/pages/admin/SalesNotes.tsx`：查詢 select 帶 `returned_quantity`；`tableData` 加 `hasReturned`（任一 item returned_quantity>0）；`SalesNoteListTable.tsx` 在狀態列（桌機＋手機卡片）顯示「已退貨」Badge；`<SalesNoteDetailDialog enableReturn={!isRep}>`
  - `src/pages/admin/purchase-orders/components/PurchaseReturnDialog.tsx`：採購退貨對話框。每品項可退數上限 `received_quantity - returned_quantity`、退貨倉（預設 own）、沖帳入帳帳戶（金額>0 必填）、原因；RPC `process_purchase_return`；invalidates `purchase-order-items`/`purchase-orders`/`inventory-list`/`accounts`/`accounting-entries`
  - `PurchaseOrderDetailDialog.tsx`：表格加「已退」欄；底部操作列新增「廠商退貨」按鈕（RotateCcw，`receivedCount===0` 時 disabled）；`usePurchaseOrders.returnItemsMutation` 回傳至 `onReturnItems`。門市端 `store/SalesNotes.tsx` 查詢帶 `returned_quantity` 並映射 `returnedQuantity`（僅顯示，無退貨權限）
- **拆分後直接轉銷貨單修正（2026-09-09）**：`AdminOrderForm` 的 Direct Ship Dialog（`directShipMutation`，處理中訂單「轉銷貨單」／寄賣出貨）原本直接呼叫 `direct_ship_order`（RPC 只讀 DB `order_items`），本地拆分行（`isNew`、未儲存）會遺失導致銷貨單品項缺漏、總數錯誤。修正：抽出共用 `buildItemsPayload()`（updateOrderMutation 與 directShipMutation 共用），`directShipMutation` 出貨前**先 `update_order_with_items` 持久化本地拆分/刪除**（失敗即 throw 不出貨）再呼叫 `direct_ship_order`。列表頁批次（OrderListPage）讀 DB 直接出貨不受影響
- **刪除訂單 UI（2026-09-09，RPC `delete_order_if_unadopted`）**：訂單列表 `pending`/`processing` tab 且 `viewMode='orders'` 時，BatchActionBar（桌機 pill＋行動 footer）新增「刪除」destructive 按鈕；`OrderDetailDialog` 新增選擇性 `onDeleteOrder` prop（admin 訂單列表傳入才顯示「刪除訂單」按鈕；store／accounting ReferenceViewer 引用處不顯示）；`OrderListPage.deleteOrderMutation` 逐單呼叫 RPC，成功計數 toast，失敗彙總 reason toast（migration `20260909000003` 起 RPC 回傳 `adopted_by` 採用明細，前端把 reason 拼上「（銷貨單 SL…、採購單 PO…）」），成功 invalidate `admin-orders`；刪除前 `confirm` 二次確認。庫存異動檢查改為 `order_items.shipped_quantity > 0`（已出貨但未回補才擋），庫存已歸零的歷史異動紀錄不阻擋刪除（`fix_delete_order_use_shipped_quantity`）
- **銷貨單/採購單刪除守門前端（2026-09-09，migration `20260909000003`/`20260909000004`）**：`SalesNotes.tsx deleteMutation` 解析 `delete_sales_note` RPC 的 JSONB 回傳，`ok!==false` 才成功、失敗 reason 顯示於 toast（hint「請先處理會計/佣金/寄賣紀錄」）；`usePurchaseOrders.deleteOrderMutation` 由原生 `DELETE FROM purchase_orders` 改用 `delete_purchase_order_if_empty` RPC，`{ok:false}` 時以「reason + adopted_by label」toast（已收貨→「請改用採購退貨」、有庫存異動/會計分錄同理）

## 8. 組件架構重點

- 既有文件 `.agent/COMPONENT_ARCHITECTURE.md` 記錄訂單相關組件樹（OrdersTableView/CardsView、ItemsTableView/CardsView、OrderDetailDialog 等），此部分不再重複，需要時直接讀該檔
- 響應式策略：電腦版 `*TableView.tsx`、手機版 `*CardView.tsx`，用 Tailwind `hidden md:block` / `md:hidden` 切換
- 容器/展示分離：頁面處理資料與邏輯，子組件專注渲染

## 9. 其他 utils

- `src/utils/SpecEngine.ts`、`specLogic.ts`、`specTree.ts`、`specSerializer.ts`、`specFormatter.ts`：規格引擎 v6 前端實作
- `src/utils/productModelResolver.ts`：產品/變體 ↔ 型號關聯解析（`buildModelMaps`、`processEntityModels`）
- `src/utils/excelImport.ts` / `excelExport.ts` / `templateImport.ts` / `templateExport.ts`：Excel 匯入/匯出與訂單範本
- `src/lib/`：`supabase-helpers.ts`（型別工具）、`formatters.ts`、`order-grid-utils.ts`、`errorMessages.ts`、`exportUtils.ts`、`utils.ts`

## 10. Edge Functions（supabase/functions/）

| Function | 用途 |
|---|---|
| `check-data-version` | 增量 Diff 引擎：收到 tableName + lastSequenceId，比對 data_change_logs/data_versions，回傳增量 changes/deletedIds 或全量 snapshot |
| `invitation-service` | 邀請加入門市 |

> Edge Function 內有 `TABLE_VERSION_ALIASES` 別名映射（specification_definitions → specs 等）。
