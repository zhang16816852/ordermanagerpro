import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Send } from 'lucide-react';
import { WarehouseSelector } from "@/components/WarehouseSelector";
import { DeliveryType, useDeliveryMethods, deliveryTypeOfMethod } from '@/components/shipping/DeliveryMethodPicker';
import {
  ShippingDeliveryFields, ShippingDeliveryValue,
} from '@/components/shipping/ShippingDeliveryFields';

export interface DirectShipDelivery {
  deliveryType: DeliveryType | null;
  deliveryMethodId: string | null;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export interface DirectShipItemLine {
  id: string;
  productId: string;
  variantId?: string | null;
  name: string;
  quantity: number;
}

export interface DirectShipOrderContext {
  id: string;
  code?: string | null;
  storeName?: string;
  consignmentMode?: boolean;
  deliveryType?: DeliveryType | null;
  deliveryMethodId?: string | null;
  deliveryMethodTitle?: string | null;
  defaultDeliveryMethodId?: string | null;
  items: DirectShipItemLine[];
}

interface DirectShipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: DirectShipOrderContext[];
  shippedAt: string;
  onShippedAtChange: (v: string) => void;
  notes?: string;
  onNotesChange?: (v: string) => void;
  getItemWarehouse: (itemId: string) => string;
  onItemWarehouseChange: (itemId: string, w: string) => void;
  itemSources?: Record<string, string>;
  onItemSourceChange?: (itemId: string, src: string) => void;
  isPending: boolean;
  onConfirm: (delivery: DirectShipDelivery, orderIds: string[]) => void;
}

const isLogistics = (t: DeliveryType | null) => t === 'logistics';

export function DirectShipDialog({
  open,
  onOpenChange,
  orders,
  shippedAt,
  onShippedAtChange,
  notes,
  onNotesChange,
  getItemWarehouse,
  onItemWarehouseChange,
  itemSources,
  onItemSourceChange,
  isPending,
  onConfirm,
}: DirectShipDialogProps) {
  const [delivery, setDelivery] = useState<ShippingDeliveryValue>({
    deliveryType: null,
    deliveryMethodId: null,
    trackingCompany: '',
    trackingNumber: '',
    trackingUrl: '',
  });

  const allConsignment = orders.length > 0 && orders.every((o) => o.consignmentMode);
  const orderIds = orders.map((o) => o.id);

  // 開啟時初始化：繼承第一筆訂單的配送類型與物流方式（未設定時由店家預設方式推導）
  const first = orders[0];
  const { data: deliveryMethods = [] } = useDeliveryMethods({ includeInactive: true });
  const firstRef = useRef(first);
  firstRef.current = first;
  const methodsRef = useRef(deliveryMethods);
  methodsRef.current = deliveryMethods;

  useEffect(() => {
    if (!open) return;
    const latest = firstRef.current;
    if (!latest) return;
    const defaultMethod =
      latest.defaultDeliveryMethodId
        ? methodsRef.current.find((m) => m.id === latest.defaultDeliveryMethodId)
        : undefined;
    const inherited = (latest.deliveryType as DeliveryType) || deliveryTypeOfMethod(defaultMethod) || 'delivery';
    setDelivery({
      deliveryType: inherited,
      deliveryMethodId: latest.deliveryMethodId || defaultMethod?.id || null,
      trackingCompany: latest.deliveryMethodTitle || '',
      trackingNumber: '',
      trackingUrl: '',
    });
  }, [open]);

  const handleConfirm = () => {
    onConfirm({
      deliveryType: delivery.deliveryType,
      deliveryMethodId: isLogistics(delivery.deliveryType) ? delivery.deliveryMethodId : null,
      trackingCompany: isLogistics(delivery.deliveryType) ? (delivery.trackingCompany || null) : null,
      trackingNumber: isLogistics(delivery.deliveryType) ? (delivery.trackingNumber || null) : null,
      trackingUrl: isLogistics(delivery.deliveryType) ? (delivery.trackingUrl || null) : null,
    }, orderIds);
  };

  const showItemRows = (order: DirectShipOrderContext) =>
    order.consignmentMode
      ? onItemSourceChange === undefined
      : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {allConsignment ? '寄賣出貨' : '直接轉銷貨單'}
          </DialogTitle>
          <DialogDescription>
            {allConsignment
              ? '所有品項將以寄賣模式出貨（不開立銷貨單），店家確認收貨並回報銷售後才會開收款單。'
              : '將訂單的所有剩餘品項直接出貨，跳過出貨池。出貨後訂單狀態將變為「已出貨」。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {orders.map((order) => (
            <div key={order.id} className="rounded-lg border">
              <div className="px-3 py-2 bg-muted/30 font-medium text-sm">
                {order.code || order.id} {order.storeName ? `- ${order.storeName}` : ''}
                {order.consignmentMode ? '（寄賣）' : ''}
              </div>
              {showItemRows(order) ? (
                <div className="divide-y">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.quantity}件</div>
                      </div>
                      <WarehouseSelector
                        value={getItemWarehouse(item.id)}
                        onChange={(w) => onItemWarehouseChange(item.id, w)}
                        productId={item.productId}
                        variantId={item.variantId}
                      />
                      {onItemSourceChange && (
                        <Select
                          value={itemSources?.[item.id] || 'self'}
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
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  此訂單為寄賣模式，轉出時以店家寄賣方式記錄，不扣自有庫存。
                </div>
              )}
            </div>
          ))}

          <div className="space-y-2">
            <Label>配送類型</Label>
            <ShippingDeliveryFields
              value={delivery}
              onChange={setDelivery}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>出貨時間</Label>
              <Input
                type="datetime-local"
                value={shippedAt}
                onChange={(e) => onShippedAtChange(e.target.value)}
              />
            </div>
            {onNotesChange && (
              <div className="space-y-1.5">
                <Label>備註（選填）</Label>
                <Textarea
                  value={notes || ''}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="輸入出貨備註..."
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || (isLogistics(delivery.deliveryType) && !delivery.deliveryMethodId)}
          >
            {isPending ? '處理中…' : (allConsignment ? '確認寄賣出貨' : '確認轉銷貨單')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}