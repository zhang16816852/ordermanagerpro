import Papa from 'papaparse';
import { toast } from 'sonner';

export type DocImportKind = 'orders' | 'sales' | 'consignment' | 'purchase';

export interface DocImportRow {
  sourceRow: number;
  [key: string]: string | number | undefined;
}

export interface ImportItemRow {
  sku?: string;
  name?: string;
  vendor_product_id?: string;
  quantity?: number;
  unit_price?: number;
  unit_cost?: number;
  serials?: string[];
  batch_number?: string;
  batch_unit_cost?: number;
}

export type ImportDateField = 'order_date' | 'expected_date' | 'shipped_date';

export interface ImportDateIssue {
  field: ImportDateField;
  raw: string;
  row: number;
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
  supplier_order_number?: string;
  purpose?: string;
  order_date?: string;
  expected_date?: string;
  shipped_date?: string;
  receive?: boolean;
  notes?: string;
  items: ImportItemRow[];
  errors: string[];
  /** 原始日期欄非空但無法辨識（軟性）：由前端提示並讓使用者手動選日期，不直接擋下匯入 */
  dateIssues: ImportDateIssue[];
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
  supplier_order_number: ['supplier_order_number', '廠商單號', '供應商單號', '廠商編號', '供應商訂單號', '採購單號'],
  order_date: ['order_date', '訂單日期', '下單日期', '採購日期', '採購單日期', '單據日期', '請購日期'],
  expected_date: ['expected_date', '預計到貨日', '預計日期', '預計交貨日', '交貨日期'],
  shipped_date: ['shipped_date', '出貨日期', '銷貨日期', '日期', 'shipped_at'],
  purpose: ['purpose', '類型', '採購類型', '用途'],
  receive: ['receive', '立即收貨', '收貨', '已收貨'],
  vendor_product_id: ['vendor_product_id', '廠商料號', '供應商料號', '廠商產品編號', '供應商商品編號'],
  serials: ['serials', 'serial', '序號', '序號清單', '序號列表'],
  batch_number: ['batch_number', '批號', '批次號', 'batch'],
  batch_unit_cost: ['batch_unit_cost', '批號成本', '批次成本'],
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

// Excel 1900 日期系統的基準：序號 1 = 1900-01-01，以 UTC 計算可免除時區偏移
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const EXCEL_SERIAL_MAX = 2958465; // 9999-12-31
const EXCEL_SERIAL_RE = /^\d{5,}(?:\.\d+)?$/; // 至少 5 位，避免把「2026」這類手打年份當序號
const PLAIN_YEAR_MIN = 1900;
const PLAIN_YEAR_MAX = 2999;

function formatYmd(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 真實日曆日檢查：擋掉 2026-13-45、2026-02-31 等，否則伺服端 ::date 會整張回退 */
function isRealYmd(year: number, month1: number, day: number): boolean {
  if (year < PLAIN_YEAR_MIN || year > PLAIN_YEAR_MAX) return false;
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return false;
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month1 - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month1 - 1 && probe.getUTCDate() === day;
}

export function normalizeDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const y = value.getFullYear();
    const mo = value.getMonth() + 1;
    const d = value.getDate();
    return isRealYmd(y, mo, d) ? formatYmd(y, mo, d) : undefined;
  }
  const s = String(value).trim();
  if (!s) return undefined;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return isRealYmd(y, mo, d) ? formatYmd(y, mo, d) : undefined;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return isRealYmd(y, mo, d) ? formatYmd(y, mo, d) : undefined;
  }
  // Excel 日期儲存格在未開 cellDates 時會讀成日期序號（如 46266 = 2026-09-01）。
  // 直接 new Date('46266') 會被解析成「46266 年」而得到 46266-01-01，故必須先轉序號。
  if (EXCEL_SERIAL_RE.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 1 || serial > EXCEL_SERIAL_MAX) return undefined;
    const d = new Date(EXCEL_EPOCH_UTC + serial * 86400000);
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  // 其餘純數字字串不做猜測：new Date 會把 '1' 當成 2001 年、'2026' 當成 2026 年
  if (/^\d+(?:\.\d+)?$/.test(s)) return undefined;
  const parsed = new Date(s);
  // 守門：new Date 的 fallback 仍可能推出離譜年份，一律視為無法辨識
  if (Number.isNaN(parsed.getTime())) return undefined;
  const y = parsed.getFullYear();
  const mo = parsed.getMonth() + 1;
  const d = parsed.getDate();
  return isRealYmd(y, mo, d) ? formatYmd(y, mo, d) : undefined;
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

const TRUE_TOKENS = new Set(['是', 'y', 'yes', 'true', '1', 'v', '有', '已收貨', '立即收貨']);
const FALSE_TOKENS = new Set(['否', 'n', 'no', 'false', '0', 'x', '未收貨', '']);

function toBooleanish(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return undefined;
}

function parseSerialsCell(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/[\n\r,;、|\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

function groupKey(kind: DocImportKind): 'order_code' | 'sales_code' | 'consignment_code' | 'supplier_order_number' {
  if (kind === 'sales') return 'sales_code';
  if (kind === 'consignment') return 'consignment_code';
  if (kind === 'purchase') return 'supplier_order_number';
  return 'order_code';
}

function validateQuantity(value: string | number | undefined, errors: string[]): number | undefined {
  if (value === undefined || toTrimmed(value) === '') {
    errors.push('缺少「數量」');
    return undefined;
  }
  return toPositiveInt(value, '數量', errors);
}

const DATE_FIELDS: ImportDateField[] = ['order_date', 'expected_date', 'shipped_date'];

/** 原始日期欄有值但無法辨識時回報；空值不算（order_date 空值由伺服端補今天） */
function collectDateIssues(row: DocImportRow): ImportDateIssue[] {
  const issues: ImportDateIssue[] = [];
  for (const field of DATE_FIELDS) {
    const raw = toTrimmed(row[field]);
    if (!raw) continue;
    if (!normalizeDate(raw)) issues.push({ field, raw, row: row.sourceRow });
  }
  return issues;
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
        supplier_order_number: kind === 'purchase' ? code : toTrimmed(row.supplier_order_number) || undefined,
        order_date: normalizeDate(row.order_date),
        expected_date: normalizeDate(row.expected_date),
        shipped_date: normalizeDate(row.shipped_date),
        purpose: toTrimmed(row.purpose) || undefined,
        receive: toBooleanish(row.receive),
        notes: toTrimmed(row.notes) || undefined,
        items: [],
        errors: [],
        dateIssues: [],
      };
      groups.push(group);
      if (code) groupByCode.set(code, group);
    }

    // 同一單號的多列各自檢查日期欄，任一列的日期無法辨識都要能提示
    group.dateIssues.push(...collectDateIssues(row));

    const itemErrors: string[] = [];
    const item: ImportItemRow = {
      sku: toTrimmed(row.sku) || undefined,
      name: toTrimmed(row.name) || undefined,
      vendor_product_id: toTrimmed(row.vendor_product_id) || undefined,
    };
    if (!item.sku && !item.name && !item.vendor_product_id) itemErrors.push('缺少「SKU」、「品名」或「廠商料號」');
    item.quantity = validateQuantity(row.quantity, itemErrors);
    item.unit_price = toNonNegativeNumber(row.unit_price);
    item.unit_cost = toNonNegativeNumber(row.unit_cost);
    const serials = parseSerialsCell(row.serials);
    if (serials.length > 0) item.serials = serials;
    item.batch_number = toTrimmed(row.batch_number) || undefined;
    item.batch_unit_cost = toNonNegativeNumber(row.batch_unit_cost);
    if (item.serials && item.quantity && item.serials.length !== item.quantity) {
      itemErrors.push(`序號 ${item.serials.length} 支與數量 ${item.quantity} 不符`);
    }
    if (kind === 'purchase' && toTrimmed(row.receive) && toBooleanish(row.receive) === undefined) {
      itemErrors.push(`「立即收貨」無法辨識（${toTrimmed(row.receive)}），請填 是／否／Y／N／true／false／1／0`);
    }
    group.items.push(item);
    group.rowCount += 1;
    if (itemErrors.length > 0) {
      group.errors.push(`第 ${row.sourceRow + 1} 列：${itemErrors.join('、')}`);
    }
  }

  const PURCHASE_STATUSES = new Set(['draft', 'ordered', 'cancelled']);
  const PURCHASE_PURPOSES = new Set(['general', 'repair_parts']);

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
    } else if (kind === 'purchase') {
      const status = (g.status || 'draft').toLowerCase();
      if (!PURCHASE_STATUSES.has(status)) {
        gErrors.push(`採購單狀態僅支援 draft／ordered／cancelled（收到「${g.status}」）`);
      }
      const purpose = (g.purpose || 'general').toLowerCase();
      if (!PURCHASE_PURPOSES.has(purpose)) {
        gErrors.push(`採購類型僅支援 general／repair_parts（收到「${g.purpose}」）`);
      }
      if (g.receive && (status === 'draft' || status === 'cancelled')) {
        gErrors.push('狀態為 draft／cancelled 時不會執行收貨，請改為 ordered');
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
    } else if (kind === 'purchase') {
      payload.supplier_order_number = g.supplier_order_number ?? undefined;
      payload.order_date = g.order_date ?? undefined;
      payload.expected_date = g.expected_date ?? undefined;
      payload.status = (g.status || 'draft').toLowerCase();
      payload.purpose = (g.purpose || 'general').toLowerCase();
      payload.receive = g.receive ?? false;
      payload.notes = g.notes ?? undefined;
      payload.items = g.items.map(item => ({
        sku: item.sku,
        name: item.name,
        vendor_product_id: item.vendor_product_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        serials: item.serials ?? [],
        batch_number: item.batch_number ?? undefined,
        batch_unit_cost: item.batch_unit_cost ?? undefined,
      }));
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
    purchase: ['廠商單號', '採購日期', '預計到貨日', '狀態', '類型', '立即收貨', '備註', 'SKU', '品名', '廠商料號', '數量', '成本', '序號', '批號', '批號成本'],
  };
  const example: Record<string, string[]> = {
    orders: ['ttshop001', 'OD26090100001', '2026-09-01', 'processing', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '2', '1200', '600'],
    sales: ['ttshop001', 'OD26090100001', 'SL2609ttshop0010001', '2026-09-02', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '1', '1200', '600'],
    consignment: ['寄出', 'ttshop001', '', 'CS2609ttshop0010001', '', '2026-09-02', 'active', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '3', '1000', '500'],
    purchase: ['PO-20260901-01', '2026-09-01', '2026-09-10', 'ordered', 'general', '是', '範例備註', 'GLA_AP-HC-IP13-MINI', '範例商品', '', '2', '600', '', '', ''],
  };
  const wideColumns: Record<DocImportKind, number[]> = {
    orders: [5, 6],
    sales: [5, 6],
    consignment: [5, 6],
    purchase: [8, 9, 12],
  };

  const doExport = async () => {
    const XLSX = await import('xlsx');
    const sheet = [headers[kind], example[kind]];
    const ws = XLSX.utils.aoa_to_sheet(sheet);
    const wide = wideColumns[kind];
    ws['!cols'] = headers[kind].map((_, idx) => ({ wch: wide.includes(idx) ? 30 : 16 }));
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
  purchase: 'import_purchase_orders_batch',
};

export const IMPORT_QUERY_KEYS: Record<DocImportKind, string[]> = {
  orders: ['admin-orders', 'consignment-source-orders'],
  sales: ['admin-sales-notes', 'admin-orders', 'inventory-list'],
  consignment: ['consignment-orders', 'consignment-source-orders', 'admin-orders', 'inventory-list'],
  purchase: ['purchase-orders', 'purchase-order', 'inventory-list', 'suppliers'],
};