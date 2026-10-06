import { supabase } from '@/integrations/supabase/client';
import { poReceivePlanRow, type PoReceivePlanRow } from './batchActions';

/**
 * 批次收貨的最新資料載入器。
 *
 * ⚠️ 收貨的對象必須以「伺服器現況」為準：
 * 畫面上的品項列表可能是過期快取（另一個分頁／另一台裝置已收過貨），
 * 而 `receive_purchase_items` 會以絕對值覆寫 received_quantity 並寫等量庫存異動，
 * 送錯資料等於重複入帳。故預覽與送出都必須走這裡重新查詢。
 */
export interface PoReceiveItemRow {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  received_quantity: number;
  product_variants: { tracking_mode?: string | null } | null;
}

export async function loadBatchReceiveItems(orderIds: string[]): Promise<PoReceiveItemRow[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('purchase_order_items')
    .select('id, purchase_order_id, product_id, variant_id, quantity, received_quantity, product_variants(tracking_mode)')
    .in('purchase_order_id', orderIds)
    .order('purchase_order_id', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []) as PoReceiveItemRow[];
}

/** 把 DB 列轉為收貨計畫列（含可否收貨判定與跳過原因） */
export function toReceivePlanRow(row: PoReceiveItemRow): PoReceivePlanRow {
  return poReceivePlanRow({
    itemId: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity: Number(row.quantity) || 0,
    received_quantity: Number(row.received_quantity) || 0,
    tracking_mode: row.product_variants?.tracking_mode ?? null,
  });
}

// ---------------------------------------------------------------------------
// 採購單表頭（server truth）
// ---------------------------------------------------------------------------

export interface PoHeaderRow {
  id: string;
  status: string;
  purpose?: string | null;
  supplier_id: string | null;
  supplier_order_number: string | null;
  total_amount: number;
  suppliers: { name: string } | null;
}

/**
 * 重新載入指定採購單的**最新表頭**。
 *
 * ⚠️ 與 `loadBatchReceiveItems` 同理必須以伺服器現況為準：
 * 畫面快取可能是舊的，而 `receive_purchase_items` 完全沒有狀態守門、
 * 還會依品項進度重算 status——把已取消的單送進去會直接「復活」它。
 * 因此批次收貨／批次下單在送出前都要重新確認 status / purpose。
 */
export async function loadPoHeaders(orderIds: string[]): Promise<PoHeaderRow[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('purchase_orders')
    .select('id, status, purpose, supplier_id, supplier_order_number, total_amount, suppliers(name)')
    .in('id', orderIds);
  if (error) throw error;
  return (data || []) as PoHeaderRow[];
}