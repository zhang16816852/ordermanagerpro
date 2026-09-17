import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Order } from '@/types/order';
import { getDisplayProductName, getAggregateItemKey } from './orderListUtils';
import type {
  AggregateSelectionItem,
  ItemsSelectionItem,
} from './orderListTypes';

export function useOrderListSelections() {
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Map<string, ItemsSelectionItem>>(new Map());
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [shipToPoolOpen, setShipToPoolOpen] = useState(false);
  const [orderPoolOpen, setOrderPoolOpen] = useState(false);
  const [convertToConsignmentOpen, setConvertToConsignmentOpen] = useState(false);
  const [reverseShipmentOrder, setReverseShipmentOrder] = useState<{ order: Order; consignmentOrderId: string } | null>(null);
  const [reverseNote, setReverseNote] = useState('');
  const [directShipDialogOpen, setDirectShipDialogOpen] = useState(false);
  const [directShipNotes, setDirectShipNotes] = useState('');
  const [directShipAt, setDirectShipAt] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [itemWarehouses, setItemWarehouses] = useState<Record<string, string>>({});
  const [convertToPOOpen, setConvertToPOOpen] = useState(false);
  const [selectedAggregateItems, setSelectedAggregateItems] = useState<Map<string, AggregateSelectionItem>>(new Map());

  const defaultWarehouseIdResolver = (itemId: string, defaultWarehouseId?: string) =>
    itemWarehouses[itemId] || defaultWarehouseId || '';

  // Grouped Selections for Dialog (單筆品項轉出貨池用，依店家分組)
  const groupedSelections = useMemo(() => {
    return Array.from(selectedItems.values()).reduce((acc, item) => {
      if (!acc[item.storeId]) {
        acc[item.storeId] = { storeName: item.storeName, items: [] };
      }
      acc[item.storeId].items.push(item);
      return acc;
    }, {} as Record<string, { storeName: string; items: any[] }>);
  }, [selectedItems]);

  const handleItemToggleSelection = (item: any, checked: boolean) => {
    const next = new Map(selectedItems);
    if (checked) {
      next.set(item.id, {
        itemId: item.id,
        productName: getDisplayProductName(item.product?.name, item.product_variant?.name),
        sku: item.product?.code || '',
        quantity: item.pendingQuantity,
        maxQuantity: item.pendingQuantity,
        storeId: item.storeId,
        storeName: item.storeName,
        orderId: item.orderId,
      });
    } else next.delete(item.id);
    setSelectedItems(next);
  };

  const handleItemToggleAll = (checked: boolean, allPendingItems: any[]) => {
    if (checked) {
      const next = new Map<string, ItemsSelectionItem>();
      allPendingItems.forEach(item => {
        next.set(item.id, {
          itemId: item.id,
          productName: getDisplayProductName(item.product?.name, item.product_variant?.name),
          sku: item.product?.code || '',
          quantity: item.pendingQuantity,
          maxQuantity: item.pendingQuantity,
          storeId: item.storeId,
          storeName: item.storeName,
          orderId: item.orderId,
        });
      });
      setSelectedItems(next);
    } else setSelectedItems(new Map());
  };

  const handleUpdateItemQuantity = (id: string, qty: number) => {
    const next = new Map(selectedItems);
    const item = next.get(id);
    if (item) {
      next.set(id, { ...item, quantity: Math.min(Math.max(1, qty), item.maxQuantity) });
      setSelectedItems(next);
    }
  };

  const handleToggleAggregateSelection = (item: { productId: string; variantId: string | null; totalPendingQuantity: number; productName: string; variantName?: string | null; sku: string; sourceOrderIds: string[]; sourceQuantities: Record<string, number> }, checked: boolean) => {
    const key = getAggregateItemKey(item.productId, item.variantId);
    setSelectedAggregateItems(prev => {
      const next = new Map(prev);
      if (checked) {
        next.set(key, {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.totalPendingQuantity,
          maxQuantity: item.totalPendingQuantity,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          sourceOrderIds: item.sourceOrderIds,
          sourceQuantities: item.sourceQuantities,
        });
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const handleToggleAllAggregate = (checked: boolean, aggregatedItems: any[]) => {
    if (checked) {
      const next = new Map<string, AggregateSelectionItem>();
      aggregatedItems.forEach(item => {
        next.set(getAggregateItemKey(item.productId, item.variantId), {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.totalPendingQuantity,
          maxQuantity: item.totalPendingQuantity,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          sourceOrderIds: item.sourceOrderIds,
          sourceQuantities: item.sourceQuantities,
        });
      });
      setSelectedAggregateItems(next);
    } else {
      setSelectedAggregateItems(new Map());
    }
  };

  const handleUpdateAggregateQuantity = (key: string, quantity: number) => {
    setSelectedAggregateItems(prev => {
      const next = new Map(prev);
      const item = next.get(key);
      if (item) {
        next.set(key, { ...item, quantity: Math.min(Math.max(1, quantity), item.maxQuantity) });
      }
      return next;
    });
  };

  return {
    selectedOrderIds,
    setSelectedOrderIds,
    selectedItems,
    setSelectedItems,
    viewingOrder,
    setViewingOrder,
    shipToPoolOpen,
    setShipToPoolOpen,
    orderPoolOpen,
    setOrderPoolOpen,
    convertToConsignmentOpen,
    setConvertToConsignmentOpen,
    reverseShipmentOrder,
    setReverseShipmentOrder,
    reverseNote,
    setReverseNote,
    directShipDialogOpen,
    setDirectShipDialogOpen,
    directShipNotes,
    setDirectShipNotes,
    directShipAt,
    setDirectShipAt,
    itemWarehouses,
    setItemWarehouses,
    convertToPOOpen,
    setConvertToPOOpen,
    selectedAggregateItems,
    setSelectedAggregateItems,
    defaultWarehouseIdResolver,
    groupedSelections,
    handleItemToggleSelection,
    handleItemToggleAll,
    handleUpdateItemQuantity,
    handleToggleAggregateSelection,
    handleToggleAllAggregate,
    handleUpdateAggregateQuantity,
  };
}