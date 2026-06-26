import type { ProductWithPricing, VariantWithPricing } from '@/types/product';
import type { DimensionConfig, GridCellVariant } from '@/types/order-grid';

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

export function extractDimensionValues(
  config: DimensionConfig,
  products: ProductWithPricing[]
): string[] {
  if (config.type === 'custom' && config.values) {
    return config.values;
  }

  if (config.type === 'product_list') {
    return products.map((p) => p.name);
  }

  if (config.type === 'variant_field' && config.field) {
    const field = config.field;
    const values = new Set<string>();

    if (field === 'device') {
      products.forEach((p) => {
        p.variants?.forEach((v) => {
          collectDeviceNames(v as VariantWithPricing).forEach((n) => values.add(n));
        });
      });
    } else {
      products.forEach((p) => {
        p.variants?.forEach((v) => {
          const val = (v as any)[field];
          if (val && typeof val === 'string') {
            values.add(val);
          }
        });
      });
    }

    return Array.from(values);
  }

  return [];
}

export function matchVariantToDimension(
  variant: VariantWithPricing,
  config: DimensionConfig,
  value: string,
  products: ProductWithPricing[]
): boolean {
  if (config.type === 'product_list') {
    const product = products.find((p) => p.id === variant.product_id);
    return product?.name === value;
  }

  if (config.type === 'variant_field' && config.field) {
    const field = config.field;

    if (field === 'device') {
      return collectDeviceNames(variant).includes(value);
    }

    return (variant as any)[field] === value;
  }

  // custom: always match (values are user-defined)
  return true;
}

export function buildGridMatrix(
  template: {
    row_config: DimensionConfig;
    col_config: DimensionConfig;
    tab_config?: DimensionConfig | null;
  },
  products: ProductWithPricing[]
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
        matchVariantToDimension(v, template.row_config, rv, products)
      );
      const matchedCol = colValues.find((cv) =>
        matchVariantToDimension(v, template.col_config, cv, products)
      );
      const matchedTab = template.tab_config
        ? tabValues.find((tv) =>
            matchVariantToDimension(v, template.tab_config!, tv, products)
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

  const rowsWithData = rowValues.filter(rv =>
    colValues.some(cv =>
      tabValues.some(tv => cells.has(`${tv}|${rv}|${cv}`))
    )
  );
  const colsWithData = colValues.filter(cv =>
    rowValues.some(rv =>
      tabValues.some(tv => cells.has(`${tv}|${rv}|${cv}`))
    )
  );
  const tabsWithData = tabValues.filter(tv =>
    rowValues.some(rv =>
      colValues.some(cv => cells.has(`${tv}|${rv}|${cv}`))
    )
  );

  return { rowValues: rowsWithData, colValues: colsWithData, tabValues: tabsWithData, cells };
}

export function filterRowsColsForTab(
  rowValues: string[],
  colValues: string[],
  cells: Map<string, GridCellVariant[]>,
  tabValue: string
): { rowValues: string[]; colValues: string[] } {
  const rowsWithData = rowValues.filter(rv =>
    colValues.some(cv => cells.has(`${tabValue}|${rv}|${cv}`))
  );
  const colsWithData = colValues.filter(cv =>
    rowValues.some(rv => cells.has(`${tabValue}|${rv}|${cv}`))
  );
  return { rowValues: rowsWithData, colValues: colsWithData };
}

export function extractVariantFieldSummary(
  products: ProductWithPricing[]
): Record<string, string[]> {
  const fields: Record<string, Set<string>> = {
    option_1: new Set(),
    option_2: new Set(),
    option_3: new Set(),
    device: new Set(),
  };

  products.forEach((p) => {
    p.variants?.forEach((v) => {
      Object.keys(fields).forEach((field) => {
        if (field === 'device') {
          collectDeviceNames(v as VariantWithPricing).forEach((n) => fields[field].add(n));
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
