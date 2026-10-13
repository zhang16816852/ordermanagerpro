import type { ProfitMode } from "@/components/shared/ProfitCell";
import type { ProfitSummary } from "@/utils/grossProfit";
import type { SalesNoteDetail } from "@/components/sales/SalesNoteDetailDialog";

export interface StoreOption {
  id: string;
  name: string;
  code: string | null;
}

export interface RepOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export interface SalesNoteItemOrderItem {
  id: string;
  order_id: string;
  quantity: number;
  unit_price: number | null;
  unit_cost: number | null;
  sort_order: number | null;
  product_id: string;
  variant_id: string | null;
  line_type: "sale" | "exchange" | "return" | null;
  line_note: string | null;
  order?: { code: string | null } | null;
  product?: { name: string | null; code: string | null } | null;
  product_variant?: { name: string | null; sku: string | null } | null;
}

export interface SalesNoteItemRow {
  id: string;
  quantity: number;
  returned_quantity: number | null;
  sort_order: number | null;
  order_item?: SalesNoteItemOrderItem | null;
}

export interface SalesNoteRow {
  id: string;
  code: string | null;
  store_id: string;
  status: string;
  payment_status: string | null;
  created_at: string;
  shipped_at: string | null;
  received_at: string | null;
  notes: string | null;
  access_token: string | null;
  delivery_type: string | null;
  shipping_fee: number | null;
  shipping_cost: number | null;
  delivery_method_id: string | null;
  delivery_method_title: string | null;
  delivery_method_code: string | null;
  shipping_address: SalesNoteDetail["shipping_address"];
  store?: { name: string | null; code: string | null } | null;
  sales_note_items?: SalesNoteItemRow[] | null;
}

export interface SalesNoteTableRow {
  id: string;
  code?: string;
  storeName?: string;
  storeCode?: string;
  status: string;
  payment_status?: string;
  access_token?: string | null;
  itemCount: number;
  totalQty: number;
  amount: number;
  hasReturned: boolean;
  created_at: string;
  shipped_at?: string | null;
  received_at?: string | null;
  profit?: ProfitSummary | null;
  profitMode?: ProfitMode;
  commission?: number | null;
  repName?: string | null;
}

export interface RepSalesSummary {
  totalProfit: number;
  totalCommission: number;
}
