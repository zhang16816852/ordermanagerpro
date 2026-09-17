// 變體批次生成 — 共用邏輯層（單一真值來源）
// VariantBatchCreator 與 CopyProductDialog 共用，確保 SKU／名稱／payload 生成規則一致，
// 不會出現「一邊 A-B 一邊 A_B」的發散。改動本檔＝兩入口同時生效。

export interface OptionValueInput {
  id: string;
  label: string;
  value: string;
  wholesalePrice: string;
  retailPrice: string;
  hexCode: string;
}

export interface OptionGroupInput {
  id: string;
  name: string;
  values: OptionValueInput[];
}

export interface OptionValueCreationInput {
  id: string;
  label: string;
  value?: string;
}

export interface SharedVariant {
  sku: string;
  name: string;
  barcode: string;
  wholesale_price: number;
  retail_price: number;
  sort_order: number;
  optionValueIds: string[];
  _modelGroupId?: string;
  _modelGroupType?: 'model' | 'group';
  _dbId?: string;
}

export interface ModelItem {
  name: string;
  id: string;
  type: 'model' | 'group';
}

export interface ModelItemRef {
  id: string;
  type: 'model' | 'group';
}

export type VariantEditableField =
  | 'sku'
  | 'name'
  | 'barcode'
  | 'wholesale_price'
  | 'retail_price';

export interface OptionGroupRef {
  id: string;
  type: 'model' | 'group';
}

const COLOR_GROUP_NAME_RE = /(顏色|色|color)/i;
const SPACE_RE = /\s+/g;
const COLOR_CODE_RE = /^#[0-9a-fA-F]{6}$/;

export function parseVariantNumber(value: string | number): number {
  return parseFloat(String(value)) || 0;
}

export function isColorGroupName(name: string): boolean {
  return COLOR_GROUP_NAME_RE.test(name);
}

export function isPredefinedColorValue(label: string, hexCode: string): boolean {
  return COLOR_CODE_RE.test(hexCode);
}

export function skuPartOf(value: OptionValueInput): string {
  return value.value.trim() || value.label.trim();
}

export function normalizeSegment(text: string): string {
  return text.trim().replace(SPACE_RE, '-');
}

export function getActiveGroups(groups: OptionGroupInput[]): OptionGroupInput[] {
  return groups.filter(g => g.name.trim() && g.values.some(v => v.label.trim()));
}

export function getActiveValueLabels(groups: OptionGroupInput[]): string[][] {
  return getActiveGroups(groups).map(g =>
    g.values.filter(v => v.label.trim()).map(v => v.label.trim()),
  );
}

export function getActiveDeviceItems(groups: OptionGroupInput[]): OptionGroupInput[] {
  return groups.filter(g => g.name.trim() && g.values.some(v => v.label.trim()));
}

export function getColorGroupValueIds(groups: OptionGroupInput[]): string[] {
  const ids: string[] = [];
  for (const g of groups) {
    if (!isColorGroupName(g.name)) continue;
    for (const v of g.values) {
      if (v.label.trim() && v.hexCode) ids.push(v.id);
    }
  }
  return ids;
}

export function resolveColorValue(v: Pick<OptionValueInput, 'label' | 'value'>, colors: { id: string; name: string; code: string }[]):
  | { id: string; name: string; code: string }
  | undefined {
  const byName = colors.find(c => c.name.trim().toLowerCase() === (v.label || '').trim().toLowerCase());
  if (byName) return byName;
  if (v.value) {
    return colors.find(c => c.code.toUpperCase() === v.value.trim().toUpperCase());
  }
  return undefined;
}

// 從色彩庫解析對應顏色（依名稱→代碼依序比對），回傳完整顏色物件
export function findLibraryColor<T extends { id: string; name: string; code: string; hex_code?: string | null }>(
  colors: T[],
  value: { label: string; value: string },
): T | undefined {
  const byName = colors.find(c => c.name.trim().toLowerCase() === (value.label || '').trim().toLowerCase());
  if (byName) return byName;
  if (value.value) {
    return colors.find(c => c.code.toUpperCase() === value.value.trim().toUpperCase());
  }
  return undefined;
}

export function cartesianProduct<T>(lists: T[][]): T[][] {
  if (lists.length === 0) return [[]];
  const [first, ...rest] = lists;
  const restProduct = cartesianProduct(rest);
  return first.flatMap(item => restProduct.map(restItems => [item, ...restItems]));
}

export interface GenerateVariantCombo {
  sku: string;
  name: string;
  sort_order: number;
  optionValueIds: string[];
  _modelGroupId?: string;
  _modelGroupType?: 'model' | 'group';
}

// 核心：笛卡爾積生成變體（唯一真值）。依「有效選項群組 × 型號項目」產生組合。
// 順序＝第一群組為最外層（與既有 VariantBatchCreator 相同），型號為內層。
export function generateVariantCombos(input: {
  optionGroups: OptionGroupInput[];
  modelItems: ModelItem[];
  prefix: string;
  baseName: string;
  priceMap: Map<string, { wholesale: number; retail: number }>;
  defaults: { wholesale: number; retail: number }; // 逐值兜底；unified 模式用 unified 價
  unified?: { wholesale: number; retail: number } | null;
}): GenerateVariantCombo[] {
  const { prefix } = input;
  const codePrefix = prefix.trim();
  const activeGroups = getActiveGroups(input.optionGroups);
  const modelDim = input.modelItems.length > 0 ? input.modelItems : [null];

  if (activeGroups.length === 0) {
    if (input.modelItems.length === 0) return [];
    return input.modelItems.map((item, idx) => ({
      sku: `${codePrefix}-${item.name}`.toUpperCase().replace(SPACE_RE, '-'),
      name: item.name,
      sort_order: idx,
      optionValueIds: [],
      _modelGroupId: item.id,
      _modelGroupType: item.type,
    }));
  }

  const valueLists = activeGroups.map(g =>
    g.values.filter(v => v.label.trim()).map(v => v.id),
  );
  const combinations = cartesianProduct(valueLists);

  const combos: GenerateVariantCombo[] = [];
  let variantIndex = 0;
  for (const combination of combinations) {
    for (const modelItem of modelDim) {
      const valueIds = combination.slice();
      const valueObjs = combination.map(id => {
        for (const g of activeGroups) {
          const found = g.values.find(v => v.id === id);
          if (found) return found;
        }
        return null;
      }).filter((v): v is OptionValueInput => !!v);

      const skuParts = [codePrefix, ...valueObjs.map(skuPartOf)];
      if (modelItem) skuParts.push(modelItem.name);
      const sku = skuParts.join('-').toUpperCase().replace(SPACE_RE, '-');

      const nameLabels = valueObjs.map(v => v.label.trim()).filter(Boolean);
      const name = modelItem
        ? `${modelItem.name}${nameLabels.length > 0 ? '_' + nameLabels.join('-') : ''}`
        : nameLabels.join('-');

      combos.push({
        sku,
        name,
        sort_order: variantIndex,
        optionValueIds: valueIds,
        ...(modelItem ? { _modelGroupId: modelItem.id, _modelGroupType: modelItem.type } : {}),
      });
      variantIndex++;
    }
  }
  return combos;
}

// 價格解析：逐值→預設（unified 時用統一價）
export function resolveVariantPrices(
  valueIds: string[],
  priceMap: Map<string, { wholesale: number; retail: number }>,
  defaults: { wholesale: number; retail: number },
): { wholesale: number; retail: number } {
  for (const vid of valueIds) {
    const hit = priceMap.get(vid);
    if (hit) return { ...hit };
  }
  return { ...defaults };
}

export function buildVariantPayload(input: {
  combos: GenerateVariantCombo[];
  prefix: string;
  baseName: string;
  priceMap: Map<string, { wholesale: number; retail: number }>;
  defaults: { wholesale: number; retail: number };
  unified?: { wholesale: number; retail: number } | null;
  barcodeLines?: string[];
  disallowEmptyGroups?: boolean;
}): SharedVariant[] {
  const { combos, barcodeLines = [] } = input;
  return combos.map((combo, idx) => {
    const prices = input.unified
      ? { ...input.unified }
      : resolveVariantPrices(
          combo.optionValueIds,
          input.priceMap,
          input.defaults,
        );
    return {
      sku: combo.sku,
      name: combo.name,
      barcode: barcodeLines[idx] ?? '',
      wholesale_price: prices.wholesale,
      retail_price: prices.retail,
      sort_order: combo.sort_order,
      optionValueIds: combo.optionValueIds,
      _modelGroupId: combo._modelGroupId,
      _modelGroupType: combo._modelGroupType,
    };
  });
}

export function createOptionValue(
  label = '',
  value = '',
  wholesalePrice = '',
  retailPrice = '',
  hexCode = '',
): OptionValueInput {
  return { id: crypto.randomUUID(), label, value, wholesalePrice, retailPrice, hexCode };
}

export function createOptionGroup(name = ''): OptionGroupInput {
  return { id: crypto.randomUUID(), name, values: [] };
}

// 建構「每值價」對照表：值 client id → { wholesale, retail }（retail 未填時沿用 wholesale）
export function buildPriceMap(groups: OptionGroupInput[]): Map<string, { wholesale: number; retail: number }> {
  const priceMap = new Map<string, { wholesale: number; retail: number }>();
  for (const group of groups) {
    for (const v of group.values) {
      if (v.label.trim() && v.wholesalePrice) {
        const wp = parseFloat(v.wholesalePrice);
        const rp = parseFloat(v.retailPrice) || wp;
        if (!isNaN(wp)) priceMap.set(v.id, { wholesale: wp, retail: rp });
      }
    }
  }
  return priceMap;
}

export interface OptionGroupSuggestion {
  name: string;
  values: { label: string; value: string; hexCode: string }[];
}

// RPC payload：option groups / values（以 client ref 串接）
export function buildGroupsPayload(groups: OptionGroupInput[]) {
  return groups
    .filter(g => g.name.trim())
    .map(g => ({
      ref: g.id,
      name: g.name.trim(),
      values: g.values
        .filter(v => v.label.trim())
        .map(v => ({
          ref: v.id,
          label: v.label.trim(),
          value: v.value.trim() || v.label.trim(),
          hex_code: v.hexCode || null,
        })),
    }));
}

// RPC payload：variants（依 SKU 去重）
export function buildDedupedVariantsPayload(variants: SharedVariant[]) {
  const list = variants.map(v => ({
    sku: v.sku,
    name: v.name,
    barcode: v.barcode || undefined,
    wholesale_price: v.wholesale_price,
    retail_price: v.retail_price,
    sort_order: v.sort_order,
  }));
  return [...new Map(list.map(v => [v.sku, v])).values()];
}

// RPC payload：variant-option 連結（依 SKU + client ref 串接）
export function buildVariantOptionsPayload(
  groups: OptionGroupInput[],
  variants: SharedVariant[],
): { sku: string; group_ref: string; value_ref: string }[] {
  const payload: { sku: string; group_ref: string; value_ref: string }[] = [];
  const namedGroupIds = new Set(groups.filter(g => g.name.trim()).map(g => g.id));
  for (const variant of variants) {
    for (const clientValueId of variant.optionValueIds) {
      const group = groups.find(g => g.values.some(val => val.id === clientValueId));
      if (!group || !namedGroupIds.has(group.id)) continue;
      payload.push({ sku: variant.sku, group_ref: group.id, value_ref: clientValueId });
    }
  }
  return payload;
}

// RPC payload：model relations。維持「每變體（_modelGroupId 存在時）」與「全變體 × 全部 refs」兩種模式。
export function buildModelRelationsPayload(
  variants: SharedVariant[],
  refs: ModelItemRef[],
): any[] {
  const payload: any[] = [];
  if (refs.length === 0) return payload;
  const deviceOrder = new Map<string, number>();
  refs.forEach((ref, idx) => deviceOrder.set(ref.id, idx));

  const hasPerVariantMapping = variants.some(v => v._modelGroupId && v._modelGroupType);

  if (hasPerVariantMapping) {
    for (const variant of variants) {
      if (!variant._modelGroupId || !variant._modelGroupType) continue;
      payload.push({
        sku: variant.sku,
        ...(variant._modelGroupType === 'model'
          ? { model_id: variant._modelGroupId }
          : { group_id: variant._modelGroupId }),
        sort_order: deviceOrder.get(variant._modelGroupId) ?? 0,
      });
    }
  } else {
    for (const variant of variants) {
      for (const ref of refs) {
        payload.push({
          sku: variant.sku,
          ...(ref.type === 'model' ? { model_id: ref.id } : { group_id: ref.id }),
          sort_order: deviceOrder.get(ref.id) ?? 0,
        });
      }
    }
  }
  return payload;
}

// 估測組合數（用於未生成前顯示數量）
export function estimateComboCount(groups: OptionGroupInput[], modelCount: number): number {
  const active = getActiveGroups(groups);
  if (active.length === 0) {
    return modelCount > 0 ? modelCount : 0;
  }
  const base = active.reduce(
    (acc, g) => acc * g.values.filter(v => v.label.trim()).length,
    1,
  );
  return modelCount > 0 ? base * modelCount : base;
}
