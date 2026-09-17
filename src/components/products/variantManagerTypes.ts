import type { Tables } from '@/integrations/supabase/types';
import type { DeviceSelectionRef } from './StandaloneDeviceModelSelectField';

export type Product = Tables<'products'>;
export type ProductVariant = Tables<'product_variants'>;

export interface VariantManagerProps {
  products: Product[];
  search: string;
}

export interface ModelLink {
  variant_id: string;
  model_id: string;
  device_models?: { name?: string | null } | null;
}

export interface OptionDisplay {
  label: string;
  hexCode: string | null;
  groupName: string;
}

export type VariantWithExtras = ProductVariant & {
  device_model_links?: ModelLink[];
  optionDisplays?: OptionDisplay[];
};

export interface OptionValueRow {
  id: string;
  label: string;
  value: string | null;
  hex_code: string | null;
}

export interface OptionGroupRow {
  id: string;
  name: string | null;
  product_option_values?: OptionValueRow[];
}

export const STATUS_LABELS: Record<string, string> = {
  active: '上架中',
  discontinued: '已停售',
  preorder: '預購中',
  sold_out: '售完停產',
};

const COLOR_GROUP_NAME_RE = /(顏色|色|color)/i;
export function isColorGroupName(name: string): boolean {
  return COLOR_GROUP_NAME_RE.test(name);
}

export interface BatchEditEntry {
  field: string;
  value: string;
  optionGroupId?: string;
  optionValueId?: string;
  newOptionValueLabel?: string;
  newOptionValueHex?: string;
  modelRefs?: DeviceSelectionRef[];
}

export type FieldOptionType = 'number' | 'text' | 'select' | 'option' | 'model';

export interface FieldOption {
  value: string;
  label: string;
  type: FieldOptionType;
}

export interface BatchEditPayload {
  ids: string[];
  updates: Record<string, any>;
  optionGroupId?: string;
  optionValueId?: string;
  customLabel?: string;
  customHex?: string;
  modelRefs?: DeviceSelectionRef[];
}

export const FIELD_OPTIONS: FieldOption[] = [
  { value: 'option', label: '選項群組值', type: 'option' },
  { value: 'model', label: '型號', type: 'model' },
  { value: 'wholesale_price', label: '批發價', type: 'number' },
  { value: 'retail_price', label: '零售價', type: 'number' },
  { value: 'status', label: '狀態', type: 'select' },
  { value: 'name', label: '變體名稱', type: 'text' },
  { value: 'barcode', label: '條碼', type: 'text' },
];