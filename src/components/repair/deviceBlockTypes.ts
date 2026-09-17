import type { DeviceLockType } from '@/components/repair/LockInput';
import type { ChecklistItem } from '@/components/repair/ChecklistEditor';

export interface RepairBlockItem {
  id: string;
  item_type: 'service' | 'part';
  service_name: string;
  part_name: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  unit_cost: number;
  unit_price: number;
  description: string;
  is_stock_deducted: boolean;
  purchase_order_item_id: string | null;
}

export interface DeviceBlock {
  key: string;
  device_model_id: string;
  device_color: string;
  device_storage: string;
  device_ram: string;
  device_cpu: string;
  device_imei: string;
  device_sn: string;
  device_lock_type: DeviceLockType;
  device_passcode: string;
  device_passcode_pattern: string;
  device_condition: string;
  reported_issue: string;
  diagnostic_result: string;
  internal_notes: string;
  items: RepairBlockItem[];
  appearanceChecklist: ChecklistItem[];
  functionalChecklist: ChecklistItem[];
  discount: number;
  deposit: number;
}

export function createEmptyDeviceBlock(): DeviceBlock {
  return {
    key: crypto.randomUUID(),
    device_model_id: '',
    device_color: '',
    device_storage: '',
    device_ram: '',
    device_cpu: '',
    device_imei: '',
    device_sn: '',
    device_lock_type: 'none',
    device_passcode: '',
    device_passcode_pattern: '',
    device_condition: '',
    reported_issue: '',
    diagnostic_result: '',
    internal_notes: '',
    items: [],
    appearanceChecklist: [],
    functionalChecklist: [],
    discount: 0,
    deposit: 0,
  };
}

export function createEmptyBlockItem(type: 'part' | 'service' = 'part'): RepairBlockItem {
  return {
    id: crypto.randomUUID(),
    item_type: type,
    service_name: '',
    part_name: '',
    product_id: null,
    variant_id: null,
    quantity: 1,
    unit_cost: 0,
    unit_price: 0,
    description: '',
    is_stock_deducted: false,
    purchase_order_item_id: null,
  };
}

export function calcBlockTotals(block: DeviceBlock) {
  const partsCost = block.items.filter(i => i.item_type === 'part').reduce((s, i) => s + (i.unit_cost * i.quantity), 0);
  const laborFee = block.items.filter(i => i.item_type === 'service').reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const gross = block.items.reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const totalPrice = Math.max(0, gross - block.discount);
  return { partsCost, laborFee, gross, totalPrice };
}

export interface BlockUpdateProps {
  block: DeviceBlock;
  onChange: (block: DeviceBlock) => void;
}