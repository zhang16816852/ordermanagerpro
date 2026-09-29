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
  for (const p of products) {
    const ogroups = (p as any).option_groups || [];
    for (const og of ogroups) {
      if (og.id === groupId) {
        return og.name;
      }
    }
  }
  return null;
}

function collectOptionValuesByName(
  variant: VariantWithPricing,
  groupName: string,
  product: ProductWithPricing,
): string[] {
  const ovs = (variant as any).option_values;
  if (!ovs || !Array.isArray(ovs)) return [];

  const matchingGroupIds = new Set(
    ((product as any).option_groups || [])
      .filter((g: any) => g.name === groupName)
      .map((g: any) => g.id),
  );

  return ovs
    .filter((ov: any) => matchingGroupIds.has(ov.group_id))
    .map((ov: any) => ov.label || ov.value || '')
    .filter(Boolean);
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
    const groupName = getOptionGroupName(config.option_group_id, products);
    if (!groupName) return [];

    const values = new Set<string>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        collectOptionValuesByName(v as VariantWithPricing, groupName, p as ProductWithPricing).forEach((n) =>
          values.add(n),
        );
      });
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh'));
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
    return collectOptionValuesByName(variant, groupName, product).includes(value);
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
