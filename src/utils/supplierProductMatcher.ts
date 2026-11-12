import { SupplierProduct, ProductDiff, FieldChange, DiffAction, FIELD_LABELS } from './supplierProductSchema';
import type { ProductWithDetails, ProductVariant } from '@/types/product';
import type { SupplierProductMapping } from '@/pages/admin/purchase-orders/hooks/useSupplierMappings';

/**
 * 比對鍵優先序：supplier_mappings (vendor_product_id) → supplier_sku → barcode → sku → name
 *
 * 當 supplierMappings 提供時，優先用 vendor_product_id 匹配。
 * 匹配成功後，比對的是 mapping 的 vendor_product_name/vendor_unit_cost（不是內部產品）。
 */
function getMatchKey(
  sp: SupplierProduct,
  existingProducts: ProductWithDetails[],
  supplierMappings?: SupplierProductMapping[]
): { product: ProductWithDetails | null; variant: ProductVariant | null; mapping: SupplierProductMapping | null; keyType: string } {
  // 0. supplier_product_mappings（廠商代號 → 內部產品/變體）
  if (supplierMappings) {
    const mapping = supplierMappings.find(m => m.vendor_product_id === sp.supplier_sku);
    if (mapping) {
      const product = existingProducts.find(p => p.id === mapping.internal_product_id) || null;
      const variant = mapping.internal_variant_id
        ? (product?.variants || []).find(v => v.id === mapping.internal_variant_id) || null
        : null;
      return { product, variant, mapping, keyType: 'supplier_mapping' };
    }
  }

  // 1. supplier_sku → products.code 或 variants.sku
  for (const p of existingProducts) {
    if (p.code === sp.supplier_sku) return { product: p, variant: null, mapping: null, keyType: 'code' };
    for (const v of p.variants || []) {
      if (v.sku === sp.supplier_sku) return { product: p, variant: v, mapping: null, keyType: 'variant_sku' };
    }
  }
  // 2. barcode
  if (sp.barcode) {
    for (const p of existingProducts) {
      for (const v of p.variants || []) {
        if (v.barcode === sp.barcode) return { product: p, variant: v, mapping: null, keyType: 'variant_barcode' };
      }
    }
  }
  // 3. name（精確匹配）
  for (const p of existingProducts) {
    if (p.name === sp.name) return { product: p, variant: null, mapping: null, keyType: 'name' };
  }
  return { product: null, variant: null, mapping: null, keyType: 'none' };
}

function compareField(field: string, oldVal: unknown, newVal: unknown): boolean {
  if (oldVal === newVal) return true;
  if (oldVal == null && newVal == null) return true;
  if (oldVal == null || newVal == null) return false;
  if (typeof oldVal === 'number' && typeof newVal === 'number') {
    return Math.abs(oldVal - newVal) < 0.0001;
  }
  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    if (oldVal.length !== newVal.length) return false;
    return oldVal.every((v, i) => v === newVal[i]);
  }
  if (typeof oldVal === 'object' && typeof newVal === 'object') {
    return JSON.stringify(oldVal) === JSON.stringify(newVal);
  }
  return String(oldVal) === String(newVal);
}

/**
 * 建立欄位變更清單
 * 當有 mapping 時，old value 來自 mapping（vendor_product_name, vendor_unit_cost）
 * 否則來自內部產品
 */
function buildFieldChanges(
  sp: SupplierProduct,
  product: ProductWithDetails,
  variant: ProductVariant | null,
  mapping: SupplierProductMapping | null
): FieldChange[] {
  const changes: FieldChange[] = [];

  // 當有 mapping 時，用 mapping 的資料作為舊值
  const hasMapping = !!mapping;

  const productFields: { field: keyof SupplierProduct; label: string; oldGetter: () => unknown; newVal: unknown }[] = [
    {
      field: 'name',
      label: '品名',
      oldGetter: () => hasMapping ? mapping!.vendor_product_name : product.name,
      newVal: sp.name,
    },
    {
      field: 'wholesale_price',
      label: '批發價',
      oldGetter: () => hasMapping ? mapping!.vendor_unit_cost : (product.unified_pricing ? product.unified_wholesale_price : (variant?.wholesale_price ?? null)),
      newVal: sp.wholesale_price,
    },
    {
      field: 'retail_price',
      label: '零售價',
      oldGetter: () => hasMapping ? null : (product.unified_pricing ? product.unified_retail_price : (variant?.retail_price ?? null)),
      newVal: sp.retail_price,
    },
    { field: 'description', label: '描述', oldGetter: () => product.description, newVal: sp.description },
    { field: 'brand', label: '品牌', oldGetter: () => (product as any).primary_brand_name ?? (product as any).brand_names?.[0] ?? null, newVal: sp.brand },
    // category 欄位不參與比對（目前系統中分類無作用）
    { field: 'barcode', label: '條碼', oldGetter: () => variant?.barcode ?? null, newVal: sp.barcode },
    { field: 'weight_kg', label: '重量', oldGetter: () => product.weight_kg, newVal: sp.weight_kg },
    { field: 'images', label: '圖片', oldGetter: () => (product as any).image_url ? [(product as any).image_url] : undefined, newVal: sp.images },
  ];

  for (const { field, label, oldGetter, newVal } of productFields) {
    if (newVal === undefined) continue;
    // 當有 mapping 時，retail_price 的 old 值為 null，跳過比較
    if (hasMapping && field === 'retail_price') continue;
    const oldVal = oldGetter();
    if (!compareField(field, oldVal, newVal)) {
      changes.push({ field, label, old_value: oldVal, new_value: newVal });
    }
  }

  // 變體層級比對（僅無 mapping 時）
  if (!hasMapping && sp.variants && sp.variants.length > 0) {
    const existingVariants = product.variants || [];
    const variantChanges: string[] = [];

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
 * 當有 supplierMappings 時，優先用 vendor_product_id 匹配
 * 匹配成功後，比對 mapping 的 vendor_product_name/vendor_unit_cost（不是內部產品）
 */
export function matchSupplierProducts(
  supplierProducts: SupplierProduct[],
  existingProducts: ProductWithDetails[],
  supplierMappings?: SupplierProductMapping[]
): ProductDiff[] {
  const diffs: ProductDiff[] = [];

  for (const sp of supplierProducts) {
    const { product, variant, mapping, keyType } = getMatchKey(sp, existingProducts, supplierMappings);

    // 有 mapping → 已對應，比對 mapping 的資料
    if (mapping) {
      const changes = buildFieldChanges(sp, product || ({} as any), variant, mapping);

      if (changes.length === 0) {
        diffs.push({
          supplier_product: sp,
          action: 'unchanged',
          matched_product_id: product?.id,
          matched_variant_id: variant?.id,
          reason: `比對鍵：${keyType}（廠商代號已對應）`,
        });
      } else {
        const nameChange = changes.find(c => c.field === 'name');
        const isConflict = nameChange && String(nameChange.old_value).trim() !== String(nameChange.new_value).trim() &&
          !String(nameChange.old_value).trim().includes(String(nameChange.new_value).trim()) &&
          !String(nameChange.new_value).trim().includes(String(nameChange.old_value).trim());

        diffs.push({
          supplier_product: sp,
          action: isConflict ? 'conflict' : 'update',
          matched_product_id: product?.id,
          matched_variant_id: variant?.id,
          changes,
          reason: isConflict ? '品名差異過大，請確認' : `比對鍵：${keyType}，${changes.length} 個欄位有變更`,
        });
      }
      continue;
    }

    // 無 mapping → 檢查是否能透過 SKU/名稱匹配到內部產品
    if (product) {
      const changes = buildFieldChanges(sp, product, variant, null);

      if (changes.length === 0) {
        diffs.push({
          supplier_product: sp,
          action: 'unchanged',
          matched_product_id: product.id,
          matched_variant_id: variant?.id,
          reason: `比對鍵：${keyType}`,
        });
      } else {
        const nameChange = changes.find(c => c.field === 'name');
        const isConflict = nameChange && String(nameChange.old_value).trim() !== String(nameChange.new_value).trim() &&
          !String(nameChange.old_value).trim().includes(String(nameChange.new_value).trim()) &&
          !String(nameChange.new_value).trim().includes(String(nameChange.old_value).trim());

        diffs.push({
          supplier_product: sp,
          action: isConflict ? 'conflict' : 'update',
          matched_product_id: product.id,
          matched_variant_id: variant?.id,
          changes,
          reason: isConflict ? '品名差異過大，請確認' : `比對鍵：${keyType}，${changes.length} 個欄位有變更`,
        });
      }
      continue;
    }

    // 完全沒有匹配 → 新增
    diffs.push({
      supplier_product: sp,
      action: 'create',
      reason: '系統中不存在此產品（無對照規則）',
    });
  }

  return diffs;
}

export function summarizeDiffs(diffs: ProductDiff[]): { create: number; update: number; unchanged: number; conflict: number } {
  return {
    create: diffs.filter(d => d.action === 'create').length,
    update: diffs.filter(d => d.action === 'update').length,
    unchanged: diffs.filter(d => d.action === 'unchanged').length,
    conflict: diffs.filter(d => d.action === 'conflict').length,
  };
}
