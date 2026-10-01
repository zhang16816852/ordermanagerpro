import { Tables } from '@/integrations/supabase/types';

export interface OrderItemRow {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    isNew?: boolean;
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
    lineType?: 'sale' | 'exchange' | 'return';
    lineNote?: string;
    returnStatus?: 'pending' | 'stock' | 'exchange' | 'repaired' | null;
    isRepair?: boolean;
    /** 採購單品項已收貨數量：不可刪除／不可降低數量／不可換商品（僅採購編輯模式使用） */
    receivedQuantity?: number;
}

export const DEFAULT_LINE_TYPE: 'sale' | 'exchange' | 'return' = 'sale';

export const isReturnLine = (item: Pick<OrderItemRow, 'lineType'>): boolean =>
  (item.lineType ?? DEFAULT_LINE_TYPE) === 'return';

export const displayQty = (item: Pick<OrderItemRow, 'lineType' | 'quantity'>): number =>
  isReturnLine(item) ? -(Number(item.quantity) || 0) : Number(item.quantity) || 0;

export const lineAmount = (item: Pick<OrderItemRow, 'lineType' | 'quantity' | 'unitPrice'>): number =>
  displayQty(item) * (Number(item.unitPrice) || 0);

export const LINE_TYPE_LABELS: Record<'sale' | 'exchange' | 'return', string> = {
  sale: '一般',
  exchange: '換貨',
  return: '退貨',
};

export type LineTypeOption = 'sale' | 'exchange' | 'return' | 'repair';

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