import { useCallback, useState } from "react";
import type { DeliveryType } from "@/components/shipping/DeliveryMethodPicker";
import { ShipDeliveryMap, ShipParcelDraft, EMPTY_SHIP_ADDRESS, makeEmptyParcel } from "./shippingPoolTypes";

export interface StoreWithAddress {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  recipient: string | null;
  postal_code: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
}

const makeEmptyState = (): ShipDeliveryMap[string] => ({
  delivery_type: "delivery",
  address: { ...EMPTY_SHIP_ADDRESS },
  parcels: [makeEmptyParcel()],
});

// 每家店的配送狀態 hook：類型（優先）＋地址（共享）＋包裹清單（logistics 可拆多包）
// state 依 storeId 存放，dialog 開啟／店家切換時自動補齊
export function useShipDelivery() {
  const [deliveryMap, setDeliveryMap] = useState<ShipDeliveryMap>({});
  const [appliedStoreKeys, setAppliedStoreKeys] = useState<Record<string, string>>({});

  // 確保某店家存在配送 state（缺省建立時：類型 delivery、空地址、一空包裹）
  const ensureStore = useCallback((storeId: string) => {
    setDeliveryMap((prev) => {
      if (prev[storeId]) return prev;
      return { ...prev, [storeId]: makeEmptyState() };
    });
  }, []);

  // 對話框開／店家選取時確保所有選取店家都有配送 state（由呼叫端觸發 ensureStores）
  const ensureStores = useCallback((storeIds: string[]) => {
    storeIds.forEach((sid) => ensureStore(sid));
  }, [ensureStore]);

  const setStoreType = useCallback((storeId: string, deliveryType: DeliveryType | null) => {
    setDeliveryMap((prev) => {
      const cur = prev[storeId] || makeEmptyState();
      return { ...prev, [storeId]: { ...cur, delivery_type: deliveryType } };
    });
  }, []);

  const setStoreAddress = useCallback((storeId: string, address: ShipDeliveryMap[string]["address"]) => {
    setDeliveryMap((prev) => {
      const cur = prev[storeId] || makeEmptyState();
      return { ...prev, [storeId]: { ...cur, address } };
    });
  }, []);

  // 套用店家最新地址（僅限首次 per store，避免覆寫使用者手填）
  const applyStoreAddressFromStores = useCallback((storeId: string, store?: StoreWithAddress) => {
    if (!store) return;
    setDeliveryMap((prev) => {
      const cur = prev[storeId];
      if (!cur) return prev;
      if (appliedStoreKeys[storeId] === store.code) return prev;
      setAppliedStoreKeys((m) => ({ ...m, [storeId]: store.code || storeId }));
      return {
        ...prev,
        [storeId]: {
          ...cur,
          address: {
            ...EMPTY_SHIP_ADDRESS,
            recipient: store.recipient || store.name || "",
            phone: store.phone || "",
            postal_code: store.postal_code || "",
            city: store.city || "",
            district: store.district || "",
            address: store.address || "",
          },
        },
      };
    });
  }, [appliedStoreKeys]);

  // 調整包裹數量（>=1）
  const setParcelCount = useCallback((storeId: string, count: number) => {
    const n = Math.max(1, Math.floor(count) || 1);
    setDeliveryMap((prev) => {
      const cur = prev[storeId] || makeEmptyState();
      const parcels = [...cur.parcels];
      while (parcels.length < n) parcels.push(makeEmptyParcel());
      while (parcels.length > n) parcels.pop();
      return { ...prev, [storeId]: { ...cur, parcels } };
    });
  }, []);

  const updateParcel = useCallback((storeId: string, index: number, patch: Partial<ShipParcelDraft>) => {
    setDeliveryMap((prev) => {
      const cur = prev[storeId] || makeEmptyState();
      const parcels = cur.parcels.map((p, i) => (i === index ? { ...p, ...patch } : p));
      return { ...prev, [storeId]: { ...cur, parcels } };
    });
  }, []);

  const resetStores = useCallback((storeIds: string[]) => {
    setDeliveryMap((prev) => {
      const next = { ...prev };
      storeIds.forEach((sid) => delete next[sid]);
      return next;
    });
    setAppliedStoreKeys({});
  }, []);

  return {
    deliveryMap,
    ensureStore,
    ensureStores,
    resetStores,
    setStoreType,
    setStoreAddress,
    applyStoreAddressFromStores,
    setParcelCount,
    updateParcel,
  };
}