// src/stores/useOrderDraftStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ProductWithPricing, VariantWithPricing } from "@/types/product";
import { supabase } from "@/integrations/supabase/client";

interface AddonBindingEntry {
  id: string;
  parent_product_id: string;
  parent_variant_id: string | null;
  addon_product_id: string;
  addon_variant_id: string | null;
  quantity: number;
  sort_order: number;
  addon_product?: {
    id: string;
    name: string;
    code: string | null;
    wholesale_price: number | null;
    retail_price: number | null;
  } | null;
  addon_variant?: {
    id: string;
    name: string | null;
    sku: string | null;
    wholesale_price: number | null;
  } | null;
}

let addonBindingsCache: AddonBindingEntry[] | null = null;
let addonBindingsPromise: Promise<AddonBindingEntry[]> | null = null;

function ensureAddonBindings(): Promise<AddonBindingEntry[]> {
  if (addonBindingsCache) return Promise.resolve(addonBindingsCache);
  if (addonBindingsPromise) return addonBindingsPromise;
  addonBindingsPromise = (async () => {
    const { data, error } = await (supabase as any)
      .from('product_addon_bindings')
      .select(`
        id, parent_product_id, parent_variant_id, addon_product_id, addon_variant_id, quantity, sort_order,
        addon_product:products(id, name, code, wholesale_price, retail_price),
        addon_variant:product_variants(id, name, sku, wholesale_price)
      `)
      .order('sort_order');
    if (error) throw error;
    addonBindingsCache = (data || []) as AddonBindingEntry[];
    setTimeout(() => { addonBindingsCache = null; addonBindingsPromise = null; }, 5 * 60 * 1000);
    return addonBindingsCache;
  })();
  return addonBindingsPromise;
}

// A+B 加購：加入父品後自動帶出綁定的加購子行（temp_key / parent_temp_key 串接，供出貨 RPC 兩輪對應）
function enqueueAddons(storeId: string, product: ProductWithPricing, variant?: VariantWithPricing, parentTempKey?: string) {
  ensureAddonBindings().then((bindings) => {
    const relevant = bindings.filter(b =>
      b.parent_product_id === product.id &&
      (!b.parent_variant_id || (variant && b.parent_variant_id === variant.id))
    );
    if (relevant.length === 0) return;
    for (const b of relevant) {
      const childKey = `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const child: any = {
        id: b.addon_product_id,
        name: b.addon_product?.name || '',
        code: b.addon_product?.code,
        item_type: 'packaging',
        temp_key: childKey,
        parent_temp_key: parentTempKey,
      };
      const childVariant: any = b.addon_variant_id && b.addon_variant
        ? {
            id: b.addon_variant_id,
            name: b.addon_variant.name || '',
            sku: b.addon_variant.sku || '',
            wholesale_price: b.addon_variant.wholesale_price ?? b.addon_product?.wholesale_price ?? 0,
            option_values: [],
          }
        : b.addon_product
          ? {
              id: b.addon_product_id,
              name: b.addon_product.name,
              sku: b.addon_product.code || '',
              wholesale_price: b.addon_product.wholesale_price ?? b.addon_product.retail_price ?? 0,
            }
          : undefined;
      for (let i = 0; i < Math.max(1, b.quantity || 1); i++) {
        useOrderDraftStore.getState().addItem(
          storeId,
          child as unknown as ProductWithPricing,
          childVariant as unknown as VariantWithPricing | undefined,
          undefined,
          `addon:${b.id}`,
        );
      }
    }
  }).catch(() => { /* 綁定查詢失敗時僅加入父品 */ });
}

export interface OrderDraftItem {
  id: string; // unique key: `${productId}-${variantId || 'base'}` or customItemId
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  productName: string;
  variantName?: string;
  options?: string[];
  selectedModelName?: string;
  itemType?: 'product' | 'shipping' | 'packaging' | 'repair_part';
  unitCost?: number;
  shippingPayment?: string | null;
  tempKey?: string;
  parentTempKey?: string;
}

export interface OrderDraft {
  items: OrderDraftItem[];
  notes: string;
  priceSyncMap: Record<string, boolean>;
  updatedAt: number;
}

interface OrderDraftState {
  // 以 storeId 為 key 的草稿 map
  drafts: Record<string, OrderDraft>;

  // 取得特定店鋪的草稿
  getDraft: (storeId: string) => OrderDraft;

  // 新增商品到購物車
  addItem: (
    storeId: string,
    product: ProductWithPricing,
    variant?: VariantWithPricing,
    selectedModelName?: string,
    customItemId?: string
  ) => void;

  // 更新數量
  updateQuantity: (storeId: string, itemId: string, quantity: number) => void;

  // 更新單價
  updateItemPrice: (storeId: string, itemId: string, price: number) => void;

  // 取代整個 items 陣列（拖曳排序後）
  reorderItems: (storeId: string, items: OrderDraftItem[]) => void;

  // 取代 priceSyncMap
  setPriceSyncMap: (storeId: string, map: Record<string, boolean>) => void;

  // 移除商品
  removeItem: (storeId: string, itemId: string) => void;

  // 更新備註
  updateNotes: (storeId: string, notes: string) => void;

  // 清空購物車
  clearDraft: (storeId: string) => void;

  // 計算方法
  getTotalItems: (storeId: string) => number;
  getTotalAmount: (storeId: string) => number;
  getItemQuantity: (storeId: string, productId: string, variantId?: string) => number;
  getTotalProductQuantity: (storeId: string, productId: string) => number;
}

const createEmptyDraft = (): OrderDraft => ({
  items: [],
  notes: "",
  priceSyncMap: {},
  updatedAt: Date.now(),
});

const generateItemId = (productId: string, variantId?: string): string => {
  return `${productId}-${variantId || "base"}`;
};

export const useOrderDraftStore = create<OrderDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},

      getDraft: (storeId) => {
        return get().drafts[storeId] || createEmptyDraft();
      },

      addItem: (storeId, product, variant, selectedModelName, customItemId) => {
        set((state) => {
          const draft = state.drafts[storeId] || createEmptyDraft();
          
          const isVirtual = 'physical_product_id' in product;
          const realProductId = isVirtual ? (product as any).physical_product_id : product.id;
          const fallbackVariantId = isVirtual ? (product as any).physical_variant_id : undefined;
          const realVariantId = fallbackVariantId ?? variant?.id ?? undefined;
          const realModelName = isVirtual ? (product as any).device_model_name : (selectedModelName || (variant as any)?.effective_model_names?.[0]);
          const itemId = customItemId || (
            isVirtual && !fallbackVariantId
              ? generateItemId(product.id, realVariantId)
              : isVirtual
                ? product.id
                : generateItemId(product.id, variant?.id)
          );

          const existingIndex = draft.items.findIndex((item) => item.id === itemId);

          let newItems: OrderDraftItem[];

          if (existingIndex > -1) {
            // 已存在，增加數量
            newItems = draft.items.map((item, index) =>
              index === existingIndex
                ? { ...item, quantity: item.quantity + 1 }
                : item
            );
          } else {
            // 新增項目
            const newItem: OrderDraftItem = {
              id: itemId,
              productId: realProductId,
              productName: isVirtual ? (product as any).display_name || product.name : product.name,
              variantId: realVariantId,
              name: product.name,
              variantName: variant?.name ?? undefined,
              sku: variant?.sku || product.code || '',
              price: variant?.effective_wholesale_price ?? variant?.wholesale_price ?? (product as any).wholesale_price ?? 0,
              quantity: 1,
              options: variant?.option_values?.map((ov: any) => ov.label || ov.value).filter(Boolean) || undefined,
              selectedModelName: realModelName,
              itemType: (product as any).item_type || 'product',
              unitCost: variant?.wholesale_price ?? (product as any).wholesale_price ?? 0,
              shippingPayment: (product as any).shipping_payment ?? null,
              tempKey: (product as any).temp_key,
              parentTempKey: (product as any).parent_temp_key,
            };
            newItems = [...draft.items, newItem];
          }


          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                items: newItems,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateQuantity: (storeId, itemId, quantity) => {
        set((state) => {
          const draft = state.drafts[storeId];
          if (!draft) return state;

          const newItems =
            quantity <= 0
              ? draft.items.filter((item) => item.id !== itemId)
              : draft.items.map((item) =>
                item.id === itemId ? { ...item, quantity } : item
              );

          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                items: newItems,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateItemPrice: (storeId, itemId, price) => {
        set((state) => {
          const draft = state.drafts[storeId];
          if (!draft) return state;

          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                items: draft.items.map((item) =>
                  item.id === itemId ? { ...item, price } : item
                ),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      reorderItems: (storeId, items) => {
        set((state) => {
          const draft = state.drafts[storeId];
          if (!draft) return state;

          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                items,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      setPriceSyncMap: (storeId, map) => {
        set((state) => {
          const draft = state.drafts[storeId];
          if (!draft) return state;

          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                priceSyncMap: map,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      removeItem: (storeId, itemId) => {
        set((state) => {
          const draft = state.drafts[storeId];
          if (!draft) return state;

          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                items: draft.items.filter((item) => item.id !== itemId),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updateNotes: (storeId, notes) => {
        set((state) => {
          const draft = state.drafts[storeId] || createEmptyDraft();
          return {
            drafts: {
              ...state.drafts,
              [storeId]: {
                ...draft,
                notes,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      clearDraft: (storeId) => {
        set((state) => {
          const { [storeId]: _, ...rest } = state.drafts;
          return { drafts: rest };
        });
      },

      getTotalItems: (storeId) => {
        const draft = get().drafts[storeId];
        if (!draft) return 0;
        return draft.items.reduce((sum, item) => sum + item.quantity, 0);
      },

      getTotalAmount: (storeId) => {
        const draft = get().drafts[storeId];
        if (!draft) return 0;
        return draft.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      },

      getItemQuantity: (storeId, productId, variantId) => {
        const draft = get().drafts[storeId];
        if (!draft) return 0;
        const itemId = generateItemId(productId, variantId);
        return draft.items.find((item) => item.id === itemId)?.quantity || 0;
      },

      getTotalProductQuantity: (storeId, productId) => {
        const draft = get().drafts[storeId];
        if (!draft) return 0;
        return draft.items
          .filter((item) => item.productId === productId)
          .reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: "order-drafts-storage",
      partialize: (state) => ({ drafts: state.drafts }),
    }
  )
);

// Convenience hook for single store context
export function useStoreDraft(storeId: string | undefined) {
  const store = useOrderDraftStore();

  if (!storeId) {
    return {
      draft: createEmptyDraft(),
      items: [],
      notes: "",
      priceSyncMap: {},
      totalItems: 0,
      totalAmount: 0,
      addItem: () => { },
      updateQuantity: () => { },
      updateItemPrice: () => { },
      reorderItems: () => { },
      setPriceSyncMap: () => { },
      removeItem: () => { },
      updateNotes: () => { },
      clearDraft: () => { },
      getItemQuantity: () => 0,
      getTotalProductQuantity: () => 0,
    };
  }

  const draft = store.getDraft(storeId);

  return {
    draft,
    items: draft.items,
    notes: draft.notes,
    priceSyncMap: draft.priceSyncMap,
    totalItems: store.getTotalItems(storeId),
    totalAmount: store.getTotalAmount(storeId),
    addItem: (product: ProductWithPricing, variant?: VariantWithPricing, selectedModelName?: string, customItemId?: string) => {
      const parentTempKey = `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const enriched = {
        ...product,
        temp_key: (product as any).temp_key || parentTempKey,
      } as ProductWithPricing;
      store.addItem(storeId, enriched, variant, selectedModelName, customItemId);
      if (!(product as any).temp_key) {
        enqueueAddons(storeId, product, variant, parentTempKey);
      }
    },
    updateQuantity: (itemId: string, quantity: number) =>
      store.updateQuantity(storeId, itemId, quantity),
    updateItemPrice: (itemId: string, price: number) =>
      store.updateItemPrice(storeId, itemId, price),
    reorderItems: (items: OrderDraftItem[]) =>
      store.reorderItems(storeId, items),
    setPriceSyncMap: (map: Record<string, boolean>) =>
      store.setPriceSyncMap(storeId, map),
    removeItem: (itemId: string) => store.removeItem(storeId, itemId),
    updateNotes: (notes: string) => store.updateNotes(storeId, notes),
    clearDraft: () => store.clearDraft(storeId),
    getItemQuantity: (productId: string, variantId?: string) =>
      store.getItemQuantity(storeId, productId, variantId),
    getTotalProductQuantity: (productId: string) =>
      store.getTotalProductQuantity(storeId, productId),
  };
}
