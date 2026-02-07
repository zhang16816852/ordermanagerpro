// src/stores/useOrderDraftStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ProductWithPricing, VariantWithPricing } from "@/hooks/useProductCache";

export interface OrderDraftItem {
  id: string; // unique key: `${productId}-${variantId || 'base'}`
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  variantName?: string;
  options?: string[];
}

export interface OrderDraft {
  items: OrderDraftItem[];
  notes: string;
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
    variant?: VariantWithPricing
  ) => void;

  // 更新數量
  updateQuantity: (storeId: string, itemId: string, quantity: number) => void;

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

      addItem: (storeId, product, variant) => {
        set((state) => {
          const draft = state.drafts[storeId] || createEmptyDraft();
          const itemId = generateItemId(product.id, variant?.id);

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
              productId: product.id,
              variantId: variant?.id,
              name: variant ? `${product.name} - ${variant.name}` : product.name,
              variantName: variant?.name,
              sku: variant?.sku || product.sku,
              price: variant?.effective_wholesale_price ?? product.wholesale_price,
              quantity: 1,
              options: variant
                ? [variant.option_1, variant.option_2, variant.option_3].filter((o): o is string => !!o)
                : undefined,
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
      totalItems: 0,
      totalAmount: 0,
      addItem: () => { },
      updateQuantity: () => { },
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
    totalItems: store.getTotalItems(storeId),
    totalAmount: store.getTotalAmount(storeId),
    addItem: (product: ProductWithPricing, variant?: VariantWithPricing) =>
      store.addItem(storeId, product, variant),
    updateQuantity: (itemId: string, quantity: number) =>
      store.updateQuantity(storeId, itemId, quantity),
    removeItem: (itemId: string) => store.removeItem(storeId, itemId),
    updateNotes: (notes: string) => store.updateNotes(storeId, notes),
    clearDraft: () => store.clearDraft(storeId),
    getItemQuantity: (productId: string, variantId?: string) =>
      store.getItemQuantity(storeId, productId, variantId),
    getTotalProductQuantity: (productId: string) =>
      store.getTotalProductQuantity(storeId, productId),
  };
}
