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
| `admin.tsx` | `/admin/*`（約 21 條，含 `/admin/consignment`、`/admin/repair-parts`） | `ProtectedRoute requireAdmin` + `AppLayout` |
| `store.tsx` | `/dashboard`、`/orders`、`/cart`、`/catalog`、`/sales-notes`、`/receiving`、`/accounting`、`/team`、`/audit`、`/notifications`、`/market/create`、`/market/my-listings`、`/consignment-sales`、維修單 4 條 | `ProtectedRoute` + `AppLayout` |
| `shared.tsx` | `/auth`、`/invite/:token`、`/share/order/:orderId`、`/share/sale/:salesNoteId`、`/share/consignment/:consignmentId`、`/share/statement/:statementId`、`*`（404） | 無（公開） |

- `ProtectedRoute`（src/components/ProtectedRoute.tsx）+ `AppLayout`（src/components/layout/AppLayout.tsx）
- **三支出貨 Dialog 配送＋同步至店鋪（2026-09-23）**：① 寄賣 ShipDialog（`src/pages/admin/consignment/components/ShipDialog.tsx`）重寫為自含 form——`['store-info', storeId]`（`staleTime: Infinity`）查店家（含 `default_delivery_*`）、`ShippingDeliveryFields`（類型＋物流方式/追蹤）、logistics 展開 `ShippingAddressFields`＋「套用店家最新地址」＋「同步至店鋪」checkbox（配送地址與店家異動自動勾選、套用店家地址後不勾）；初始化 effect 用 `didInitRef`＋deps `[storeId, storeInfo?.id]`（訂單快照只套一次、storeInfo 非同步到達後才補店家預設/地址，不覆寫使用者輸入）。② 出貨池 `ShipDialog`（`src/pages/admin/shippingPool/`）：`useShipDelivery.setStoreSync`，每店家 logistics 地址區下方「出貨後將配送地址同步至店鋪」checkbox（不一致自動勾選、不主動取消）。③ 訂單列表/表單共用 `DirectShipDialog`（`src/components/orders/DirectShipDialog.tsx`）繼承訂單既有配送並同步至店鋪。**同步至店鋪僅回寫 `stores` 收件人/電話/郵區/縣市/鄉鎮/地址六欄，不回寫 `default_delivery_*`**（配送為單據層、預設為店家層）。成功皆 invalidate `['stores']/['store-info']`。
- **客戶對帳單分享（2026-09-24）**：admin 銷貨單頁（`SalesNotes.tsx`）CardHeader「對帳單」按鈕（僅 `!isRep`）→ `CustomerStatementDialog`（`src/components/sales/CustomerStatementDialog.tsx`）：list/create/created 三視圖，選店家（`StorePicker` 單選）＋日期範圍（Calendar，預設本月 1 號~今天），標題自動產生可改（內聯編輯），建立後顯示分享連結＋QR（`qrcode.react`），可刪除（confirm）。資料層 `useCustomerStatements`（`src/hooks/useCustomerStatements.ts`，queryKey `["customer-statement-shares"]`）操作新表 `customer_statement_shares`（RLS 僅 admin，未進 types.ts 統一 `(supabase as any).from`）；分享連結格式 `/share/statement/{id}?token={access_token}`。公開分享頁 `SharedCustomerStatement`（`src/pages/share/SharedCustomerStatement.tsx`，路由 `/share/statement/:statementId`）ajax 呼叫 `get_shared_customer_statement` RPC（免登入，價格一律顯示）：標題＋店家＋區間、彙總卡（張數/總件數/總金額，前端計算）、每單 Card 以 `Collapsible` 展開品項表＋運費＋備註，並有「檢視完整單據」深層連結 `/share/sale/{code}?token={note.access_token}` 開新分頁；無連動 `SharedReceiptExport`。
- **物流管理統包頁（2026-09-21）**：`/admin/logistics`＝`src/pages/admin/logistics/LogisticsPage.tsx`，側欄單一入口「物流管理」取代原「運費月結／配送方式」兩項。頁面自持 `PageHeader`（物流管理）＋`Tabs` 嵌入兩子頁（`?tab=delivery-methods|shipping-settlements` URL 路由）。`DeliveryMethodsPage`／`ShippingSettlementsPage` 新增 `embedded?: boolean`（embedded 時隱藏各自 PageHeader、action 按鈕改置頂右側 inline row，避免雙標題）；舊路由 `/admin/delivery-methods`、`/admin/shipping-settlements` 改 `<Navigate>` redirect。共用配送地址組件 `ShippingAddressFields` 縣市/鄉鎮市區改 `SearchableSelect`（`src/utils/taiwanAddress.ts`，鄉鎮 subLabel 顯示郵遞區號、無縣市時 disabled）。**（2026-09-21 追加）** `ShippingAddressFields` 再新增「完整地址（自動分欄）」欄（失焦以 `parseTaiwanAddressText` 解析、僅覆寫非空欄位，郵區可省略、缺縣市時以 `cityOfDistrict` 反查）＋郵遞區號欄可編輯失焦以 `getCityDistrictOfPostal` 反查縣市/鄉鎮＋`hideContact` prop；`taiwanAddress.ts` 新增 `cityOfDistrict`／`getCityDistrictOfPostal`。`StoresTab` 新增「營業地址」欄位組＋「收件地址同營業地址」複製勾選（stores.business_*，勾勾狀態持久於 `stores.delivery_address_matches_business`，2026-09-29 補；配送欄位組改以 `ShippingAddressFields hideAddress={sameAsBusiness}` 恆渲染，勾勾時僅留收件人/電話）。
- **維修零件型錄（2026-09-27）**：新路由 `/admin/repair-parts`（`src/pages/admin/repair-parts/RepairPartsPage.tsx`，default export）＋側欄「維修零件」。頁面含搜尋/型號 scope/標籤過濾/顯示停用、桌機表格＋行動卡片、庫存與成本售價摘要、編輯（`RepairPartFormDialog`）、刪除（**有 links 時前端擋下**）、`RepairPartTagsManager.tsx`（標籤字典）、`RepairPartBatchCreateDialog.tsx`（列出尚未被型錄綁定的維修零件商品，勾選＋命名＋選型號（留空＝通用），多變體自動展開為 `spec_label` links，第一筆為預設）。維修單端：`ItemsFieldsSection.tsx` 改用 `RepairPartPicker`（catalog／manual 雙模式）、`DeviceBlockSection.tsx` 透傳 `onEditPart`／`onCreatePart`；admin `repair-orders/new.tsx` 存 `repair_part_id` 並保留扣料與採購行為，store 端 `saveItems()` 同步品項但**不觸發庫存扣減**。schema 細節見 `.agent/DATABASE.md`。
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
| `useCreateOrder.ts` | 建立訂單 mutation（insert orders → order_items）；Phase D 支援 optional `deliveryMethod/shippingAddress` 快照（`delivery_method_id/title/code`＋`shipping_fee`＝method.price＋`shipping_address`），return 含 `shippingFee/grandTotal` |
| `useRepairOrders.ts` | 維修單 CRUD；detail query 帶 `repair_part:repair_part_id(id,name,tags)` 供明細顯示 catalog tags |
| `useRepairParts.ts` | **維修零件型錄（2026-09-27）**：零件/links/標籤 CRUD ＋ `useRepairPartProductOptions()`（links 編輯器與批次建立共用）＋ `partLabelOf`／`resolveLinkOf`。管理頁 `/admin/repair-parts` |
| `useShipments.ts` | 包裹（`shipments`）讀取與 mutations：`useShipments(docType, docId)`、**`useShipmentMutations(docType, docId)`**（`upsertMutation`／`deleteMutation`／**`setDeliveryTypeMutation`（2026-10-01，呼叫 `set_doc_delivery_type` 切換 order/sales_note/consignment_order 的配送類型，`{ok:false}` 轉為例外走統一 toast）**），共用於三層單據的 `ParcelManager` |
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
- **建立**：`useCreateOrder` → insert `orders`（Phase D：門市結帳先套用店家預設配送方式，快照 `delivery_method_id/title/code`＋`shipping_fee`＝method.price＋`shipping_address`）→ insert `order_items`；總額＝商品金額＋運費（`grandTotal`）
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
- **訂單列表批次「轉寄賣」=建立草稿不立即出貨**（v1.6，2026-09-08）：`OrderListPage.tsx` 的 `convertToConsignmentMutation` 由舊「先標 `consignment_mode=true` 再逐單 `direct_ship_order` 立即出貨」改為逐單呼叫新 RPC `convert_order_to_consignment_draft`（見 DATABASE.md）：守門 pending＋有未出貨量＋非寄賣鏡像單，建立 `send_to_store` **draft** 寄賣草稿＋鏡像 `consignment_order_items`（`order_item_id` 回填、維持 `waiting`、不扣庫存）；重跑回傳既有草稿（`reused:true`）。寄賣模式按鈕/對話框文案改「轉寄賣（草稿）／確認轉寄賣／待轉寄賣（未出貨）」，成功 toast「已轉為寄賣草稿（未出貨），可至寄賣管理調整後再出貨」。未出貨品項至寄賣管理草稿頁 `EditItemsDialog` 調整後再出貨（`create_consignment_shipment`）。`BatchActionBar.tsx`「轉寄賣」標籤同步改「轉寄賣（草稿）」
- **`BatchActionBar` 批次列修正**（v1.5）：`OrderListPage.tsx` 計算 `hasConsignmentSelection`/`hasNormalSelection`/`allSelectedConsignment` 三旗標傳入；processing tab「轉銷貨單」「轉寄賣」僅 `hasNormalSelection` 顯示、「寄賣出貨」（沿用 `onDirectShipOrders` → `direct_ship_order` RPC，寄賣單出貨不開銷貨單）僅 `hasConsignmentSelection` 顯示、混合選取時兩組之間加 `w-px` 分隔線、「轉出貨池」恆顯示；`DirectShipDialog` 於 `allSelectedConsignment` 時標題「寄賣出貨」、描述改寄賣語意、確認鈕「確認寄賣出貨」；`directShipMutation` 成功 toast 依選取是否全為寄賣改顯示「已寄賣出貨 N 個訂單」

## 7b. 寄賣系統 v1（前端）

- **後台 `/admin/consignment`**（`src/pages/admin/consignment/`）：
  - `index.tsx`：Tabs（寄賣單 / 銷售回報審核，審核 tab 帶 pending 數 badge）
  - `hooks/useConsignment.ts`：資料 queries（suppliers/stores/products/orders/pendingReports/accounts/warehouses）+ `useOrderDetail`（內嵌查 items + summary + settlements + sales）+ mutations（createOrder / addItem / removeItem / cancelOrder / receiveItems / ship / confirmReports / rejectReport / returnItems / settle / updateItem / reverseShipment），全部用 `useSupabaseAction`（自動 toast + invalidate）。`invalidateAll` 已納入 `['shipping-pool']`/`['shipping-pool-items']`；`updateItemMutation`（send_to_store 且 `order_item_id` 存在時同步鏡像 `order_items.quantity/unit_price`）、`reverseShipmentMutation`（rpc `reverse_consignment_shipment`，invalidate consignment/admin-orders/shipping-pool/inventory-*）；`cancelOrderMutation`（2026-09-25）依狀態分流——draft＝`delete_consignment_draft_if_clean` 完整刪除（連帶刪 pending 鏡像來源訂單），非 draft＝標 `cancelled`＋pending 來源訂單先 `delete_order_if_unadopted`
  - `components/`：`OrderListTab.tsx`、`CreateOrderDialog.tsx`、`OrderDetailDialog.tsx`（內嵌 Receive/Ship/Return/Settle/Reverse/Edit 六 Dialog）、`ReportsTab.tsx`
  - 建立流程兩步：insert 表頭（`code='CS-DRAFT-{id8}'` 暫存碼，draft→active 時 trigger 產 `CS{YYMM}{店碼}{0001}`）→ 逐筆 addItem；方向 `receive_from_supplier` 選供應商、`send_to_store` 選門市
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
  - ~~`src/components/sales/SalesReturnDialog.tsx`~~（**已刪除，2026-09-24**）：銷貨退貨對話框；RPC `process_sales_note_return` 亦已刪除。銷往門市的退貨/換貨/送修改為**訂單層**處理——`src/components/order/OrderReturnProcessDialog.tsx`（admin 訂單詳情「處理退貨」按鈕）選取 pending return 列＋action（退庫存退款／標記換貨／標記送修歸還），stock 時帶倉庫＋退款帳戶＋expense 分類，呼叫 RPC `process_order_return_lines`，成功 invalidate `admin-orders`/`inventory-list`/`accounts`/`accounting-entries`。詳情品項顯示 `LineTypeBadge`（`sale/exchange/return` 徽章＋return 的 `pending/stock/exchange/repaired` 微牌）。return 列全線排除出貨/需求/採購/寄賣並於總額、佣金、分享頁負數淨扣
  - `SalesNoteDetailDialog.tsx`：`SalesNoteItem` 加 `returnedQuantity?: number`；props 加 `enableReturn`（**2026-09-24 已移除**，舊退貨登記入口全數刪除）。桌機表格＋行動卡片在 `returnedQuantity>0` 顯示「已退 N」橙色 Badge；**2026-09-30** 另加退貨列徽章（`lineType` 為 `return`/`exchange` 時顯示「退貨」／「換貨」muted 小徽章）
  - **撤銷誤標退貨（2026-09-30，migration `20260930000002`，RPC `revert_order_return_line`）**：`src/components/order/OrderReturnRevertDialog.tsx`（新建）——admin 訂單詳情在**任一** `line_type='return'`（不限 `return_status`，因誤標常已是 `stock`）時顯示「撤銷退貨」按鈕（`OrderReturnRevertDialog` 在 `OrderListPage` 持有 state，經 `OrderDetailDialog` 的 `onRevertReturnLines?` callback 開啟；**區別於「處理退貨」仍限 pending**）。對話框以 `sales_note_items` join `sales_notes` 逐一檢查阻擋條件（已收貨 / 會計分錄 entry row＋`accounting_entry_references` 雙路徑 / 業務佣金已發放 / 寄賣確認銷售 / `inventory_source_type !== 'self'`），被擋列以 `opacity-70` ＋停用輸入並附 `BLOCK_HINTS` 人工處理指引；`revertMutation` 逐列呼叫 RPC，`{ok:false}` throw 後 toast `reason`。⚠️ **僅還原誤標、不退款**；已收款／已收貨列須先至會計模組回退收款
  - **退貨列防誤加（2026-09-30）**：`useSalesNoteCorrectQueries` 的 `orderCandidates` filter 原本引用未選取的 `oi.line_type` → 退貨列**未被排除**（既有 bug，已修：select 補 `line_type`）；`shipping_pool` 候選不 server 端過濾，改在 `CorrectAddTable` UI 停用退貨列數量輸入（`placeholder="—"`、`opacity-70`、「退貨品項不可追加出貨」），並在 `SalesNoteCorrectDialog` 組 `p_items_to_add` 時再過濾一次（防禦 state 殘留）。`PoolItem.order_item` 補 `line_type?` 型別
  - **`update_order_with_items` 送 payload 慣例（2026-09-30）**：`useOrderFormMutations` 以 `lineTypeFields()` **固定成組**送出 `line_type`／`line_note`／`return_status`／`is_repair`（非退貨列固定 `null`／`false`）——因後端以 `elem ? 'line_note' : oi.line_note` 判斷「是否為 null」，省略 key 會保留舊值並觸發 `23514`（CHECK：僅 return 列可帶 return_status/is_repair）。另注意後端守門（`20260930000003`）已把 **`line_type` 差異併入已收款擋下判定**，已收款訂單不可改打單性質
  - `src/pages/admin/SalesNotes.tsx`：查詢 select 帶 `returned_quantity`；`tableData` 加 `hasReturned`（任一 item returned_quantity>0）；`SalesNoteListTable.tsx` 在狀態列（桌機＋手機卡片）顯示「已退貨」Badge；`<SalesNoteDetailDialog enableReturn={!isRep}>`
  - `src/pages/admin/purchase-orders/components/PurchaseReturnDialog.tsx`：採購退貨對話框。每品項可退數上限 `received_quantity - returned_quantity`、退貨倉（預設 own）、沖帳入帳帳戶（金額>0 必填）、原因；RPC `process_purchase_return`；invalidates `purchase-order-items`/`purchase-orders`/`inventory-list`/`accounts`/`accounting-entries`
  - `PurchaseOrderDetailDialog.tsx`：表格加「已退」欄；底部操作列新增「廠商退貨」按鈕（RotateCcw，`receivedCount===0` 時 disabled）；`usePurchaseOrders.returnItemsMutation` 回傳至 `onReturnItems`。門市端 `store/SalesNotes.tsx` 查詢帶 `returned_quantity` 並映射 `returnedQuantity`（僅顯示，無退貨權限）**品項搜尋（2026-09-20）**：頂部搜尋列以 trim＋toLowerCase 過濾產品/變體/SKU/`vendor_product_id`/`vendor_product_name`/來源訂單字串，`visibleItems` memo 驅動表格渲染與空狀態分流，匯出/存檔組裝與 `liveTotal` 維持全量，`isFiltering` 時停用拖曳排序；原檔 `OrderDetailDialog.tsx` 已 `git mv` 更名為本檔名
- **拆分後直接轉銷貨單修正（2026-09-09）**：`AdminOrderForm` 的 Direct Ship Dialog（`directShipMutation`，處理中訂單「轉銷貨單」／寄賣出貨）原本直接呼叫 `direct_ship_order`（RPC 只讀 DB `order_items`），本地拆分行（`isNew`、未儲存）會遺失導致銷貨單品項缺漏、總數錯誤。修正：抽出共用 `buildItemsPayload()`（updateOrderMutation 與 directShipMutation 共用），`directShipMutation` 出貨前**先 `update_order_with_items` 持久化本地拆分/刪除**（失敗即 throw 不出貨）再呼叫 `direct_ship_order`。列表頁批次（OrderListPage）讀 DB 直接出貨不受影響
- **刪除訂單 UI（2026-09-09，RPC `delete_order_if_unadopted`）**：訂單列表 `pending`/`processing` tab 且 `viewMode='orders'` 時，BatchActionBar（桌機 pill＋行動 footer）新增「刪除」destructive 按鈕；`OrderDetailDialog` 新增選擇性 `onDeleteOrder` prop（admin 訂單列表傳入才顯示「刪除訂單」按鈕；store／accounting ReferenceViewer 引用處不顯示）；`OrderListPage.deleteOrderMutation` 逐單呼叫 RPC，成功計數 toast，失敗彙總 reason toast（migration `20260909000003` 起 RPC 回傳 `adopted_by` 採用明細，前端把 reason 拼上「（銷貨單 SL…、採購單 PO…）」），成功 invalidate `admin-orders`；刪除前 `confirm` 二次確認。庫存異動檢查改為 `order_items.shipped_quantity > 0`（已出貨但未回補才擋），庫存已歸零的歷史異動紀錄不阻擋刪除（`fix_delete_order_use_shipped_quantity`）
- **銷貨單/採購單刪除守門前端（2026-09-09，migration `20260909000003`/`20260909000004`）**：`SalesNotes.tsx deleteMutation` 解析 `delete_sales_note` RPC 的 JSONB 回傳，`ok!==false` 才成功、失敗 reason 顯示於 toast（hint「請先處理會計/佣金/寄賣紀錄」）；`usePurchaseOrders.deleteOrderMutation` 由原生 `DELETE FROM purchase_orders` 改用 `delete_purchase_order_if_empty` RPC，`{ok:false}` 時以「reason + adopted_by label」toast（已收貨→「請改用採購退貨」、有庫存異動/會計分錄同理）
- **銷貨單修正 UI（2026-09-11，migration `20260911000007_correct_sales_note.sql`）**：
  - `src/components/sales/SalesNoteCorrectDialog.tsx`（新建）：三個區塊——① 目前品項 checkbox 勾選移除（退回出貨池；已退貨品項 disabled）；② 追加品項兩個子區塊（同店家出貨池→query `shipping_pool`（`enabled: open && storeId`）；同店家 pending/processing 訂單未出貨量 `quantity - shipped_quantity > 0`，各自數量輸入上限 clamp）；③ 完全新品（`SearchableSelect` 產品/變體選項由 `useProductCache()` 過濾 `item_type≠repair_part/shipping`＋`!is_hidden` 建出，數量/單價輸入，加入後可刪除）。底部原始/修正後總額（`correctedTotal = original − removed + added`）與「新品將自動建立新訂單」警示；提交經 `(supabase.rpc as any)('correct_sales_note', { p_sales_note_id, p_items_to_remove, p_items_to_add, p_new_items, p_created_by })`（jsonb 陣列**直接傳、勿 stringify**），成功 invalidate `admin-sales-notes`/`store-sales-notes`/`admin-orders`/`shipping-pool-items`/`inventory-list`；**須至少移除／追加／新品其一才可送出**
  - `SalesNoteDetailDialog.tsx`：`SalesNoteDetail` interface 加 `store_id`（必填，供出貨池/訂單查詢過濾店家）；props 加 `enableCorrect?`（預設 false）；`enableCorrect && note.status !== 'received' && note.payment_status !== 'paid'` 時顯示藍色「修正」按鈕（Pencil）並渲染 `<SalesNoteCorrectDialog>`（繼承既有 `SalesReturnDialog` 的 open/note pattern）
  - `src/pages/admin/SalesNotes.tsx`：`dialogData` 映射補 `store_id`；`<SalesNoteDetailDialog enableCorrect={!isRep}>`（業務無修正權）。Store 端 `store/SalesNotes.tsx` 與會計 `ReferenceViewer.tsx` 維持預設 false（RPC 僅 admin，不接線）
- **供應商編輯＋物流公司身分（2026-09-21）**：`purchase-orders/types.ts` `Supplier` 補 `is_logistics_company`；`usePurchaseOrders` 新增 `updateSupplierMutation`（update by id，invalidate `['suppliers']`/`['delivery-methods-logistics-suppliers']`/`['shipping-suppliers']`，create 亦補後兩者）；`SupplierForm` 支援編輯（`initial?` prop＋「物流公司」Checkbox）；`SupplierTab` 加每卡「編輯」按鈕與「物流」徽章；`PurchaseOrdersPage` 加編輯 Dialog。物流公司為身分牌（可與採購供應商並存），配送方式（`type='logistics'`）與運費月結依此篩選。
- **寄賣雙視角（2026-09-12；2026-09-26 元件已遷移）**：`ConsignmentPage` 新增「訂單視角／店家視角」切換（searchParams `view` 持久化）。店家視角**元件已於 2026-09-25 遷移**為共用 `src/components/consignment/ConsignmentGroupedView.tsx`（原 `src/pages/admin/consignment/components/StoreViewTab.tsx` 已刪除）：`send_to_store` 依目標店家分組、`receive_from_supplier` 依供應商分組（`consignment_order_items` 以 `quantity×unit_price` 加總為組內總額），組內列出各單 code/狀態 badge/日期/總額＋查看按鈕（開既有 `OrderDetailDialog`）。`useConsignment` orders query select 增加 `consignment_order_items(id, quantity, unit_price)`（供前端加總，無需後端聚合）
- **寄賣共用視角手機排版（2026-09-26）**：`src/components/consignment/` 依「型別／資料／呈現」拆分，門市 `/sales-notes?tab=consignment` 與後台 `/admin/consignment?view=partner` 共用同一元件（`onView` 型別泛型 `T extends ConsignmentViewOrder`，props 與三個 action slot 簽稱不變，**呼叫端零改動**）：
  - `consignmentViewTypes.ts`：view 型別（`ConsignmentProductRow` 新增可選 `dateCells?: ConsignmentProductDateCell[]` 供手機卡顯示各日給貨數）
  - `consignmentViewData.ts`：衍生邏輯（`buildPartnerGroups`／`buildPivotGroups`／`orderTotals`／`deliveredOf`／`directionLabel` ＋ `ViewMode`／`ColumnMode`／`PartnerGroup`／`PivotProduct`／`PivotGroup`／`CollapseApi`）。`buildPivotGroups` 填非零 `dateCells`；`PivotProduct.defaultReportTarget` 維持 FIFO 語意（`received_at` 有值、剩餘>0、非 cancelled，依日期升冪、同日依單號）
  - `consignmentViewParts.tsx`：`StatusBadge`／`ReceivedBadge`／`PartnerHeader`／`GroupFooter`／`ViewToolbar`
  - `ConsignmentOrdersView.tsx`：桌機表格逐欄原樣保留＋手機訂單卡（**品項預設收合**、收合時卡片右側顯示總額、訂單展開 trigger 與查看／動作鈕為 sibling）
  - `ConsignmentProductsView.tsx`：桌機商品×日期矩陣＋手機商品卡（商品名／給貨／剩餘／回報鈕，各日明細以 `Collapsible` 預設收合、只列非零日期）。**頂部另有產品名稱搜尋**（`Input type="search"` ＋清除鈕，狀態為元件內部 `useState`；`filteredGroups` 以 `useMemo` 過濾商品列並一併濾掉無命中的整個群組）。搜尋同時比對**變體名與產品名**（`ConsignmentProductRow.productName`，僅供比對不顯示），因顯示名為變體優先
  - `ConsignmentGroupedView.tsx`：薄殼，切換標籤「全部訂單」／「商品」；斷點 `md`（768px）桌機 `hidden md:block`、手機 `md:hidden`（純 CSS，未用 `useIsMobile`）。**手機商品視角不顯示「只看剩餘」**（`columnToggleOnMobile` 僅訂單視角為 true）。**展開狀態以單一 override map 存放**：未記錄者桌機預設展開、手機預設收合；「全部展開／全部收合」寫入所有訂單明確值，故同一份 state 同時服務兩種預設
  - `PageHeaderConfig.mobileOnly?: boolean`：標題／動作鈕**僅供 `MobileHeader`**，`DesktopHeader` 據此略過。供「桌機頁面內自渲染大型 h1」的頁面（`ConsignmentPage`）使用，避免兩個 Header 同時出現造成標題重複；頁面以 `useLayoutEffect` 設定並於 cleanup 清除，deps 只留穩定的 `setPageHeader`（勿在 deps 內放 inline callback，會重演 Maximum update depth）
  - `src/pages/store/SalesNotes.tsx`：寄賣 Tab 訂單列「已出貨／已回報」計數由 `hidden sm:inline text-sm` 改為 `text-xs`（手機可見、不超寬）
  - **無 query／migration／RLS／後端改動**

- **變體名稱單一顯示（全站 UI 慣例，2026-09-12）**：品項名稱一律「有變體只顯示變體名（`variant?.name`），無變體才回退產品名」；**商品卡容器（代表整支商品：商品卡片、Dialog 標題、BrandPricing、AddProductCard 的 `code - name` 等）保留產品名**。共改 15+ 處：`OrderItemsTable`（getComponentInfo 已 variant 優先，移除 compact「name - variant」重複與詳情/卡片子列）、`ItemsTableView`、orders/list `ItemTableView`/`AggregateTableView`/`AggregateCardsView`、store `SalesNotes` 寄賣回報表、PO `PurchaseOrderDetailDialog`/`ReceivingTab`/`ImportFromOrdersDialog`、consignment `OrderDetailDialog`（明細＋編輯品項）/`ReportsTab`、`OrderReviewPanel`、`CartPanel`、`OrderGridProductPicker` 已選 badge、`useInventory`（name＝variant、specs 欄改顯示所屬產品名）、`ProductDetailDialog` 加購物車 toast、accounting `ReferenceViewer`。天然已合規：`SharedReceiptExport`（`variant ?? name`）、`SalesNoteDetailDialog`、維修零件名（`part_name || variant?.name || product?.name`）、repair detail 兩頁、`PurchaseReturnDialog`

## 8. 組件架構重點

- 既有文件 `.agent/COMPONENT_ARCHITECTURE.md` 記錄訂單相關組件樹（OrdersTableView/CardsView、ItemsTableView/CardsView、OrderDetailDialog 等），此部分不再重複，需要時直接讀該檔
- 響應式策略：電腦版 `*TableView.tsx`、手機版 `*CardView.tsx`，用 Tailwind `hidden md:block` / `md:hidden` 切換
- 容器/展示分離：頁面處理資料與邏輯，子組件專注渲染
- **配送類型與包裹（2026-10-01）**：`src/components/shipping/ParcelManager.tsx` 新增 `deliveryType?: string | null` prop 與 `DeliveryTypePicker`（複用 `DeliveryMethodPicker` 的 `DeliveryType`/`TYPE_LABEL`）——`editable` 時可切換送貨/物流/自取，切為非物流且已有包裹時以 `window.confirm` 確認（會移除包裹與追蹤號），**物流才渲染包裹清單與「新增包裹」**，唯讀時顯示「配送類型：X」；未傳 `deliveryType` 的舊呼叫端回退以 `shipments.length > 0` 判斷。三個詳情接線傳 `deliveryType`：`components/order/OrderDetailDialog`、`components/sales/SalesNoteDetailDialog`（`SalesNoteDetail` 需含 `delivery_type`）、`pages/admin/consignment/components/OrderDetailDialog`。銷貨單的 `delivery_type`／`shipping_fee`／`shipping_cost`／`delivery_method_*`／`shipping_address` 須在三處 mapping 帶入（`pages/admin/SalesNotes`、`pages/store/SalesNotes`、`pages/admin/accounting/components/ReferenceViewer`），否則「配送」列恆不顯示

## 9. 其他 utils

- `src/utils/SpecEngine.ts`、`specLogic.ts`、`specTree.ts`、`specSerializer.ts`、`specFormatter.ts`：規格引擎 v6 前端實作
- `src/utils/productModelResolver.ts`：產品/變體 ↔ 型號關聯解析（`buildModelMaps`、`processEntityModels`）
- `src/utils/excelImport.ts` / `excelExport.ts` / `templateImport.ts` / `templateExport.ts`：Excel 匯入/匯出與訂單範本
- `src/utils/variantReferenceCheck.ts`：`checkVariantReferences(variantIds)` 批次檢查 7 張業務表（order_items/purchase_order_items/inventory_movements/product_inventory/consignment_order_items/repair_order_items/supplier_product_mappings）是否引用指定變體，回傳 `{ok, referenced[]}`；`groupReferencesByVariant` 依變體聚合。對齊 RPC `delete_variant_if_safe` 的守門表清單
- `src/utils/lotTracking.ts`＋`src/components/purchase/LotInputFields.tsx`（2026-09-27，序號/批號追蹤）：`LotInput`/`TrackingMode`/`trackingModeOf`/`parseSerials`/`isLotValid` 共用型別與校驗；`LotInputFields` 為受控元件（serial＝textarea 逐行序號＋`已輸入 N/需 M`、batch＝批號＋批次成本、none 不渲染）。三收貨路徑（採購 `ReceivingTab`、`ReceiveForm`、維修 `RepairPurchaseDialog` 直接收貨）皆用它收集 lots 並組 `p_lots` 送 `receive_purchase_items`；庫存頁 `InventoryPage` 第四 tab「批次/序號」＝`src/pages/admin/inventory/components/BatchesTab.tsx`（product_batches ╳ variants/products/purchase_orders embed 清單＋搜尋）
- `src/lib/`：`supabase-helpers.ts`（型別工具）、`formatters.ts`、`order-grid-utils.ts`、`errorMessages.ts`、`exportUtils.ts`、`utils.ts`

## 10. 產品複製與變體批次編輯（2026-09-10）

- **`src/components/products/CopyProductDialog.tsx`**（三頁籤複製 wizard）：基本資訊／型號群組／選項群組＋預覽摘要。執行：先 `duplicate_product_with_variants`（完整複製，變體 SKU 帶 `-COPY-XXXX` 後綴），再依 `optionsChanged`／`modelsChanged` 分流——選項群組有改則 DELETE 複製變體後 `batch_upsert_product_options`（以 SKU 前綴重新生成），僅型號有改則重寫 `entity_model_relations`（帶 `sort_order`），皆未改則沿用複製結果。判別基準用 `originalGroupsRef`／`originalDeviceRefsRef` 快照比較。掛在 `ProductsPage`（列表「複製」按鈕）
- **`VariantBatchCreator.tsx` smart merge + 防孤兒**：`existingDbVariantsRef`（DB 變體含 `_dbId`）供 `mergeWithExisting` 依 `identityKey` 比對保存既有 SKU（RPC 依 SKU UPSERT 就地更新），避免加值/調價時產生重複或孤兒；`handleSave` 對「SKU 不在新組合」的既有變體跑 `checkVariantReferences`——無引用者存 `orphanCleanupRef`、RPC 成功後以 `delete_variant_if_safe` 清除；被引用者彈 `orphanConfirm` Dialog（列出引用 Badge）可返回調整或「仍要儲存（被引用者保留）」

## 10. Edge Functions（supabase/functions/）

| Function | 用途 |
|---|---|
| `check-data-version` | 增量 Diff 引擎：收到 tableName + lastSequenceId，比對 data_change_logs/data_versions，回傳增量 changes/deletedIds 或全量 snapshot |
| `invitation-service` | 邀請加入門市 |

> Edge Function 內有 `TABLE_VERSION_ALIASES` 別名映射（specification_definitions → specs 等）。
