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
}

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
    priceSyncMap?: Record<string, boolean>;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
    defaultCompact?: boolean;
    priceLabel?: string;
}