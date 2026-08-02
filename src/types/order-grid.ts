import type { ProductWithPricing, VariantWithPricing } from './product';

export type DimensionType = 'variant_field' | 'product_list' | 'custom' | 'spec' | 'option';

export type VariantFieldKey = string;

export const VARIANT_FIELD_LABELS: Record<string, string> = {
  device: '型號/群組',
};

export const DIMENSION_TYPE_LABELS: Record<DimensionType, string> = {
  variant_field: 'Variant 欄位',
  spec: '規格表',
  option: '選項群組',
  product_list: '產品列表',
  custom: '自訂名稱',
};

export interface DimensionConfig {
  type: DimensionType;
  label: string;
  field?: VariantFieldKey;
  spec_id?: string;
  option_group_id?: string;
  model_ids?: string[];
  values?: string[];
  valueMap?: Record<string, string>;
}

export interface OrderGridTemplate {
  id: string;
  name: string;
  description?: string;
  row_config: DimensionConfig;
  col_config: DimensionConfig;
  tab_config?: DimensionConfig | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface TableTemplateVariant {
  id: string;
  template_id: string;
  variant_id: string;
  sort_order: number;
}

export interface OrderGridTemplateWithProducts extends OrderGridTemplate {
  template_variants: TableTemplateVariant[];
}

export interface GridCellVariant {
  variant: VariantWithPricing;
  product: ProductWithPricing;
  quantity: number;
}

export interface GridCellData {
  rowValue: string;
  colValue: string;
  tabValue?: string;
  items: GridCellVariant[];
}

export type GridMode = 'button' | 'input';

export interface GridQuantities {
  [variantId: string]: number;
}
