export type RepRecord = {
  user_id: string;
  role: string;
  commission_rate: number | null;
};

export type ProfileRecord = {
  id: string;
  email: string;
  full_name: string | null;
};

export type RepSummary = Record<string, { totalCommission: number; totalProfit: number; noteCount: number; totalSales: number }>;

export interface AssignableStore {
  id: string;
  name: string;
  code: string | null;
}

export interface CostItemInput {
  product_id: string;
  variant_id: string | null;
  cost: number | null;
}

export interface CostRow {
  rep_id: string;
  product_id: string;
  variant_id: string | null;
  cost: number;
}