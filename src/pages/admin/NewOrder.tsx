import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ShoppingCart, Plus, Minus, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useProductCache } from "@/hooks/useProductCache";

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
}

export default function AdminNewOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");

  // Use cached products
  const { activeProducts, isLoading: productsLoading } = useProductCache();

  // Fetch stores
  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["admin-stores-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id, name, code")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch store-specific prices when store is selected
  const { data: storeProducts } = useQuery({
    queryKey: ["store-products", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId) return [];
      const { data, error } = await supabase
        .from("store_products")
        .select("product_id, wholesale_price")
        .eq("store_id", selectedStoreId);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedStoreId,
  });

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStoreId || !user) throw new Error("請選擇店鋪");
      if (cart.length === 0) throw new Error("購物車是空的");

      // Create order
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          store_id: selectedStoreId,
          created_by: user.id,
          notes,
          source_type: "admin_proxy",
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = cart.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        store_id: selectedStoreId,
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
      setSelectedStoreId("");
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      navigate("/admin/orders");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Get product price (store-specific or base)
  const getProductPrice = (productId: string, basePrice: number) => {
    const storeProduct = storeProducts?.find((sp) => sp.product_id === productId);
    return storeProduct?.wholesale_price ?? basePrice;
  };

  const filteredProducts = activeProducts?.filter((product) => {
    const searchLower = search.toLowerCase();
    return (
      product.name?.toLowerCase().includes(searchLower) ||
      product.sku?.toLowerCase().includes(searchLower)
    );
  });

  const addToCart = (product: (typeof activeProducts)[number]) => {
    const price = getProductPrice(product.id, product.base_wholesale_price);
    const existing = cart.find((item) => item.productId === product.id);

    if (existing) {
      setCart(
        cart.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1, price }
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
          price,
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

  // Update cart prices when store changes
  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
    // Prices will be updated via the storeProducts query
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">代訂訂單</h1>
        <p className="text-muted-foreground">為店鋪建立訂單</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>選擇店鋪</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Label>店鋪</Label>
            <Select value={selectedStoreId} onValueChange={handleStoreChange}>
              <SelectTrigger>
                <SelectValue placeholder="選擇店鋪" />
              </SelectTrigger>
              <SelectContent>
                {stores?.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.code ? `${store.code} - ${store.name}` : store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedStoreId && (
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

                {productsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    載入中...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredProducts?.map((product) => {
                      const price = getProductPrice(
                        product.id,
                        product.base_wholesale_price
                      );
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
                              <div className="font-medium">${price}</div>
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
      )}
    </div>
  );
}
