import type { SalesNoteDetail } from "./SalesNoteDetailDialog";

export interface CorrectAddItem {
    order_item_id: string;
    quantity: number;
}

export interface CorrectNewItem {
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    unit_price: number;
}

export interface SalesNoteCorrectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    note: SalesNoteDetail | null;
}

export interface PoolItem {
    id: string;
    order_item_id: string;
    quantity: number;
    store_id: string;
    sort_order: number;
    order_item: {
        id: string;
        order_id: string;
        product_id: string;
        variant_id: string | null;
        quantity: number;
        shipped_quantity: number;
        unit_price: number;
        order: { code: string | null; consignment_mode: boolean } | null;
        product: { name: string; code: string } | null;
        product_variant: { name: string; sku: string } | null;
    };
}

export interface OrderItemCandidate {
    id: string;
    order_id: string;
    product_id: string;
    variant_id: string | null;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    available: number;
    code: string;
    product: { name: string; code: string } | null;
    product_variant: { name: string; sku: string } | null;
}

export interface NoteReference {
    code: string;
    payment_status: string;
}

export interface PriceChange {
    itemId: string;
    orderItemId: string;
    orderCode?: string;
    label: string;
    oldPrice: number;
    newPrice: number;
    quantity: number;
    otherNotes: NoteReference[];
    blocked: boolean;
}

export const itemLabel = (productName?: string | null, variantName?: string | null) =>
    variantName ? variantName : productName || "未知品項";