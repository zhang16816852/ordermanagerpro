import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus } from 'lucide-react';
import type { GridCellVariant, GridMode } from '@/types/order-grid';
import type { VariantWithPricing, ProductWithPricing } from '@/types/product';
import { cn } from '@/lib/utils';

interface OrderGridCellProps {
  items: GridCellVariant[];
  mode: GridMode;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onItemAdd?: (variant: VariantWithPricing, product: ProductWithPricing, delta: number) => void;
}

export function OrderGridCell({
  items,
  mode,
  onQuantityChange,
  onItemAdd,
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
              onItemAdd={onItemAdd}
              variant={variant}
              product={product}
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
  onItemAdd,
  variant,
  product,
}: {
  quantity: number;
  onQuantityChange: (variantId: string, quantity: number) => void;
  variantId: string;
  onItemAdd?: (variant: VariantWithPricing, product: ProductWithPricing, delta: number) => void;
  variant: VariantWithPricing;
  product: ProductWithPricing;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-0.5">
      <Button
        variant={quantity > 0 ? 'default' : 'outline'}
        size="icon"
        className="h-5 w-5"
        onClick={() => {
          onQuantityChange(variantId, quantity + 1);
          onItemAdd?.(variant, product, 1);
        }}
      >
        <Plus className="h-2.5 w-2.5" />
      </Button>
      <span className="text-xs font-medium leading-none text-primary">{quantity}</span>
      {quantity > 0 && (
        <Button
          variant="outline"
          size="icon"
          className="h-5 w-5"
          onClick={() => {
            onQuantityChange(variantId, quantity - 1);
            onItemAdd?.(variant, product, -1);
          }}
        >
          <Minus className="h-2.5 w-2.5" />
        </Button>
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
        onFocus={(e) => e.target.select()}
        className={cn(
          'h-7 w-16 sm:w-20 text-center text-xs',
          parseInt(localValue) > 0 && 'border-primary/50 bg-primary/5'
        )}
        placeholder="0"
      />
    </div>
  );
}
