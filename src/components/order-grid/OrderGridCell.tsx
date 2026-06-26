import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus } from 'lucide-react';
import type { GridCellVariant, GridMode } from '@/types/order-grid';
import { cn } from '@/lib/utils';

interface OrderGridCellProps {
  items: GridCellVariant[];
  mode: GridMode;
  onQuantityChange: (variantId: string, quantity: number) => void;
}

export function OrderGridCell({
  items,
  mode,
  onQuantityChange,
}: OrderGridCellProps) {
  if (items.length === 0) {
    return (
      <div className="h-full min-h-[44px] flex items-center justify-center">
        <span className="text-red-400/60 text-base leading-none">✕</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 py-0.5">
      {items.map(({ variant, product, quantity }) => (
        <div key={variant.id}>
          {mode === 'button' ? (
            <ButtonModeCell
              quantity={quantity}
              onQuantityChange={onQuantityChange}
              variantId={variant.id}
            />
          ) : (
            <InputModeCell
              quantity={quantity}
              onQuantityChange={onQuantityChange}
              variantId={variant.id}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ButtonModeCell({
  quantity,
  onQuantityChange,
  variantId,
}: {
  quantity: number;
  onQuantityChange: (variantId: string, quantity: number) => void;
  variantId: string;
}) {
  return (
    <div className="flex items-center justify-center gap-px">
      {quantity > 0 && (
        <Button
          variant="outline"
          size="icon"
          className="h-6 w-6"
          onClick={() => onQuantityChange(variantId, quantity - 1)}
        >
          <Minus className="h-3 w-3" />
        </Button>
      )}
      <Button
        variant={quantity > 0 ? 'default' : 'outline'}
        size="icon"
        className="h-6 w-6"
        onClick={() => onQuantityChange(variantId, quantity + 1)}
      >
        <Plus className="h-3 w-3" />
      </Button>
      {quantity > 0 && (
        <span className="text-xs font-medium text-primary min-w-[20px] text-center">
          {quantity}
        </span>
      )}
    </div>
  );
}

function InputModeCell({
  quantity,
  onQuantityChange,
  variantId,
}: {
  quantity: number;
  onQuantityChange: (variantId: string, quantity: number) => void;
  variantId: string;
}) {
  const [localValue, setLocalValue] = useState(quantity.toString());

  useEffect(() => {
    setLocalValue(quantity.toString());
  }, [quantity]);

  const sync = () => {
    const val = parseInt(localValue, 10);
    onQuantityChange(variantId, isNaN(val) ? 0 : Math.max(0, val));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center justify-center">
      <Input
        type="number"
        min={0}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={sync}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-7 w-16 text-center text-xs',
          parseInt(localValue) > 0 && 'border-primary/50 bg-primary/5'
        )}
        placeholder="0"
      />
    </div>
  );
}
