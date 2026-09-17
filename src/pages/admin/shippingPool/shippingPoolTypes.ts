export interface ShippingPoolItem {
  id: string;
  order_item_id: string;
  quantity: number;
  store_id: string;
  created_at: string;
  order_item: {
    id: string;
    order_id: string;
    product_id: string;
    variant_id: string | null;
    order?: { code: string; consignment_mode?: boolean };
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    product: { name: string; sku: string };
    product_variant?: { name: string } | null;
  };
}

export interface GroupedByStore {
  storeId: string;
  storeName: string;
  storeCode: string | null;
  items: ShippingPoolItem[];
  totalQuantity: number;
}

export type PoolSortField = 'product' | 'quantity' | 'unit_price' | 'subtotal' | 'created_at';

export type PoolSortDir = 'asc' | 'desc';

export const getDisplayName = (item: ShippingPoolItem) => {
  const variant = item.order_item?.product_variant?.name;
  const product = item.order_item?.product?.name;
  if (variant) return variant;
  return product || '';
};