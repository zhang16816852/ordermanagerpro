import type {
  ConsignmentProductRow,
  ConsignmentViewDirection,
  ConsignmentViewItem,
  ConsignmentViewItemSummary,
  ConsignmentViewOrder,
  ConsignmentViewProductTarget,
} from './consignmentViewTypes';

export type ColumnMode = 'all' | 'remaining';
export type ViewMode = 'orders' | 'items';

export const directionLabel: Record<ConsignmentViewDirection, string> = {
  receive_from_supplier: '廠商寄賣',
  send_to_store: '店家寄賣',
};

export interface PartnerGroup<T> {
  partnerId: string;
  name: string;
  kind: 'store' | 'supplier';
  direction: ConsignmentViewDirection;
  orders: T[];
  totalValue: number;
  totalDelivered: number;
  totalRemaining: number;
}

export interface PivotContribution {
  orderId: string;
  itemId: string;
  orderCode: string;
  dateKey: string;
  eligible: boolean;
}

export interface PivotProduct extends ConsignmentProductRow {
  key: string;
  byDate: Record<string, number>;
  contributions: PivotContribution[];
}

export interface PivotGroup<T> {
  group: PartnerGroup<T>;
  dates: { key: string; label: string }[];
  products: PivotProduct[];
}

export interface OrderTotals {
  total: number;
  delivered: number;
  remaining: number;
}

/**
 * 訂單／商品卡展開狀態。桌機與手機預設不同（桌機展開、手機收合），
 * 因此以「未記錄＝採各斷點預設」方式解析，共用同一份 override map。
 */
export interface CollapseApi {
  isCollapsed: (orderId: string) => boolean;
  toggle: (orderId: string) => void;
}

export function deliveredOf(
  summary: ConsignmentViewItemSummary | undefined,
  isStore: boolean
): number {
  if (!summary) return 0;
  return (isStore ? summary.shipped_quantity : (summary.received_quantity || 0)) || 0;
}

export function orderTotals(
  items: ConsignmentViewItem[],
  summaries: Record<string, ConsignmentViewItemSummary>,
  isStore: boolean
): OrderTotals {
  let total = 0;
  let delivered = 0;
  let remaining = 0;
  for (const item of items) {
    total += Number(item.quantity || 0) * Number(item.unit_price || 0);
    const summary = summaries[item.id];
    delivered += deliveredOf(summary, isStore);
    remaining += summary ? (summary.remaining_quantity || 0) : 0;
  }
  return { total, delivered, remaining };
}

export function buildPartnerGroups<T extends ConsignmentViewOrder>(
  orders: T[],
  summaries: Record<string, ConsignmentViewItemSummary>
): PartnerGroup<T>[] {
  const map = new Map<string, PartnerGroup<T>>();
  for (const order of orders) {
    const isStore = order.direction === 'send_to_store';
    const partner = isStore ? order.store : order.supplier;
    if (!partner?.id) continue;
    const key = `${isStore ? 'store' : 'supplier'}:${partner.id}`;
    const existing = map.get(key);
    const totals = orderTotals(order.items || [], summaries, isStore);
    if (existing) {
      existing.orders.push(order);
      existing.totalValue += totals.total;
      existing.totalDelivered += totals.delivered;
      existing.totalRemaining += totals.remaining;
    } else {
      map.set(key, {
        partnerId: partner.id,
        name: partner.name,
        kind: isStore ? 'store' : 'supplier',
        direction: isStore ? 'send_to_store' : 'receive_from_supplier',
        orders: [order],
        totalValue: totals.total,
        totalDelivered: totals.delivered,
        totalRemaining: totals.remaining,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

/** 商品 × 日期矩陣：日期為欄，儲存格＝該日給貨數；商品以 product_id:variant_id 為 key */
export function buildPivotGroups<T extends ConsignmentViewOrder>(
  groups: PartnerGroup<T>[],
  summaries: Record<string, ConsignmentViewItemSummary>
): PivotGroup<T>[] {
  return groups.map((group) => {
    const dateMap = new Map<string, { key: string; label: string }>();
    const prodMap = new Map<string, PivotProduct>();
    const isStore = group.direction === 'send_to_store';

    const dateKeyOf = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      const d = new Date(raw);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // dateKey 已是正規化的 YYYY-MM-DD，直接拆字串取月日，
    // 不可再 new Date()（會被視為 UTC midnight 而在負時區退一天）
    const labelOf = (dateKey: string): string => {
      const [, mm, dd] = dateKey.split('-');
      return `${Number(mm)}/${Number(dd)}`;
    };

    for (const order of group.orders) {
      const orderKey = dateKeyOf(order.shipped_at || order.received_at || order.created_at);
      if (orderKey && !dateMap.has(orderKey)) {
        dateMap.set(orderKey, { key: orderKey, label: labelOf(orderKey) });
      }
      for (const item of order.items || []) {
        const summary = summaries[item.id];
        const name = item.variant?.name || item.product?.name || '-';
        const prodKey = `${item.product?.id ?? 'p'}:${item.variant?.id ?? 'v'}`;
        let prod = prodMap.get(prodKey);
        if (!prod) {
          prod = {
            key: prodKey,
            name,
            productName: item.product?.name,
            byDate: {},
            delivered: 0,
            remaining: 0,
            contributions: [],
          };
          prodMap.set(prodKey, prod);
        }
        const delivered = deliveredOf(summary, isStore);
        if (delivered > 0 && orderKey) {
          prod.byDate[orderKey] = (prod.byDate[orderKey] || 0) + delivered;
        }
        prod.delivered += delivered;
        const remaining = summary ? summary.remaining_quantity ?? 0 : 0;
        prod.remaining += remaining;
        const eligible = !!order.received_at && remaining > 0 && order.status !== 'cancelled';
        prod.contributions.push({
          orderId: order.id,
          itemId: item.id,
          orderCode: order.code,
          dateKey: orderKey || '',
          eligible,
        });
      }
    }

    const dates = [...dateMap.values()].sort((a, b) => a.key.localeCompare(b.key));
    const products = [...prodMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    for (const prod of products) {
      // 僅保留給貨數大於 0 的日期欄，供手機版商品卡展開各日明細
      prod.dateCells = dates
        .map((d) => ({ key: d.key, label: d.label, count: prod.byDate[d.key] ?? 0 }))
        .filter((cell) => cell.count > 0);
      // 回報目標自動挑最舊可回報：日期升冪，日期相同再依單號排序
      const best = prod.contributions
        .filter((c) => c.eligible)
        .sort(
          (a, b) =>
            (a.dateKey || '9999').localeCompare(b.dateKey || '9999') ||
            a.orderCode.localeCompare(b.orderCode)
        )[0];
      if (best) {
        const target: ConsignmentViewProductTarget = {
          orderId: best.orderId,
          itemId: best.itemId,
        };
        prod.defaultReportTarget = target;
      }
    }
    return { group, dates, products };
  });
}
