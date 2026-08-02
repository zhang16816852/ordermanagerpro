import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { PurchaseOrderItem } from '../types';
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";

interface ReceiveFormProps {
  items: PurchaseOrderItem[];
  onSubmit: (data: { id: string; received_quantity: number; warehouse_id: string }[]) => void;
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

  const getItemWarehouse = (itemId: string) => itemWarehouses[itemId] || itemWarehouses['_default'] || defaultWarehouse?.id || '';

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{item.product?.name || '-'}</p>
            <p className="text-sm text-muted-foreground">
              訂購: {item.quantity} / 已收: {item.received_quantity}
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
      ))}
      <DialogFooter>
        <Button
          onClick={() => onSubmit(
            Object.entries(quantities).map(([id, received_quantity]) => ({ id, received_quantity, warehouse_id: getItemWarehouse(id) }))
          )}
          disabled={isLoading}
        >
          {isLoading ? '處理中...' : '確認收貨'}
        </Button>
      </DialogFooter>
    </div>
  );
}