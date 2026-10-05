export interface PoPaymentSummary {
  /** 應付金額；採購退貨為負數單據，取絕對值後即為待沖帳金額 */
  payable: number;
  /** 已付／已沖帳金額，上限為 payable（避免超付產生負數） */
  paid: number;
  /** 未付／待沖帳金額，永不為負 */
  unpaid: number;
  /** 是否為採購退貨（負數單據） */
  isCredit: boolean;
}

/**
 * 計算單張採購單的付款狀態。
 *
 * `purchase_orders` 沒有 payment_status／paid_amount 欄位，已付金額完全來自
 * 會計模組（`accounting_entries` 與 `accounting_entry_references` 兩條參照路徑），
 * 因此這裡只負責把「訂單金額 + 已付金額」收斂成顯示用的三個數字。
 *
 * 採購退貨單的 `total_amount` 為負數（沖回成本），此時以絕對值處理，
 * 讓「已付／已沖帳」與「未付／待沖帳」維持同一語意。
 */
export function poPaymentSummary(
  totalAmount: number | string | null | undefined,
  paidAmount: number | string | null | undefined,
): PoPaymentSummary {
  const raw = Number(totalAmount) || 0;
  const payable = Math.abs(raw);
  const paid = Math.min(Math.max(Number(paidAmount) || 0, 0), payable);
  return { payable, paid, unpaid: payable - paid, isCredit: raw < 0 };
}