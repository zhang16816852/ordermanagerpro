import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Store, Send, RotateCcw } from 'lucide-react';
import { WarehouseSelector } from '@/components/WarehouseSelector';
import { Order } from '@/types/order';
import { getDisplayProductName } from './orderListUtils';

interface ConvertToConsignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: Order[];
  selectedOrderIds: Set<string>;
  isPending: boolean;
  onConfirm: () => void;
}

export function ConvertToConsignmentDialog({
  open,
  onOpenChange,
  orders,
  selectedOrderIds,
  isPending,
  onConfirm,
}: ConvertToConsignmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            轉寄賣（草稿）
          </DialogTitle>
          <DialogDescription>
            將所選訂單標記為寄賣模式並建立「未出貨」的寄賣草稿（不扣庫存、不開銷貨單）；可至寄賣管理調整品項後再出貨。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border divide-y max-h-96 overflow-y-auto">
          {orders.filter(o => selectedOrderIds.has(o.id)).map(order => (
            <div key={order.id} className="flex items-center justify-between px-3 py-2">
              <div className="text-sm font-medium">{order.code} - {order.stores?.name || '未知店家'}</div>
              <div className="text-xs text-muted-foreground">{order.order_items.filter(i => i.status !== 'cancelled' && i.status !== 'discontinued' && (i.quantity - i.shipped_quantity) > 0).length} 個品項待轉寄賣（未出貨）</div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? '處理中...' : '確認轉寄賣'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DirectShipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: Order[];
  selectedOrderIds: Set<string>;
  allSelectedConsignment: boolean;
  directShipAt: string;
  onDirectShipAtChange: (v: string) => void;
  directShipNotes: string;
  onDirectShipNotesChange: (v: string) => void;
  getItemWarehouse: (itemId: string) => string;
  onItemWarehouseChange: (itemId: string, warehouseId: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function DirectShipDialog({
  open,
  onOpenChange,
  orders,
  selectedOrderIds,
  allSelectedConsignment,
  directShipAt,
  onDirectShipAtChange,
  directShipNotes,
  onDirectShipNotesChange,
  getItemWarehouse,
  onItemWarehouseChange,
  isPending,
  onConfirm,
}: DirectShipDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {allSelectedConsignment ? '寄賣出貨' : '直接轉銷貨單'}
          </DialogTitle>
          <DialogDescription>
            {allSelectedConsignment
              ? '所有品項將以寄賣模式出貨（不開立銷貨單），店家確認收貨並回報銷售後才會開收款單。'
              : '為每個品項選擇出貨倉庫，所有剩餘數量將全額出貨。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">出貨時間</label>
              <Input
                type="datetime-local"
                value={directShipAt}
                onChange={(e) => onDirectShipAtChange(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">備註（選填）</label>
              <Textarea
                value={directShipNotes}
                onChange={(e) => onDirectShipNotesChange(e.target.value)}
                placeholder="輸入出貨備註..."
                className="mt-1"
              />
            </div>
          </div>
          <div className="rounded-lg border divide-y max-h-96 overflow-y-auto">
            {orders.filter(o => selectedOrderIds.has(o.id)).map(order => (
              <div key={order.id}>
                <div className="px-3 py-2 bg-muted/30 font-medium text-sm">{order.code} - {order.stores?.name || '未知店家'}</div>
                <div className="divide-y">
                  {order.order_items
                    .filter(item => item.status !== 'cancelled' && item.status !== 'discontinued' && (item.quantity - item.shipped_quantity) > 0)
                    .map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{getDisplayProductName(item.product?.name, item.product_variant?.name)}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.product?.code} × {item.quantity - item.shipped_quantity}
                          </div>
                        </div>
                        <WarehouseSelector
                          value={getItemWarehouse(item.id)}
                          onChange={(w) => onItemWarehouseChange(item.id, w)}
                          productId={item.product_id}
                          variantId={item.variant_id}
                        />
                      </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? '處理中...' : allSelectedConsignment ? '確認寄賣出貨' : '確認轉銷貨單'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReverseShipmentDialogProps {
  open: boolean;
  target: { order: Order; consignmentOrderId: string } | null;
  onOpenChange: (open: boolean) => void;
  note: string;
  onNoteChange: (v: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function ReverseShipmentDialog({
  open,
  target,
  onOpenChange,
  note,
  onNoteChange,
  isPending,
  onConfirm,
}: ReverseShipmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-destructive" />
            回滾出貨（{target?.order.code}）
          </DialogTitle>
          <DialogDescription>
            將此寄賣訂單的出貨整單回滾：扣回已出貨數量、品項放回出貨池，寄賣單退回草稿狀態。店家尚未確認收貨時才能執行。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>備註（選填）</Label>
          <Textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="輸入回滾原因"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending || !target}>
            {isPending ? '處理中...' : '確認回滾出貨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}