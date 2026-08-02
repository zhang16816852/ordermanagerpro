export type ConsignmentDirection = 'receive_from_supplier' | 'send_to_store';

export type ConsignmentStatus = 'draft' | 'active' | 'settled' | 'cancelled';

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
}

export interface ConsignmentOrder {
  id: string;
  code: string;
  direction: ConsignmentDirection;
  supplier_id: string | null;
  store_id: string | null;
  status: ConsignmentStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  supplier?: { id: string; name: string } | null;
  store?: { id: string; name: string } | null;
}

export interface ConsignmentOrderItem {
  id: string;
  consignment_order_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  product?: { id: string; name: string; code: string };
  variant?: { id: string; name: string; sku: string };
}

export interface ConsignmentOrderItemSummary {
  consignment_order_item_id: string;
  consignment_order_id: string;
  direction: ConsignmentDirection;
  product_id: string;
  variant_id: string | null;
  order_quantity: number;
  unit_price: number;
  unit_cost: number;
  received_quantity: number;
  shipped_quantity: number;
  returned_to_supplier: number;
  returned_from_store: number;
  sold_quantity: number;
  remaining_quantity: number;
}

export interface ConsignmentSalesReport {
  id: string;
  consignment_order_id: string;
  consignment_order_item_id: string;
  store_id: string | null;
  quantity: number;
  sale_price: number | null;
  status: 'pending' | 'confirmed' | 'rejected';
  note: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
  consignment_order?: { code: string } | null;
  store?: { id: string; name: string } | null;
  item?: { id: string; product?: { name: string; code: string }; variant?: { name: string } } | null;
}

export interface ConsignmentSettlement {
  id: string;
  consignment_order_id: string;
  settlement_type: string;
  status: string;
  amount: number;
  account_id: string | null;
  note: string | null;
  settled_by: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface ProductOption {
  id: string;
  name: string;
  code: string;
  variants?: VariantOption[];
}

export interface VariantOption {
  id: string;
  name: string | null;
  sku: string | null;
  status?: string;
}

export interface NewConsignmentItem {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
}
