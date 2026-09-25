export type ConsignmentViewDirection = 'receive_from_supplier' | 'send_to_store';

export type ConsignmentViewStatus = 'draft' | 'active' | 'settled' | 'cancelled';

export interface ConsignmentViewItemSummary {
  shipped_quantity: number;
  received_quantity?: number;
  sold_quantity: number;
  remaining_quantity: number;
}

export interface ConsignmentViewItem {
  id: string;
  quantity: number;
  unit_price: number;
  product?: { id?: string; name: string } | null;
  variant?: { id?: string; name: string } | null;
}

export interface ConsignmentViewOrder {
  id: string;
  code: string;
  direction: ConsignmentViewDirection;
  status: ConsignmentViewStatus;
  created_at: string;
  shipped_at?: string | null;
  received_at?: string | null;
  note?: string | null;
  store?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  items?: ConsignmentViewItem[] | null;
}

export interface ConsignmentViewProductTarget {
  orderId: string;
  itemId: string;
}

export interface ConsignmentProductDateCell {
  key: string;
  label: string;
  count: number;
}

export interface ConsignmentProductRow {
  name: string;
  /** 產品層級名稱；顯示為 name（變體優先），但搜尋時需一併比對 */
  productName?: string;
  delivered: number;
  remaining: number;
  /** 僅含給貨數大於 0 的日期欄，供手機版商品卡展開各日明細 */
  dateCells?: ConsignmentProductDateCell[];
  defaultReportTarget?: ConsignmentViewProductTarget;
}
