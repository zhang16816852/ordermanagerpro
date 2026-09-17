import type { OrderItem } from '@/types/order';

// Helper: 優先顯示變體名稱，沒有變體才顯示主產品名稱
export const getDisplayProductName = (productName: string = '', variantName?: string | null) => {
  return variantName || productName || '未知商品';
};

export const getOrderShipmentStatus = (items: OrderItem[]) => {
  if (items.length === 0) return 'waiting';
  const allProcessed = items.every((i) =>
    i.status === 'shipped' || i.status === 'cancelled' || i.status === 'discontinued'
  );
  const someShipped = items.some((i) => i.shipped_quantity > 0);
  if (allProcessed) return 'shipped';
  if (someShipped) return 'partial';
  return 'waiting';
};

export const getOrderTotal = (items: OrderItem[]) => {
  return items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
};

export const getAggregateItemKey = (productId: string, variantId: string | null) =>
  `${productId}_${variantId || 'null'}`;