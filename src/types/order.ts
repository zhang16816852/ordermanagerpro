import type { Database } from "../integrations/supabase/types";

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type OrderStatus = 'pending' | 'processing' | 'shipped';
export type OrderItemStatus = 'waiting' | 'partial' | 'shipped' | 'out_of_stock' | 'discontinued' | 'cancelled';
export type OrderSourceType = 'frontend' | 'admin_proxy';

export interface OrderItem {
    id: string;
    order_id: string;
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    status: OrderItemStatus;
    store_id: string;
    product?: {
        name: string;
        sku: string;
    } | null;
    product_variant?: {
        name: string;
        option_1: string | null;
        option_2: string | null;
    } | null;
}

export interface Order {
    id: string;
    code?: string | null;
    created_at: string;
    source_type: OrderSourceType;
    status: OrderStatus;
    notes: string | null;
    store_id: string;
    stores?: {
        name: string;
        code: string | null;
    } | null;
    order_items: OrderItem[];
    access_token?: string | null;
}

export interface ShipmentSelection {
    itemId: string;
    quantity: number;
    maxQuantity: number;
    productName: string;
    sku: string;
    storeId: string;
    storeName: string;
}

export interface ShippingPoolItem {
    order_item_id: string;
    quantity: number;
    store_id?: string;
    created_by?: string;
}

export interface FlatOrderItem extends OrderItem {
    orderId: string;
    orderCreatedAt: string;
    orderStatus: string;
}
