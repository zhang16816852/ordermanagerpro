import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus } from 'lucide-react';
import type { GridCellVariant, GridMode } from '@/types/order-grid';
import type { VariantWithPricing, ProductWithPricing } from '@/types/product';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface OrderGridCellProps {
  items: GridCellVariant[];
  mode: GridMode;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onItemAdd?: (variant: VariantWithPricing, product: ProductWithPricing, delta: number) => void;
}

function OptionLabels({ variant }: { variant: VariantWithPricing }) {
  const options = useMemo(() => {
    const ovs = (variant as any).option_values;
    if (!ovs || !Array.isArray(ovs) || ovs.length === 0) return null;
    return ovs.map((ov: any) => ({
      label: ov.label || ov.value || '',
      hexCode: ov.hex_code || null,
    }));
  }, [variant]);

  if (!options) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {options.map((opt: any, idx: number) => (
        <span key={idx} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-1 py-0.5">
          {opt.hexCode && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-black/10"
              style={{ backgroundColor: opt.hexCode }}
            />
          )}
          {opt.label}
        </span>
      ))}
    </div>
  );
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
        <div key={variant.id} className="group">
          <OptionLabels variant={variant as VariantWithPricing} />
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
  if (quantity === 0) {
    return (
      <div className="flex items-center justify-center py-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                onQuantityChange(variantId, 1);
                onItemAdd?.(variant, product, 1);
              }}
            >
              加入
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs whitespace-nowrap">
            零售 ${variant.effective_retail_price} / 批發 ${variant.effective_wholesale_price}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1 py-0.5">
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
      <span className="text-xs font-medium leading-none text-primary min-w-[16px] text-center">{quantity}</span>
      <Button
        variant="default"
        size="icon"
        className="h-5 w-5"
        onClick={() => {
          onQuantityChange(variantId, quantity + 1);
          onItemAdd?.(variant, product, 1);
        }}
      >
        <Plus className="h-2.5 w-2.5" />
      </Button>
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
