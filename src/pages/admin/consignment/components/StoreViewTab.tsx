import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, Store, Factory, Package } from 'lucide-react';
import { ConsignmentOrder, ConsignmentDirection, ConsignmentStatus } from '../types';
import { formatCurrency } from '@/lib/formatters';

interface StoreViewTabProps {
  orders: ConsignmentOrder[];
  onView: (order: ConsignmentOrder) => void;
  isLoading: boolean;
}

const directionLabel: Record<ConsignmentDirection, string> = {
  receive_from_supplier: '廠商寄賣',
  send_to_store: '店家寄賣',
};

export function getStatusBadge(status: ConsignmentStatus) {
  switch (status) {
    case 'draft': return <Badge variant="secondary">草稿</Badge>;
    case 'active': return <Badge variant="outline" className="border-blue-500 text-blue-500">進行中</Badge>;
    case 'settled': return <Badge variant="outline" className="border-green-500 text-green-600">已結算</Badge>;
    case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

interface PartnerGroup {
  partnerId: string;
  name: string;
  kind: 'store' | 'supplier';
  direction: ConsignmentDirection;
  orders: ConsignmentOrder[];
  totalValue: number;
}

export function StoreViewTab({ orders, onView, isLoading }: StoreViewTabProps) {
  const groups = useMemo<PartnerGroup[]>(() => {
    const map = new Map<string, PartnerGroup>();
    for (const order of orders) {
      const isStore = order.direction === 'send_to_store';
      const partner = isStore ? order.store : order.supplier;
      if (!partner?.id) continue;
      const key = `${isStore ? 'store' : 'supplier'}:${partner.id}`;
      const existing = map.get(key);
      const orderTotal = (order.items || []).reduce(
        (sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0),
        0
      );
      if (existing) {
        existing.orders.push(order);
        existing.totalValue += orderTotal;
      } else {
        map.set(key, {
          partnerId: partner.id,
          name: partner.name,
          kind: isStore ? 'store' : 'supplier',
          direction: isStore ? 'send_to_store' : 'receive_from_supplier',
          orders: [order],
          totalValue: orderTotal,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }, [orders]);

  if (isLoading) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground" role="status" aria-live="polite">載入中…</div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground italic">目前無寄賣紀錄</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={`${group.kind}:${group.partnerId}`} className="border rounded-lg bg-card shadow-soft">
          {/* Partner header */}
          <div className="flex flex-wrap items-center gap-3 p-4 border-b bg-muted/20 rounded-t-lg">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              group.kind === 'store' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600'
            }`}>
              {group.kind === 'store' ? <Store className="h-5 w-5" /> : <Factory className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                {group.kind === 'store' ? '店家' : '供應商'}・{directionLabel[group.direction]}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">寄賣 {group.orders.length} 單</p>
              <p className="font-bold text-primary">{formatCurrency(group.totalValue)}</p>
            </div>
          </div>

          {/* Orders under this partner */}
          <div className="p-2">
            {group.orders.map((order) => {
              const orderTotal = (order.items || []).reduce(
                (sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0),
                0
              );
              return (
                <div key={order.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-medium">{order.code}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {getStatusBadge(order.status)}
                      <span className="text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleDateString('zh-TW')}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-semibold">{formatCurrency(orderTotal)}</span>
                  <Button size="sm" variant="outline" onClick={() => onView(order)} aria-label={`查看寄賣單 ${order.code}`}>
                    <Eye className="h-3.5 w-3.5 mr-1" />查看
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}