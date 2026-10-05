/**
 * 採購／退貨匯入的「前端商品比對」。
 *
 * 本模組是伺服端 `public._po_resolve_item` 的前端鏡像，目的是讓使用者在預覽階段
 * 就知道每個品項會被解析成哪個商品（避免送出後才被 RAISE 整張中止），並允許
 * 對「未比對」品項手動指定內部變體。
 *
 * ⚠️ 語意必須與後端完全一致，改動前先確認 `prosrc`：
 *   _po_resolve_item
 *     1. btrim(vendor_product_id) 完全相同（case-sensitive）→ supplier_product_mappings
 *        ORDER BY is_primary DESC, updated_at DESC NULLS LAST, created_at DESC, id LIMIT 1
 *        label = COALESCE(pv.name, p.name)；ambiguous = count > 1 且無主對照
 *     2. 否則 import_resolve_item(sku, name)：
 *        a. product_variants.sku = sku   → 變體層級
 *        b. products.code = sku OR products.name = sku → 產品層級
 *        c. product_variants.name = name → 變體層級
 *        d. products.name = name         → 產品層級
 *        e. 全不命中 → NULL（伺服端 RAISE，整張中止）
 *
 * 後端 fallback 為「完全相同且大小寫敏感」（SQL `=`），故前端不可用模糊比對或
 * toLowerCase，否則預覽會顯示與實際匯入結果不同的判定。
 *
 * 本檔刻意不 import `@/utils/docImport`（改以結構型別描述品項），以便用
 * `node --experimental-strip-types` 直接 import 做純邏輯驗證。
 */

export interface MatchableItem {
  sku?: string;
  name?: string;
  vendor_product_id?: string;
}

/** `supplier_product_mappings` 匯入預覽所需的欄位（不含成本以外的額外欄位） */
export interface ImportMappingRow {
  id: string;
  vendor_product_id?: string | null;
  internal_product_id?: string | null;
  internal_variant_id?: string | null;
  is_primary?: boolean | null;
  updated_at?: string | null;
  created_at?: string | null;
  /** 由呼叫端以 nested select 組好的顯示名（後端為 COALESCE(pv.name, p.name)） */
  internal_label?: string | null;
}

export interface ImportCatalogVariant {
  id: string;
  name?: string | null;
  sku?: string | null;
}

export interface ImportCatalogProduct {
  id: string;
  name?: string | null;
  code?: string | null;
  variants?: ImportCatalogVariant[] | null;
}

export interface ImportMatchTarget {
  productId?: string | null;
  variantId?: string | null;
  label: string;
}

export type ImportMatchVia =
  | 'manual'
  | 'mapping'
  | 'variant_sku'
  | 'product_code_or_name'
  | 'variant_name'
  | 'product_name';

export interface ImportMatchResult extends ImportMatchTarget {
  status: 'matched' | 'unmatched';
  via: ImportMatchVia | null;
  /** 命中的是產品主體而非變體（後端允許，但對照單位應為變體，故前端需提示） */
  isProductLevel: boolean;
  /** 與 `_po_resolve_item` 的 ambiguous 定義一致：同料號多筆對照且無主對照 */
  ambiguous: boolean;
  candidateCount: number;
}

/** 手動指定（指定後即寫入 supplier_product_mappings，故優先於既有對照） */
export interface ManualTarget extends ImportMatchTarget {
  variantId: string;
}

export interface ImportMatchIndex {
  /** 廠商料號 → 對照列（已依後端排序，主對照優先） */
  mappingsByCode: Map<string, ImportMappingRow[]>;
  /** 廠商料號 → 使用者本次手動指定的目標 */
  manualByCode: Map<string, ManualTarget>;
  variantBySku: Map<string, ImportMatchTarget>;
  /** 後端 (b) 為單一 SELECT 的 `code = sku OR name = sku`，故合併為單一索引 */
  productByCodeOrName: Map<string, ImportMatchTarget>;
  variantByName: Map<string, ImportMatchTarget>;
  productByName: Map<string, ImportMatchTarget>;
}

function trimmed(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function labelOf(name: unknown, fallback: string): string {
  const s = typeof name === 'string' ? name.trim() : '';
  return s || fallback;
}

/** 後端 ORDER BY is_primary DESC, updated_at DESC NULLS LAST, created_at DESC, id */
function compareMappings(a: ImportMappingRow, b: ImportMappingRow): number {
  const pa = a.is_primary === true ? 1 : 0;
  const pb = b.is_primary === true ? 1 : 0;
  if (pa !== pb) return pb - pa;
  const ua = a.updated_at ?? null;
  const ub = b.updated_at ?? null;
  if (ua !== ub) {
    if (ua === null) return 1;
    if (ub === null) return -1;
    // DESC：字串較大者＝時間較新，須排在前
    return ua < ub ? 1 : -1;
  }
  const ca = a.created_at ?? null;
  const cb = b.created_at ?? null;
  if (ca !== cb) {
    if (ca === null) return 1;
    if (cb === null) return -1;
    return ca < cb ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 第一筆命中即採用（對應後端無 ORDER BY 的 LIMIT 1，取決於掃描順序） */
function putFirst(
  map: Map<string, ImportMatchTarget>,
  key: string,
  target: ImportMatchTarget,
) {
  if (key && !map.has(key)) map.set(key, target);
}

export function buildImportMatchIndex(
  mappings: ImportMappingRow[],
  products: ImportCatalogProduct[],
  manualByCode: Map<string, ManualTarget> = new Map(),
): ImportMatchIndex {
  const mappingsByCode = new Map<string, ImportMappingRow[]>();
  for (const row of mappings) {
    const code = trimmed(row.vendor_product_id);
    if (!code) continue;
    const bucket = mappingsByCode.get(code);
    if (bucket) bucket.push(row);
    else mappingsByCode.set(code, [row]);
  }
  for (const bucket of mappingsByCode.values()) bucket.sort(compareMappings);

  const variantBySku = new Map<string, ImportMatchTarget>();
  const productByCodeOrName = new Map<string, ImportMatchTarget>();
  const variantByName = new Map<string, ImportMatchTarget>();
  const productByName = new Map<string, ImportMatchTarget>();

  for (const product of products) {
    const productName = labelOf(product.name, '');
    const productTarget: ImportMatchTarget = {
      productId: product.id,
      variantId: null,
      label: productName || product.id,
    };
    putFirst(productByCodeOrName, trimmed(product.code), productTarget);
    putFirst(productByName, productName, productTarget);

    for (const variant of product.variants ?? []) {
      const variantTarget: ImportMatchTarget = {
        productId: product.id,
        variantId: variant.id,
        label: labelOf(variant.name, '') || labelOf(variant.sku, '') || productName || variant.id,
      };
      putFirst(variantBySku, trimmed(variant.sku), variantTarget);
      putFirst(variantByName, labelOf(variant.name, ''), variantTarget);
    }
  }

  return {
    mappingsByCode,
    manualByCode,
    variantBySku,
    productByCodeOrName,
    variantByName,
    productByName,
  };
}

function matchFromTarget(
  target: ImportMatchTarget,
  via: ImportMatchVia,
  extra?: Partial<ImportMatchResult>,
): ImportMatchResult {
  return {
    status: 'matched',
    via,
    productId: target.productId ?? null,
    variantId: target.variantId ?? null,
    label: target.label,
    isProductLevel: !target.variantId,
    ambiguous: false,
    candidateCount: 0,
    ...extra,
  };
}

/**
 * 逐品項比對。回傳 null 代表尚未完成索引（查詢仍在進行），
 * 呼叫端此時不得下「未比對」結論。
 */
export function resolveImportItem(
  item: MatchableItem | undefined,
  index: ImportMatchIndex | null,
): ImportMatchResult | null {
  if (!item || !index) return null;

  const code = trimmed(item.vendor_product_id);

  // 使用者手動指定（已寫入對照表）→ 伺服端同樣會走 mapping 路徑命中
  if (code) {
    const manual = index.manualByCode.get(code);
    if (manual) return matchFromTarget(manual, 'manual');
  }

  // 1. 供應商對照
  if (code) {
    const rows = index.mappingsByCode.get(code);
    if (rows && rows.length > 0) {
      const row = rows[0];
      return matchFromTarget(
        {
          productId: row.internal_product_id,
          variantId: row.internal_variant_id,
          label: labelOf(row.internal_label, code),
        },
        'mapping',
        {
          isProductLevel: !row.internal_variant_id,
          ambiguous: rows.length > 1 && !rows.some((r) => r.is_primary === true),
          candidateCount: rows.length,
        },
      );
    }
  }

  // 2. SKU / 品名 fallback（完全相同、大小寫敏感）
  const sku = trimmed(item.sku);
  if (sku) {
    const variant = index.variantBySku.get(sku);
    if (variant) return matchFromTarget(variant, 'variant_sku');
    const product = index.productByCodeOrName.get(sku);
    if (product) return matchFromTarget(product, 'product_code_or_name');
  }

  const name = trimmed(item.name);
  if (name) {
    const variant = index.variantByName.get(name);
    if (variant) return matchFromTarget(variant, 'variant_name');
    const product = index.productByName.get(name);
    if (product) return matchFromTarget(product, 'product_name');
  }

  return {
    status: 'unmatched',
    via: null,
    productId: null,
    variantId: null,
    label: '',
    isProductLevel: false,
    ambiguous: false,
    candidateCount: 0,
  };
}

/** 匯入後續需要的「指定變體」目標（只允許變體層級） */
export function toManualTarget(productId: string, variantId: string, label: string): ManualTarget {
  return { productId, variantId, label };
}
