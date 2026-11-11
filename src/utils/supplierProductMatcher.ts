import { SupplierProduct, ProductDiff, FieldChange, DiffAction, FIELD_LABELS } from './supplierProductSchema';
import type { ProductWithDetails, ProductVariant } from '@/types/product';

/**
 * 比對鍵優先序：supplier_sku → barcode → sku → name
 */
function getMatchKey(sp: SupplierProduct, existingProducts: ProductWithDetails[]): { product: ProductWithDetails | null; variant: ProductVariant | null; keyType: string } {
  // 1. supplier_sku → products.code 或 variants.sku
  for (const p of existingProducts) {
    if (p.code === sp.supplier_sku) return { product: p, variant: null, keyType: 'code' };
    for (const v of p.variants || []) {
      if (v.sku === sp.supplier_sku) return { product: p, variant: v, keyType: 'variant_sku' };
    }
  }
  // 2. barcode
  if (sp.barcode) {
    for (const p of existingProducts) {
      for (const v of p.variants || []) {
        if (v.barcode === sp.barcode) return { product: p, variant: v, keyType: 'variant_barcode' };
      }
    }
  }
  // 3. name（精確匹配）
  for (const p of existingProducts) {
    if (p.name === sp.name) return { product: p, variant: null, keyType: 'name' };
  }
  return { product: null, variant: null, keyType: 'none' };
}

function compareField(field: string, oldVal: unknown, newVal: unknown): boolean {
  if (oldVal === newVal) return true;
  if (oldVal == null && newVal == null) return true;
  if (oldVal == null || newVal == null) return false;
  // 數字比較
  if (typeof oldVal === 'number' && typeof newVal === 'number') {
    return Math.abs(oldVal - newVal) < 0.0001;
  }
  // 陣列比較（images）
  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    if (oldVal.length !== newVal.length) return false;
    return oldVal.every((v, i) => v === newVal[i]);
  }
  // 物件比較（dimensions）
  if (typeof oldVal === 'object' && typeof newVal === 'object') {
    return JSON.stringify(oldVal) === JSON.stringify(newVal);
  }
  return String(oldVal) === String(newVal);
}

function buildFieldChanges(sp: SupplierProduct, product: ProductWithDetails, variant: ProductVariant | null): FieldChange[] {
  const changes: FieldChange[] = [];

  // 產品層級欄位（依實際 DB schema：products 表無 barcode/brand/category/base_* 欄位，
  // 這些資料分散於 product_variants / product_brands / product_category_links / product_images）
  const firstVariant = product.variants?.[0];
  const productFields: { field: keyof SupplierProduct; label: string; oldGetter: (p: ProductWithDetails, v: ProductVariant | null) => unknown }[] = [
    { field: 'name', label: '品名', oldGetter: (p) => p.name },
    { field: 'wholesale_price', label: '批發價', oldGetter: (p, v) => p.unified_pricing ? p.unified_wholesale_price : (v?.wholesale_price ?? null) },
    { field: 'retail_price', label: '零售價', oldGetter: (p, v) => p.unified_pricing ? p.unified_retail_price : (v?.retail_price ?? null) },
    { field: 'description', label: '描述', oldGetter: (p) => p.description },
    { field: 'brand', label: '品牌', oldGetter: (p) => (p as any).primary_brand_name ?? (p as any).brand_names?.[0] ?? null },
    { field: 'category', label: '分類', oldGetter: (p) => (p as any).category_names?.[0] ?? null },
    { field: 'barcode', label: '條碼', oldGetter: (_p, v) => v?.barcode ?? null },
    { field: 'weight_kg', label: '重量', oldGetter: (p) => p.weight_kg },
    { field: 'images', label: '圖片', oldGetter: (p) => (p as any).image_url ? [(p as any).image_url] : undefined },
  ];

  for (const { field, label, oldGetter } of productFields) {
    const newVal = sp[field as keyof SupplierProduct];
    if (newVal === undefined) continue;
    const oldVal = oldGetter(product, firstVariant ?? null);
    if (!compareField(field, oldVal, newVal)) {
      changes.push({ field, label, old_value: oldVal, new_value: newVal });
    }
  }
  // 變體層級比對
  if (sp.variants && sp.variants.length > 0) {
    const existingVariants = product.variants || [];
    const variantChanges: string[] = [];

    // 檢查新增/刪除/修改的變體
    const spSkus = new Set(sp.variants.map(v => v.sku));
    const existingSkus = new Set(existingVariants.map(v => v.sku));

    const added = sp.variants.filter(v => !existingSkus.has(v.sku));
    const removed = existingVariants.filter(v => !spSkus.has(v.sku));
    const common = sp.variants.filter(v => existingSkus.has(v.sku));

    for (const v of common) {
      const ev = existingVariants.find(x => x.sku === v.sku);
      if (!ev) continue;
      const vChanges: string[] = [];
      if (v.name !== ev.name) vChanges.push('名稱');
      if (v.wholesale_price !== undefined && Math.abs((ev.wholesale_price || 0) - (v.wholesale_price || 0)) > 0.0001) vChanges.push('批發價');
      if (v.retail_price !== undefined && Math.abs((ev.retail_price || 0) - (v.retail_price || 0)) > 0.0001) vChanges.push('零售價');
      if (v.barcode && v.barcode !== ev.barcode) vChanges.push('條碼');
      if (vChanges.length > 0) {
        variantChanges.push(`${v.sku}：${vChanges.join('、')}`);
      }
    }

    if (added.length > 0) variantChanges.push(`新增變體：${added.map(v => v.sku).join('、')}`);
    if (removed.length > 0) variantChanges.push(`移除變體：${removed.map(v => v.sku).join('、')}`);

    if (variantChanges.length > 0) {
      changes.push({
        field: 'variants',
        label: '變體',
        old_value: `${existingVariants.length} 個變體`,
        new_value: `${sp.variants.length} 個變體（${variantChanges.join('；')}）`,
      });
    }
  }

  return changes;
}

/**
 * 比對供應商產品與系統現有產品
 */
export function matchSupplierProducts(
  supplierProducts: SupplierProduct[],
  existingProducts: ProductWithDetails[],
): ProductDiff[] {
  const diffs: ProductDiff[] = [];

  for (const sp of supplierProducts) {
    const { product, variant, keyType } = getMatchKey(sp, existingProducts);

    if (!product) {
      diffs.push({
        supplier_product: sp,
        action: 'create',
        reason: '系統中不存在此產品',
      });
      continue;
    }

    const changes = buildFieldChanges(sp, product, variant);

    if (changes.length === 0) {
      diffs.push({
        supplier_product: sp,
        action: 'unchanged',
        matched_product_id: product.id,
        matched_variant_id: variant?.id,
        reason: `比對鍵：${keyType}`,
      });
    } else {
      // 檢查是否有衝突（名稱差異過大）
      const nameChange = changes.find(c => c.field === 'name');
      const isConflict = nameChange && String(nameChange.old_value).trim() !== String(nameChange.new_value).trim() &&
        !String(nameChange.old_value).includes(String(nameChange.new_value)) &&
        !String(nameChange.new_value).includes(String(nameChange.old_value));

      diffs.push({
        supplier_product: sp,
        action: isConflict ? 'conflict' : 'update',
        matched_product_id: product.id,
        matched_variant_id: variant?.id,
        changes,
        reason: isConflict ? '品名差異過大，請確認' : `比對鍵：${keyType}，${changes.length} 個欄位有變更`,
      });
    }
  }

  return diffs;
}

/**
 * 統計差異
 */
export function summarizeDiffs(diffs: ProductDiff[]): { create: number; update: number; unchanged: number; conflict: number } {
  return {
    create: diffs.filter(d => d.action === 'create').length,
    update: diffs.filter(d => d.action === 'update').length,
    unchanged: diffs.filter(d => d.action === 'unchanged').length,
    conflict: diffs.filter(d => d.action === 'conflict').length,
  };
}
