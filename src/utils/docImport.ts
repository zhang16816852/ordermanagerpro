import Papa from 'papaparse';
import { toast } from 'sonner';

export type DocImportKind = 'orders' | 'sales' | 'consignment';

export interface DocImportRow {
  sourceRow: number;
  [key: string]: string | number | undefined;
}

export interface ImportItemRow {
  sku?: string;
  name?: string;
  quantity?: number;
  unit_price?: number;
  unit_cost?: number;
}

export interface ImportGroup {
  index: number;
  sourceRow: number;
  rowCount: number;
  store_code?: string;
  supplier_code?: string;
  direction?: string;
  status?: string;
  order_code?: string;
  sales_code?: string;
  consignment_code?: string;
  order_date?: string;
  shipped_date?: string;
  notes?: string;
  items: ImportItemRow[];
  errors: string[];
}

export interface ImportParseResult {
  rows: DocImportRow[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  store_code: ['store_code', 'store', '店家代碼', '店家', '店鋪', '店', '門市'],
  supplier_code: ['supplier_code', 'supplier', '供應商', '供應商名稱', '廠商', '廠商名稱'],
  direction: ['direction', '方向', '寄賣方向'],
  status: ['status', '狀態'],
  notes: ['notes', '備註', 'note', '備註說明'],
  order_code: ['order_code', '訂單編號', '訂單號', '單號'],
  sales_code: ['sales_code', '銷貨編號', '銷貨單號', '銷貨單編號', '銷售單號'],
  consignment_code: ['consignment_code', '寄賣編號', '寄賣單號', '寄賣單編號'],
  order_date: ['order_date', '訂單日期', '下單日期'],
  shipped_date: ['shipped_date', '出貨日期', '銷貨日期', '日期', 'shipped_at'],
  sku: ['sku', '商品編號', '產品編號', '料號', '編號'],
  name: ['name', '品名', '商品名稱', '產品名稱', '名稱'],
  quantity: ['quantity', 'qty', '數量', '件數'],
  unit_price: ['unit_price', '單價', '售價', '價錢', '單價（元）'],
  unit_cost: ['unit_cost', '成本', '進貨價', '成本價', '成本（元）'],
};

const HEADER_KEYS = Object.keys(HEADER_ALIASES);

function normalizeHeader(raw: string): string | null {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return null;
  for (const field of HEADER_KEYS) {
    if (HEADER_ALIASES[field].some(a => a.toLowerCase() === key)) return field;
  }
  return null;
}

function toTrimmed(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function normalizeDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    const [_, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const [_, y, mo, d] = m;
    return `${y}-${mo}-${d}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return undefined;
}

export function toPositiveInt(value: unknown, label: string, errors: string[]): number | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isInteger(n) && n > 0) return n;
  errors.push(`${label} 必須為正整數（收到「${s}」）`);
  return undefined;
}

export function toNonNegativeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export async function parseImportExcel(buffer: ArrayBuffer): Promise<ParseSheetResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  const sheetName = sheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
  return parseSheetRows(rows, sheetName);
}

interface ParseSheetResult {
  rows: DocImportRow[];
  errors: string[];
}

function parseSheetRows(rawRows: unknown[][], sheetName: string): ParseSheetResult {
  const rows: DocImportRow[] = [];
  const errors: string[] = [];

  if (rawRows.length === 0) {
    errors.push('檔案沒有任何資料列');
    return { rows, errors };
  }

  const headerRow = rawRows.findIndex((row, idx) =>
    Array.isArray(row) && row.some((cell, cellIdx) => {
      const normalized = normalizeHeader(toTrimmed(cell));
      return normalized === 'store_code' || normalized === 'sku' || normalized === 'name';
    })
  );

  const headerIndex = headerRow >= 0 ? headerRow : 0;
  const header = (rawRows[headerIndex] || []).map(h => normalizeHeader(toTrimmed(h)));
  const hasHeader = header.some(Boolean);

  if (!hasHeader && rows.length > 0) {
    errors.push('找不到表頭列（需含「店家代碼」「SKU」或「品名」欄位）');
    return { rows, errors };
  }

  const recognized = header.filter(Boolean).length;
  if (recognized === 0) {
    errors.push('表頭沒有可辨識的欄位（店家代碼／訂單編號／SKU／數量等）');
    return { rows, errors };
  }

  for (let i = headerIndex + 1; i < rawRows.length; i++) {
    const raw = rawRows[i];
    if (!Array.isArray(raw)) continue;
    const row: DocImportRow = { sourceRow: i };
    let hasValue = false;
    header.forEach((field, colIdx) => {
      if (!field) return;
      const cell = raw[colIdx];
      if (cell === null || cell === undefined || toTrimmed(cell) === '') return;
      hasValue = true;
      row[field] = toTrimmed(cell);
    });
    if (hasValue) rows.push(row);
  }

  if (rows.length === 0) {
    errors.push(`工作表「${sheetName}」沒有資料列（表頭後無任何內容）`);
  }
  return { rows, errors };
}

export async function parseImportText(text: string, sourceLabel: string): Promise<ImportParseResult> {
  const errors: string[] = [];
  if (!text.trim()) {
    errors.push('內容是空的');
    return { rows: [], errors };
  }

  const result = Papa.parse<unknown[]>(text, {
    skipEmptyLines: 'greedy',
    transformHeader: undefined as never,
  });

  const rawRows = (result.data || []) as unknown[][];
  const { rows, errors: sheetErrors } = parseSheetRows(rawRows, sourceLabel);
  return { rows, errors: [...errors, ...sheetErrors] };
}

function groupKey(kind: DocImportKind): 'order_code' | 'sales_code' | 'consignment_code' {
  if (kind === 'sales') return 'sales_code';
  if (kind === 'consignment') return 'consignment_code';
  return 'order_code';
}

function validateQuantity(value: string | number | undefined, errors: string[]): number | undefined {
  if (value === undefined || toTrimmed(value) === '') {
    errors.push('缺少「數量」');
    return undefined;
  }
  return toPositiveInt(value, '數量', errors);
}

export function rowsToImportGroups(kind: DocImportKind, rows: DocImportRow[]): ImportGroup[] {
  const groups: ImportGroup[] = [];
  const codeField = groupKey(kind);
  const groupByCode = new Map<string, ImportGroup>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawCode = toTrimmed(row[codeField]);
    const code = rawCode || undefined;

    let group: ImportGroup;
    if (code && groupByCode.has(code)) {
      group = groupByCode.get(code)!;
    } else {
      group = {
        index: groups.length,
        sourceRow: row.sourceRow,
        rowCount: 0,
        store_code: toTrimmed(row.store_code) || undefined,
        supplier_code: toTrimmed(row.supplier_code) || undefined,
        direction: toTrimmed(row.direction) || undefined,
        status: toTrimmed(row.status) || undefined,
        order_code: kind === 'orders' ? code : toTrimmed(row.order_code) || undefined,
        sales_code: kind === 'sales' ? code : undefined,
        consignment_code: kind === 'consignment' ? code : undefined,
        order_date: normalizeDate(row.order_date),
        shipped_date: normalizeDate(row.shipped_date),
        notes: toTrimmed(row.notes) || undefined,
        items: [],
        errors: [],
      };
      groups.push(group);
      if (code) groupByCode.set(code, group);
    }

    const itemErrors: string[] = [];
    const item: ImportItemRow = {
      sku: toTrimmed(row.sku) || undefined,
      name: toTrimmed(row.name) || undefined,
    };
    if (!item.sku && !item.name) itemErrors.push('缺少「SKU」或「品名」');
    item.quantity = validateQuantity(row.quantity, itemErrors);
    item.unit_price = toNonNegativeNumber(row.unit_price);
    item.unit_cost = toNonNegativeNumber(row.unit_cost);
    group.items.push(item);
    group.rowCount += 1;
    if (itemErrors.length > 0) {
      group.errors.push(`第 ${row.sourceRow + 1} 列：${itemErrors.join('、')}`);
    }
  }

  for (const g of groups) {
    const gErrors: string[] = [];
    if (kind === 'consignment') {
      const direction = (g.direction || 'send_to_store').toLowerCase();
      const isReceive = direction === 'receive_from_supplier' || direction === '進貨' || direction === '廠商進貨' || direction === '廠商方向';
      if (isReceive) {
        if (!g.supplier_code) gErrors.push('廠商進貨方向缺少「供應商」欄位');
      } else {
        if (!g.store_code) gErrors.push('缺少「店家代碼」欄位');
      }
    } else {
      if (!g.store_code) gErrors.push('缺少「店家代碼」欄位');
    }
    if (g.items.length === 0) gErrors.push('沒有品項');
    if (gErrors.length > 0) g.errors = [...gErrors, ...g.errors];
  }

  return groups;
}

export function importGroupPayload(kind: DocImportKind, groups: ImportGroup[]): Record<string, unknown>[] {
  return groups.map(g => {
    const payload: Record<string, unknown> = {
      store_code: g.store_code ?? undefined,
      items: g.items.map(item => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
      })),
    };
    if (kind === 'orders') {
      payload.order_code = g.order_code ?? undefined;
      payload.order_date = g.order_date ?? undefined;
      payload.status = g.status ?? undefined;
      payload.notes = g.notes ?? undefined;
    } else if (kind === 'sales') {
      payload.order_code = g.order_code ?? undefined;
      payload.sales_code = g.sales_code ?? undefined;
      payload.shipped_date = g.shipped_date ?? undefined;
      payload.notes = g.notes ?? undefined;
    } else {
      payload.direction = g.direction ?? undefined;
      payload.supplier_code = g.supplier_code ?? undefined;
      payload.consignment_code = g.consignment_code ?? undefined;
      payload.order_code = g.order_code ?? undefined;
      payload.shipped_date = g.shipped_date ?? undefined;
      payload.status = g.status ?? undefined;
      payload.notes = g.notes ?? undefined;
    }
    return payload;
  });
}

export function downloadImportTemplate(kind: DocImportKind): void {
  const headers: Record<string, string[]> = {
    orders: ['店家代碼', '訂單編號', '訂單日期', '狀態', '備註', 'SKU', '品名', '數量', '單價', '成本'],
    sales: ['店家代碼', '訂單編號', '銷貨單編號', '出貨日期', '備註', 'SKU', '品名', '數量', '單價', '成本'],
    consignment: ['方向', '店家代碼', '供應商', '寄賣單編號', '訂單編號', '出貨日期', '狀態', '備註', 'SKU', '品名', '數量', '單價', '成本'],
  };
  const example: Record<string, string[]> = {
    orders: ['ttshop001', 'OD26090100001', '2026-09-01', 'processing', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '2', '1200', '600'],
    sales: ['ttshop001', 'OD26090100001', 'SL2609ttshop0010001', '2026-09-02', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '1', '1200', '600'],
    consignment: ['寄出', 'ttshop001', '', 'CS2609ttshop0010001', '', '2026-09-02', 'active', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '3', '1000', '500'],
  };

  const doExport = async () => {
    const XLSX = await import('xlsx');
    const sheet = [headers[kind], example[kind]];
    const ws = XLSX.utils.aoa_to_sheet(sheet);
    ws['!cols'] = headers[kind].map((_, idx) => ({ wch: idx === 5 || idx === 6 ? 30 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '匯入範本');
    XLSX.writeFile(wb, `匯入範本_${kind}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('範本已下載');
  };
  void doExport();
}

export const IMPORT_RPC_NAMES: Record<DocImportKind, string> = {
  orders: 'import_orders_batch',
  sales: 'import_sales_notes_batch',
  consignment: 'import_consignment_batch',
};

export const IMPORT_QUERY_KEYS: Record<DocImportKind, string[]> = {
  orders: ['admin-orders', 'consignment-source-orders'],
  sales: ['admin-sales-notes', 'admin-orders', 'inventory-list'],
  consignment: ['consignment-orders', 'consignment-source-orders', 'admin-orders', 'inventory-list'],
};