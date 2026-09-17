import type { Order } from '@/types/order';

export type OrderStatusTab = 'pending' | 'processing' | 'shipped';
export type OrderViewMode = 'orders' | 'items' | 'aggregate';

export interface AggregateSelectionItem {
  productId: string;
  variantId: string | null;
  quantity: number;
  maxQuantity: number;
  productName: string;
  variantName?: string | null;
  sku: string;
  sourceOrderIds: string[];
  sourceQuantities: Record<string, number>;
}

export interface ItemsSelectionItem {
  itemId: string;
  productName: string;
  sku: string;
  quantity: number;
  maxQuantity: number;
  storeId: string;
  storeName: string;
  orderId: string;
}

export interface GroupedSelection {
  [storeId: string]: { storeName: string; items: any[] };
}

export interface ReverseShipmentTarget {
  order: Order;
  consignmentOrderId: string;
}

export const itemStatusLabels: Record<string, { label: string; className: string }> = {
  waiting: { label: '待出貨', className: 'bg-primary text-primary-foreground' },
  partial: { label: '部分出貨', className: 'bg-warning text-warning-foreground' },
  shipped: { label: '已出貨', className: 'bg-success text-success-foreground' },
  cancelled: { label: '已取消', className: 'bg-destructive text-destructive-foreground' },
  out_of_stock: { label: '缺貨', className: 'bg-muted text-muted-foreground' },
  discontinued: { label: '已停售', className: 'bg-muted text-muted-foreground' },
};