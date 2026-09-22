import { OrderItemRow } from '@/components/order/orderItemsTypes';
import {
  DirectShipDialog as SharedDirectShipDialog,
  DirectShipDelivery, DirectShipOrderContext,
} from '@/components/orders/DirectShipDialog';

export type { DirectShipDelivery };

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
  onConfirm: (delivery: DirectShipDelivery) => void;
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
  const contexts: DirectShipOrderContext[] = [
    {
      id: orderId || order?.id || '',
      code: order?.code,
      storeName: displayStoreName,
      consignmentMode: order?.consignment_mode,
      deliveryType: order?.delivery_type || null,
      deliveryMethodId: order?.delivery_method_id,
      deliveryMethodTitle: order?.delivery_method_title,
      defaultDeliveryMethodId: order?.stores?.default_delivery_method_id || null,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        name: item.productName || item.sku || item.id.slice(0, 8),
        quantity: item.quantity,
      })),
    },
  ];

  return (
    <SharedDirectShipDialog
      open={open}
      onOpenChange={onOpenChange}
      orders={contexts}
      shippedAt={shippedAt}
      onShippedAtChange={onShippedAtChange}
      getItemWarehouse={getItemWarehouse}
      onItemWarehouseChange={onItemWarehouseChange}
      itemSources={itemSources}
      onItemSourceChange={onItemSourceChange}
      isPending={isPending}
      onConfirm={(delivery) => onConfirm(delivery)}
    />
  );
}