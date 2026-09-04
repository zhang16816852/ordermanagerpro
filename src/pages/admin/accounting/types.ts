export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export type EntryType = 'income' | 'expense' | 'transfer' | 'settlement' | 'topup' | 'currency_exchange';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '帳戶互轉',
  settlement: '跨單結帳',
  topup: '儲值',
  currency_exchange: '幣值換算',
};

export const CURRENCY_OPTIONS = [
  { value: 'TWD', label: '台幣 TWD' },
  { value: 'USD', label: '美金 USD' },
  { value: 'JPY', label: '日圓 JPY' },
  { value: 'CNY', label: '人民幣 CNY' },
  { value: 'EUR', label: '歐元 EUR' },
  { value: 'HKD', label: '港幣 HKD' },
  { value: 'KRW', label: '韓元 KRW' },
  { value: 'GBP', label: '英鎊 GBP' },
];

export interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  description: string | null;
  is_active: boolean;
}

export interface AccountingCategory {
  id: string;
  name: string;
  type: EntryType;
  description: string | null;
  is_active: boolean;
}

export interface AccountingEntry {
  id: string;
  category_id: string | null;
  account_id: string | null;
  transfer_to_account_id: string | null;
  exchange_rate: number | null;
  original_currency: string | null;
  original_amount: number | null;
  type: EntryType;
  amount: number;
  paid_amount: number;
  payment_status: PaymentStatus;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  transaction_date: string;
  due_date: string | null;
  created_by: string;
  created_at: string;
  category?: AccountingCategory;
  account?: Account;
  transferToAccount?: Account;
  references?: AccountingEntryReference[];
}

export interface AccountingEntryReference {
  id: string;
  entry_id: string;
  reference_type: string;
  reference_id: string;
  item_name: string | null;
  amount_applied: number;
  created_at: string;
}
