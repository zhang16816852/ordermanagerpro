/**
 * 供應商產品統一資料格式（Standard Product Schema）
 *
 * 所有接入方式（API / 爬蟲 / 手動匯入）最終產出此格式，
 * 再由比對引擎與系統現有產品進行比對。
 */

export interface SupplierVariant {
  sku: string;
  name: string;
  barcode?: string;
  color?: string;
  option_1?: string;
  option_2?: string;
  option_3?: string;
  wholesale_price?: number;
  retail_price?: number;
  images?: string[];
  stock?: number;
}

export interface SupplierProduct {
  // 基本資訊
  supplier_sku: string;          // 供應商料號（必填，對照鍵）
  name: string;                  // 產品名稱
  description?: string;
  brand?: string;
  category?: string;
  // 價格
  wholesale_price?: number;
  retail_price?: number;
  currency?: string;             // 預設 TWD
  // 庫存/規格
  barcode?: string;
  weight_kg?: number;
  dimensions?: { length?: number; width?: number; height?: number; unit?: string };
  // 圖片
  images?: string[];
  // 變體
  variants?: SupplierVariant[];
  // 供應商資訊
  supplier_name?: string;
  supplier_url?: string;
  // 元資料
  source: 'api' | 'crawler' | 'manual' | 'import';
  source_platform?: string;
  fetched_at?: string;
}

export type DiffAction = 'create' | 'update' | 'unchanged' | 'conflict';

export interface FieldChange {
  field: string;
  label: string;
  old_value: unknown;
  new_value: unknown;
}

export interface ProductDiff {
  supplier_product: SupplierProduct;
  action: DiffAction;
  matched_product_id?: string;
  matched_variant_id?: string;
  changes?: FieldChange[];
  reason?: string;
}

/** 欄位變更顯示標籤 */
export const FIELD_LABELS: Record<string, string> = {
  name: '品名',
  wholesale_price: '批發價',
  retail_price: '零售價',
  description: '描述',
  brand: '品牌',
  category: '分類',
  barcode: '條碼',
  weight_kg: '重量',
  images: '圖片',
  variants: '變體',
};

/** 統計差異 */
export function summarizeDiffs(diffs: ProductDiff[]): { create: number; update: number; unchanged: number; conflict: number } {
  return {
    create: diffs.filter(d => d.action === 'create').length,
    update: diffs.filter(d => d.action === 'update').length,
    unchanged: diffs.filter(d => d.action === 'unchanged').length,
    conflict: diffs.filter(d => d.action === 'conflict').length,
  };
}

/** 驗證統一格式是否合法 */
export function validateSupplierProduct(p: Partial<SupplierProduct>): string[] {
  const errors: string[] = [];
  if (!p.supplier_sku?.trim()) errors.push('缺少供應商料號（supplier_sku）');
  if (!p.name?.trim()) errors.push('缺少產品名稱（name）');
  if (p.wholesale_price !== undefined && (typeof p.wholesale_price !== 'number' || p.wholesale_price < 0)) {
    errors.push('批發價必須為非負數');
  }
  if (p.retail_price !== undefined && (typeof p.retail_price !== 'number' || p.retail_price < 0)) {
    errors.push('零售價必須為非負數');
  }
  return errors;
}
