import type { PurchaseOrder } from './types';

/**
 * 採購單列表的排列（排序）邏輯單一真值。
 *
 * 排序狀態刻意放在網址（sort / dir），與本頁既有的 supplier/purpose/status/from/to
 * 篩選參數同一套慣例：重新整理、分享連結都會保留排列結果。
 * 排序是純顯示層行為，刻意不併入 PurchaseOrderFilters —— 該型別同時是
 * usePurchaseOrders 的 queryKey 與 PostgREST 條件，放進去會讓切換排序時重新打 DB。
 */

/**
 * 可排序欄位。
 *
 * - id / supplier / purpose / supplier_order_number / order_date / total_amount / status
 *   皆有對應表格欄位，可用表頭點擊排序。
 * - created_at 為「建立時間」，**表格沒有這一欄**（純為還原預設排列與提供下拉選項），
 *   故不可出現在 SortableHead，只能從手機版排序下拉選擇。
 */
export type PoSortField =
  | 'id'
  | 'supplier'
  | 'purpose'
  | 'supplier_order_number'
  | 'order_date'
  | 'created_at'
  | 'total_amount'
  | 'status';

export type PoSortDir = 'asc' | 'desc';

const PO_SORT_FIELDS: readonly PoSortField[] = [
  'id',
  'supplier',
  'purpose',
  'supplier_order_number',
  'order_date',
  'created_at',
  'total_amount',
  'status',
];

/**
 * 預設排列：建立時間由新到舊。
 *
 * ⚠️ 刻意與 usePurchaseOrders 的 server 端排序（`.order('created_at', { ascending: false })`）
 * 保持一致，讓「沒做任何排序」時的畫面與舊行為完全相同（見 line 80）。
 * 網址未帶 sort/dir 時即回退至此預設，所以預設狀態不需要在網址留下任何參數。
 */
export const PO_DEFAULT_SORT_FIELD: PoSortField = 'created_at';
export const PO_DEFAULT_SORT_DIR: PoSortDir = 'desc';

/**
 * 點選新欄位時的預設方向：時間／數值類用大的在前（新的在前），文字類用字典序。
 * 與「同一欄再點一次就翻轉」不同，這裡決定的是「換欄位」時的方向。
 */
export function defaultPoSortDir(field: PoSortField): PoSortDir {
  return field === 'order_date' || field === 'created_at' || field === 'total_amount'
    ? 'desc'
    : 'asc';
}

/** 手機版排序下拉的選項（表頭在 <md 隱藏，需另一個入口）；順序即預設排列優先序 */
export const PO_SORT_OPTIONS: ReadonlyArray<{ value: PoSortField; label: string }> = [
  { value: 'created_at', label: '建立時間' },
  { value: 'order_date', label: '日期' },
  { value: 'total_amount', label: '總額' },
  { value: 'supplier', label: '供應商' },
  { value: 'supplier_order_number', label: '廠商單號' },
  { value: 'status', label: '狀態' },
  { value: 'purpose', label: '類型' },
  { value: 'id', label: '編號' },
];

const isSortField = (v: string | null): v is PoSortField =>
  !!v && (PO_SORT_FIELDS as readonly string[]).includes(v);

/** 由網址參數還原排序狀態；未知 / 缺漏值一律回退預設，避免髒連結讓表格壞掉 */
export function parsePoSort(sp: URLSearchParams): { sortField: PoSortField; sortDir: PoSortDir } {
  const raw = sp.get('sort');
  const sortField = isSortField(raw) ? raw : PO_DEFAULT_SORT_FIELD;
  const sortDir: PoSortDir = sp.get('dir') === 'asc' ? 'asc' : PO_DEFAULT_SORT_DIR;
  return { sortField, sortDir };
}

/** 中文／數字混排的穩定比較器；numeric 讓「PO-2」排在「PO-10」之前 */
const collator = new Intl.Collator('zh-Hant-TW', { numeric: true, sensitivity: 'base' });

/** 排序用的欄位值：文字類走 collator，金額走數值比較 */
type PoSortValue = string | number;

/** 取該列在此欄位的原始值；null 代表「空白」（不參與值比較，固定排最後） */
function sortValueOf(o: PurchaseOrder, field: PoSortField): PoSortValue | null {
  switch (field) {
    case 'supplier':
      return o.supplier?.name ?? null;
    case 'purpose':
      return o.purpose ?? null;
    case 'status':
      return o.status ?? null;
    case 'supplier_order_number':
      return o.supplier_order_number ?? null;
    case 'order_date':
      // 欄位為 ISO 'YYYY-MM-DD'，字串比較即日期先後
      return o.order_date ?? null;
    case 'created_at':
      // timestamptz，PostgREST 固定回傳同一格式（'...T..:..:..+00:00'），字串比較即時間先後
      return o.created_at ?? null;
    case 'total_amount': {
      // 採購退貨為負數金額，故照數值大小排序（不做絕對值），退貨會落在最小端。
      // ⚠️ 0 元是有效金額，不算空白；只有非數字才視為空白。
      const n = Number(o.total_amount ?? 0);
      return Number.isNaN(n) ? null : n;
    }
    case 'id':
    default:
      return o.id ?? null;
  }
}

/** 型別守衛：null 與空字串皆視為空白；標成 type predicate 才能讓 TS 在反向分支收窄 */
const isBlank = (v: PoSortValue | null): v is null | '' => v === null || v === '';

function compareNonEmpty(a: PoSortValue, b: PoSortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * 主要欄位同值時的收斂鍵，避免同值列的先後隨資料載入順序跳動。
 * ⚠️ 排序欄位本身就是 created_at 時這一層會是 no-op，故改用 id（uuid，字串比較即穩定）。
 */
function tiebreak(a: PurchaseOrder, b: PurchaseOrder, field: PoSortField): number {
  if (field === 'created_at') return collator.compare(a.id ?? '', b.id ?? '');
  return (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

/**
 * 依指定欄位／方向排列採購單。
 *
 * ⚠️ 一律回傳新陣列：來源 `orders` 是 react-query cache 傳下來的參考，
 * 就地 sort 會污染 cache 並造成 re-render 迴圈（與 useOrderListDerived.sortedOrders 同一考量）。
 */
export function sortPurchaseOrders(
  orders: PurchaseOrder[],
  sortField: PoSortField,
  sortDir: PoSortDir,
): PurchaseOrder[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...orders].sort((a, b) => {
    const av = sortValueOf(a, sortField);
    const bv = sortValueOf(b, sortField);
    // ⚠️ 空白值固定排最後，**不可乘上 dir**：那會讓 desc 把它翻到最前面，
    // 「沒有廠商單號」的單子就會洗到列表頂端。這裡必須在 dir 之外判斷。
    if (isBlank(av)) return isBlank(bv) ? tiebreak(a, b, sortField) : 1;
    if (isBlank(bv)) return -1;
    return compareNonEmpty(av, bv) * dir || tiebreak(a, b, sortField);
  });
}
