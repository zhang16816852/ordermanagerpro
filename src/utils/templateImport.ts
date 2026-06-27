import * as XLSX from 'xlsx';
import type { DimensionConfig } from '@/types/order-grid';

export interface ParsedTemplate {
  uuid?: string;
  name: string;
  description: string;
  rowConfig: DimensionConfig;
  colConfig: DimensionConfig;
  tabConfig: DimensionConfig | null;
  variantIds: string[];
  isNew: boolean;
}

function parseDimConfig(row: Record<string, string>, prefix: string): DimensionConfig | null {
  const type = (row[`${prefix}類型`] || '').trim();
  if (!type) return null;
  const label = (row[`${prefix}標籤`] || '').trim();
  const field = (row[`${prefix}欄位`] || '').trim();
  const valuesStr = (row[`${prefix}值`] || '').trim();
  const values = valuesStr ? valuesStr.split(',').map(v => v.trim()).filter(Boolean) : undefined;
  return {
    type: type as DimensionConfig['type'],
    label: label || type,
    ...(field ? { field: field as DimensionConfig['field'] } : {}),
    ...(values?.length ? { values } : {}),
  };
}

export interface ParseResult {
  templates: ParsedTemplate[];
  errors: string[];
}

export function parseTemplateExcel(
  buffer: ArrayBuffer,
  existingIds: Set<string>,
): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  const errors: string[] = [];
  const groups = new Map<string, {
    uuid?: string;
    description: string;
    rowConfig: DimensionConfig;
    colConfig: DimensionConfig;
    tabConfig: DimensionConfig | null;
    variantIds: string[];
    rowNum: number;
  }>();

  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    const name = (row['範本名稱'] || '').trim();
    if (!name) {
      errors.push(`第 ${i + 2} 列：缺少「範本名稱」`);
      continue;
    }

    const rowConfig = parseDimConfig(row, 'Row維度');
    if (!rowConfig) {
      errors.push(`第 ${i + 2} 列（範本「${name}」）：缺少「Row維度類型」`);
      continue;
    }
    const colConfig = parseDimConfig(row, 'Col維度');
    if (!colConfig) {
      errors.push(`第 ${i + 2} 列（範本「${name}」）：缺少「Col維度類型」`);
      continue;
    }
    const tabConfig = parseDimConfig(row, 'Tab維度');

    const description = (row['說明'] || '').trim();
    const variantId = (row['Variant ID'] || '').trim();
    const uuid = (row['UUID'] || '').trim();

    const existing = groups.get(name);
    if (existing) {
      if (variantId) existing.variantIds.push(variantId);
    } else {
      groups.set(name, {
        uuid: uuid || undefined,
        description,
        rowConfig: rowConfig!,
        colConfig: colConfig!,
        tabConfig,
        variantIds: variantId ? [variantId] : [],
        rowNum: i + 2,
      });
    }
  }

  const templates: ParsedTemplate[] = [];
  for (const [name, group] of groups) {
    const isNew = group.uuid ? !existingIds.has(group.uuid) : true;
    templates.push({
      uuid: group.uuid,
      name,
      description: group.description,
      rowConfig: group.rowConfig,
      colConfig: group.colConfig,
      tabConfig: group.tabConfig,
      variantIds: [...new Set(group.variantIds)],
      isNew,
    });
  }

  return { templates, errors };
}
