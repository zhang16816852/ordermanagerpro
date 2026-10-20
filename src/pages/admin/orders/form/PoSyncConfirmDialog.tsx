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
import type { PoSyncChange } from './useOrderFormMutations';

interface PoSyncConfirmDialogProps {
  open: boolean;
  changes: PoSyncChange[];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function labelOf(change: PoSyncChange) {
  const name = change.variant_name || change.product_name || '未命名品項';
  return `${name}（${change.purchase_order_code}）`;
}

export function PoSyncConfirmDialog({ open, changes, isPending, onOpenChange, onConfirm }: PoSyncConfirmDialogProps) {
  const hasIncrease = changes.some((c) => c.new_quantity > c.old_quantity);
  const hasDecrease = changes.some((c) => c.new_quantity < c.old_quantity);
  const title = hasIncrease && hasDecrease
    ? '是否調整採購單數量？'
    : hasIncrease
      ? '是否要增補採購？'
      : '是否要調降採購數量？';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            以下採購單品項數量會隨此次訂單變更同步調整：
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-60 space-y-2 overflow-y-auto text-sm">
          {changes.map((change) => (
            <div key={change.purchase_order_item_id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="truncate">{labelOf(change)}</span>
              <span className="whitespace-nowrap tabular-nums">
                原為 {change.old_quantity}
                {change.action === 'remove' ? '，將移除該品項' : ` 調整為 ${change.new_quantity}`}
              </span>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>不調整</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {isPending ? '處理中…' : '確認調整'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
