import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import { PurchaseOrderItem } from '../types';

interface ReceiveFormProps {
  items: PurchaseOrderItem[];
  onSubmit: (data: { id: string; received_quantity: number }[]) => void;
  isLoading: boolean;
}

export function ReceiveForm({
  items,
  onSubmit,
  isLoading,
}: ReceiveFormProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>(
    items.reduce((acc, item) => ({ ...acc, [item.id]: item.quantity }), {})
  );

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-4">
            <div className="flex-1">
              <p className="font-medium">{item.product?.name || '-'}</p>
              <p className="text-sm text-muted-foreground">
                訂購: {item.quantity} / 已收: {item.received_quantity}
              </p>
            </div>
            <Input
              type="number"
              className="w-24"
              value={quantities[item.id] || 0}
              onChange={(e) => setQuantities({ ...quantities, [item.id]: parseInt(e.target.value) || 0 })}
              min="0"
              max={item.quantity}
            />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit(
            Object.entries(quantities).map(([id, received_quantity]) => ({ id, received_quantity }))
          )}
          disabled={isLoading}
        >
          {isLoading ? '處理中...' : '確認收貨'}
        </Button>
      </DialogFooter>
    </div>
  );
}
