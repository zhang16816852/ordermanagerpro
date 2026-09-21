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

// ---- 出貨配送（Phase C-4）----
// 每家店（＝每張銷貨單）共享一份收件地址，可拆多個包裹
export interface ShipParcelDraft {
  delivery_method_id: string | null;
  fee: string;
  cost: string;
  tracking_company: string;
  tracking_number: string;
}

export interface ShipDeliveryState {
  address: {
    recipient: string;
    phone: string;
    postal_code: string;
    city: string;
    district: string;
    address: string;
  };
  parcels: ShipParcelDraft[];
}

export type ShipDeliveryMap = Record<string, ShipDeliveryState>;

export const EMPTY_SHIP_ADDRESS = { recipient: "", phone: "", postal_code: "", city: "", district: "", address: "" };

export const makeEmptyParcel = (methodId: string | null = null): ShipParcelDraft => ({
  delivery_method_id: methodId,
  fee: "",
  cost: "",
  tracking_company: "",
  tracking_number: "",
});