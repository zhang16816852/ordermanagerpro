import { Database } from '@/integrations/supabase/types';

export type RepairOrder = Database['public']['Tables']['repair_orders']['Row'];
export type RepairOrderInsert = Database['public']['Tables']['repair_orders']['Insert'];
export type RepairOrderUpdate = Database['public']['Tables']['repair_orders']['Update'];

export type RepairOrderItem = Database['public']['Tables']['repair_order_items']['Row'];
export type RepairOrderItemInsert = Database['public']['Tables']['repair_order_items']['Insert'];
export type RepairOrderItemUpdate = Database['public']['Tables']['repair_order_items']['Update'];

export type RepairOrderStatusHistory = Database['public']['Tables']['repair_order_status_history']['Row'];

export type RepairOrderSummary = Database['public']['Views']['repair_order_summary']['Row'];

export type RepairOrderStatus = Database['public']['Enums']['repair_order_status'];
export type RepairItemType = Database['public']['Enums']['repair_item_type'];

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
