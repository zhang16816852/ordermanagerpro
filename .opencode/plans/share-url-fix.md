# 修復計畫：分享網址路徑 + 訂單永久分享

## 問題摘要

1. **4 處銷貨單分享連結用了錯誤路徑** `/share/sales-note/`，路由定義是 `/share/sale/`，導致 404
2. **訂單無法分享**：`orders.access_token` 建立時從不設定，`OrderDetailDialog` 分享按鈕永遠不出現

## 修復一：修正 4 處銷貨單分享路徑

將 `/share/sales-note/` 改為 `/share/sale/`：

| # | 檔案 | 行號 | 調用場景 |
|---|------|------|---------|
| 1 | `src/pages/admin/AdminOrderForm.tsx` | 628 | 新建訂單 + 直接出貨（`create_order_with_sales_note`） |
| 2 | `src/pages/admin/AdminOrderForm.tsx` | 693 | 編輯頁直接出貨（`direct_ship_order`） |
| 3 | `src/pages/admin/AdminOrderCheckout.tsx` | 165 | 結帳頁出貨（`create_order_with_sales_note`） |
| 4 | `src/pages/admin/orders/list/OrderListPage.tsx` | 176 | 訂單列表批次出貨（`ship_from_pool` / `direct_ship_order`） |

**改動方式**：每處將 `share/sales-note/` 替換為 `share/sale/`

## 修復二：讓訂單可永久分享

### 改動 A — 客戶端建立訂單時帶入 access_token

**檔案：`src/hooks/useCreateOrder.ts`**（約第 42 行）

在 `.insert()` 的物件中加入 `access_token: crypto.randomUUID()`：

```typescript
const { data, error } = await supabase
    .from('orders')
    .insert({
        store_id,
        created_by: user.id,
        notes,
        source_type,
        access_token: crypto.randomUUID(),  // 新增
    })
    .select()
    .single();
```

**檔案：`src/pages/admin/AdminOrderForm.tsx`**（`createPendingMutation`，約第 562 行）

在 `.insert()` 的物件中加入 `access_token: crypto.randomUUID()`：

```typescript
const { data, error } = await supabase.from('orders').insert({
    store_id: storeId,
    created_by: user.id,
    sales_rep_id: user.id,
    source_type: 'pos',
    notes,
    consignment_mode: consignmentModeRef.current,
    access_token: crypto.randomUUID(),  // 新增
}).select().single();
```

### 改動 B — 後端 RPC 建立訂單時帶入 access_token

**Migration 檔案：`supabase/migrations/20260802000005_consignment_shipment_no_sales_note.sql`**

在 `create_order_with_sales_note` RPC 的 orders INSERT 語句中（約第 553-555 行），加入 `access_token`：

```sql
INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token)
VALUES (p_store_id, p_created_by, p_notes, v_source_type, 'pending', p_consignment_mode, gen_random_uuid())
RETURNING id, code INTO v_order_id, v_order_code;
```

同時在 returns 的 JSONB 中加入訂單的 access_token：

```sql
-- 在 RETURN JSONB 中加入：
'order_access_token', (SELECT access_token FROM public.orders WHERE id = v_order_id),
```

> 注意：需要先確認該 RPC 的 RETURN 語句結構，可能需要同時返回訂單的 access_token。

### 改動 C — 出貨時不再清除訂單的 access_token

**Migration 檔案：`supabase/migrations/20260903000003_reuse_access_token_in_ship.sql`**

#### `ship_from_pool`（約第 77-87 行）

**移除**這段邏輯（搜尋並複用訂單 token → 清除）：

```sql
-- 舊邏輯（要移除）：
SELECT o.access_token INTO v_access_token
FROM public.orders o
WHERE o.store_id = v_store_id AND o.access_token IS NOT NULL
LIMIT 1;

IF v_access_token IS NOT NULL THEN
    UPDATE public.orders SET access_token = NULL
    WHERE store_id = v_store_id AND access_token IS NOT NULL;
ELSE
    v_access_token := gen_random_uuid();
END IF;
```

**改為**：銷貨單一律使用獨立的新 token，不再讀取/清除訂單的 access_token：

```sql
-- 新邏輯：
v_access_token := gen_random_uuid();
```

#### `direct_ship_order`（約第 244-248 行）

**移除**這段邏輯：

```sql
-- 舊邏輯（要移除）：
IF v_order.access_token IS NOT NULL THEN
    v_access_token := v_order.access_token;
    UPDATE public.orders SET access_token = NULL WHERE id = p_order_id;
ELSE
    v_access_token := gen_random_uuid();
END IF;
```

**改為**：

```sql
-- 新邏輯：
v_access_token := gen_random_uuid();
```

## 不需要改動的部分

- `get_shared_order_details` RPC：已正確驗證 `orders.access_token`
- `SharedOrder.tsx`：路由和頁面已正確
- `OrderDetailDialog.tsx`：分享按鈕邏輯已正確（`access_token` 非空即顯示）
- `useOrdersList`：已 fetch `access_token`
- `SalesNoteListTable.tsx`、`SalesNoteDetailDialog.tsx`：已用正確路徑 `/share/sale/`

## 驗證步驟

1. `npm run typecheck` — 確認型別無誤
2. `npm run lint` — 確認 lint 通過
3. `npm run build` — 確認建置成功
4. 手動測試：
   - 新建訂單（pending）→ 訂單詳情 Dialog 應出現分享按鈕
   - 出貨後 toast 的「複製連結」應產生 `/share/sale/` 路徑的連結
   - 複製的連結應能正確開啟銷貨單分享頁
