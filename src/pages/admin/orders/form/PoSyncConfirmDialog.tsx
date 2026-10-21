import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import type { PoSyncChange } from './useOrderFormMutations';

interface PoSyncConfirmDialogProps {
  open: boolean;
  changes: PoSyncChange[];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (overrides: Record<string, number>) => void;
}

function labelOf(change: PoSyncChange) {
  const name = change.variant_name || change.product_name || '未命名品項';
  return `${name}（${change.purchase_order_code}）`;
}

export function PoSyncConfirmDialog({ open, changes, isPending, onOpenChange, onConfirm }: PoSyncConfirmDialogProps) {
  const [adjusted, setAdjusted] = useState<Record<string, number>>({});

  // 每次 changes 變動時，以系統計算的 new_quantity 重新填滿輸入框
  useEffect(() => {
    const next: Record<string, number> = {};
    changes.forEach((c) => {
      if (c.action === 'update') next[c.purchase_order_item_id] = c.new_quantity;
    });
    setAdjusted(next);
  }, [changes]);

  const hasIncrease = changes.some((c) => c.new_quantity > c.old_quantity);
  const hasDecrease = changes.some((c) => c.new_quantity < c.old_quantity);
  const title = hasIncrease && hasDecrease
    ? '是否調整採購單數量？'
    : hasIncrease
      ? '是否要增補採購？'
      : '是否要調降採購數量？';

  const handleConfirm = () => {
    onConfirm(adjusted);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            以下採購單品項數量會隨此次訂單變更同步調整（可手動調整目標數量）：
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-60 space-y-2 overflow-y-auto text-sm">
          {changes.map((change) => (
            <div key={change.purchase_order_item_id} className="flex flex-col gap-2 rounded-md border px-3 py-2">
              <span className="truncate font-medium">{labelOf(change)}</span>
              {change.action === 'remove' ? (
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                  原本數量 {change.old_quantity}，將移除該品項
                </span>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">原本數量</span>
                    <span className="tabular-nums font-medium">{change.old_quantity}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">已採購數量</span>
                    <span className="tabular-nums font-medium">{change.old_share}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">調整採購數量</span>
                    <Input
                      type="number"
                      min={0}
                      className="h-7 w-full text-right"
                      value={adjusted[change.purchase_order_item_id] ?? change.new_quantity}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setAdjusted((prev) => ({
                          ...prev,
                          [change.purchase_order_item_id]: Number.isNaN(v) ? change.new_quantity : Math.max(0, v),
                        }));
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>不調整</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
          >
            {isPending ? '處理中…' : '確認調整'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}