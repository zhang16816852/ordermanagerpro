// src/pages/store/Checkout.tsx
import { useAuth } from "@/hooks/useAuth";
import CheckoutForm from "@/components/order/CheckoutForm";

export default function StoreCheckout() {
  const { user, storeId } = useAuth();

  if (!storeId || !user) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        無法取得店鋪或使用者資訊
      </div>
    );
  }

  return (
    <CheckoutForm
      storeId={storeId}
      userId={user.id}
      sourceType="frontend"
      successRedirect="/orders"
      queryKeyToInvalidate="store-orders"
      catalogPath="/catalog"
    />
  );
}
