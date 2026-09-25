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
  // 建立模式補料：order 為 null 時，由 controller 帶入店家預設方式與目前選擇的配送類型
  defaultDeliveryMethodId?: string | null;
  deliveryType?: string | null;
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
  defaultDeliveryMethodId,
  deliveryType,
}: DirectShipDialogProps) {
  const contexts: DirectShipOrderContext[] = [
    {
      id: orderId || order?.id || '',
      code: order?.code,
      storeName: displayStoreName,
      storeId: order?.store_id ?? null,
      consignmentMode: order?.consignment_mode,
      deliveryType: order?.delivery_type ?? deliveryType ?? null,
      deliveryMethodId: order?.delivery_method_id,
      deliveryMethodTitle: order?.delivery_method_title,
      defaultDeliveryMethodId: order?.stores?.default_delivery_method_id ?? defaultDeliveryMethodId ?? null,
      shippingAddress: order?.shipping_address ? {
        recipient: order?.shipping_address?.recipient ?? '',
        phone: order?.shipping_address?.phone ?? '',
        postal_code: order?.shipping_address?.postal_code ?? '',
        city: order?.shipping_address?.city ?? '',
        district: order?.shipping_address?.district ?? '',
        address: order?.shipping_address?.address ?? '',
      } : null,
      storeAddress: order?.stores ? {
        recipient: order?.stores?.recipient ?? '',
        phone: order?.stores?.phone ?? '',
        postal_code: order?.stores?.postal_code ?? '',
        city: order?.stores?.city ?? '',
        district: order?.stores?.district ?? '',
        address: order?.stores?.address ?? '',
      } : null,
      items: items
        .filter((item) => (item.lineType ?? 'sale') !== 'return')
        .map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        name: item.productName || item.sku || item.id.slice(0, 8),
        quantity: item.quantity,
        lineType: item.lineType,
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