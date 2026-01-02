// src/components/cart/CartSidebar.tsx
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Plus, Minus, Trash2, ArrowRight } from "lucide-react";
import { useCartStore } from "@/stores/useCartStore";

interface CartSidebarProps {
  /** 是否顯示「去結帳」按鈕（NewOrder 頁面不需要，因為已經在結帳流程） */
  showCheckoutButton?: boolean;
}

export default function CartSidebar({ showCheckoutButton = true }: CartSidebarProps) {
  const navigate = useNavigate();
  const {
    items: cartItems,
    updateQuantity,
    removeItem,
    getTotalItems,
    getTotalAmount,
  } = useCartStore();

  const totalItems = getTotalItems();
  const totalAmount = getTotalAmount();

  if (cartItems.length === 0) {
    return (
      <Card className="sticky top-4">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              購物車
            </span>
            <Badge variant="secondary">0</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-12">
            購物車是空的
            <br />
            <span className="text-sm">快去選購商品吧！</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            購物車
          </span>
          <Badge variant="secondary">{totalItems}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-96 pr-4 -mx-4 px-4">
          <div className="space-y-3">
            {cartItems.map((item) => (
              <div
                key={item.productId}
                className="flex items-center gap-3 p-3 border rounded-lg bg-background"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.sku} · ${item.price} × {item.quantity}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-9 text-center text-sm font-medium">
                    {item.quantity}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeItem(item.productId)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        <div className="space-y-4">
          <div className="flex justify-between text-lg font-semibold">
            <span>總計</span>
            <span>${totalAmount.toLocaleString()}</span>
          </div>

          {showCheckoutButton && (
            <Button
              size="lg"
              className="w-full"
              onClick={() => navigate("/orders/new")}
            >
              去結帳
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}