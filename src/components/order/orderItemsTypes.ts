import { Tables } from '@/integrations/supabase/types';

export interface OrderItemRow {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    isNew?: boolean;
    /** 價格來源：預設批發價 (default) 或 連鎖客戶批發價 (brand) */
    priceSource?: 'default' | 'brand';
    variantId?: string;
    variantName?: string;
    selectedModelName?: string;
    sku?: string;
    productName?: string;
    sort_order?: number;
    itemType?: 'product' | 'shipping' | 'packaging' | 'repair_part';
    unitCost?: number;
    shippingPayment?: string | null;
    tempKey?: string;
    parentTempKey?: string;
    lineType?: 'sale' | 'exchange' | 'return' | 'defective';
    lineNote?: string;
    returnStatus?: 'pending' | 'stock' | 'exchange' | 'repaired' | null;
    isRepair?: boolean;
    /** 採購單品項已收貨數量：不可刪除／不可降低數量／不可換商品（僅採購編輯模式使用） */
    receivedQuantity?: number;
    shippedQuantity?: number;
    /** 已被採購單採購數量（source_quantities 對此訂單的累計）：不可降低數量至此以下（僅銷售訂單編輯模式使用） */
    poRecordedQuantity?: number;
    /** 採購單採購此品項的單號（提示用） */
    poRecordedCodes?: string[];
    /** 來源採購單品項的 source_order_ids（用於出貨/pre-save 時顯式保留綁定，避免條件式覆寫誤清） */
    sourceOrderIds?: string[] | null;
    /** 來源採購單品項的 source_quantities（用於出貨/pre-save 時顯式保留綁定） */
    sourceQuantities?: Record<string, number> | null;
}

export const DEFAULT_LINE_TYPE: 'sale' | 'exchange' | 'return' = 'sale';

export const isReturnLine = (item: Pick<OrderItemRow, 'lineType'>): boolean =>
  (item.lineType ?? DEFAULT_LINE_TYPE) === 'return';

export const isDefectiveLine = (item: Pick<OrderItemRow, 'lineType'>): boolean =>
  (item.lineType ?? DEFAULT_LINE_TYPE) === 'defective';

export const isReturnOrDefectiveLine = (item: Pick<OrderItemRow, 'lineType'>): boolean =>
  isReturnLine(item) || isDefectiveLine(item);

export const isRepairLine = (item: Pick<OrderItemRow, 'lineType' | 'isRepair'>): boolean =>
  (item.lineType ?? DEFAULT_LINE_TYPE) === 'exchange' && !!item.isRepair;

export const displayQty = (item: Pick<OrderItemRow, 'lineType' | 'quantity'>): number =>
  isReturnLine(item) || isDefectiveLine(item) ? -(Number(item.quantity) || 0) : Number(item.quantity) || 0;

export const lineAmount = (item: Pick<OrderItemRow, 'lineType' | 'quantity' | 'unitPrice'>): number =>
  displayQty(item) * (Number(item.unitPrice) || 0);

export const LINE_TYPE_LABELS: Record<'sale' | 'exchange' | 'return' | 'defective', string> = {
  sale: '一般',
  exchange: '換貨',
  return: '退貨',
  defective: '瑕疵',
};

export type LineTypeOption = 'sale' | 'exchange' | 'return' | 'defective' | 'repair';

export const RETURN_STATUS_LABELS: Record<string, string> = {
  pending: '待處理',
  stock: '已退庫存',
  exchange: '已換貨',
  repaired: '已送修歸還',
};

export type ViewMode = 'compact' | 'detailed' | 'grid';

export type NameSort = 'default' | 'asc' | 'desc';

export type KeyOption = { name: string; value: string };

export interface OrderItemsTableProps {
    items: OrderItemRow[];
    products?: Tables<'products'>[];
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void;
    onRemove: (index: number) => void;
    onSplit?: (index: number) => void;
    isEditable: boolean;
    onReorder?: (items: OrderItemRow[]) => void;
    onUpdateLineType?: (index: number, lineType: LineTypeOption) => void;
    priceSyncMap?: Record<string, boolean>;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
    defaultCompact?: boolean;
    priceLabel?: string;
}