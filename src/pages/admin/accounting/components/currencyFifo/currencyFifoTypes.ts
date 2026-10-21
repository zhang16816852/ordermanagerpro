// Currency FIFO Types
// src/pages/admin/accounting/components/currencyFifo/currencyFifoTypes.ts

export interface CurrencyBatch {
  id: string;
  account_id: string;
  amount: number;
  exchange_rate: number;
  twd_equivalent: number;
  source_type: string;
  source_id: string | null;
  transfer_source_batch_id: string | null;
  transaction_date: string;
  created_at: string;
  status?: 'active' | 'cancelled';
}

export interface CurrencyBatchInventory {
  batch_id: string;
  account_id: string;
  remaining_amount: number;
  updated_at: string;
}

export interface CurrencyMovement {
  id: string;
  account_id: string;
  amount_change: number;
  twd_equivalent: number;
  exchange_rate: number;
  source_type: string;
  reference_id: string | null;
  receipt_id: string | null;
  transaction_date: string;
  created_at: string;
}

export interface CurrencyBatchConsumption {
  id: string;
  movement_id: string;
  batch_id: string;
  consumed_amount: number;
  historical_twd_cost: number;
  transfer_fee_amount: number | null;
  status: 'active' | 'reversed';
  reversal_of_movement_id: string | null;
  refund_of_movement_id: string | null;
  receipt_id: string | null;
  created_at: string;
}

export interface CurrencyCostAdjustment {
  id: string;
  movement_id: string;
  trigger_reason: string;
  original_consumptions: any;
  new_consumptions: any;
  delta_amount: number;
  created_at: string;
}

export interface CurrencyTransactionResult {
  receipt_id: string;
  account_id: string | null;
  operation_type: string;
  request_hash: string;
  result_json: any;
  group_id: string | null;
  is_reversed: boolean;
  created_at: string;
}

export interface CurrencyBatchWithInventory extends CurrencyBatch {
  remaining_amount: number;
  consumed_amount: number;
  is_fully_consumed: boolean;
}

export interface FIFOResult {
  ok: boolean;
  reason?: string;
  movement_id?: string;
  consumed_batches?: Array<{
    batch_id: string;
    consumed_amount: number;
    exchange_rate: number;
    historical_twd_cost: number;
  }>;
  total_twd_cost?: number;
  consumed_amount?: number;
  remaining_qty?: number;
  shortfall?: number;
  available?: number;
}

export interface ExchangeResult {
  ok: boolean;
  reason?: string;
  movement_id?: string;
  twd_gross_received?: number;
  bank_fee?: number;
  twd_net_received?: number;
  fifo_historical_cost?: number;
  exchange_gain_loss?: number;
  group_id?: string;
}

export interface TransferResult {
  ok: boolean;
  reason?: string;
  from_movement_id?: string;
  to_movement_id?: string;
  fee_movement_id?: string;
  transferred_amount?: number;
  fee_amount?: number;
  total_deducted?: number;
  received_amount?: number;
  total_twd_cost?: number;
  fee_twd_cost?: number;
  group_id?: string;
}

export interface ReconcileResult {
  ok: boolean;
  account_id: string;
  movement_sum: number;
  batch_remaining: number;
  consumption_sum: number;
  historical_cost_sum: number;
  discrepancies: Array<{
    type: string;
    expected: number;
    actual: number;
  }>;
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  initial: '期初餘額',
  initial_estimated: '期初餘額（估計）',
  sales: '客戶外幣收款',
  transfer_in: '轉帳轉入',
  purchase_refund: '採購取消退款',
  sales_refund: '客戶退貨退款',
  manual: '人工調整入帳',
  exchange: '外幣兌換台幣',
  transfer: '外幣轉帳轉出',
  purchase_payment: '支付國外採購單',
  freight_payment: '支付廠商獨立運費',
  transfer_fee: '轉帳手續費',
  reversal: '沖銷原交易',
  pending_reconciliation: '暫記/待補帳',
};

export const FREIGHT_TYPE_LABELS: Record<string, string> = {
  local_transfer: '當地轉倉',
  international: '國際運輸',
  customs: '關稅',
  clearance: '清關費',
  other: '其他',
};

export const OPERATION_TYPE_LABELS: Record<string, string> = {
  inbound: '外幣入帳',
  exchange: '外幣換匯',
  transfer: '外幣轉帳',
  reversal: '沖銷',
  refund: '退款',
  purchase_payment: '採購付款',
  freight_payment: '運費付款',
};