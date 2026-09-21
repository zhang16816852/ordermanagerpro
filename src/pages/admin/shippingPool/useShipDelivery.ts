import { useCallback, useRef, useState } from "react";
import { useDeliveryMethods, DeliveryMethodOption } from "@/components/shipping/DeliveryMethodPicker";
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

// 每家店的配送狀態 hook：地址（共享）＋包裹清單（可拆多包）
// state 依 storeId 存放，dialog 開啟／店家切換時自動補齊
export function useShipDelivery() {
  const { data: deliveryMethods } = useDeliveryMethods();
  const [deliveryMap, setDeliveryMap] = useState<ShipDeliveryMap>({});
  const [appliedStoreKeys, setAppliedStoreKeys] = useState<Record<string, string>>({});
  const methodsRef = useRef<DeliveryMethodOption[]>([]);
  methodsRef.current = deliveryMethods || [];

  const defaultMethodId = useCallback((): string | null => {
    const d = methodsRef.current.find((m) => m.is_default && m.type === "delivery");
    return d?.id ?? null;
  }, []);

  // 確保某店家存在配送 state（缺省建立時用預設配送方式、空地址）
  const ensureStore = useCallback((storeId: string) => {
    setDeliveryMap((prev) => {
      if (prev[storeId]) return prev;
      return { ...prev, [storeId]: { address: { ...EMPTY_SHIP_ADDRESS }, parcels: [makeEmptyParcel(defaultMethodId())] } };
    });
  }, [defaultMethodId]);

  // 對話框開／店家選取時確保所有選取店家都有配送 state（由呼叫端觸發 ensureStores）

  const ensureStores = useCallback((storeIds: string[]) => {
    storeIds.forEach((sid) => ensureStore(sid));
  }, [ensureStore]);

  const setStoreAddress = useCallback((storeId: string, address: ShipDeliveryMap[string]["address"]) => {
    setDeliveryMap((prev) => {
      const cur = prev[storeId] || { address: { ...EMPTY_SHIP_ADDRESS }, parcels: [makeEmptyParcel()] };
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
      const cur = prev[storeId] || { address: { ...EMPTY_SHIP_ADDRESS }, parcels: [] };
      const parcels = [...cur.parcels];
      while (parcels.length < n) parcels.push(makeEmptyParcel(defaultMethodId()));
      while (parcels.length > n) parcels.pop();
      return { ...prev, [storeId]: { ...cur, parcels } };
    });
  }, [defaultMethodId]);

  const updateParcel = useCallback((storeId: string, index: number, patch: Partial<ShipParcelDraft>) => {
    setDeliveryMap((prev) => {
      const cur = prev[storeId] || { address: { ...EMPTY_SHIP_ADDRESS }, parcels: [] };
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
    deliveryMethods: deliveryMethods || [],
    deliveryMap,
    ensureStore,
    ensureStores,
    resetStores,
    setStoreAddress,
    applyStoreAddressFromStores,
    setParcelCount,
    updateParcel,
  };
}