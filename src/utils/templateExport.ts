import type { OrderGridTemplateWithProducts, DimensionConfig } from '@/types/order-grid';
import type { ProductWithPricing } from '@/types/product';

export interface VariantLookup {
  sku: string;
  name: string;
  productName: string;
  productId: string;
}

function collectOptionGroupValues(
  groupId: string | undefined,
  products: ProductWithPricing[],
  variantIds: Set<string> | null,
): string[] {
  if (!groupId) return [];
  const values = new Set<string>();
  products.forEach((p) => {
    const ogroups = (p as any).option_groups || [];
    const groupIds = new Set(
      ogroups.filter((g: any) => g.id === groupId).map((g: any) => g.id),
    );
    if (groupIds.size === 0) return;
    p.variants?.forEach((v: any) => {
      if (variantIds && !variantIds.has(v.id)) return;
      (v.option_values || []).forEach((ov: any) => {
        if (groupIds.has(ov.group_id) && (ov.label || ov.value)) {
          values.add(ov.label || ov.value);
        }
      });
    });
  });
  return Array.from(values);
}

function dimConfigToCols(
  config: DimensionConfig,
  prefix: string,
  products: ProductWithPricing[],
  variantIds: Set<string> | null,
): Record<string, string> {
  let values = config.values || [];
  if (config.type === 'option') {
    const collected = collectOptionGroupValues(config.option_group_id, products, variantIds);
    if (collected.length > 0) values = collected;
  }
  return {
    [`${prefix}類型`]: config.type,
    [`${prefix}欄位`]: config.field || '',
    [`${prefix}標籤`]: config.label,
    [`${prefix}值`]: values.join(','),
    [`${prefix}SpecID`]: config.spec_id || '',
    [`${prefix}OptionGroupID`]: config.option_group_id || '',
    [`${prefix}ValueMap`]: config.valueMap ? JSON.stringify(config.valueMap) : '',
  };
}

export async function exportTemplatesToExcel(
  templates: OrderGridTemplateWithProducts[],
  variantLookup: Map<string, VariantLookup>,
  products: ProductWithPricing[] = [],
): Promise<void> {
  const XLSX = await import('xlsx');
  const rows: Record<string, string>[] = [];

  for (const t of templates) {
    const variants = t.template_variants || [];
    const variantIds = new Set<string>(variants.map((tv) => tv.variant_id));
    const rc = dimConfigToCols(t.row_config, 'Row維度', products, variantIds);
    const cc = dimConfigToCols(t.col_config, 'Col維度', products, variantIds);
    const tc = t.tab_config ? dimConfigToCols(t.tab_config, 'Tab維度', products, variantIds) : {
      'Tab維度類型': '', 'Tab維度欄位': '', 'Tab維度標籤': '', 'Tab維度值': '',
      'Tab維度SpecID': '', 'Tab維度OptionGroupID': '', 'Tab維度ValueMap': '',
    };

    if (variants.length === 0) {
      rows.push({
        'UUID': t.id,
        '範本名稱': t.name,
        '說明': t.description || '',
        ...rc, ...cc, ...tc,
        'Variant ID': '',
        '變體 SKU': '',
        '變體名稱': '',
        '產品名稱': '',
        '產品 ID': '',
      });
    } else {
      for (const tv of variants) {
        const lookup = variantLookup.get(tv.variant_id);
        rows.push({
          'UUID': t.id,
          '範本名稱': t.name,
          '說明': t.description || '',
          ...rc, ...cc, ...tc,
          'Variant ID': tv.variant_id,
          '變體 SKU': lookup?.sku ?? '',
          '變體名稱': lookup?.name ?? '',
          '產品名稱': lookup?.productName ?? '',
          '產品 ID': lookup?.productId ?? '',
        });
      }
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 36, hidden: true },
    { wch: 20 }, { wch: 30 },
    { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 30 },
    { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 30 },
    { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 30 },
    { wch: 36 }, { wch: 16 }, { wch: 20 }, { wch: 24 }, { wch: 36 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '範本明細');

  const dateStr = new Date().toISOString().slice(0, 10);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `表格範本匯出_${dateStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
