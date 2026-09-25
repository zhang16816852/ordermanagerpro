import type { OrderItem } from '@/types/order';

// Helper: 優先顯示變體名稱，沒有變體才顯示主產品名稱
export const getDisplayProductName = (productName: string = '', variantName?: string | null) => {
  return variantName || productName || '未知商品';
};

export const getOrderShipmentStatus = (items: OrderItem[]) => {
  const activeItems = items.filter((i) => i.line_type !== 'return');
  if (activeItems.length === 0) return 'shipped';
  const allProcessed = activeItems.every((i) =>
    i.status === 'shipped' || i.status === 'cancelled' || i.status === 'discontinued' || i.status === 'out_of_stock'
  );
  const someShipped = activeItems.some((i) => i.shipped_quantity > 0);
  if (allProcessed) return 'shipped';
  if (someShipped) return 'partial';
  return 'waiting';
};

export const getOrderTotal = (items: OrderItem[], shippingFee?: number | null) => {
  const itemTotal = items.reduce((sum, item) => {
    const isReturn = item.line_type === 'return';
    return sum + (isReturn ? -1 : 1) * item.quantity * item.unit_price;
  }, 0);
  return itemTotal + (shippingFee || 0);
};

export const isReturnLine = (item: OrderItem) => item.line_type === 'return';

export const getAggregateItemKey = (productId: string, variantId: string | null) =>
  `${productId}_${variantId || 'null'}`;