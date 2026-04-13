export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  description: string | null;
  is_active: boolean;
}

export interface AccountingCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  description: string | null;
  is_active: boolean;
}

export interface AccountingEntry {
  id: string;
  category_id: string | null;
  account_id: string | null;
  type: 'income' | 'expense';
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
}
