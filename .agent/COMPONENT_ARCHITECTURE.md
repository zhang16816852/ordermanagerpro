# 訂單管理組件架構圖

## 📐 組件層次結構

```
訂單管理系統
├── 📄 StoreOrderList (訂單列表頁面)
│   ├── 🔄 OrdersTableView (電腦版訂單表格)
│   ├── 📱 OrdersCardView (手機版訂單卡片)
│   ├── 🔄 ItemsTableView (電腦版商品表格)
│   ├── 📱 ItemsCardView (手機版商品卡片)
│   └── 💬 OrderDetailDialog (訂單詳情對話框)
│       ├── ℹ️ OrderInfo (訂單基本信息)
│       ├── 🔄 OrderDetailItemsTable (電腦版商品表格)
│       └── 📱 OrderDetailItemsCards (手機版商品卡片)
│
├── 📄 StoreOrderEdit (訂單編輯頁面)
│   ├── 🎯 OrderEditHeader (頁面頭部)
│   ├── 📝 OrderNotesCard (訂單備註)
│   ├── ➕ AddProductCard (新增產品)
│   ├── 🔒 LockedOrderView (已鎖定訂單視圖)
│   └── 📋 OrderItemsTable (訂單商品表格 - 可編輯)
│
└── 🔧 共享組件
    └── 🏷️ OrderStatusBadge (訂單狀態徽章)
```

## 🔗 組件依賴關係

### StoreOrderList.tsx
```
StoreOrderList
    ↓
    ├─→ OrdersTableView
    │   └─→ OrderStatusBadge
    │
    ├─→ OrdersCardView
    │   └─→ OrderStatusBadge
    │
    ├─→ ItemsTableView
    │   └─→ Badge (UI)
    │
    ├─→ ItemsCardView
    │   └─→ Badge (UI)
    │
    └─→ OrderDetailDialog
        ├─→ OrderInfo
        ├─→ OrderDetailItemsTable
        │   └─→ OrderStatusBadge
        └─→ OrderDetailItemsCards
            └─→ OrderStatusBadge
```

### StoreOrderEdit.tsx
```
StoreOrderEdit
    ↓
    ├─→ OrderEditHeader
    │   └─→ Badge (UI)
    │
    ├─→ OrderNotesCard
    │   └─→ Textarea (UI)
    │
    ├─→ AddProductCard
    │   └─→ Select (UI)
    │
    ├─→ LockedOrderView
    │   └─→ Table (UI)
    │
    └─→ OrderItemsTable
        └─→ Input (UI)
```

## 📊 數據流向

### 訂單列表頁面數據流
```
用戶操作
    ↓
StoreOrderList (狀態管理)
    ↓
    ├─→ React Query (數據獲取)
    │   └─→ Supabase (後端)
    │
    ├─→ 過濾/搜索邏輯
    │   └─→ filteredOrders / allItems
    │
    └─→ 視圖組件 (展示)
        ├─→ OrdersTableView / OrdersCardView
        └─→ ItemsTableView / ItemsCardView
```

### 訂單編輯頁面數據流
```
用戶操作
    ↓
StoreOrderEdit (狀態管理)
    ↓
    ├─→ React Query (數據獲取)
    │   └─→ Supabase (後端)
    │
    ├─→ 本地狀態 (編輯中的數據)
    │   ├─→ notes
    │   ├─→ orderItems
    │   └─→ selectedProductId
    │
    ├─→ Mutation (數據更新)
    │   └─→ Supabase (後端)
    │
    └─→ 視圖組件 (展示/編輯)
        ├─→ OrderEditHeader
        ├─→ OrderNotesCard
        ├─→ AddProductCard
        └─→ OrderItemsTable
```

## 🎯 組件職責分工

### 容器組件 (Smart Components)
負責數據獲取、狀態管理和業務邏輯

- **StoreOrderList.tsx**
  - 數據獲取 (React Query)
  - 搜索和過濾邏輯
  - 狀態管理 (tabs, viewMode, search)
  - 路由導航

- **StoreOrderEdit.tsx**
  - 數據獲取和更新
  - 表單狀態管理
  - 驗證邏輯
  - 路由導航

### 展示組件 (Presentational Components)
只負責 UI 渲染，通過 props 接收數據和回調

#### 視圖組件
- **OrdersTableView** - 訂單表格視圖
- **OrdersCardView** - 訂單卡片視圖
- **ItemsTableView** - 商品表格視圖
- **ItemsCardView** - 商品卡片視圖
- **OrderDetailItemsTable** - 訂單詳情商品表格
- **OrderDetailItemsCards** - 訂單詳情商品卡片

#### 功能組件
- **OrderInfo** - 訂單信息展示
- **OrderEditHeader** - 編輯頁面頭部
- **OrderNotesCard** - 備註編輯
- **AddProductCard** - 產品選擇
- **LockedOrderView** - 鎖定訂單視圖

#### 共享組件
- **OrderStatusBadge** - 狀態徽章

## 🔄 響應式設計策略

### 桌面優先 vs 移動優先
我們採用**組件分離**策略：

```tsx
// 電腦版組件
<div className="hidden md:block">
  <OrdersTableView {...props} />
</div>

// 手機版組件
<div className="md:hidden">
  <OrdersCardView {...props} />
</div>
```

### 優勢
1. **獨立優化** - 每個版本可以獨立優化
2. **代碼清晰** - 不需要在單個組件內處理複雜的響應式邏輯
3. **性能更好** - 只渲染需要的版本
4. **易於維護** - 修改一個版本不影響另一個

## 🚀 擴展性

### 添加新視圖
如果需要添加新的視圖模式（例如：看板視圖），只需：

1. 創建新組件 `OrdersKanbanView.tsx`
2. 在 `StoreOrderList` 中添加新的 tab
3. 條件渲染新組件

```tsx
{viewMode === 'kanban' && (
  <OrdersKanbanView
    orders={filteredOrders}
    onView={setSelectedOrder}
    onEdit={handleEdit}
  />
)}
```

### 重用組件
所有展示組件都可以在其他頁面重用：

- `OrderInfo` 可用於任何需要顯示訂單信息的地方
- `OrderStatusBadge` 可用於任何需要顯示狀態的地方
- 視圖組件可用於不同的訂單管理頁面

## 📝 最佳實踐

1. **單一職責** - 每個組件只做一件事
2. **Props 接口** - 明確定義 TypeScript 接口
3. **回調函數** - 使用回調處理用戶操作
4. **數據和 UI 分離** - 容器組件處理數據，展示組件處理 UI
5. **可測試性** - 展示組件易於單元測試
6. **可重用性** - 組件設計考慮重用場景
