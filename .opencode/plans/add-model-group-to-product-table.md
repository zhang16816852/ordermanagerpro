# 在產品列表表格新增「型號群組」顯示

## 需求
產品列表 TABLE 目前只有顯示型號 (device_models)，沒有顯示型號群組 (device_model_groups)。  
用戶要求「只顯示群組名稱，不用展開」。

## 修改計畫

### 1. `src/pages/admin/products/hooks/useProductsList.ts`

在 `getProductModels` 之後新增 `getProductModelGroups` 函數：

```ts
const getProductModelGroups = useCallback((productId: string) => {
    const product = products?.find(p => p.id === productId);
    if (!product) return [];

    const pGroups = (product.device_model_groups || []).map((g: any) => g.name).filter(Boolean);
    const vGroups = (product as any).variants?.flatMap((v: any) =>
        (v.device_model_groups || []).map((g: any) => g.name).filter(Boolean)
    ) || [];

    return Array.from(new Set([...pGroups, ...vGroups])) as string[];
}, [products]);
```

在 return 物件中新增 `getProductModelGroups` 回傳值。

### 2. `src/pages/admin/products/components/ProductsTable.tsx`

- 在 `ProductsTableProps` 介面新增 `getModelGroups?: (id: string) => string[]`
- 在 component 參數解構中新增 `getModelGroups`
- 傳遞 `modelGroups={getModelGroups ? getModelGroups(product.id) : []}` 給 `<ProductRowItem>`

### 3. `src/pages/admin/products/components/ProductRowItem.tsx`

- 在 `ProductRowItemProps` 介面新增 `modelGroups: string[]`
- 在 component 參數解構中新增 `modelGroups`
- 在 `models` badges 區塊下方新增 group badges 渲染（使用藍色配色）

```tsx
{modelGroups.length > 0 && (
    <div className="flex flex-wrap gap-1 mt-1">
        {modelGroups.map((name, idx) => (
            <Badge key={`${product.id}-group-${idx}`} variant="secondary" className="text-[9px] px-1 h-4 bg-blue-100 text-blue-800 hover:bg-blue-100/80 border-transparent">
                {name}
            </Badge>
        ))}
    </div>
)}
```

### 4. `src/pages/admin/products/index.tsx`

在 `<ProductsTable>` 標籤中新增 `getModelGroups={getProductModelGroups}` prop。

## 預期結果

`產品列表` TAB 中的每一行產品：

```
廠牌 / 型號
Apple / iPhone15
[iPhone 15] [iPhone 15 Pro]    ← amber badge（個別型號，原本就有）
[iPhone 15 系列]               ← blue badge（型號群組，新增）
```
