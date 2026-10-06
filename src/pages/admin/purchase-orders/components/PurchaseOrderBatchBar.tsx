import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  ClipboardCheck,
  PackageCheck,
  Wallet,
  X,
  Loader2,
} from 'lucide-react';

interface PurchaseOrderBatchBarProps {
  batchMode: boolean;
  onBatchModeChange: (v: boolean) => void;
  selectedCount: number;
  /** 選取中可下單（draft）張數 */
  orderableCount: number;
  /** 選取中可收貨張數 */
  receivableCount: number;
  /** 選取中可合併付款張數（已付清者不計） */
  payableCount: number;
  /** 合併付款是否可用（同供應商且有未付） */
  canPay: boolean;
  isOrdering: boolean;
  isReceiving: boolean;
  isPaying?: boolean;
  onOrder: () => void;
  onReceive: () => void;
  onPay: () => void;
  onClear: () => void;
}

/**
 * 批次操作列。
 *
 * ⚠️ 刻意**不提供批次取消／批次刪除**：後者會牽動
 * `delete_purchase_order_if_empty` 的守門（已收貨／已有庫存異動／已有會計分錄），
 * 且逐張刪除無法給出整批的原子性，寧可讓使用者逐張明確操作。
 */
export function PurchaseOrderBatchBar({
  batchMode,
  onBatchModeChange,
  selectedCount,
  orderableCount,
  receivableCount,
  payableCount,
  canPay,
  isOrdering,
  isReceiving,
  isPaying = false,
  onOrder,
  onReceive,
  onPay,
  onClear,
}: PurchaseOrderBatchBarProps) {
  // 任一批次 mutation 在途都要鎖住整條操作列（含切換批次模式與清除選取），
  // 避免使用者中途改選取集合導致「送出時的選取」與「畫面上的選取」不一致。
  const pending = isOrdering || isReceiving || isPaying;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Switch
          id="po-batch-mode"
          checked={batchMode}
          onCheckedChange={onBatchModeChange}
          disabled={pending}
        />
        <Label htmlFor="po-batch-mode" className="text-sm">
          批次模式
        </Label>
      </div>

      {batchMode && (
        <>
          <span className="text-sm text-muted-foreground">
            已選 <strong className="text-foreground">{selectedCount}</strong> 張
          </span>

          <Button size="sm" variant="outline" onClick={onOrder} disabled={pending || orderableCount === 0}>
            {isOrdering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ClipboardCheck className="h-4 w-4 mr-1" />}
            批次下單{orderableCount > 0 ? `（${orderableCount}）` : ''}
          </Button>

          <Button size="sm" variant="outline" onClick={onReceive} disabled={pending || receivableCount === 0}>
            {isReceiving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-1" />}
            批次收貨{receivableCount > 0 ? `（${receivableCount}）` : ''}
          </Button>

          <Button size="sm" variant="outline" onClick={onPay} disabled={pending || !canPay}>
            <Wallet className="h-4 w-4 mr-1" />
            合併付款{payableCount > 0 ? `（${payableCount}）` : ''}
          </Button>

          <Button size="sm" variant="ghost" onClick={onClear} disabled={pending || selectedCount === 0}>
            <X className="h-4 w-4 mr-1" />
            清除選取
          </Button>
        </>
      )}
    </div>
  );
}