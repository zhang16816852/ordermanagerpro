import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { PurchaseOrderItem } from '../types';
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { LotInputFields } from '@/components/purchase/LotInputFields';
import { LotInput, TrackingMode, trackingModeOf, isLotValid } from '@/utils/lotTracking';
import { toast } from 'sonner';

interface ReceiveFormProps {
  items: PurchaseOrderItem[];
  onSubmit: (data: { id: string; received_quantity: number; warehouse_id: string; lots?: LotInput }[]) => void;
  isLoading: boolean;
}

export function ReceiveForm({
  items,
  onSubmit,
  isLoading,
}: ReceiveFormProps) {
  const { defaultWarehouse, warehouses } = useWarehouses();
  const [quantities, setQuantities] = useState<Record<string, number>>(
    items.reduce((acc, item) => ({ ...acc, [item.id]: item.quantity }), {})
  );
  const [itemWarehouses, setItemWarehouses] = useState<Record<string, string>>(() =>
    (defaultWarehouse ? { _default: defaultWarehouse.id } : {}) as any
  );
  const [lots, setLots] = useState<Record<string, LotInput>>({});

  const getItemWarehouse = (itemId: string) => itemWarehouses[itemId] || itemWarehouses['_default'] || defaultWarehouse?.id || '';

  const handleSubmit = () => {
    const rows = Object.entries(quantities).map(([id, received_quantity]) => {
      const item = items.find(i => i.id === id);
      const tracking = trackingModeOf(item?.variant as { tracking_mode?: TrackingMode } | undefined);
      const lotInput = lots[id] || null;
      if (!isLotValid(lotInput, tracking, received_quantity)) {
        toast.error(tracking === 'serial'
          ? `${item?.product?.name || '品項'} 需輸入與收貨數量相同的序號`
          : `${item?.product?.name || '品項'} 需輸入批號`);
        return null;
      }
      return { id, received_quantity, warehouse_id: getItemWarehouse(id), lots: lotInput || undefined };
    });

    if (rows.some(r => r === null)) return;
    onSubmit(rows.filter(Boolean) as { id: string; received_quantity: number; warehouse_id: string; lots?: LotInput }[]);
  };

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const tracking = trackingModeOf(item.variant as { tracking_mode?: TrackingMode } | undefined);
        return (
          <div key={item.id}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{item.variant?.name || item.product?.name || '-'}</p>
                <p className="text-sm text-muted-foreground">
                  訂購: {item.quantity} / 已收: {item.received_quantity}
                  {tracking !== 'none' && <span className="ml-2 text-xs">{tracking === 'serial' ? '（序號件）' : '（批號件）'}</span>}
                </p>
              </div>
              <Input
                type="number"
                className="w-20"
                value={quantities[item.id] || 0}
                onChange={(e) => setQuantities({ ...quantities, [item.id]: parseInt(e.target.value) || 0 })}
                min="0"
                max={item.quantity}
              />
              <select
                value={getItemWarehouse(item.id)}
                onChange={(e) => setItemWarehouses(prev => ({ ...prev, [item.id]: e.target.value }))}
                className="h-8 text-xs border rounded px-1 w-36"
              >
                {warehouses.filter(w => w.is_active !== false).map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            {tracking !== 'none' && (
              <div className="ml-1 pl-3 border-l-2 border-muted mt-2">
                <LotInputFields
                  trackingMode={tracking}
                  quantity={quantities[item.id] || 0}
                  defaultUnitCost={Number(item.unit_cost) || 0}
                  value={lots[item.id] || null}
                  onChange={(v) => setLots(prev => {
                    const next = { ...prev };
                    if (v) next[item.id] = v; else delete next[item.id];
                    return next;
                  })}
                />
              </div>
            )}
          </div>
        );
      })}
      <DialogFooter>
        <Button
          onClick={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? '處理中...' : '確認收貨'}
        </Button>
      </DialogFooter>
    </div>
  );
}