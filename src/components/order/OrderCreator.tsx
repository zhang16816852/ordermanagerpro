// src/components/order/OrderCreator.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, ShoppingCart, Plus, Minus, Trash2, Send, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useStoreProductCache, useProductVariants, ProductWithPricing, VariantWithPricing } from "@/hooks/useProductCache";

interface CartItem {
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
}

interface OrderCreatorProps {
  storeId: string;
  sourceType: "frontend" | "admin_proxy";
  successRedirect: string;
  queryKeyToInvalidate: string;
  title: string;
  userId: string;
  description: string;
  onOrderCreated?: () => void;
}

export default function OrderCreator({
  storeId,
  sourceType,
  userId,
  successRedirect,
  queryKeyToInvalidate,
  title,
  description,
  onOrderCreated,
}: OrderCreatorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [variantDialogProduct, setVariantDialogProduct] = useState<ProductWithPricing | null>(null);

  const { products: storeProducts, isLoading: productsLoading, brand } = useStoreProductCache(storeId);
  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("購物車是空的");

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          store_id: storeId,
          created_by: userId,
          notes,
          source_type: sourceType,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = cart.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        variant_id: item.variantId,
        store_id: storeId,
        quantity: item.quantity,
        unit_price: item.price,
      }));

      const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
      if (itemsError) throw itemsError;

      return order;
    },
    onSuccess: () => {
      toast.success("訂單已建立");
      setCart([]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: [queryKeyToInvalidate] });
      onOrderCreated?.();
      navigate(successRedirect);
    },
    onError: (error: any) => {
      toast.error(error.message || "建立訂單失敗");
    },
  });

  const filteredProducts = storeProducts.filter((product) => {
    const searchLower = search.toLowerCase();
    return (
      product.name?.toLowerCase().includes(searchLower) ||
      product.sku?.toLowerCase().includes(searchLower)
    );
  });

  const handleProductClick = (product: ProductWithPricing) => {
    if (product.has_variants && product.variants && product.variants.length > 0) {
      // 有變體，開啟變體選擇對話框
      setVariantDialogProduct(product);
    } else {
      // 無變體，直接加入購物車
      addToCart(product);
    }
  };

  const addToCart = (product: ProductWithPricing, variant?: VariantWithPricing) => {
    const itemId = variant ? `${product.id}-${variant.id}` : product.id;
    const existing = cart.find((item) =>
      variant ? item.variantId === variant.id : item.productId === product.id && !item.variantId
    );

    if (existing) {
      setCart(
        cart.map((item) =>
          (variant ? item.variantId === variant.id : item.productId === product.id && !item.variantId)
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          variantId: variant?.id,
          name: variant ? `${product.name} - ${variant.name}` : product.name,
          sku: variant?.sku || product.sku,
          price: variant?.effective_wholesale_price ?? product.wholesale_price,
          quantity: 1,
        },
      ]);
    }

    if (variant) {
      setVariantDialogProduct(null);
    }
  };

  const updateQuantity = (productId: string, variantId: string | undefined, delta: number) => {
    setCart(
      cart
        .map((item) =>
          item.productId === productId && item.variantId === variantId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId: string, variantId: string | undefined) => {
    setCart(cart.filter((item) => !(item.productId === productId && item.variantId === variantId)));
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
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

              {productsLoading ? (
                <div className="text-center py-8 text-muted-foreground">載入中...</div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">沒有找到符合的產品</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredProducts.map((product) => {
                    const inCartCount = cart
                      .filter((item) => item.productId === product.id)
                      .reduce((sum, item) => sum + item.quantity, 0);
                    const hasVariants = product.has_variants && product.variants && product.variants.length > 0;

                    return (
                      <div
                        key={product.id}
                        className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
                        onClick={() => handleProductClick(product)}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium flex items-center gap-2">
                              {product.name}
                              {hasVariants && (
                                <Badge variant="outline" className="text-xs">
                                  {product.variants!.length} 變體
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground font-mono">
                              {product.sku}
                            </div>
                          </div>
                          <div className="text-right flex items-center gap-2">
                            <div>
                              <div className="font-medium">${product.wholesale_price}</div>
                              {inCartCount > 0 && (
                                <div className="text-sm text-primary">
                                  已加入 x{inCartCount}
                                </div>
                              )}
                            </div>
                            {hasVariants && (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
                        key={`${item.productId}-${item.variantId || 'base'}`}
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
                            onClick={() => updateQuantity(item.productId, item.variantId, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.productId, item.variantId, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeFromCart(item.productId, item.variantId)}
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

      {/* 變體選擇對話框 */}
      <Dialog open={!!variantDialogProduct} onOpenChange={() => setVariantDialogProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>選擇規格</DialogTitle>
          </DialogHeader>
          {variantDialogProduct && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {variantDialogProduct.name}
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {variantDialogProduct.variants?.map((variant) => {
                  const inCart = cart.find((item) => item.variantId === variant.id);
                  const price = 'effective_wholesale_price' in variant
                    ? variant.effective_wholesale_price
                    : variant.wholesale_price;
                  return (
                    <div
                      key={variant.id}
                      className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
                      onClick={() => addToCart(variantDialogProduct, variant as VariantWithPricing)}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-medium">{variant.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {variant.sku}
                          </div>
                          {(variant.option_1 || variant.option_2 || variant.option_3) && (
                            <div className="flex gap-1 mt-1">
                              {variant.option_1 && <Badge variant="secondary" className="text-xs">{variant.option_1}</Badge>}
                              {variant.option_2 && <Badge variant="secondary" className="text-xs">{variant.option_2}</Badge>}
                              {variant.option_3 && <Badge variant="secondary" className="text-xs">{variant.option_3}</Badge>}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-medium">${Number(price)}</div>
                          {inCart && (
                            <div className="text-sm text-primary">已加入 x{inCart.quantity}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
