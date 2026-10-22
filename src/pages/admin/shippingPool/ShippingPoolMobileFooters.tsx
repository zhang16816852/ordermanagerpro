import { Button } from "@/components/ui/button";
import { MobileFooter } from '@/components/layout/MobileFooter';
import { Truck, Undo2 } from "lucide-react";

type ShippingPoolMobileAction = 'rollback' | 'ship';

interface ShippingPoolMobileFootersProps {
  actionType: ShippingPoolMobileAction | null;
  count: number;
  isPending: boolean;
  onAction: () => void;
}

export function ShippingPoolMobileFooters({
  actionType,
  count,
  isPending,
  onAction,
}: ShippingPoolMobileFootersProps) {
  if (!actionType) return null;

  const isRollback = actionType === 'rollback';

  return (
    <MobileFooter visible={count > 0}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">
            {isRollback ? `已選擇 ${count} 個品項` : `已選擇 ${count} 店家`}
          </p>
          <p className="text-xs text-muted-foreground">
            {isRollback
              ? "移出出貨池並回滾為待出貨（已出貨訂單的殘留亦一併清除）"
              : "合併為銷售單後出貨"}
          </p>
        </div>
        <Button
          variant={isRollback ? "destructive" : "default"}
          onClick={onAction}
          disabled={isPending}
          className="shrink-0"
        >
          {isRollback ? (
            <>
              <Undo2 className="h-4 w-4 mr-2" />
              {isPending ? "處理中..." : "回滾成訂單"}
            </>
          ) : (
            <>
              <Truck className="h-4 w-4 mr-2" />
              {isPending ? "處理中..." : "確認出貨"}
            </>
          )}
        </Button>
      </div>
    </MobileFooter>
  );
}
