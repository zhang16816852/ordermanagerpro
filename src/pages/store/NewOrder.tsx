// src/pages/store/NewOrder.tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Search, ShoppingCart, Plus, Minus, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useStoreProductCache } from "@/hooks/useProductCache";

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
}

export default function StoreNewOrder() {
  const { user, storeId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");

  // Use cached products
  const { products: storeProducts, isLoading } = useStoreProductCache(storeId);

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!storeId || !user) throw new Error("未登入或未選擇店鋪");
      if (cart.length === 0) throw new Error("購物車是空的");

      // Create order
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          store_id: storeId,
          created_by: user.id,
          notes,
          source_type: "frontend",
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = cart.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        store_id: storeId,
        quantity: item.quantity,
        unit_price: item.price,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) throw itemsError;

      return order;
    },
    onSuccess: () => {
      toast.success("訂單已建立");
      setCart([]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["store-orders"] });
      navigate("/orders");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const filteredProducts = storeProducts?.filter((product) => {
    const searchLower = search.toLowerCase();
    return (
      product.name?.toLowerCase().includes(searchLower) ||
      product.sku?.toLowerCase().includes(searchLower)
    );
  });

  const addToCart = (product: typeof storeProducts[number]) => {
    const existing = cart.find((item) => item.productId === product.id);

    if (existing) {
      setCart(
        cart.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          price: product.wholesale_price,
          quantity: 1,
        },
      ]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(
      cart
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter((item) => item.productId !== productId));
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">請先選擇店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">建立訂單</h1>
        <p className="text-muted-foreground">選擇產品並建立新訂單</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>產品目錄</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜尋產品..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  載入中...
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredProducts?.map((product) => {
                    const inCart = cart.find(
                      (item) => item.productId === product.id
                    );

                    return (
                      <div
                        key={product.id}
                        className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
                        onClick={() => addToCart(product)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{product.name}</div>
                            <div className="text-sm text-muted-foreground font-mono">
                              {product.sku}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">${product.wholesale_price}</div>
                            {inCart && (
                              <div className="text-sm text-primary">
                                已加入 x{inCart.quantity}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                購物車 ({cart.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cart.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  購物車是空的
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    {cart.map((item) => (
                      <div
                        key={item.productId}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.name}</div>
                          <div className="text-sm text-muted-foreground">
                            ${item.price} x {item.quantity}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.productId, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.productId, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeFromCart(item.productId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between font-medium text-lg">
                      <span>總計</span>
                      <span>${totalAmount.toLocaleString()}</span>
                    </div>
                  </div>

                  <Textarea
                    placeholder="訂單備註（選填）"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />

                  <Button
                    className="w-full"
                    onClick={() => createOrderMutation.mutate()}
                    disabled={createOrderMutation.isPending}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {createOrderMutation.isPending ? "處理中..." : "送出訂單"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
