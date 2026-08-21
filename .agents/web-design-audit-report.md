# Web Interface Guidelines 審查報告

**審查日期**：2026-08-18
**審查範圍**：全部 108 個頁面/元件
**通過檔案數**：12 / 108

---

## 統計摘要

| 類別 | 發現數 |
|---|---|
| Icon button 缺少 `aria-label` | ~55 |
| 裝飾圖示缺 `aria-hidden="true"` | ~80 |
| 表單欄位缺 label / `aria-label` | ~40 |
| `transition-all` 反模式 | ~20 |
| Loading 文字用 `...` 而非 `…` | ~15 |
| `<Label>` 未連接 `htmlFor`/`id` | ~30 |
| 硬編碼金額格式（缺 `Intl.NumberFormat`） | ~10 |
| `console.log` 殘留 | 4 |
| `<div>`/`<Badge>` 有 `onClick` 非鍵盤可及 | ~8 |
| `outline-none` 焦點替代 | 3 |
| `aria-live="polite"` 缺失（async 狀態） | ~10 |
| `prefers-reduced-motion` 未處理 | ~5 |
| `overscroll-behavior: contain` 缺失 | ~5 |
| `tabular-nums` 缺失（數字欄位） | ~5 |

---

## 通過的檔案

- `src/pages/admin/AdminOrderCheckout.tsx`
- `src/pages/admin/accounting/index.tsx`
- `src/pages/admin/accounting/components/CategoriesTab.tsx`
- `src/pages/admin/audit-logs/index.tsx`
- `src/pages/admin/categories/index.tsx`
- `src/pages/admin/categories/components/CategoryBindingImport.tsx`
- `src/pages/admin/consignment/index.tsx`
- `src/pages/admin/purchase-orders/components/SupplierMappingDialog.tsx`
- `src/pages/admin/purchase-orders/components/mapping/MappingConfigForm.tsx`
- `src/pages/admin/purchase-orders/components/mapping/MappingExportDialog.tsx`
- `src/pages/admin/purchase-orders/components/mapping/SupplierMappingManager.tsx`
- `src/routes/admin.tsx`、`shared.tsx`、`store.tsx`
- `src/pages/store/Checkout.tsx`、`Dashboard.tsx`
- `src/pages/store/components/audit/AuditDetailDialog.tsx`
- `src/pages/share/SharedOrder.tsx`
- `src/pages/Index.tsx`
- `src/pages/admin/libraries/device-models/DeviceModelActions.tsx`
- `src/pages/admin/order-grid-templates/index.tsx`
- `src/pages/admin/products/components/ProductsTable.tsx`

---

## 詳細發現

### src/routes/

```
src/routes/index.tsx:19 - Loader2 spinner 缺 role="status" + aria-live="polite"
```

### src/pages/ (root)

```
src/pages/AcceptInvite.tsx:346 - spinner 缺 role="status" + aria-live="polite" + aria-hidden="true"
src/pages/AcceptInvite.tsx:359 - XCircle decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:381 - XCircle decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:405 - Store decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:426 - Mail icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:449 - UserPlus decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:466 - User decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:467 - Input 缺 name + autocomplete="name"
src/pages/AcceptInvite.tsx:482 - Lock decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:483 - Input 缺 name + autocomplete="new-password"
src/pages/AcceptInvite.tsx:498 - Lock decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:500 - Input 缺 name + autocomplete="new-password"
src/pages/AcceptInvite.tsx:513 - Store decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:518 - UserPlus decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:529 - loading 用 `...` 非 `…`
src/pages/AcceptInvite.tsx:568 - UserPlus icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:576 - Mail icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:593 - XCircle decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:634 - UserPlus decorative icon 缺 aria-hidden="true"
src/pages/AcceptInvite.tsx:672 - loading 用 `...` 非 `…`
src/pages/AcceptInvite.tsx:676 - CheckCircle icon 缺 aria-hidden="true"

src/pages/Auth.tsx:158 - spinner 缺 role="status" + aria-live="polite"
src/pages/Auth.tsx:169 - Package decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:202 - Mail decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:203 - Input 缺 name + autocomplete="email"
src/pages/Auth.tsx:215 - email suggestion dropdown 缺 role="listbox"/"option" + 鍵盤導航
src/pages/Auth.tsx:239 - Lock decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:241 - Input 缺 name + autocomplete="current-password"
src/pages/Auth.tsx:264 - User decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:266 - Input 缺 name + autocomplete="name"
src/pages/Auth.tsx:280 - Mail decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:282 - Input 缺 name + autocomplete="email"
src/pages/Auth.tsx:296 - Lock decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:298 - Input 缺 name + autocomplete="new-password"
src/pages/Auth.tsx:312 - Lock decorative icon 缺 aria-hidden="true"
src/pages/Auth.tsx:314 - Input 缺 name + autocomplete="new-password"

src/pages/NotFound.tsx:16 - link 缺 explicit focus-visible:ring-*
```

### src/pages/admin/ (根目錄)

```
src/pages/admin/Dashboard.tsx:116 - decorative icon 缺 aria-hidden="true"

src/pages/admin/AdminOrderEdit.tsx:233 - loading 用 `...` 非 `…`
src/pages/admin/AdminOrderEdit.tsx:333 - Textarea 缺 label
src/pages/admin/AdminOrderEdit.tsx:350 - Select 缺 accessible label
src/pages/admin/AdminOrderEdit.tsx:509 - loading 用 `...` 非 `…`

src/pages/admin/AdminOrderForm.tsx:509 - loading 用 `...` 非 `…`
src/pages/admin/AdminOrderForm.tsx:594 - Textarea 缺 label
src/pages/admin/AdminOrderForm.tsx:632 - Search Input 缺 label
src/pages/admin/AdminOrderForm.tsx:687 - SelectTrigger 缺 accessible label
src/pages/admin/AdminOrderForm.tsx:792 - SelectTrigger 缺 accessible label

src/pages/admin/BrandPricing.tsx:299 - Input type="number" 缺 label/id
src/pages/admin/BrandPricing.tsx:311 - loading 用 `...` 非 `…`
src/pages/admin/BrandPricing.tsx:320 - Search Input 缺 label
src/pages/admin/BrandPricing.tsx:403 - icon-only button (expand chevron) 缺 aria-label
src/pages/admin/BrandPricing.tsx:430 - price Input 缺 label
src/pages/admin/BrandPricing.tsx:475 - price Input 缺 label

src/pages/admin/OrderComposer.tsx:274 - transition-all → 應列出具體屬性
src/pages/admin/OrderComposer.tsx:309 - Textarea 缺 label
src/pages/admin/OrderComposer.tsx:317 - 硬編碼 `toLocaleString()` → 應用 Intl.NumberFormat

src/pages/admin/SalesNotes.tsx:196 - Search Input 缺 label
src/pages/admin/SalesNotes.tsx:279 - icon-only button (X) 缺 aria-label
src/pages/admin/SalesNotes.tsx:188 - 硬編碼 `$${totalAmount.toLocaleString()}` → Intl.NumberFormat

src/pages/admin/ShippingPool.tsx:362 - `<div>` 有 role="checkbox" + onClick → 用 Checkbox 元件
src/pages/admin/ShippingPool.tsx:425 - icon-only button (Trash2) 缺 aria-label
src/pages/admin/ShippingPool.tsx:538 - SelectTrigger 缺 accessible label
src/pages/admin/ShippingPool.tsx:565 - `<label>` 未連接 htmlFor/id
src/pages/admin/ShippingPool.tsx:574 - `<label>` 未連接 Textarea

src/pages/admin/SortableItem.tsx:29 - drag handle icon 缺 aria-hidden="true"

src/pages/admin/Stores.tsx:519 - Button 有 title 但缺 aria-label
src/pages/admin/Stores.tsx:528 - icon-only button (Pencil) 缺 aria-label
src/pages/admin/Stores.tsx:668 - icon-only button (X) 缺 aria-label
src/pages/admin/Stores.tsx:685 - icon-only button (UserPlus) 缺 aria-label
src/pages/admin/Stores.tsx:776 - icon-only button (Trash2) 缺 aria-label
src/pages/admin/Stores.tsx:822 - Label 未連接 htmlFor
src/pages/admin/Stores.tsx:837 - Label 未連接 htmlFor
src/pages/admin/Stores.tsx:868 - Label 未連接 htmlFor
src/pages/admin/Stores.tsx:872 - Label 未連接 htmlFor
src/pages/admin/Stores.tsx:884 - Label 未連接 htmlFor

src/pages/admin/Users.tsx:263 - Search Input 缺 label
src/pages/admin/Users.tsx:324 - icon-only button (Trash2) 缺 aria-label
src/pages/admin/Users.tsx:341 - icon-only button (UserPlus) 缺 aria-label
src/pages/admin/Users.tsx:419 - Label 未連接 htmlFor
src/pages/admin/Users.tsx:434 - Label 未連接 htmlFor
src/pages/admin/Users.tsx:472 - Label 未連接 htmlFor
src/pages/admin/Users.tsx:481 - Label 未連接 htmlFor
src/pages/admin/Users.tsx:496 - Label 未連接 htmlFor
```

### src/pages/admin/accounting/

```
src/pages/admin/accounting/components/AccountForm.tsx:33 - Label 未連接 htmlFor
src/pages/admin/accounting/components/AccountForm.tsx:37 - Label 未連接 htmlFor
src/pages/admin/accounting/components/AccountForm.tsx:49 - Label 未連接 htmlFor
src/pages/admin/accounting/components/AccountForm.tsx:53 - Label 未連接 htmlFor

src/pages/admin/accounting/components/AccountsTab.tsx:36 - 硬編碼 `$${account.balance.toLocaleString()}` → Intl.NumberFormat

src/pages/admin/accounting/components/CategoryForm.tsx:30 - Label 未連接 htmlFor
src/pages/admin/accounting/components/CategoryForm.tsx:34 - Label 未連接 htmlFor

src/pages/admin/accounting/components/EntriesTab.tsx:86 - 硬編碼 `$${entry.amount.toLocaleString()}` → Intl.NumberFormat
src/pages/admin/accounting/components/EntriesTab.tsx:97 - icon-only button (CreditCard) 缺 aria-label
src/pages/admin/accounting/components/EntriesTab.tsx:106 - icon-only button (Edit) 缺 aria-label
src/pages/admin/accounting/components/EntriesTab.tsx:114 - icon-only button (Trash2) 缺 aria-label

src/pages/admin/accounting/components/EntryForm.tsx:169 - SelectTrigger 缺 accessible label
src/pages/admin/accounting/components/EntryForm.tsx:244 - SelectTrigger 缺 accessible label
src/pages/admin/accounting/components/EntryForm.tsx:257 - SelectTrigger 缺 accessible label
src/pages/admin/accounting/components/EntryForm.tsx:271 - Input type="number" 未連接 htmlFor

src/pages/admin/accounting/components/PaymentDialog.tsx:70 - Label 未連接 htmlFor
src/pages/admin/accounting/components/PaymentDialog.tsx:76 - Label 未連接 input
src/pages/admin/accounting/components/PaymentDialog.tsx:85 - Label 未連接 htmlFor

src/pages/admin/accounting/components/StatsCards.tsx:26 - 硬編碼 `$${totalIncome.toLocaleString()}` → Intl.NumberFormat
src/pages/admin/accounting/components/StatsCards.tsx:37 - 硬編碼 `$${totalExpense.toLocaleString()}` → Intl.NumberFormat
src/pages/admin/accounting/components/StatsCards.tsx:49 - 硬編碼 `$${...toLocaleString()}` → Intl.NumberFormat
src/pages/admin/accounting/components/StatsCards.tsx:60 - 硬編碼 `$${totalBalance.toLocaleString()}` → Intl.NumberFormat
```

### src/pages/admin/categories/

```
src/pages/admin/categories/components/BrandsTab.tsx:56 - icon-only button (Pencil) 缺 aria-label
src/pages/admin/categories/components/BrandsTab.tsx:59 - icon-only button (Trash2) 缺 aria-label
src/pages/admin/categories/components/BrandsTab.tsx:227 - icon-only button (Pencil) 缺 aria-label
src/pages/admin/categories/components/BrandsTab.tsx:230 - icon-only button (Trash2) 缺 aria-label
src/pages/admin/categories/components/BrandsTab.tsx:250 - label 未連接 htmlFor
src/pages/admin/categories/components/BrandsTab.tsx:254 - label 未連接 htmlFor
src/pages/admin/categories/components/BrandsTab.tsx:258 - label 未連接 htmlFor
src/pages/admin/categories/components/BrandsTab.tsx:262 - label 未連接 htmlFor

src/pages/admin/categories/components/CategoryBindingTab.tsx:482 - button (expand chevron) 缺 aria-label

src/pages/admin/categories/components/CategoryDialog.tsx:54 - console.log 殘留
src/pages/admin/categories/components/CategoryDialog.tsx:82 - X icon + onClick 非鍵盤可及
src/pages/admin/categories/components/CategoryDialog.tsx:95 - Badge + onClick 非鍵盤可及
src/pages/admin/categories/components/CategoryDialog.tsx:115 - TabsTrigger icon 缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryDialog.tsx:130 - decorative color dots 缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryDialog.tsx:68 - Input id="name" 缺 autoComplete

src/pages/admin/categories/components/CategorySelectedConfigTab.tsx:63 - GripVertical icon 缺 aria-hidden="true"
src/pages/admin/categories/components/CategorySelectedConfigTab.tsx:67 - LinkIcon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategorySelectedConfigTab.tsx:86 - expand/collapse Button 缺 aria-label + aria-expanded
src/pages/admin/categories/components/CategorySelectedConfigTab.tsx:124 - remove Button (X) 缺 aria-label
src/pages/admin/categories/components/CategorySelectedConfigTab.tsx:73 - Input type="number" 缺 aria-label

src/pages/admin/categories/components/CategorySpecLibraryTab.tsx:80 - transition-all → 應列出具體屬性
src/pages/admin/categories/components/CategorySpecLibraryTab.tsx:90 - expand/collapse button 缺 aria-label + aria-expanded
src/pages/admin/categories/components/CategorySpecLibraryTab.tsx:99 - LinkIcon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategorySpecLibraryTab.tsx:171 - Search icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategorySpecLibraryTab.tsx:172 - search Input 缺 aria-label
src/pages/admin/categories/components/CategorySpecLibraryTab.tsx:179 - X clear button 是 svg + onClick 非鍵盤可及

src/pages/admin/categories/components/CategoryTab.tsx:319 - loading 用 `...` 非 `…`
src/pages/admin/categories/components/CategoryTab.tsx:305 - Plus icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryTab.tsx:290 - Download icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryTab.tsx:300 - Upload icon 編輯图标缺 aria-hidden="true"

src/pages/admin/categories/components/CategoryTreeNode.tsx:128 - GripVertical icon 缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryTreeNode.tsx:139 - chevron icons 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryTreeNode.tsx:144 - FolderTree icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/CategoryTreeNode.tsx:155 - Button (Plus) 有 title 但缺 aria-label
src/pages/admin/categories/components/CategoryTreeNode.tsx:162 - Button (Pencil) 有 title 但缺 aria-label
src/pages/admin/categories/components/CategoryTreeNode.tsx:169 - Button (Trash2) 有 title 但缺 aria-label

src/pages/admin/categories/components/SpecDialog.tsx:80 - transition-all → 應列出具體屬性
src/pages/admin/categories/components/SpecDialog.tsx:143 - label 未連接 input
src/pages/admin/categories/components/SpecDialog.tsx:151 - label 未連接 input
src/pages/admin/categories/components/SpecDialog.tsx:161 - label 未連接 select
src/pages/admin/categories/components/SpecDialog.tsx:162 - select 缺 id/name/aria-label
src/pages/admin/categories/components/SpecDialog.tsx:197 - label 未連接 select
src/pages/admin/categories/components/SpecDialog.tsx:198 - select 缺 id/name
src/pages/admin/categories/components/SpecDialog.tsx:224 - Input 缺 aria-label
src/pages/admin/categories/components/SpecDialog.tsx:229 - select 缺 id/name
src/pages/admin/categories/components/SpecDialog.tsx:239 - select 缺 id/name
src/pages/admin/categories/components/SpecDialog.tsx:263 - remove trigger Button (X) 缺 aria-label
src/pages/admin/categories/components/SpecDialog.tsx:265 - select 編輯图标缺 aria-label
src/pages/admin/categories/components/SpecDialog.tsx:289 - Checkbox 編輯图标缺 aria-label
src/pages/admin/categories/components/SpecDialog.tsx:317 - Input 編輯图标缺 aria-label
src/pages/admin/categories/components/SpecDialog.tsx:322 - delete option Button (X) 編輯图标缺 aria-label

src/pages/admin/categories/components/SpecLibraryTab.tsx:252 - console.log 殘留
src/pages/admin/categories/components/SpecLibraryTab.tsx:274 - console.log 殘留
src/pages/admin/categories/components/SpecLibraryTab.tsx:389 - loading 用 `...` 非 `…`
src/pages/admin/categories/components/SpecLibraryTab.tsx:389 - animate-pulse 編輯图标缺 aria-live="polite"

src/pages/admin/categories/components/spec-library/SpecLibraryCard.tsx:88 - edit Button (Pencil) 編輯图标缺 aria-label
src/pages/admin/categories/components/spec-library/SpecLibraryCard.tsx:93 - delete Button (Trash2) 編輯图标缺 aria-label

src/pages/admin/categories/components/spec-library/SpecLibraryGridView.tsx:18 - loading 用 `...` 非 `…`
src/pages/admin/categories/components/spec-library/SpecLibraryGridView.tsx:22 - animate-in fade-in 缺 prefers-reduced-motion

src/pages/admin/categories/components/spec-library/SpecLibraryToolbar.tsx:48 - clear search Button 編輯图标缺 aria-label
src/pages/admin/categories/components/spec-library/SpecLibraryToolbar.tsx:63 - LayoutGrid/Network icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/spec-library/SpecLibraryToolbar.tsx:76 - FileJson/FileSpreadsheet icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/spec-library/SpecLibraryToolbar.tsx:80 - clickable div 應為 button
src/pages/admin/categories/components/spec-library/SpecLibraryToolbar.tsx:93 - clickable div 應為 button

src/pages/admin/categories/components/spec-library/SpecLibraryTreeView.tsx:59 - GripVertical icon 編輯图标缺 aria-hidden="true"
src/pages/admin/categories/components/spec-library/SpecLibraryTreeView.tsx:88 - transition-all → 應列出具體屬性
src/pages/admin/categories/components/spec-library/SpecLibraryTreeView.tsx:89 - Zap icon 編輯图标缺 aria-hidden="true"
```

### src/pages/admin/consignment/

```
src/pages/admin/consignment/components/CreateOrderDialog.tsx:113 - Label 未連接 Select
src/pages/admin/consignment/components/CreateOrderDialog.tsx:131 - Label 未連接 Select
src/pages/admin/consignment/components/CreateOrderDialog.tsx:205 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/consignment/components/CreateOrderDialog.tsx:214 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/consignment/components/CreateOrderDialog.tsx:224 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/consignment/components/CreateOrderDialog.tsx:234 - remove Button (Trash2) 編輯图标缺 aria-label
src/pages/admin/consignment/components/CreateOrderDialog.tsx:258 - loading 用 `...` 非 `…`

src/pages/admin/consignment/components/OrderDetailDialog.tsx:378 - loading 用 `...` 非 `…`
src/pages/admin/consignment/components/OrderDetailDialog.tsx:416 - loading 用 `...` 非 `…`
src/pages/admin/consignment/components/OrderDetailDialog.tsx:511 - loading 用 `...` 非 `…`
src/pages/admin/consignment/components/OrderDetailDialog.tsx:601 - loading 用 `...` 非 `…`
src/pages/admin/consignment/components/OrderDetailDialog.tsx:639 - loading 用 `...` 非 `…`
src/pages/admin/consignment/components/OrderDetailDialog.tsx:811 - delete item Button (Trash2) 編輯图标缺 aria-label
src/pages/admin/consignment/components/OrderDetailDialog.tsx:928 - delete new line Button (Trash2) 編輯图标缺 aria-label
src/pages/admin/consignment/components/OrderDetailDialog.tsx:486 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/consignment/components/OrderDetailDialog.tsx:357 - Input type="number" 編輯图标缺 aria-label

src/pages/admin/consignment/components/OrderListTab.tsx:72 - view Button (Eye) 編輯图标缺 aria-label
src/pages/admin/consignment/components/OrderListTab.tsx:51 - loading 用 `...` 非 `…`

src/pages/admin/consignment/components/ReportsTab.tsx:71 - select-all Checkbox 編輯图标缺 aria-label
src/pages/admin/consignment/components/ReportsTab.tsx:99 - row Checkbox 編輯图标缺 aria-label
src/pages/admin/consignment/components/ReportsTab.tsx:131 - reject Button (X) 編輯图标缺 aria-label
```

### src/pages/admin/inventory/

```
src/pages/admin/inventory/index.tsx:48 - save Button (Save) 編輯图标缺 aria-label
src/pages/admin/inventory/index.tsx:266 - history Button (History) 編輯图标缺 aria-label
src/pages/admin/inventory/index.tsx:127 - select 編輯图标缺 aria-label/id
src/pages/admin/inventory/index.tsx:342 - search Input 編輯图标缺 aria-label

src/pages/admin/inventory/components/WarehousesTab.tsx:55 - GripVertical icon 編輯图标缺 aria-hidden="true"
src/pages/admin/inventory/components/WarehousesTab.tsx:64 - Star icon 編輯图标缺 aria-label
src/pages/admin/inventory/components/WarehousesTab.tsx:92 - edit Button (Pencil) 編輯图标缺 aria-label
```

### src/pages/admin/libraries/

```
src/pages/admin/libraries/colors/ColorManager.tsx:199 - name Input 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:207 - code Input 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:216 - color picker input 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:222 - hex Input 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:311 - edit Button (Pencil) 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:314 - delete Button (Trash2) 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:252 - edit mode Input fields 編輯图标缺 aria-label
src/pages/admin/libraries/colors/ColorManager.tsx:266 - edit mode color inputs 編輯图标缺 aria-label

src/pages/admin/libraries/colors/QuickColorAdd.tsx:64 - close Button (X) 編輯图标缺 aria-label
src/pages/admin/libraries/colors/QuickColorAdd.tsx:76 - label 未連接 htmlFor
src/pages/admin/libraries/colors/QuickColorAdd.tsx:87 - label 未連接 htmlFor
src/pages/admin/libraries/colors/QuickColorAdd.tsx:97 - label 未連接 htmlFor

src/pages/admin/libraries/device-models/DeviceModelDialog.tsx:77 - quick-add Button (Plus) 有 title 但缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelDialog.tsx:136 - alias remove X icon + onClick 非鍵盤可及

src/pages/admin/libraries/device-models/DeviceModelGroupManager.tsx:363 - search Input 編輯图标缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelGroupManager.tsx:382 - clickable div 應為 button 或加 keyboard handler
src/pages/admin/libraries/device-models/DeviceModelGroupManager.tsx:433 - edit Button (Edit2) 編輯图标缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelGroupManager.tsx:436 - delete Button (Trash2) 編輯图标缺 aria-label

src/pages/admin/libraries/device-models/DeviceModelGroupView.tsx:141 - Switch 編輯图标缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelGroupView.tsx:160 - edit Button (Edit) 編輯图标缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelGroupView.tsx:163 - delete Button (Trash2) 編輯图标缺 aria-label

src/pages/admin/libraries/device-models/DeviceModelListView.tsx:106 - Switch 編輯图标缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelListView.tsx:113 - edit Button (Edit) 編輯图标缺 aria-label
src/pages/admin/libraries/device-models/DeviceModelListView.tsx:116 - delete Button (Trash2) 編輯图标缺 aria-label

src/pages/admin/libraries/device-models/DeviceModelManager.tsx:97 - console.log 殘留
src/pages/admin/libraries/device-models/DeviceModelManager.tsx:110 - console.log 殘留
```

### src/pages/admin/orders/

```
src/pages/admin/orders/list/OrderListPage.tsx:1025 - label 未連接 Input via htmlFor
src/pages/admin/orders/list/OrderListPage.tsx:1034 - label 未連接 Textarea
src/pages/admin/orders/list/OrderListPage.tsx:1098 - Label 未連接 Textarea

src/pages/admin/orders/list/components/AggregateTableView.tsx:82 - select-all Checkbox 編輯图标缺 aria-label
src/pages/admin/orders/list/components/AggregateTableView.tsx:139 - icon-only expand Button 編輯图标缺 aria-label
src/pages/admin/orders/list/components/AggregateTableView.tsx:125 - Input quantity 編輯图标缺 label

src/pages/admin/orders/list/components/AggregateToPODialog.tsx:384 - Input quantity 的 `<span>` 非 label 元素
src/pages/admin/orders/list/components/AggregateToPODialog.tsx:395 - Input unit cost 的 `<span>` 非 label 元素
src/pages/admin/orders/list/components/AggregateToPODialog.tsx:404 - icon-only Button (Trash2) 編輯图标缺 aria-label
src/pages/admin/orders/list/components/AggregateToPODialog.tsx:453 - Input add quantity 的 `<span>` 非 label 元素
src/pages/admin/orders/list/components/AggregateToPODialog.tsx:457 - Input add unit cost 的 `<span>` 非 label 元素

src/pages/admin/orders/list/components/BatchActionBar.tsx:77 - transition-all (全部按鈕)
src/pages/admin/orders/list/components/BatchActionBar.tsx:93 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:103 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:117 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:128 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:138 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:153 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:163 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:178 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:188 - transition-all
src/pages/admin/orders/list/components/BatchActionBar.tsx:198 - transition-all

src/pages/admin/orders/list/components/ItemTableView.tsx:49 - select-all Checkbox 編輯图标缺 aria-label
src/pages/admin/orders/list/components/ItemTableView.tsx:135 - quantity Input 編輯图标缺 label
src/pages/admin/orders/list/components/ItemTableView.tsx:171 - icon-only Button (RotateCcw) 用 title 非 aria-label

src/pages/admin/orders/list/components/OrderFilters.tsx:89 - Search Input 編輯图标缺 label
src/pages/admin/orders/list/components/OrderFilters.tsx:112 - date Input "起日" 編輯图标缺 label
src/pages/admin/orders/list/components/OrderFilters.tsx:121 - date Input "迄日" 編輯图标缺 label
src/pages/admin/orders/list/components/OrderFilters.tsx:97 - Select store filter 編輯图标缺 label
src/pages/admin/orders/list/components/OrderFilters.tsx:129 - Select PO filter 編輯图标缺 label

src/pages/admin/orders/list/components/OrderTableView.tsx:184 - icon-only Button (RotateCcw) 用 title 非 aria-label
src/pages/admin/orders/list/components/OrderTableView.tsx:194 - icon-only Button (Eye) 編輯图标缺 aria-label
src/pages/admin/orders/list/components/OrderTableView.tsx:197 - icon-only Button (Pencil) 編輯图标缺 aria-label
src/pages/admin/orders/list/components/OrderTableView.tsx:96 - select-all Checkbox 編輯图标缺 aria-label

src/pages/admin/orders/list/components/ShipToPoolDialog.tsx:77 - Button 文字 "取消修" 疑似 typo
```

### src/pages/admin/products/

```
src/pages/admin/products/index.tsx:133 - Search Input 編輯图标缺 label
src/pages/admin/products/index.tsx:204 - Search Input 編輯图标缺 label
src/pages/admin/products/index.tsx:157 - outline-none on TabsContent 無 focus-visible 替代
src/pages/admin/products/index.tsx:237 - outline-none on TabsContent 無 focus-visible 替代
src/pages/admin/products/index.tsx:243 - outline-none on TabsContent 無 focus-visible 替代

src/pages/admin/products/components/ProductDialogs.tsx:41 - icon-only Button (Minus) 編輯图标缺 aria-label
src/pages/admin/products/components/ProductDialogs.tsx:45 - icon-only Button (Plus) 編輯图标缺 aria-label

src/pages/admin/products/components/ProductRowItem.tsx:136 - CollapsibleTrigger Button (expand) 編輯图标缺 aria-label
src/pages/admin/products/components/ProductRowItem.tsx:206 - DropdownMenuTrigger Button (MoreHorizontal) 編輯图标缺 aria-label
src/pages/admin/products/components/ProductRowItem.tsx:268 - wholesale price Input 編輯图标缺 label
src/pages/admin/products/components/ProductRowItem.tsx:281 - retail price Input 編輯图标缺 label
```

### src/pages/admin/purchase-orders/

```
src/pages/admin/purchase-orders/index.tsx:79 - TabsTrigger icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/index.tsx:82 - TabsTrigger icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/index.tsx:85 - TabsTrigger icon 編輯图标缺 aria-hidden="true"

src/pages/admin/purchase-orders/components/ExcelImportDialog.tsx:170 - file Input 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/ExcelImportDialog.tsx:153 - loading 狀態 編輯图标缺 aria-live="polite"
src/pages/admin/purchase-orders/components/ExcelImportDialog.tsx:160 - AlertTriangle icon 編輯图标缺 aria-hidden="true"

src/pages/admin/purchase-orders/components/ImportFromOrdersDialog.tsx:105 - select-all Checkbox 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/ImportFromOrdersDialog.tsx:129 - row Checkbox 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/ImportFromOrdersDialog.tsx:122 - loading 狀態 編輯图标缺 aria-live="polite"

src/pages/admin/purchase-orders/components/ItemForm.tsx:95 - Input type="number" 編輯图标缺 name + autocomplete
src/pages/admin/purchase-orders/components/ItemForm.tsx:99 - Input type="number" 編輯图标缺 name + autocomplete

src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:297 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:315 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:338 - icon button 編輯图标缺 aria-label (有 title)
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:347 - icon button 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:359 - icon button 編輯图标缺 aria-label (有 title)
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:369 - icon button 編輯图标缺 aria-label (有 title)
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:345 - Save icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:366 - Save icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:186 - Download icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:189 - FileSpreadsheet icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:401 - PackageCheck icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderDetailDialog.tsx:418 - CreditCard icon 編輯图标缺 aria-hidden="true"

src/pages/admin/purchase-orders/components/OrderForm.tsx:56 - Input type="date" 編輯图标缺 name
src/pages/admin/purchase-orders/components/OrderForm.tsx:60 - Input type="date" 編輯图标缺 name
src/pages/admin/purchase-orders/components/OrderForm.tsx:66 - Input 編輯图标缺 name + autocomplete
src/pages/admin/purchase-orders/components/OrderForm.tsx:91 - Textarea 編輯图标缺 name

src/pages/admin/purchase-orders/components/OrderListTab.tsx:79 - icon button 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/OrderListTab.tsx:82 - icon button 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/OrderListTab.tsx:85 - icon button 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/OrderListTab.tsx:80 - Eye icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderListTab.tsx:83 - Edit icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderListTab.tsx:86 - Trash2 icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/OrderListTab.tsx:58 - loading 狀態 編輯图标缺 aria-live="polite"

src/pages/admin/purchase-orders/components/PaymentForm.tsx:51 - Input type="number" 編輯图标缺 name + autocomplete
src/pages/admin/purchase-orders/components/PaymentForm.tsx:55 - Input type="date" 編輯图标缺 name

src/pages/admin/purchase-orders/components/ReceiveForm.tsx:39 - Input type="number" 編輯图标缺 aria-label + name
src/pages/admin/purchase-orders/components/ReceiveForm.tsx:47 - select 編輯图标缺 label + name

src/pages/admin/purchase-orders/components/ReceivingTab.tsx:147 - CardHeader onClick 非互動元素 (應用 button)
src/pages/admin/purchase-orders/components/ReceivingTab.tsx:220 - Input type="number" 編輯图标缺 aria-label + name
src/pages/admin/purchase-orders/components/ReceivingTab.tsx:236 - select 編輯图标缺 label + name
src/pages/admin/purchase-orders/components/ReceivingTab.tsx:123 - loading 狀態 編輯图标缺 aria-live="polite"
src/pages/admin/purchase-orders/components/ReceivingTab.tsx:129 - PackageCheck icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/ReceivingTab.tsx:261 - Check icon 編輯图标缺 aria-hidden="true"

src/pages/admin/purchase-orders/components/SupplierForm.tsx:29 - Input 編輯图标缺 name + autocomplete
src/pages/admin/purchase-orders/components/SupplierForm.tsx:34 - Input 編輯图标缺 name + autocomplete
src/pages/admin/purchase-orders/components/SupplierForm.tsx:38 - phone Input 編輯图标缺 type="tel" + name + autocomplete="tel"
src/pages/admin/purchase-orders/components/SupplierForm.tsx:43 - Input type="email" 編輯图标缺 name + autocomplete="email"
src/pages/admin/purchase-orders/components/SupplierForm.tsx:47 - Input 編輯图标缺 name + autocomplete="street-address"
src/pages/admin/purchase-orders/components/SupplierForm.tsx:51 - Textarea 編輯图标缺 name

src/pages/admin/purchase-orders/components/SupplierTab.tsx:41 - FileEdit icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/SupplierTab.tsx:49 - User icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/SupplierTab.tsx:53 - Phone icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/SupplierTab.tsx:57 - Mail icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/SupplierTab.tsx:61 - MapPin icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/SupplierTab.tsx:77 - Download icon 編輯图标缺 aria-hidden="true"

src/pages/admin/purchase-orders/components/mapping/InternalProductSelector.tsx:37 - Input search 編輯图标缺 aria-label

src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:154 - icon button (clear) 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:272 - icon button (save) 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:281 - icon button (cancel) 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:292 - icon button (edit) 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:300 - icon button (delete) 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:380 - icon button (clear) 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:159 - X icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:279 - Check icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:287 - X icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:298 - Pencil icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:310 - Trash2 icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:384 - X icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappedRulesList.tsx:96 - loading 狀態 編輯图标缺 aria-live="polite"

src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:309 - file Input 編輯图标缺 aria-label
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:319 - loading 狀態 編輯图标缺 aria-live="polite"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:305 - Upload icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:344 - CheckCircle2 icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:349 - AlertTriangle icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:356 - XCircle icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:391 - CheckCircle2 icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:405 - AlertTriangle icon 編輯图标缺 aria-hidden="true"
src/pages/admin/purchase-orders/components/mapping/MappingImportDialog.tsx:412 - XCircle icon 編輯图标缺 aria-hidden="true"

src/pages/admin/purchase-orders/components/mapping/UnmappedResolver.tsx:90 - CheckCircle2 icon 編輯图标缺 aria-hidden="true"
```

### src/pages/admin/repair-orders/

```
src/pages/admin/repair-orders/index.tsx:85 - select 編輯图标缺 label + name
src/pages/admin/repair-orders/index.tsx:146 - search Input 編輯图标缺 aria-label
src/pages/admin/repair-orders/index.tsx:163 - Badge onClick 非互動元素 (應用 button)
src/pages/admin/repair-orders/index.tsx:132 - Wrench icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/index.tsx:145 - Search icon 編輯图标缺 aria-hidden="true"

src/pages/admin/repair-orders/detail.tsx:163 - icon button (back) 編輯图标缺 aria-label
src/pages/admin/repair-orders/detail.tsx:164 - ArrowLeft icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:178 - Printer icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:182 - Edit icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:192 - Printer icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:228 - User icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:255 - Smartphone icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:324 - DollarSign icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:423 - Clock icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:462 - History icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:488 - Edit icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/detail.tsx:492 - Printer icon 編輯图标缺 aria-hidden="true"

src/pages/admin/repair-orders/new.tsx:230 - icon button (back) 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:231 - ArrowLeft icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/new.tsx:238 - Save icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/new.tsx:386 - Plus icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/new.tsx:451 - icon button (delete) 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:452 - Trash2 icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/new.tsx:398 - select 編輯图标缺 label
src/pages/admin/repair-orders/new.tsx:408 - Input 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:416 - Input 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:424 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:433 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:442 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:512 - Input type="number" 編輯图标缺 aria-label
src/pages/admin/repair-orders/new.tsx:248 - User icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/new.tsx:275 - Smartphone icon 編輯图标缺 aria-hidden="true"
src/pages/admin/repair-orders/new.tsx:382 - DollarSign icon 編輯图标缺 aria-hidden="true"
```

### src/pages/store/

```
src/pages/store/Accounting.tsx:101 - SelectTrigger 編輯图标缺 accessible label
src/pages/store/Accounting.tsx:120 - DollarSign decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Accounting.tsx:130 - Package decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Accounting.tsx:140 - TrendingUp decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Accounting.tsx:152 - Calculator decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Accounting.tsx:192 - truncation 用 `...` 非 `…`
src/pages/store/Accounting.tsx:199 - number columns 編輯图标缺 tabular-nums
src/pages/store/Accounting.tsx:200 - number columns 編輯图标缺 tabular-nums

src/pages/store/Audit.tsx:55 - FileText decorative icon 編輯图标缺 aria-hidden="true"

src/pages/store/Catalog.tsx:232 - transition-all on view toggle
src/pages/store/Catalog.tsx:241 - transition-all on view toggle
src/pages/store/Catalog.tsx:250 - transition-all on view toggle
src/pages/store/Catalog.tsx:259 - transition-all on view toggle
src/pages/store/Catalog.tsx:323 - pagination ellipsis 用 `...` 非 `…`

src/pages/store/Notifications.tsx:105 - Bell decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Notifications.tsx:119 - notification div + onClick 應用 button
src/pages/store/Notifications.tsx:154 - icon Button 編輯图标缺 aria-label
src/pages/store/Notifications.tsx:143 - ExternalLink decorative icon 編輯图标缺 aria-hidden="true"

src/pages/store/Receiving.tsx:93 - Truck decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Receiving.tsx:99 - loading 用 `...` 非 `…`
src/pages/store/Receiving.tsx:147 - Package decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Receiving.tsx:212 - loading 用 `...` 非 `…`

src/pages/store/SalesNotes.tsx:309 - Package decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/SalesNotes.tsx:313 - Send decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/SalesNotes.tsx:320 - loading 用 `...` 非 `…`
src/pages/store/SalesNotes.tsx:372 - raw `<table>` 缺 role="table" 或用 semantic Table
src/pages/store/SalesNotes.tsx:458 - form Input 編輯图标缺 name + autocomplete
src/pages/store/SalesNotes.tsx:111 - loading 用 `...` 非 `…`

src/pages/store/StoreOrderEdit.tsx:246 - loading 用 `...` 非 `…`
src/pages/store/StoreOrderEdit.tsx:175 - loading 用 `...` 非 `…`

src/pages/store/StoreOrderList.tsx:175 - search Input 編輯图标缺 label
src/pages/store/StoreOrderList.tsx:138 - tab icons 編輯图标缺 aria-hidden="true"
src/pages/store/StoreOrderList.tsx:142 - tab icons 編輯图标缺 aria-hidden="true"
src/pages/store/StoreOrderList.tsx:146 - tab icons 編輯图标缺 aria-hidden="true"

src/pages/store/Team.tsx:153 - Users decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Team.tsx:198 - Mail decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/Team.tsx:249 - email Input 編輯图标缺 name + autocomplete="email"
src/pages/store/Team.tsx:224 - icon Button (Copy) 編輯图标缺 aria-label

src/pages/store/components/audit/AuditFilters.tsx:16 - Search decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/components/audit/AuditFilters.tsx:17 - search Input 編輯图标缺 label

src/pages/store/components/audit/AuditTable.tsx:75 - eye icon Button 編輯图标缺 aria-label
src/pages/store/components/audit/AuditTable.tsx:62 - truncation 用 `...` 非 `…`

src/pages/store/repair-orders/index.tsx:106 - Search decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/repair-orders/index.tsx:115 - filter Badge + onClick 非鍵盤可及
src/pages/store/repair-orders/index.tsx:93 - Wrench decorative icon 編輯图标缺 aria-hidden="true"

src/pages/store/repair-orders/detail.tsx:29 - back Button 編輯图标缺 aria-label
src/pages/store/repair-orders/detail.tsx:58 - User decorative icon 編輯图标缺 aria-hidden="true"
src/pages/store/repair-orders/detail.tsx:81 - Smartphone decorative icon 編輯图标缺 aria-hidden="true"

src/pages/store/repair-orders/new.tsx:154 - back Button 編輯图标缺 aria-label
src/pages/store/repair-orders/new.tsx:254 - delete Button 編輯图标缺 aria-label
src/pages/store/repair-orders/new.tsx:175 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:179 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:198 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:202 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:206 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:210 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:214 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:218 - form inputs 編輯图标缺 name
src/pages/store/repair-orders/new.tsx:234 - inputs 編輯图标缺 autocomplete
src/pages/store/repair-orders/new.tsx:240 - inputs 編輯图标缺 autocomplete
src/pages/store/repair-orders/new.tsx:247 - inputs 編輯图标缺 autocomplete
src/pages/store/repair-orders/new.tsx:234 - repair item inputs 編輯图标缺 label
src/pages/store/repair-orders/new.tsx:240 - repair item inputs 編輯图标缺 label
src/pages/store/repair-orders/new.tsx:247 - repair item inputs 編輯图标缺 label
```

### src/pages/market/

```
src/pages/market/create.tsx:242 - back Button 編輯图标缺 aria-label
src/pages/market/create.tsx:288 - selection button 非鍵盤可及 (缺 role/aria-pressed)
src/pages/market/create.tsx:319 - selection button 非鍵盤可及
src/pages/market/create.tsx:366 - selection button 非鍵盤可及
src/pages/market/create.tsx:479 - selection button 非鍵盤可及
src/pages/market/create.tsx:257 - transition-all
src/pages/market/create.tsx:270 - transition-all
src/pages/market/create.tsx:292 - transition-all
src/pages/market/create.tsx:304 - transition-all
src/pages/market/create.tsx:325 - transition-all
src/pages/market/create.tsx:371 - transition-all
src/pages/market/create.tsx:484 - transition-all
src/pages/market/create.tsx:504 - contact input 編輯图标缺 name + autocomplete
src/pages/market/create.tsx:501 - Smartphone decorative icon 編輯图标缺 aria-hidden="true"

src/pages/market/detail.tsx:134 - back Button 編輯图标缺 aria-label
src/pages/market/detail.tsx:140 - edit Button 編輯图标缺 aria-label
src/pages/market/detail.tsx:143 - delete Button 編輯图标缺 aria-label
src/pages/market/detail.tsx:154 - img 缺 explicit width/height
src/pages/market/detail.tsx:163 - image carousel dot Button 編輯图标缺 aria-label
src/pages/market/detail.tsx:167 - transition-all
src/pages/market/detail.tsx:267 - copy Button 編輯图标缺 aria-label
src/pages/market/detail.tsx:118 - loading spinner 缺 prefers-reduced-motion

src/pages/market/index.tsx:106 - category button transition-all
src/pages/market/index.tsx:124 - Search decorative icon 編輯图标缺 aria-hidden="true"
src/pages/market/index.tsx:125 - search Input 有 id 但缺 label htmlFor
src/pages/market/index.tsx:173 - FAB Button 編輯图标缺 aria-label

src/pages/market/my-listings.tsx:158 - Card onClick 用於導航 → 應用 Link/a
src/pages/market/my-listings.tsx:158 - transition-all
src/pages/market/my-listings.tsx:214 - icon Button 用 title 非 aria-label
src/pages/market/my-listings.tsx:223 - icon Button 用 title 非 aria-label
src/pages/market/my-listings.tsx:235 - icon Button 用 title 非 aria-label
src/pages/market/my-listings.tsx:244 - icon Button 用 title 非 aria-label
src/pages/market/my-listings.tsx:253 - icon Button 用 title 非 aria-label
src/pages/market/my-listings.tsx:288 - back Button 編輯图标缺 aria-label
src/pages/market/my-listings.tsx:321 - focus-visible:outline-none 無焦點替代
src/pages/market/my-listings.tsx:329 - focus-visible:outline-none 無焦點替代
src/pages/market/my-listings.tsx:337 - focus-visible:outline-none 無焦點替代
```

### src/pages/share/

```
src/pages/share/SharedSales.tsx:317 - loading 用 `...` 非 `…`
```
