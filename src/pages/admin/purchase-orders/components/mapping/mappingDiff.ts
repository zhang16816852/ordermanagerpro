import { SupplierProductMapping } from '../../hooks/useSupplierMappings';

interface MatchedProductSummary {
  id: string;
  name: string;
}

interface MatchedVariantSummary {
  id: string;
  name: string | null;
  sku: string;
}

/** 匯入預覽列中，diffRowsOf 需要的最小欄位集合 */
export interface MappingDiffInput {
  vendor_product_name: string;
  unit_cost: number | null;
  matched_product?: MatchedProductSummary;
  matched_variant?: MatchedVariantSummary;
  /** 將被更新的既有對照（原始資料） */
  conflict_existing?: SupplierProductMapping;
  /** 檔案提供的「主對照」欄位；未提供時為 undefined */
  is_primary?: boolean;
}

/** 單一欄位的「原始值 → 變更後值」 */
export interface MappingFieldDiff {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

export const targetTextOf = (
  productName?: string | null,
  variantName?: string | null,
  productCode?: string | null,
) => {
  const name = productName || productCode || '未知產品';
  return variantName ? `${name}（${variantName}）` : name;
};

export const costTextOf = (value: number | null | undefined) => (value != null ? `$${value}` : '無');

/** 依既有對照（原始資料）與檔案內容算出逐欄差異 */
export const diffRowsOf = (row: MappingDiffInput): MappingFieldDiff[] => {
  const existing = row.conflict_existing;
  if (!existing) return [];

  const beforeTarget = targetTextOf(
    existing.internal_product?.name,
    existing.internal_variant?.name,
    existing.internal_product?.code,
  );
  const afterTarget = targetTextOf(row.matched_product?.name, row.matched_variant?.name);
  const beforeName = existing.vendor_product_name?.trim() || '（空白）';
  const afterName = row.vendor_product_name?.trim() || '（空白）';
  const beforeCost = costTextOf(existing.vendor_unit_cost);
  const afterCost = costTextOf(row.unit_cost);
  const beforePrimary = existing.is_primary ? '主對照' : '次要對照';
  const afterPrimary = row.is_primary == null
    ? `${beforePrimary}（檔案未指定，維持原值）`
    : row.is_primary ? '主對照' : '次要對照';

  return [
    { label: '對照目標', before: beforeTarget, after: afterTarget, changed: beforeTarget !== afterTarget },
    { label: '廠商品名', before: beforeName, after: afterName, changed: beforeName !== afterName },
    { label: '供應商單價', before: beforeCost, after: afterCost, changed: beforeCost !== afterCost },
    {
      label: '主對照',
      before: beforePrimary,
      after: afterPrimary,
      changed: row.is_primary != null && row.is_primary !== existing.is_primary,
    },
  ];
};