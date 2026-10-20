export type PoBindStatus = 'none' | 'covered' | 'partial' | 'over';

export interface OrderPoBindItem {
  id: string;
  quantity: number;
  shipped_quantity: number;
  status?: string | null;
  line_type?: string | null;
  is_repair?: boolean | null;
}

export type OrderPoBindMap = Map<string, { recorded: number; status: PoBindStatus; poIds: string[] }>;

export function getPoBindStatus(pending: number, recorded: number, over = false): PoBindStatus {
  if (over) return 'over';
  if (recorded <= 0) return 'none';
  if (recorded >= pending) return 'covered';
  return 'partial';
}

export function poBindBadge(status: PoBindStatus, pending: number, recorded: number): { text: string; className: string } | null {
  switch (status) {
    case 'over':
      return { text: '採購超量', className: 'bg-red-100 text-red-700 border-red-200' };
    case 'covered':
      return { text: `已採購 ${recorded}`, className: 'bg-green-100 text-green-700 border-green-200' };
    case 'partial':
      return { text: `待採購 ${Math.max(0, pending - recorded)}`, className: 'bg-orange-100 text-orange-700 border-orange-200' };
    default:
      return null;
  }
}

export function orderPoBindBadge(
  items: OrderPoBindItem[],
  binds: OrderPoBindMap | undefined,
): { text: string; className: string } | null {
  if (!binds) return null;
  let pending = 0;
  let recorded = 0;
  let over = false;
  for (const item of items) {
    if (item.status === 'cancelled' || item.status === 'discontinued' || item.status === 'out_of_stock') continue;
    if (item.line_type === 'return' || item.is_repair) continue;
    pending += Math.max(0, item.quantity - item.shipped_quantity);
    const bind = binds.get(item.id);
    if (!bind) continue;
    recorded += bind.recorded;
    if (bind.status === 'over') over = true;
  }
  if (recorded <= 0 && !over) return null;
  return poBindBadge(getPoBindStatus(pending, recorded, over), pending, recorded);
}
