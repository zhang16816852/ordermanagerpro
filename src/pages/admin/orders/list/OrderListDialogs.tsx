import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Store, RotateCcw } from 'lucide-react';
import { Order } from '@/types/order';
import { DeliveryType } from '@/components/shipping/DeliveryMethodPicker';
import { isReturnLine } from './orderListUtils';
import {
  DirectShipDialog as SharedDirectShipDialog,
  DirectShipDelivery, DirectShipOrderContext, DirectShipItemLine,
} from '@/components/orders/DirectShipDialog';

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
              <div className="text-xs text-muted-foreground">{order.order_items.filter(i => !isReturnLine(i) && i.status !== 'cancelled' && i.status !== 'discontinued' && (i.quantity - i.shipped_quantity) > 0).length} 個品項待轉寄賣（未出貨）</div>
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
  directShipAt: string;
  onDirectShipAtChange: (v: string) => void;
  directShipNotes: string;
  onDirectShipNotesChange: (v: string) => void;
  getItemWarehouse: (itemId: string) => string;
  onItemWarehouseChange: (itemId: string, warehouseId: string) => void;
  isPending: boolean;
  onConfirm: (delivery: DirectShipDelivery) => void;
}

export function DirectShipDialog({
  open,
  onOpenChange,
  orders,
  selectedOrderIds,
  directShipAt,
  onDirectShipAtChange,
  directShipNotes,
  onDirectShipNotesChange,
  getItemWarehouse,
  onItemWarehouseChange,
  isPending,
  onConfirm,
}: DirectShipDialogProps) {
  const contexts: DirectShipOrderContext[] = orders
    .filter((o) => selectedOrderIds.has(o.id))
    .map((order) => ({
      id: order.id,
      code: order.code,
      storeName: order.stores?.name || undefined,
      storeId: order.store_id || null,
      consignmentMode: order.consignment_mode,
      deliveryType: (order.delivery_type as DeliveryType) || null,
      deliveryMethodId: order.delivery_method_id,
      deliveryMethodTitle: order.delivery_method_title,
      defaultDeliveryMethodId: order.stores?.default_delivery_method_id || null,
      shippingAddress: order.shipping_address ? {
        recipient: order.shipping_address.recipient || '',
        phone: order.shipping_address.phone || '',
        postal_code: order.shipping_address.postal_code || '',
        city: order.shipping_address.city || '',
        district: order.shipping_address.district || '',
        address: order.shipping_address.address || '',
      } : null,
      storeAddress: order.stores
        ? {
            recipient: order.stores.recipient || '',
            phone: order.stores.phone || '',
            postal_code: order.stores.postal_code || '',
            city: order.stores.city || '',
            district: order.stores.district || '',
            address: order.stores.address || '',
          }
        : null,
      items: order.order_items
        .filter((item) => item.status !== 'cancelled' && item.status !== 'discontinued' && (item.quantity - item.shipped_quantity) > 0)
        .map((item) => ({
          id: item.id,
          productId: item.product_id,
          variantId: item.variant_id,
          name: item.product_variant?.name || item.product?.name || item.id,
          quantity: item.quantity - item.shipped_quantity,
          lineType: (item.line_type as DirectShipItemLine['lineType']) ?? 'sale',
        })),
    }));

  return (
    <SharedDirectShipDialog
      open={open}
      onOpenChange={onOpenChange}
      orders={contexts}
      shippedAt={directShipAt}
      onShippedAtChange={onDirectShipAtChange}
      notes={directShipNotes}
      onNotesChange={onDirectShipNotesChange}
      getItemWarehouse={getItemWarehouse}
      onItemWarehouseChange={onItemWarehouseChange}
      isPending={isPending}
      onConfirm={(delivery) => onConfirm(delivery)}
    />
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