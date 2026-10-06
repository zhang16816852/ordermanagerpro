import { poPaymentSummary } from './paymentSummary';
import type { PurchaseOrder } from './types';

/**
 * 採購單「批次操作」的純邏輯層（批次下單／批次收貨／合併付款）。
 *
 * 刻意零 React、零 supabase 依賴，可直接用
 * `node --experimental-strip-types` import 做純邏輯驗證
 * （同 importMatchPreview.ts 的作法）。
 */

// ---------------------------------------------------------------------------
// 批次收貨資格
// ---------------------------------------------------------------------------

/**
 * 批次收貨可接受的採購單狀態。
 *
 * ⚠️ `receive_purchase_items` 沒有任何狀態守門，且會依實際品項進度**重算** status，
 * 因此前端必須自行排除 `cancelled`，否則一張已取消單會被批次收貨「復活」成
 * ordered／partial_received／received。
 */
export const PO_BATCH_RECEIVABLE_STATUSES = ['draft', 'ordered', 'partial_received'] as const;
export type PoBatchReceivableStatus = (typeof PO_BATCH_RECEIVABLE_STATUSES)[number];

export const isBatchReceivableStatus = (status: string): status is PoBatchReceivableStatus =>
  (PO_BATCH_RECEIVABLE_STATUSES as readonly string[]).includes(status);

/**
 * 採購退貨單（purpose='purchase_return'）不走收貨：退貨在匯入時已直接回沖庫存，
 * 其數量為負，批次「全量收貨」語意不適用。
 */
export const isBatchReceivable = (order: Pick<PurchaseOrder, 'status' | 'purpose'>): boolean =>
  order.purpose !== 'purchase_return' && isBatchReceivableStatus(order.status);

/** 批次下單（draft → ordered）：僅草稿單 */
export const isBatchOrderable = (order: Pick<PurchaseOrder, 'status'>): boolean =>
  order.status === 'draft';

// ---------------------------------------------------------------------------
// 採購單層級的排除原因（供預覽與結果摘要使用）
// ---------------------------------------------------------------------------

export type PoOrderSkipReason = 'cancelled' | 'received' | 'purchase_return';

export const PO_ORDER_SKIP_LABELS: Record<PoOrderSkipReason, string> = {
  cancelled: '已取消',
  received: '已收貨完畢',
  purchase_return: '屬採購退貨單（數量為負、匯入時已回沖庫存）',
};

/**
 * 判定整張採購單為何不可批次收貨；null 代表可收貨。
 *
 * 與 `isBatchReceivable` 同定義但**回傳原因**，讓 UI 能顯示
 * 「為什麼這張被排除」而非只給一個總數。
 */
export function poOrderSkipReason(
  order: { status: string; purpose?: string | null },
): PoOrderSkipReason | null {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'received') return 'received';
  if (order.purpose === 'purchase_return') return 'purchase_return';
  if (!isBatchReceivableStatus(order.status)) return 'cancelled';
  return null;
}

// ---------------------------------------------------------------------------
// 品項可否納入「全量收貨」
// ---------------------------------------------------------------------------

export type PoReceiveSkipReason =
  | 'already_received'
  | 'partial_received'
  | 'tracked_serial'
  | 'tracked_batch'
  | 'zero_quantity';

export const PO_RECEIVE_SKIP_LABELS: Record<PoReceiveSkipReason, string> = {
  already_received: '已收貨完畢',
  partial_received: '已部分收貨（重收會重複入帳）',
  tracked_serial: '需逐台輸入序號，請於單張收貨作業',
  tracked_batch: '需輸入批號，請於單張收貨作業',
  zero_quantity: '數量為 0',
};

/** 收貨計畫只需這些欄位，故不綁 purchase_order_items 整列 */
export interface PoReceivePlanInput {
  quantity: number;
  received_quantity: number;
  tracking_mode?: string | null;
}

/**
 * 判定單一品項能否安全納入批次全量收貨。
 *
 * ⚠️ `receive_purchase_items` 的語意是「**絕對值**寫回 received_quantity，
 * 且 `inventory_movements.quantity_change` 用的也是同一個絕對值」，不是累加量。
 * 因此：
 *   - 已收過的品項重送會讓庫存**重複入帳**（欄位看似正確，帳上卻多一筆），
 *     故 received_quantity > 0 一律排除（含部分收貨：傳剩餘量會把欄位寫成剩餘量）。
 *   - 需序號／批號的品項必須走單張收貨（p_lots），批次路徑不帶 p_lots，
 *     硬送會讓整批 RAISE 回滾。
 */
export function poReceiveSkipReason(
  item: PoReceivePlanInput,
): PoReceiveSkipReason | null {
  const received = item.received_quantity ?? 0;
  const quantity = item.quantity ?? 0;
  if (received > 0) {
    return received >= quantity ? 'already_received' : 'partial_received';
  }
  const mode = item.tracking_mode ?? 'none';
  if (mode === 'serial') return 'tracked_serial';
  if (mode === 'batch') return 'tracked_batch';
  if (quantity <= 0) return 'zero_quantity';
  return null;
}

export interface PoReceivePlanRow extends PoReceivePlanInput {
  itemId: string;
  purchaseOrderId: string;
  productId: string | null;
  variantId: string | null;
  /** 可安全納入批次全量收貨 */
  receivable: boolean;
  skipReason: PoReceiveSkipReason | null;
}

export function poReceivePlanRow(
  row: PoReceivePlanInput & {
    itemId: string;
    purchaseOrderId: string;
    productId: string | null;
    variantId: string | null;
  },
): PoReceivePlanRow {
  const skipReason = poReceiveSkipReason(row);
  return { ...row, receivable: skipReason === null, skipReason };
}

// ---------------------------------------------------------------------------
// 同供應商合併付款
// ---------------------------------------------------------------------------

export interface PoPaymentDocLine {
  orderId: string;
  supplierOrderNumber: string | null;
  /** 採購單總額（保留正負號：退貨單為負） */
  totalAmount: number;
  /** 尚未付款／沖帳的金額（絕對值） */
  unpaid: number;
  /** 是否為待沖帳的採購退貨單 */
  isCredit: boolean;
  /**
   * 會計分錄的 `amount_applied`：支出為負、沖帳收入為正。
   *
   * 與 `useEntryFormController.addDocItem` 的 `-(item.amount)` 同一規則，
   * 但這裡帶入的是**未付餘額**而非整張單額，故部分付款的單不會被重複沖帳。
   */
  amountApplied: number;
}

/** 單張付款對帳列；已付清回 null（不列入合併收款） */
export function poPaymentDocLine(
  order: Pick<PurchaseOrder, 'id' | 'supplier_order_number' | 'total_amount'>,
  paidAmount: number | undefined,
): PoPaymentDocLine | null {
  const s = poPaymentSummary(order.total_amount, paidAmount);
  if (s.unpaid <= 0) return null;
  const sign = s.isCredit ? -1 : 1;
  return {
    orderId: order.id,
    supplierOrderNumber: order.supplier_order_number,
    totalAmount: order.total_amount,
    unpaid: s.unpaid,
    isCredit: s.isCredit,
    amountApplied: -sign * s.unpaid,
  };
}

export interface PoBatchPaymentPlan {
  lines: PoPaymentDocLine[];
  /** 合計 amountApplied：<0 淨支出、>0 淨收入（退貨為主）、0 雙向抵銷 */
  netApplied: number;
  /** 待付款（支出）金額合計 */
  payable: number;
  /** 待沖帳（退貨收入）金額合計 */
  credit: number;
  supplierId: string | null;
  supplierName: string;
  /** 選取中與主供應商不同的其他供應商名稱；非空即不可合併成一筆分錄 */
  otherSuppliers: string[];
}

const supplierNameOf = (order: Pick<PurchaseOrder, 'supplier_id' | 'supplier'>) =>
  order.supplier?.name || '未知供應商';

/**
 * 合併付款計畫。
 *
 * 一筆會計分錄的 `counterparty_name` 只能對應一個對象，故混入不同供應商時
 * 必須阻擋（otherSuppliers 非空），不可靜默合併成錯誤名稱的單一支出。
 */
export function poBatchPaymentPlan(
  orders: PurchaseOrder[],
  paidAmountMap: Record<string, number> = {},
): PoBatchPaymentPlan {
  const selected = orders.filter(Boolean);
  const lines = selected
    .map((o) => poPaymentDocLine(o, paidAmountMap[o.id]))
    .filter((l): l is PoPaymentDocLine => l !== null);

  let payable = 0;
  let credit = 0;
  let netApplied = 0;
  for (const l of lines) {
    if (l.amountApplied < 0) payable += -l.amountApplied;
    else credit += l.amountApplied;
    netApplied += l.amountApplied;
  }

  const base = selected[0];
  const supplierId = base?.supplier_id ?? null;
  const supplierName = base ? supplierNameOf(base) : '';
  const otherSuppliers: string[] = [];
  if (base) {
    for (const o of selected) {
      if (o.supplier_id === supplierId) continue;
      const name = supplierNameOf(o);
      if (!otherSuppliers.includes(name)) otherSuppliers.push(name);
    }
  }

  return { lines, netApplied, payable, credit, supplierId, supplierName, otherSuppliers };
}

/** 可否送出合併收款：至少一張可付、且全部同供應商 */
export const canSubmitBatchPayment = (plan: PoBatchPaymentPlan): boolean =>
  plan.lines.length > 0 && plan.otherSuppliers.length === 0;