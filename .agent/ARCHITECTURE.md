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

## 3. 狀態管理（src/store/）

| Store | 用途 |
|---|---|
| `useSpecStore` | 規格定義/分類快取（`fetchSpecs`、`fetchCategories`，接受 Edge Function 增量資料） |
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
- **出貨池**：`ShippingPool.tsx` 用 `ship_from_pool` RPC 依門市批次出貨
- **整單寄賣模式**（v1.1）：`AdminOrderForm.tsx` 建立訂單時可切換「寄賣模式」Switch → 送 `create_order_with_sales_note(p_consignment_mode)` 或 pending insert 帶 `orders.consignment_mode=true`；出貨（pool / direct ship / 下單即出貨）時 DB 端 `create_consignment_shipment_layer` 自動建 send_to_store 寄賣單
  - `ShippingPool.tsx`：查詢帶 `order:orders(code, consignment_mode)`，寄賣品項出貨 Dialog 不顯示倉/來源選擇（固定 store_consignment）
  - 訂單列表/明細顯示「寄賣」Badge（`OrderTableView.tsx`、`OrdersCardView.tsx`、`OrderInfo.tsx`）

## 7b. 寄賣系統 v1（前端）

- **後台 `/admin/consignment`**（`src/pages/admin/consignment/`）：
  - `index.tsx`：Tabs（寄賣單 / 銷售回報審核，審核 tab 帶 pending 數 badge）
  - `hooks/useConsignment.ts`：資料 queries（suppliers/stores/products/orders/pendingReports/accounts/warehouses）+ `useOrderDetail`（內嵌查 items + summary + settlements + sales）+ mutations（createOrder / addItem / removeItem / cancelOrder / receiveItems / ship / confirmReports / rejectReport / returnItems / settle），全部用 `useSupabaseAction`（自動 toast + invalidate）
  - `components/`：`OrderListTab.tsx`、`CreateOrderDialog.tsx`、`OrderDetailDialog.tsx`（內嵌 Receive/Ship/Return/Settle 四 Dialog）、`ReportsTab.tsx`
  - 建立流程兩步：insert 表頭（`code='TMP'`，trigger 產 `CS-YYMMDD-XXXXX`）→ 逐筆 addItem；方向 `receive_from_supplier` 選供應商、`send_to_store` 選門市
  - 明細數量/金額以 view `consignment_order_item_summary` 為準；退回/回報上限 = `remaining_quantity`
- **門市端 `/consignment-sales`**（`src/pages/store/ConsignmentSales.tsx`）：用 `useAuth` 取得 `storeId`，查 direction=send_to_store 的 active 訂單 + items + summary，Dialog 填數量/實際售價（空=建議售價）/備註 → `report_consignment_sale` RPC
- **逐項庫存來源選擇**（`inventory_source_type`）：
  - `src/components/order/OrderReviewPanel.tsx`：新增 optional props `itemSources` / `onItemSourceChange`，SortableRow 加來源 Select（self / 供應商寄賣）
  - `src/pages/admin/ShippingPool.tsx`：出貨 Dialog 逐項選來源，組 `p_source_map` 傳 `ship_from_pool`
  - `src/pages/admin/AdminOrderForm.tsx` / `AdminOrderCheckout.tsx`：`itemSources` state，payload 帶 `inventory_source_type`、`direct_ship_order` 組 `p_source_map`

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
