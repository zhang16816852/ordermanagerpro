# StoreOrderList、StoreOrderEdit 和 OrderDetailDialog 組件重構

## 📋 概述
將 `StoreOrderList.tsx`、`StoreOrderEdit.tsx` 和 `OrderDetailDialog.tsx` 拆分成更小、更可維護的子組件。

## 🎯 重構目標
- **模塊化**：將大型組件拆分成小型、專注的子組件
- **可重用性**：創建可在其他地方重用的組件
- **可維護性**：使代碼更易於理解和修改
- **響應式設計**：分離電腦版和手機版的視圖邏輯

## 📦 新創建的組件

### StoreOrderList 相關組件

#### 1. `OrdersTableView.tsx`
- **用途**：電腦版訂單列表（表格佈局）
- **位置**：`src/components/order/OrdersTableView.tsx`
- **功能**：
  - 顯示訂單列表（表格格式）
  - 支持查看和編輯操作
  - 顯示訂單狀態、金額、時間等信息
  - 包含載入狀態和空狀態

#### 2. `OrdersCardView.tsx`
- **用途**：手機版訂單列表（卡片佈局）
- **位置**：`src/components/order/OrdersCardView.tsx`
- **功能**：
  - 卡片式顯示訂單
  - 適合觸控操作
  - 響應式設計
  - 包含載入骨架屏

#### 3. `ItemsTableView.tsx`
- **用途**：電腦版商品列表（表格佈局）
- **位置**：`src/components/order/ItemsTableView.tsx`
- **功能**：
  - 顯示訂單商品明細
  - 顯示訂購/已出貨/待出貨數量
  - 顯示商品狀態

#### 4. `ItemsCardView.tsx`
- **用途**：手機版商品列表（卡片佈局）
- **位置**：`src/components/order/ItemsCardView.tsx`
- **功能**：
  - 卡片式顯示商品
  - 簡潔的數量信息展示
  - 優化的手機端體驗

### StoreOrderEdit 相關組件

#### 5. `OrderEditHeader.tsx`
- **用途**：訂單編輯頁面頭部
- **位置**：`src/components/order/OrderEditHeader.tsx`
- **功能**：
  - 顯示訂單編號
  - 返回按鈕
  - 訂單狀態徽章

#### 6. `OrderNotesCard.tsx`
- **用途**：訂單備註卡片
- **位置**：`src/components/order/OrderNotesCard.tsx`
- **功能**：
  - 編輯訂單備註
  - 顯示建立時間

#### 7. `AddProductCard.tsx`
- **用途**：新增產品卡片
- **位置**：`src/components/order/AddProductCard.tsx`
- **功能**：
  - 選擇產品下拉選單
  - 新增產品按鈕
  - 顯示產品信息（SKU、名稱、價格）

#### 8. `LockedOrderView.tsx`
- **用途**：已鎖定訂單視圖
- **位置**：`src/components/order/LockedOrderView.tsx`
- **功能**：
  - 顯示訂單已鎖定提示
  - 只讀訂單項目列表
  - 計算總金額

### OrderDetailDialog 相關組件

#### 9. `OrderInfo.tsx`
- **用途**：訂單基本信息顯示
- **位置**：`src/components/order/OrderInfo.tsx`
- **功能**：
  - 顯示訂單編號、店鋪名稱
  - 顯示建立時間、訂單來源
  - 顯示訂單備註

#### 10. `OrderDetailItemsTable.tsx`
- **用途**：訂單詳情對話框的電腦版商品表格
- **位置**：`src/components/order/OrderDetailItemsTable.tsx`
- **功能**：
  - 表格式顯示訂單商品
  - 固定表頭（sticky header）
  - 顯示單價、數量、已出貨、狀態

#### 11. `OrderDetailItemsCards.tsx`
- **用途**：訂單詳情對話框的手機版商品卡片
- **位置**：`src/components/order/OrderDetailItemsCards.tsx`
- **功能**：
  - 卡片式顯示訂單商品
  - 響應式佈局
  - 優化的手機端體驗

## 📊 重構前後對比

### StoreOrderList.tsx
**重構前**：
- ~492 行代碼
- 包含所有視圖邏輯
- 難以維護和測試

**重構後**：
- ~250 行代碼
- 使用 4 個子組件
- 清晰的職責分離
- 易於維護和擴展

### StoreOrderEdit.tsx
**重構前**：
- ~374 行代碼
- 混合多種 UI 邏輯
- 難以重用

**重構後**：
- ~280 行代碼
- 使用 4 個子組件
- 清晰的組件結構
- 更好的代碼組織

### OrderDetailDialog.tsx
**重構前**：
- ~190 行代碼
- 混合信息顯示和商品列表邏輯
- 電腦版和手機版代碼耦合

**重構後**：
- ~90 行代碼
- 使用 3 個子組件
- 清晰分離信息和商品視圖
- 響應式組件獨立管理

### 總體統計
- **創建組件數**：11 個
- **代碼減少**：~50% 平均減少
- **可重用組件**：所有子組件都可在其他地方使用

## 🎨 設計模式

### 1. **容器/展示組件模式**
- 主頁面（容器）：處理數據和業務邏輯
- 子組件（展示）：專注於 UI 渲染

### 2. **響應式組件分離**
- 電腦版組件：`*TableView.tsx`
- 手機版組件：`*CardView.tsx`
- 使用 Tailwind 的 `hidden md:block` 和 `md:hidden` 控制顯示

### 3. **Props 接口設計**
- 明確的 TypeScript 接口
- 回調函數用於事件處理
- 數據和行為分離

## 🔧 使用示例

### StoreOrderList
```tsx
<OrdersTableView
  orders={filteredOrders}
  isLoading={isLoading}
  onView={setSelectedOrder}
  onEdit={(orderId) => navigate(`/orders/${orderId}/edit`)}
  getOrderShipmentStatus={getOrderShipmentStatus}
  getOrderTotal={getOrderTotal}
/>
```

### StoreOrderEdit
```tsx
<OrderEditHeader
  orderId={order.id}
  statusLabel={statusInfo.label}
  statusClassName={statusInfo.className}
  onBack={() => navigate('/orders')}
/>
```

### OrderDetailDialog
```tsx
<OrderDetailDialog order={selectedOrder} open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)} />

// 內部使用子組件：
<OrderInfo
  orderId={order.id}
  storeName={order.stores?.name}
  createdAt={formattedDate}
  sourceType={order.source_type}
  notes={order.notes}
/>

<OrderDetailItemsTable items={order.order_items} />
<OrderDetailItemsCards items={order.order_items} />
```

## ✅ 優勢

1. **更好的代碼組織**
   - 每個組件專注於單一職責
   - 更容易找到和修改代碼

2. **提高可重用性**
   - 組件可在其他頁面使用
   - 減少代碼重複

3. **簡化測試**
   - 每個組件可獨立測試
   - 更容易編寫單元測試

4. **改善可維護性**
   - 修改一個組件不影響其他組件
   - 更容易添加新功能

5. **更好的性能**
   - 可以針對單個組件優化
   - 更精確的重新渲染控制

## 🚀 未來改進建議

1. **添加單元測試**
   - 為每個新組件編寫測試
   - 確保組件行為正確

2. **進一步優化**
   - 考慮使用 React.memo 優化性能
   - 添加錯誤邊界

3. **文檔化**
   - 為每個組件添加 JSDoc 註釋
   - 創建 Storybook 故事

4. **可訪問性**
   - 添加 ARIA 標籤
   - 改善鍵盤導航

## 📝 注意事項

- 所有組件都使用 TypeScript 嚴格類型
- 保持與現有設計系統一致
- 響應式設計適配所有螢幕尺寸
- 使用 Tailwind CSS 進行樣式設計
