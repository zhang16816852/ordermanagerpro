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

/** accounting_entries 中與付款彙總有關的欄位（amount／paid_amount 皆為正數量級）。 */
export interface PurchasePaidEntry {
  id: string;
  amount: number | string | null;
  paid_amount: number | string | null;
}

/** accounting_entry_references 的參照列；amount_applied 保留正負號。 */
export interface PurchasePaidRef {
  entry_id: string | null;
  reference_id: string | null;
  amount_applied?: number | string | null;
}

/**
 * 把會計分錄的已付款金額分攤回各採購單。
 *
 * 分攤是必要的：分錄的 `paid_amount` 對應「整張分錄」，若該分錄參照了多張採購單，
 * 把 paid_amount 直接加給每一張會嚴重高估。分攤比例為
 * `paid_amount / amount`（部分收款時 < 1），再乘上該單據的 `amount_applied`。
 *
 * 兩條參照路徑需同時處理並去重（見 usePurchaseOrders 的說明）：
 * - `entryRows`：分錄本身的 reference_id（會計分錄清單模式會帶第一張單據）
 * - `subRefs`：accounting_entry_references 子表的每一列，各自带 amount_applied
 *
 * 子表優先：同一組 (採購單, 分錄) 同時出現在兩條路徑時，子表的 amount_applied
 * 才是該單據真正參與的金額；分錄層級的 amount 只是整張分錄的總額。
 */
export function computePurchasePaidTotals(
  entries: PurchasePaidEntry[],
  entryRows: PurchasePaidRef[],
  subRefs: PurchasePaidRef[],
): Record<string, number> {
  const entryById = new Map<string, PurchasePaidEntry>();
  entries.forEach((e) => { if (e?.id) entryById.set(e.id, e); });

  const sum: Record<string, number> = {};
  const counted = new Set<string>();

  const count = (poId: string | null, entryId: string | null, applied: number | string | null | undefined) => {
    if (!poId || !entryId) return;
    const key = `${poId}:${entryId}`;
    if (counted.has(key)) return;
    counted.add(key);

    const entry = entryById.get(entryId);
    if (!entry) return;

    const entryAmount = Math.abs(Number(entry.amount) || 0);
    if (entryAmount <= 0) return;
    const ratio = Math.min(1, (Number(entry.paid_amount) || 0) / entryAmount);
    if (ratio <= 0) return;

    // amount_applied 缺漏（舊資料或僅走分錄層參照）時退回整張分錄金額
    const base = (applied === null || applied === undefined || applied === '')
      ? entryAmount
      : Math.abs(Number(applied) || 0);
    if (base <= 0) return;

    sum[poId] = (sum[poId] || 0) + base * ratio;
  };

  subRefs.forEach((r) => count(r?.reference_id, r?.entry_id, r?.amount_applied));
  entryRows.forEach((r) => count(r?.reference_id, r?.entry_id, null));

  return sum;
}