export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial_received' | 'received' | 'cancelled';

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  received_date: string | null;
  total_amount: number;
  notes: string | null;
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
  unit_cost: number;
  product?: { id: string; name: string; sku: string };
  variant?: { id: string; name: string; sku: string };
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  has_variants: boolean;
}

export interface ProductWithPrice extends Product {
  base_wholesale_price: number;
}
