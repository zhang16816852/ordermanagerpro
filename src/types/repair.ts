export type RepairOrderStatus = 'pending' | 'diagnosing' | 'quoting' | 'awaiting_approval' | 'awaiting_parts' | 'repairing' | 'ready' | 'delivered' | 'cancelled';
export type RepairItemType = 'service' | 'part';

export interface RepairOrder { id: string; [key: string]: any; }
export interface RepairOrderInsert { [key: string]: any; }
export interface RepairOrderUpdate { [key: string]: any; }
export interface RepairOrderItem { id: string; [key: string]: any; }
export interface RepairOrderItemInsert { [key: string]: any; }
export interface RepairOrderItemUpdate { [key: string]: any; }
export interface RepairOrderStatusHistory { id: string; [key: string]: any; }
export type RepairOrderSummary = Record<string, any>;

export const REPAIR_ORDER_STATUS_LABELS: Record<RepairOrderStatus, string> = {
  pending: '待處理',
  diagnosing: '檢測中',
  quoting: '報價中',
  awaiting_approval: '待客戶確認',
  awaiting_parts: '待料中',
  repairing: '維修中',
  ready: '已修復/待取件',
  delivered: '已取件',
  cancelled: '已取消',
};

export const REPAIR_ORDER_STATUS_COLORS: Record<RepairOrderStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  diagnosing: 'bg-blue-100 text-blue-700',
  quoting: 'bg-yellow-100 text-yellow-700',
  awaiting_approval: 'bg-orange-100 text-orange-700',
  awaiting_parts: 'bg-purple-100 text-purple-700',
  repairing: 'bg-indigo-100 text-indigo-700',
  ready: 'bg-green-100 text-green-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export const REPAIR_ORDER_STATUS_STEPS: RepairOrderStatus[] = [
  'pending',
  'diagnosing',
  'quoting',
  'awaiting_approval',
  'awaiting_parts',
  'repairing',
  'ready',
  'delivered',
];

export const REPAIR_ITEM_TYPE_LABELS: Record<RepairItemType, string> = {
  service: '維修服務',
  part: '零件材料',
};
