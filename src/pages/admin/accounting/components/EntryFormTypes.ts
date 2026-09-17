import { AccountingEntry, AccountingCategory, Account, AccountingEntryReference } from '../types';

export type RepairAccountingSubType = 'income_repair' | 'expense_part' | 'expense_service';

export interface RepairAccountingPrefill {
  subType?: RepairAccountingSubType;
  repairOrderId?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  vendorName?: string;
  amount?: number;
  description?: string;
}

export type DocType = 'sales_note' | 'purchase_order' | 'repair_order';

export interface DocItem {
  docType: DocType;
  docId: string;
  code: string;
  name: string;
  date: string;
  originalAmount: number;
  amountApplied: number;
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  sales_note: '銷貨單',
  purchase_order: '採購單',
  repair_order: '維修單',
};

export interface EntryPrefill {
  accountId?: string;
  amount?: number;
  categoryId?: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  transactionDate?: string;
  docItems?: DocItem[];
  markAsPaid?: boolean;
  payout?: { repId?: string; salesNoteId?: string; salesNoteIds?: string[] };
  shipping?: {
    supplierId?: string;
    orderItemIds?: string[];
    periodStart?: string;
    periodEnd?: string;
  };
  repair?: RepairAccountingPrefill;
}

export interface PayoutSubmission {
  repId: string;
  salesNoteId: string;
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
  note?: string;
}

export interface BatchPayoutSubmission {
  repId: string;
  salesNoteIds: string[];
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
}

export interface ShippingSettlementSubmission {
  supplierId: string;
  orderItemIds: string[];
  periodStart: string;
  periodEnd: string;
  paidDate: string;
  accountId: string;
  categoryId?: string | null;
  description?: string;
  note?: string;
}

export type FormView = 'list' | 'transfer' | 'currency_exchange' | 'payout' | 'shipping' | 'repair';

export interface EntryFormProps {
  entry: AccountingEntry | null;
  paymentEntry?: AccountingEntry | null;
  prefill?: EntryPrefill | null;
  categories: AccountingCategory[];
  accounts: Account[];
  onSubmit: (data: Partial<AccountingEntry>, references?: AccountingEntryReference[]) => void;
  onRecordPayment?: (data: { entryId: string; amount: number; accountId: string }) => void;
  onPayoutSubmit?: (payload: PayoutSubmission) => void;
  onBatchPayoutSubmit?: (payload: BatchPayoutSubmission) => void;
  onShippingSettleSubmit?: (payload: ShippingSettlementSubmission) => void;
  isLoading: boolean;
}

export interface PayoutRep {
  user_id: string;
  commission_rate: number;
  full_name: string | null;
  email: string;
}

export interface PayoutNote {
  id: string;
  code: string;
  storeName: string;
  shippedAt: string | null;
  commission: number;
}

export interface ShipItem {
  id: string;
  orderId: string;
  orderCode: string;
  productName: string;
  qty: number;
  unitPrice: number;
  amount: number;
}