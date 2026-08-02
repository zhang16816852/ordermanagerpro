import type { ProductWithPricing, VariantWithPricing } from '@/types/product';
import type { DimensionConfig, GridCellVariant, VariantFieldKey, OrderGridTemplateWithProducts } from '@/types/order-grid';
import { formatSpecValue } from '@/utils/specLogic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectDeviceNames(variant: VariantWithPricing): string[] {
  const names: string[] = [];
  (variant as any).device_models?.forEach((m: any) => {
    if (m.name) names.push(m.name);
  });
  (variant as any).device_model_groups?.forEach((m: any) => {
    if (m.name) names.push(m.name);
  });
  return names;
}

function collectFieldValues(
  variant: VariantWithPricing,
  field: VariantFieldKey,
): string[] {
  if (field === 'device') return collectDeviceNames(variant);
  const val = (variant as any)[field];
  return val && typeof val === 'string' ? [val] : [];
}

function getOptionGroupName(groupId: string, products: ProductWithPricing[]): string | null {
  console.log('[grid-debug] getOptionGroupName groupId:', groupId, 'products:', products.length);
  for (const p of products) {
    const ogroups = (p as any).option_groups || [];
    console.log('[grid-debug] product', p.id, 'option_groups:', ogroups.length, JSON.stringify(ogroups.map((og: any) => ({id: og.id, name: og.name}))));
    for (const og of ogroups) {
      if (og.id === groupId) {
        console.log('[grid-debug] FOUND group name:', og.name);
        return og.name;
      }
    }
  }
  console.log('[grid-debug] groupId NOT FOUND in any product');
  return null;
}

function collectOptionValuesByName(
  variant: VariantWithPricing,
  groupName: string,
  product: ProductWithPricing,
): string[] {
  const ovs = (variant as any).option_values;
  console.log('[grid-debug] collectOptionValuesByName variant:', variant.id, 'groupName:', groupName, 'product:', product.id, 'hasOV:', !!ovs, 'ovLen:', ovs?.length, 'productOGs:', ((product as any).option_groups || []).length);
  if (!ovs || !Array.isArray(ovs)) return [];

  const matchingGroupIds = new Set(
    ((product as any).option_groups || [])
      .filter((g: any) => g.name === groupName)
      .map((g: any) => g.id),
  );
  console.log('[grid-debug] matchingGroupIds:', [...matchingGroupIds]);

  const result = ovs
    .filter((ov: any) => {
      const match = matchingGroupIds.has(ov.group_id);
      console.log('[grid-debug] ov:', ov.id, ov.label, 'group_id:', ov.group_id, 'match:', match);
      return match;
    })
    .map((ov: any) => ov.label || ov.value || '')
    .filter(Boolean);
  console.log('[grid-debug] collectOptionValuesByName result:', result);
  return result;
}

function collectSpecValues(
  variant: VariantWithPricing,
  specId: string,
): string[] {
  const specVals = (variant as any).spec_values;
  if (!specVals || typeof specVals !== 'object') return [];

  const results: string[] = [];
  Object.entries(specVals).forEach(([key, val]) => {
    const parts = key.split(':');
    const id = parts.length >= 2 ? parts[1] : key;
    if (id !== specId || !val) return;

    if (Array.isArray(val)) {
      val.forEach((item) => {
        const s = formatSpecValue(item);
        if (s) results.push(s);
      });
    } else {
      const s = formatSpecValue(val);
      if (s) results.push(s);
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function getDisplayValue(
  rawValue: string,
  valueMap?: Record<string, string>,
): string {
  return valueMap?.[rawValue] ?? rawValue;
}

// ---------------------------------------------------------------------------
// Dimension value extraction
// ---------------------------------------------------------------------------

export function extractDimensionValues(
  config: DimensionConfig,
  products: ProductWithPricing[],
): string[] {
  if (config.type === 'custom' && config.values) {
    return config.values;
  }

  if (config.type === 'product_list') {
    return products.map((p) => p.name);
  }

  if (config.type === 'variant_field' && config.field) {
    const values = new Set<string>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        collectFieldValues(v as VariantWithPricing, config.field!).forEach((n) =>
          values.add(n),
        );
      });
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh'));
  }

  if (config.type === 'option' && config.option_group_id) {
    console.log('[grid-debug] extractDimensionValues option config:', JSON.stringify(config), 'products:', products.length);
    const groupName = getOptionGroupName(config.option_group_id, products);
    console.log('[grid-debug] resolved groupName:', groupName);
    if (!groupName) return [];

    const values = new Set<string>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        collectOptionValuesByName(v as VariantWithPricing, groupName, p as ProductWithPricing).forEach((n) =>
          values.add(n),
        );
      });
    });
    const result = Array.from(values).sort((a, b) => a.localeCompare(b, 'zh'));
    console.log('[grid-debug] option dimension values:', result);
    return result;
  }

  if (config.type === 'spec' && config.spec_id) {
    const values = new Set<string>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        collectSpecValues(v as VariantWithPricing, config.spec_id!).forEach((s) =>
          values.add(s),
        );
      });
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh'));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Variant ↔ dimension matching
// ---------------------------------------------------------------------------

export function matchVariantToDimension(
  variant: VariantWithPricing,
  config: DimensionConfig,
  value: string,
  products: ProductWithPricing[],
): boolean {
  if (config.type === 'product_list') {
    const product = products.find((p) => p.id === variant.product_id);
    return product?.name === value;
  }

  if (config.type === 'variant_field' && config.field) {
    return collectFieldValues(variant, config.field).includes(value);
  }

  if (config.type === 'spec' && config.spec_id) {
    return collectSpecValues(variant, config.spec_id).includes(value);
  }

  if (config.type === 'option' && config.option_group_id) {
    const groupName = getOptionGroupName(config.option_group_id, products);
    if (!groupName) return false;
    const product = products.find((p) => p.id === variant.product_id);
    if (!product) return false;
    const ovs = collectOptionValuesByName(variant, groupName, product);
    const matched = ovs.includes(value);
    console.log('[grid-debug] matchVariantToDimension variant:', variant.id, 'value:', value, 'ovs:', ovs, 'matched:', matched);
    return matched;
  }

  // custom: always match (values are user-defined)
  return true;
}

// ---------------------------------------------------------------------------
// Grid matrix builder
// ---------------------------------------------------------------------------

export function buildGridMatrix(
  template: {
    row_config: DimensionConfig;
    col_config: DimensionConfig;
    tab_config?: DimensionConfig | null;
  },
  products: ProductWithPricing[],
): {
  rowValues: string[];
  colValues: string[];
  tabValues: string[];
  cells: Map<string, GridCellVariant[]>;
} {
  console.log('[grid-debug] buildGridMatrix products count:', products.length);
  products.forEach((p) => {
    const og = (p as any).option_groups;
    console.log('[grid-debug] product:', p.id, p.name, 'option_groups:', og?.length, og ? JSON.stringify(og.map((g: any) => ({id: g.id, name: g.name, valuesCount: (g.product_option_values || g.values || []).length}))) : 'null');
    p.variants?.forEach((v) => {
      const ov = (v as any).option_values;
      console.log('[grid-debug]   variant:', v.id, v.name, 'option_values:', ov?.length, ov ? JSON.stringify(ov.map((o: any) => ({id: o.id, label: o.label, group_id: o.group_id}))) : 'null');
    });
  });
  const rowValues = extractDimensionValues(template.row_config, products);
  const colValues = extractDimensionValues(template.col_config, products);
  const tabValues = template.tab_config
    ? extractDimensionValues(template.tab_config, products)
    : ['__all__'];

  const cells = new Map<string, GridCellVariant[]>();

  products.forEach((product) => {
    product.variants?.forEach((variant) => {
      const v = variant as VariantWithPricing;

      const matchedRow = rowValues.find((rv) =>
        matchVariantToDimension(v, template.row_config, rv, products),
      );
      const matchedCol = colValues.find((cv) =>
        matchVariantToDimension(v, template.col_config, cv, products),
      );
      const matchedTab = template.tab_config
        ? tabValues.find((tv) =>
            matchVariantToDimension(v, template.tab_config!, tv, products),
          )
        : '__all__';

      if (matchedRow && matchedCol && matchedTab) {
        const key = `${matchedTab}|${matchedRow}|${matchedCol}`;
        const existing = cells.get(key) || [];
        existing.push({
          variant: v,
          product: product as ProductWithPricing,
          quantity: 0,
        });
        cells.set(key, existing);
      }
    });
  });

  const rowsWithData = rowValues.filter((rv) =>
    colValues.some((cv) =>
      tabValues.some((tv) => cells.has(`${tv}|${rv}|${cv}`)),
    ),
  );
  const colsWithData = colValues.filter((cv) =>
    rowValues.some((rv) =>
      tabValues.some((tv) => cells.has(`${tv}|${rv}|${cv}`)),
    ),
  );
  const tabsWithData = tabValues.filter((tv) =>
    rowValues.some((rv) =>
      colValues.some((cv) => cells.has(`${tv}|${rv}|${cv}`)),
    ),
  );

  return {
    rowValues: rowsWithData,
    colValues: colsWithData,
    tabValues: tabsWithData,
    cells,
  };
}

// ---------------------------------------------------------------------------
// Tab filtering
// ---------------------------------------------------------------------------

export function filterRowsColsForTab(
  rowValues: string[],
  colValues: string[],
  cells: Map<string, GridCellVariant[]>,
  tabValue: string,
): { rowValues: string[]; colValues: string[] } {
  const rowsWithData = rowValues.filter((rv) =>
    colValues.some((cv) => cells.has(`${tabValue}|${rv}|${cv}`)),
  );
  const colsWithData = colValues.filter((cv) =>
    rowValues.some((rv) => cells.has(`${tabValue}|${rv}|${cv}`)),
  );
  return { rowValues: rowsWithData, colValues: colsWithData };
}

// ---------------------------------------------------------------------------
// Variant field summary (for VariantSummaryPanel)
// ---------------------------------------------------------------------------

export function extractVariantFieldSummary(
  products: ProductWithPricing[],
): Record<string, string[]> {
  const fields: Record<string, Set<string>> = {
    device: new Set(),
  };

  products.forEach((p) => {
    p.variants?.forEach((v) => {
      Object.keys(fields).forEach((field) => {
        if (field === 'device') {
          collectDeviceNames(v as VariantWithPricing).forEach((n) =>
            fields[field].add(n),
          );
        } else {
          const val = (v as any)[field];
          if (val && typeof val === 'string') {
            fields[field].add(val);
          }
        }
      });
    });
  });

  const result: Record<string, string[]> = {};
  Object.entries(fields).forEach(([key, set]) => {
    if (set.size > 0) {
      result[key] = Array.from(set);
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Legacy migration: convert old variant_field(option_N) → option type
// ---------------------------------------------------------------------------

const LEGACY_OPTION_FIELDS = new Set(['option_1', 'option_2', 'option_3', 'option_4', 'option_5']);

function hasDirectFieldOnVariants(field: string, products: ProductWithPricing[]): boolean {
  for (const p of products) {
    for (const v of (p.variants || [])) {
      if ((v as any)[field] !== undefined) return true;
    }
    break; // only need one product
  }
  return false;
}

function resolveOptionGroupId(field: string, products: ProductWithPricing[]): string | null {
  // Collect all option groups from products
  const groupsByName = new Map<string, string>(); // name → id
  const groupsByIndex: { id: string; name: string }[] = [];
  for (const p of products) {
    for (const og of ((p as any).option_groups || [])) {
      if (!groupsByName.has(og.name)) {
        groupsByName.set(og.name, og.id);
        groupsByIndex.push({ id: og.id, name: og.name });
      }
    }
    break; // option groups are product-level, one product is enough
  }

  // 1. Try direct name match (user named the field same as option group)
  if (groupsByName.has(field)) return groupsByName.get(field)!;

  // 2. Try option_N index match (option_1 → first option group)
  if (LEGACY_OPTION_FIELDS.has(field)) {
    const idx = parseInt(field.split('_')[1]) - 1;
    if (groupsByIndex[idx]) return groupsByIndex[idx].id;
  }

  return null;
}

export function migrateTemplateConfig(
  config: DimensionConfig,
  products: ProductWithPricing[],
): DimensionConfig {
  if (config.type !== 'variant_field' || !config.field || config.field === 'device') return config;

  const field = config.field;

  // If the field still directly exists on variants, keep as-is
  if (hasDirectFieldOnVariants(field, products)) return config;

  // Try to resolve to an option group
  const optionGroupId = resolveOptionGroupId(field, products);
  if (optionGroupId) {
    return {
      type: 'option',
      label: config.label,
      option_group_id: optionGroupId,
    };
  }

  return config;
}

export function migrateTemplate(
  template: OrderGridTemplateWithProducts,
  products: ProductWithPricing[],
): OrderGridTemplateWithProducts {
  return {
    ...template,
    row_config: migrateTemplateConfig(template.row_config, products),
    col_config: migrateTemplateConfig(template.col_config, products),
    tab_config: template.tab_config ? migrateTemplateConfig(template.tab_config, products) : null,
  };
}
