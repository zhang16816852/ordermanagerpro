import { Button } from "@/components/ui/button";
import { MobileFooter } from '@/components/layout/MobileFooter';
import { Truck, Undo2 } from "lucide-react";

interface ShippingPoolMobileFootersProps {
  rollbackCount: number;
  isRollbackPending: boolean;
  onRollback: () => void;
  storeCount: number;
  totalQuantity: number;
  isShipPending: boolean;
  onOpenShipDialog: () => void;
}

export function ShippingPoolMobileFooters({
  rollbackCount,
  isRollbackPending,
  onRollback,
  storeCount,
  totalQuantity,
  isShipPending,
  onOpenShipDialog,
}: ShippingPoolMobileFootersProps) {
  return (
    <>
      {/* Mobile rollback-to-order footer */}
      <MobileFooter visible={rollbackCount > 0}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">已選擇 {rollbackCount} 個品項</p>
            <p className="text-xs text-muted-foreground">移出出貨池並回滾為待出貨</p>
          </div>
          <Button
            variant="destructive"
            onClick={onRollback}
            disabled={isRollbackPending}
            className="shrink-0"
          >
            <Undo2 className="h-4 w-4 mr-2" />
            {isRollbackPending ? "處理中..." : "回滾成訂單"}
          </Button>
        </div>
      </MobileFooter>

      {/* Mobile Ship Footer */}
      <MobileFooter visible={storeCount > 0}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">已選擇 {storeCount} 店家</p>
            <p className="text-xs text-muted-foreground">{totalQuantity} 件商品</p>
          </div>
          <Button
            onClick={onOpenShipDialog}
            disabled={isShipPending}
            className="shrink-0"
          >
            <Truck className="h-4 w-4 mr-2" />
            確認出貨
          </Button>
        </div>
      </MobileFooter>
    </>
  );
}