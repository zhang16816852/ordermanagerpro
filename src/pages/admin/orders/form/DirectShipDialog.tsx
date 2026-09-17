import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Send } from 'lucide-react';
import { WarehouseSelector } from "@/components/WarehouseSelector";
import { OrderItemRow } from '@/components/order/orderItemsTypes';

interface DirectShipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: any;
  orderId?: string;
  items: OrderItemRow[];
  displayStoreName?: string;
  shippedAt: string;
  onShippedAtChange: (v: string) => void;
  getItemWarehouse: (id: string) => string;
  onItemWarehouseChange: (id: string, w: string) => void;
  itemSources: Record<string, string>;
  onItemSourceChange: (id: string, src: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function DirectShipDialog({
  open,
  onOpenChange,
  order,
  orderId,
  items,
  displayStoreName,
  shippedAt,
  onShippedAtChange,
  getItemWarehouse,
  onItemWarehouseChange,
  itemSources,
  onItemSourceChange,
  isPending,
  onConfirm,
}: DirectShipDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {order?.consignment_mode ? '寄賣出貨' : '直接轉銷貨單'}
          </DialogTitle>
          <DialogDescription>
            {order?.consignment_mode
              ? '將此訂單的所有剩餘品項以店家寄賣方式直接出貨，不開立銷貨單，店家確認售出後再開立。'
              : '將此訂單的所有剩餘品項直接出貨，跳過出貨池。出貨後訂單狀態將變為「已出貨」。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">訂單：</span><span className="font-medium">{order?.code || orderId}</span></div>
              <div><span className="text-muted-foreground">品項數：</span><span className="font-medium">{items.length}</span></div>
              <div><span className="text-muted-foreground">店鋪：</span><span className="font-medium">{displayStoreName}</span></div>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">出貨時間</label>
            <Input
              type="datetime-local"
              value={shippedAt}
              onChange={(e) => onShippedAtChange(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{order?.consignment_mode ? '出貨資訊' : '出貨倉（逐項）'}</label>
            {order?.consignment_mode ? (
              <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                此訂單為寄賣模式，轉出時以店家寄賣方式記錄，不扣自有庫存。
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{item.productName || item.sku || item.id.slice(0, 8)}</span>
                  <span className="text-muted-foreground w-12 text-right">{item.quantity}件</span>
                  <WarehouseSelector
                    value={getItemWarehouse(item.id)}
                    onChange={(w) => onItemWarehouseChange(item.id, w)}
                    productId={item.productId}
                    variantId={item.variantId}
                  />
                  <Select
                    value={itemSources[item.id] || "self"}
                    onValueChange={(v) => onItemSourceChange(item.id, v)}
                  >
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self">自有庫存</SelectItem>
                      <SelectItem value="supplier_consignment">供應商寄賣</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? '處理中…' : (order?.consignment_mode ? '確認寄賣出貨' : '確認轉銷貨單')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}