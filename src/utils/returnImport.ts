import { toast } from 'sonner';
import {
  DocImportRow,
  ImportGroup,
  ImportItemRow,
  normalizeDate,
  toNonNegativeNumber,
  toPositiveInt,
} from '@/utils/docImport';

/**
 * 採購退貨匯入群組。
 *
 * 刻意 extends ImportGroup，讓 PurchaseDocImportDialog 既有的預覽表格、
 * 品項就地編輯、逐列錯誤與日期欄位邏輯完全沿用（僅退貨專屬欄位額外擴充）。
 */
export interface ReturnImportGroup extends ImportGroup {
  supplier_return_number?: string;
  /** 使用者於檔案填寫的原採購單（單號或 UUID）；由對話框解析成 id 後填入 source_purchase_order_id */
  source_purchase_order_ref?: string;
  /** 解析後的原採購單 id；無法解析時保持 undefined 並記錄於 errors */
  source_purchase_order_id?: string;
  /**
   * 退貨入庫倉庫，僅接受 UUID。
   * 留空或填入倉庫代碼（如 `own`）時視為未指定，由伺服端 fallback 到 warehouses.code='own'。
   */
  warehouse_id?: string;
  /**
   * 無來源採購單且檔案未提供成本。
   * 伺服端成本優先序為「檔案 unit_cost → 供應商對照成本 → 原 PO 品項單價 → 0」，
   * 前端無法得知對照表／原 PO 成本，故此情況保守標示：
   * 可能算成 0 元退貨額，且不產生沖帳分錄。
   */
  missingCostWithoutSource: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trim(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function isUuidLike(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function collectDateIssues(row: DocImportRow): ReturnImportGroup['dateIssues'] {
  const raw = trim(row.order_date);
  if (!raw || normalizeDate(raw)) return [];
  return [{ field: 'order_date', raw, row: row.sourceRow }];
}

/** 依「退貨單號」分組；退貨單號為空者各自成單 */
export function rowsToReturnGroups(rows: DocImportRow[]): ReturnImportGroup[] {
  const groups: ReturnImportGroup[] = [];
  const byNumber = new Map<string, ReturnImportGroup>();

  for (const row of rows) {
    const rawNumber = trim(row.supplier_return_number);
    const key = rawNumber || `#${groups.length}`;

    let group = byNumber.get(key);
    if (!group) {
      const created: ReturnImportGroup = {
        index: groups.length,
        sourceRow: row.sourceRow,
        rowCount: 0,
        supplier_return_number: rawNumber || undefined,
        // 沿用 supplier_order_number 讓既有的「廠商單號重複」提示與顯示欄位一致
        supplier_order_number: rawNumber || undefined,
        source_purchase_order_ref: trim(row.source_purchase_order_ref) || undefined,
        order_date: normalizeDate(row.order_date),
        notes: trim(row.notes) || undefined,
        warehouse_id: trim(row.warehouse_id) || undefined,
        items: [],
        errors: [],
        dateIssues: [],
        missingCostWithoutSource: false,
      };
      group = created;
      groups.push(created);
      byNumber.set(key, created);
    }
    const current = group;

    current.dateIssues.push(...collectDateIssues(row));

    const itemErrors: string[] = [];
    const item: ImportItemRow = {
      sku: trim(row.sku) || undefined,
      name: trim(row.name) || undefined,
      vendor_product_id: trim(row.vendor_product_id) || undefined,
    };
    if (!item.sku && !item.name && !item.vendor_product_id) {
      itemErrors.push('缺少「SKU」、「品名」或「廠商料號」');
    }
    // 數量填「正數」，伺服端會自動轉為負數的退貨品項
    if (row.quantity === undefined || trim(row.quantity) === '') {
      itemErrors.push('缺少「數量」');
    } else {
      item.quantity = toPositiveInt(row.quantity, '數量', itemErrors);
    }
    item.unit_cost = toNonNegativeNumber(row.unit_cost);

    current.items.push(item);
    current.rowCount += 1;
    if (itemErrors.length > 0) {
      current.errors.push(`第 ${row.sourceRow + 1} 列：${itemErrors.join('、')}`);
    }
  }

  for (const g of groups) {
    if (g.items.length === 0) g.errors.push('沒有品項');
    const noSource = !g.source_purchase_order_ref;
    g.missingCostWithoutSource = noSource
      && g.items.every(i => i.unit_cost === undefined || i.unit_cost === 0);
  }

  return groups;
}

/**
 * 倉庫只接受 UUID；檔案若填倉庫代碼（如 `own`）或空白，一律視為未指定，
 * 由伺服端 fallback 到自有倉庫（避免把非 UUID 當 uuid 轉型而整批失敗）。
 */
function normalizeWarehouseId(raw: string | undefined): string | undefined {
  const v = trim(raw);
  return v && isUuidLike(v) ? v : undefined;
}

/**
 * 組出 import_purchase_returns_batch 的 p_groups。
 *
 * ⚠️ 金額一律由伺服端推算（數量 × 成本，成本優先序為
 * 「檔案 unit_cost → 供應商對照成本 → 原 PO 品項單價 → 0」），payload 不接受也不傳金額。
 *
 * @param fallbackWarehouseId 檔案未指定倉庫時使用的預設倉庫（對話框上方的選擇器）
 */
export function returnGroupPayload(
  groups: ReturnImportGroup[],
  fallbackWarehouseId?: string,
): Record<string, unknown>[] {
  return groups.map((g) => ({
    supplier_return_number: g.supplier_return_number ?? undefined,
    source_purchase_order_id: g.source_purchase_order_id ?? undefined,
    order_date: g.order_date ?? undefined,
    notes: g.notes ?? undefined,
    warehouse_id: normalizeWarehouseId(g.warehouse_id) ?? normalizeWarehouseId(fallbackWarehouseId),
    items: g.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      vendor_product_id: i.vendor_product_id,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    })),
  }));
}

const RETURN_HEADERS = [
  '退貨單號', '原採購單', '採購日期', '倉庫', '備註', 'SKU', '品名', '廠商料號', '數量', '成本',
];
const RETURN_EXAMPLE = [
  'RT-20260901-01', 'PO-20260901-01', '2026-09-01', '', '範例備註',
  'GLA_AP-HC-IP13-MINI', '範例商品', '', '2', '600',
];

export function downloadReturnTemplate(): void {
  const doExport = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([RETURN_HEADERS, RETURN_EXAMPLE]);
    ws['!cols'] = RETURN_HEADERS.map((_, idx) => ({ wch: idx === 4 || idx === 8 ? 30 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '退貨匯入範本');
    XLSX.writeFile(wb, `退貨匯入範本_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('範本已下載');
  };
  void doExport();
}

export const RETURN_RPC_NAME = 'import_purchase_returns_batch';

export const RETURN_QUERY_KEYS: string[] = [
  'purchase-orders', 'purchase-order-items', 'inventory-list', 'accounts',
  'accounting-entries', 'accounting-categories',
];

/** RPC 回傳（已對照 20261004000002 migration 的 jsonb_build_object 逐欄核對） */
export interface ReturnImportResult {
  ok?: boolean;
  /** 守門失敗（權限／參數／倉庫／會計科目缺漏）時由 RPC 回傳 */
  reason?: string;
  total: number;
  success: number;
  /** 沖帳金額（正數）；各張的 total_amount 為負數 */
  total_credit: number;
  results: {
    index: number;
    status: 'created' | 'skipped';
    /** status='created' 時才有 */
    purchase_order_id?: string;
    /** 略過原因（status='skipped'） */
    reason?: string;
    supplier_return_number: string;
    source_purchase_order_id: string | null;
    /** 負數（退貨金額） */
    total_amount: number;
    created_items?: {
      product_id: string;
      variant_id: string | null;
      name: string;
      quantity: number;
      unit_cost: number;
    }[];
  }[];
  errors: { index: number; supplier_return_number: string; reason: string }[];
}