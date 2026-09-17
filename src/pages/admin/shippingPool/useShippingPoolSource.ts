import { useState } from "react";

// 出貨來源：sc = 供應商寄賣（FIFO）；wh:{id} = 自有倉庫
export function useShippingPoolSource(defaultWarehouseId?: string) {
  const [warehouseMap, setWarehouseMap] = useState<Record<string, string>>({});
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});

  const getItemWarehouse = (orderItemId: string) => warehouseMap[orderItemId] || defaultWarehouseId || '';
  const getItemSource = (orderItemId: string) => sourceMap[orderItemId] || 'self';

  const getSourceValue = (orderItemId: string) =>
    getItemSource(orderItemId) === 'supplier_consignment'
      ? 'sc'
      : `wh:${getItemWarehouse(orderItemId)}`;

  const setSourceValue = (orderItemId: string, value: string) => {
    if (value === 'sc') {
      setSourceMap(prev => ({ ...prev, [orderItemId]: 'supplier_consignment' }));
      setWarehouseMap(prev => {
        const next = { ...prev };
        delete next[orderItemId];
        return next;
      });
    } else if (value.startsWith('wh:')) {
      const warehouseId = value.slice(3);
      setWarehouseMap(prev => ({ ...prev, [orderItemId]: warehouseId }));
      setSourceMap(prev => ({ ...prev, [orderItemId]: 'self' }));
    }
  };

  return {
    warehouseMap,
    sourceMap,
    setWarehouseMap,
    setSourceMap,
    getSourceValue,
    setSourceValue,
  };
}