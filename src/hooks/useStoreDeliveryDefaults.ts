import { useCallback } from "react";
import {
  DeliveryMethodOption, DeliveryType, useDeliveryMethods, deliveryTypeOfMethod,
} from "@/components/shipping/DeliveryMethodPicker";

export interface StoreDeliveryDefaultSource {
  default_delivery_method_id?: string | null;
  default_delivery_type?: DeliveryType | null;
}

// 共用：依店家「default_delivery_type（優先）／default_delivery_method_id」解析預設配送類型與物流方式。
// 類型直接以方法型別為來源（含 inactive，保留既有方式快照之繼承）。
export function useStoreDeliveryDefaults() {
  const { data: methods = [] } = useDeliveryMethods({ includeInactive: true });

  const methodOf = useCallback(
    (defaultMethodId?: string | null): DeliveryMethodOption | null => {
      if (!defaultMethodId) return null;
      return methods.find((m) => m.id === defaultMethodId) || null;
    },
    [methods]
  );

  const typeOf = useCallback(
    (source?: StoreDeliveryDefaultSource | null): DeliveryType => {
      if (source?.default_delivery_type === "delivery" || source?.default_delivery_type === "logistics" || source?.default_delivery_type === "pickup") {
        return source.default_delivery_type;
      }
      return deliveryTypeOfMethod(methodOf(source?.default_delivery_method_id)) || "delivery";
    },
    [methodOf]
  );

  const fromStore = useCallback(
    (store?: StoreDeliveryDefaultSource | null): { method: DeliveryMethodOption | null; type: DeliveryType } => {
      return { method: methodOf(store?.default_delivery_method_id), type: typeOf(store) };
    },
    [methodOf, typeOf]
  );

  return { methods, methodOf, typeOf, fromStore };
}