export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial_received' | 'received' | 'cancelled';

/**
 * 手動可指定的狀態；partial_received / received 為收貨（receive_purchase_items）
 * 衍生狀態，create/update RPC 一律拒絕，僅能顯示。
 */
export const PO_MANUAL_STATUSES = ['draft', 'ordered', 'cancelled'] as const;
export type PurchaseOrderManualStatus = (typeof PO_MANUAL_STATUSES)[number];

export const isPurchaseOrderManualStatus = (s: string): s is PurchaseOrderManualStatus =>
  (PO_MANUAL_STATUSES as readonly string[]).includes(s);

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: '草稿',
  ordered: '已下單',
  partial_received: '部分收貨',
  received: '已收貨',
  cancelled: '已取消',
};

export const PO_PURPOSE_LABELS: Record<PurchaseOrderPurpose, string> = {
  general: '一般進貨',
  repair_parts: '維修零件',
};

/** 狀態徽章配色（與訂單列表 OrderListTab 的 getStatusBadge 色系一致） */
export const PO_STATUS_CLASSES: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  ordered: 'bg-primary text-primary-foreground',
  partial_received: 'bg-warning text-warning-foreground',
  received: 'bg-success text-success-foreground',
  cancelled: 'bg-destructive text-destructive-foreground',
};

/** 已收到庫存或已產生序號／批號的品項：不可刪除、不可降低數量、不可換商品 */
export const isPurchaseItemLocked = (item: {
  received_quantity?: number | null;
  consumed_quantity?: number | null;
  returned_quantity?: number | null;
  hasBatch?: boolean | null;
}): boolean =>
  (item.received_quantity ?? 0) > 0 ||
  (item.consumed_quantity ?? 0) > 0 ||
  (item.returned_quantity ?? 0) > 0 ||
  !!item.hasBatch;

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  is_logistics_company: boolean;
}

export type PurchaseOrderPurpose = 'general' | 'repair_parts';

export interface PurchaseOrder {
  id: string;
  supplier_id: string | null;
  status: PurchaseOrderStatus;
  purpose: PurchaseOrderPurpose;
  order_date: string;
  expected_date: string | null;
  received_date: string | null;
  total_amount: number;
  notes: string | null;
  supplier_order_number: string | null;
  created_by: string;
  created_at: string;
  supplier?: Supplier;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  received_quantity: number;
  consumed_quantity?: number;
  returned_quantity?: number;
  unit_cost: number;
  sort_order?: number;
  source_order_ids?: string[] | null;
  source_quantities?: Record<string, number> | null;
  product?: { id: string; name: string; code: string };
  variant?: { id: string; name: string; sku: string; tracking_mode?: 'none' | 'serial' | 'batch' };
}

export interface Product {
  id: string;
  name: string;
  code: string;
}

export type ProductWithPrice = Product;

// ---------------------------------------------------------------------------
// 採購交易 RPC（20260930000004/00005）回傳型別
// 函式簽章已進 generated types（p_* 為 optional）；回傳 JSONB 結構仍以本地介面描述。
// 傳參因需明確區分 null（不變更）與 ''（清空），統一走 PoUpdateItemsArgs 集中轉型。
// ---------------------------------------------------------------------------

/** public._po_resolve_item：供應商 mapping → 內部 SKU → 品名；查無回 NULL */
export interface PoResolveItemResult {
  product_id: string;
  variant_id: string | null;
  name: string;
  unit_cost: number | null;
  source: 'mapping' | 'sku';
}

/**
 * create_purchase_order_with_items / update_purchase_order_with_items 的成功與失敗回傳。
 * delete_purchase_order_item_if_safe 沿用同一組欄位，但前端刪除品項統一走
 * update_purchase_order_with_items 的 p_deleted_item_ids（單一交易路徑），故此介面僅供該 RPC。
 */
export interface PoWriteResult {
  ok: boolean;
  reason?: string;
  item_id?: string;
  purchase_order_id?: string;
  total_amount?: number;
  items?: Array<{
    id: string;
    product_id: string;
    variant_id: string | null;
    quantity: number;
  }>;
}

export interface PoImportItemName {
  name: string;
  quantity: number;
}

export interface PoImportResultEntry {
  index: number;
  status: 'created' | 'skipped';
  purchase_order_id?: string;
  supplier_order_number: string | null;
  /** created 時：是否已於同一子交易內立即收貨 */
  received?: boolean;
  reason?: string;
  created_items?: PoImportItemName[];
  skipped_items?: PoImportItemName[];
}

export interface PoImportErrorEntry {
  index: number;
  supplier_order_number: string | null;
  reason: string;
}

export interface PoImportResult {
  total: number;
  success: number;
  results: PoImportResultEntry[];
  errors: PoImportErrorEntry[];
}

/** create_purchase_order_with_items 的 p_items 元素（p_items 直接傳 JS 陣列，勿 JSON.stringify） */
export interface PoCreateItemPayload {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_cost: number;
}

/** update_purchase_order_with_items 的 p_items 元素（id 為 null ＝ 新品項） */
export interface PoUpdateItemPayload extends PoCreateItemPayload {
  id: string | null;
}

/**
 * 品項寫入（update_purchase_order_with_items 的 p_items）。
 * RPC 以收到的整份清單依序指派 sort_order（1..N）並重算 total_amount，
 * 因此呼叫端必須送出「該單全部品項」而非單一列，才能保住既有順序。
 * 守門由伺服端負責：已收貨品項不可降量／刪除／換商品，已取消單鎖品項。
 */
export interface PoItemWritePayload {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_cost: number;
}

/**
 * update_purchase_order_with_items 的呼叫參數。
 *
 * generated types 把 optional 參數標為 `?: string`（省略＝DEFAULT NULL），
 * 但本 RPC 的語意要求可區分「明確傳 null ＝ 不變更」與「傳 '' ＝ 清空」，
 * 且 p_items / p_deleted_item_ids 必須傳入「完整清單」與空陣列（不是省略），
 * 故以本地型別描述實際 payload。陣列欄位直接傳 JS 陣列，勿 JSON.stringify。
 */
export interface PoUpdateItemsArgs {
  p_purchase_order_id: string;
  p_notes?: string | null;
  p_items?: Array<PoItemWritePayload | (Omit<PoItemWritePayload, 'id'> & { id: null })> | null;
  p_deleted_item_ids?: string[] | null;
  p_status?: PurchaseOrderStatus | null;
  p_order_date?: string | null;
  p_expected_date?: string | null;
  p_purpose?: PurchaseOrderPurpose | null;
  p_supplier_order_number?: string | null;
}

/** import_purchase_orders_batch 的 p_groups 元素 */
export interface PoImportGroupPayload {
  supplier_order_number?: string | null;
  status?: PurchaseOrderManualStatus;
  purpose?: PurchaseOrderPurpose;
  order_date?: string | null;
  expected_date?: string | null;
  notes?: string | null;
  receive?: boolean;
  items: Array<{
    sku?: string | null;
    name?: string | null;
    vendor_product_id?: string | null;
    quantity: number;
    unit_cost?: number | null;
    serials?: string[];
    batch_number?: string | null;
    batch_unit_cost?: number | null;
  }>;
}

/**
 * import_purchase_orders_batch 的呼叫參數。
 * 與 PoUpdateItemsArgs 相同理由：p_warehouse_id 需可明確傳 null（＝不指定倉庫），
 * 故以本地型別描述後在呼叫端集中轉型。p_groups 直接傳 JS 陣列，勿 JSON.stringify。
 */
export interface PoImportBatchArgs {
  p_supplier_id: string;
  p_groups: PoImportGroupPayload[];
  p_warehouse_id?: string | null;
  p_created_by?: string | null;
}
