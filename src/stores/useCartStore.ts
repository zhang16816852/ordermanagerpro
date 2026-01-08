// src/stores/useCartStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;        // 這是加入購物車當時的批發價（固定不變）
  quantity: number;
  variantId?: string;
}

interface CartStore {
  items: CartItem[];
  addItem: (product: { id: string; name: string; sku: string; wholesale_price: number; variantId?: string }) => void;
  updateQuantity: (productId: string, variantId: string | undefined, quantity: number) => void;
  removeItem: (productId: string, variantId: string | undefined) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalAmount: () => number;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product) => {
        set((state) => {
          // 關鍵修改：檢查 productId 和 variantId 是否同時匹配
          const existingIndex = state.items.findIndex(
            (item) => item.productId === product.id && item.variantId === product.variantId
          );

          if (existingIndex > -1) {
            const newItems = [...state.items];
            newItems[existingIndex] = {
              ...newItems[existingIndex],
              quantity: newItems[existingIndex].quantity + 1,
            };
            return { items: newItems };
          }

          return {
            items: [
              ...state.items,
              {
                productId: product.id,
                variantId: product.variantId,
                name: product.name,
                sku: product.sku,
                price: product.wholesale_price,
                quantity: 1,
              },
            ],
          };
        });
      },

      updateQuantity: (productId, variantId, quantity) => {
        set((state) => ({
          items: state.items
            .map((item) =>
              item.productId === productId && item.variantId === variantId
                ? { ...item, quantity }
                : item
            )
            .filter((item) => item.quantity > 0),
        }));
      },

      removeItem: (productId, variantId) => {
        set((state) => ({
          items: state.items.filter(
            (item) => !(item.productId === productId && item.variantId === variantId)
          ),
        }));
      },
      clearCart: () => {
        set({ items: [] });
      },

      getTotalItems: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },

      getTotalAmount: () => {
        return get().items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      },
    }),
    
    {
      name: "cart-storage", // localStorage key
      // 可選：只儲存 items，其他函數不需持久化
      partialize: (state) => ({ items: state.items }),
    }
  )
);