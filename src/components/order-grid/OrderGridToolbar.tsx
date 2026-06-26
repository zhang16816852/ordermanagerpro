import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ShoppingCart, Trash2, LayoutGrid } from 'lucide-react';
import type { GridMode, GridQuantities } from '@/types/order-grid';
import { cn } from '@/lib/utils';

interface OrderGridToolbarProps {
  templateName: string;
  mode: GridMode;
  onModeChange: (mode: GridMode) => void;
  quantities: GridQuantities;
  onAddToCart: () => void;
  onClear: () => void;
  className?: string;
}

export function OrderGridToolbar({
  templateName,
  mode,
  onModeChange,
  quantities,
  onAddToCart,
  onClear,
  className,
}: OrderGridToolbarProps) {
  const totalItems = Object.values(quantities).reduce(
    (sum, qty) => sum + qty,
    0
  );
  const selectedVariants = Object.values(quantities).filter((q) => q > 0).length;

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 border rounded-lg bg-muted/30',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-medium">{templateName}</div>
          <div className="text-xs text-muted-foreground">
            {selectedVariants > 0
              ? `已選 ${selectedVariants} 項，共 ${totalItems} 件`
              : '點擊格子加入數量'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">
            按鈕模式
          </Label>
          <Switch
            checked={mode === 'input'}
            onCheckedChange={(checked) =>
              onModeChange(checked ? 'input' : 'button')
            }
          />
          <Label className="text-xs text-muted-foreground whitespace-nowrap">
            輸入模式
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={totalItems === 0}
            className="h-8"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            清空
          </Button>
          <Button
            size="sm"
            onClick={onAddToCart}
            disabled={totalItems === 0}
            className="h-8"
          >
            <ShoppingCart className="h-3.5 w-3.5 mr-1" />
            加入購物車
            {totalItems > 0 && (
              <span className="ml-1.5 bg-primary-foreground/20 px-1.5 rounded text-xs">
                {totalItems}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
