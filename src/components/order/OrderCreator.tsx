// src/components/order/OrderCreator.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ShoppingCart, Plus, Minus, Trash2, Send, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useStoreProductCache, ProductWithPricing, VariantWithPricing } from "@/hooks/useProductCache";

// 1. 定義 Schema
const orderSchema = z.object({
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string(),
    variantId: z.string().optional(),
    name: z.string(),
    sku: z.string(),
    price: z.number(),
    quantity: z.number().min(1, "數量至少為 1"),
  })).min(1, "購物車是空的"),
});

type OrderFormValues = z.infer<typeof orderSchema>;

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
  const [variantDialogProduct, setVariantDialogProduct] = useState<ProductWithPricing | null>(null);

  const { products: storeProducts, isLoading: productsLoading } = useStoreProductCache(storeId);

  // 2. 初始化 React Hook Form
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      notes: "",
      items: [],
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // 3. 建立訂單的 Mutation
  const createOrderMutation = useMutation({
    mutationFn: async (values: OrderFormValues) => {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          store_id: storeId,
          created_by: userId,
          notes: values.notes,
          source_type: sourceType,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = values.items.map((item) => ({
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
      form.reset();
      queryClient.invalidateQueries({ queryKey: [queryKeyToInvalidate] });
      onOrderCreated?.();
      navigate(successRedirect);
    },
    onError: (error: any) => {
      toast.error(error.message || "建立訂單失敗");
    },
  });

  // 4. 購物車邏輯
  const addToCart = (product: ProductWithPricing, variant?: VariantWithPricing) => {
    const existingIndex = fields.findIndex((item) =>
      variant ? item.variantId === variant.id : item.productId === product.id && !item.variantId
    );

    if (existingIndex > -1) {
      const currentItem = fields[existingIndex];
      update(existingIndex, { ...currentItem, quantity: currentItem.quantity + 1 });
    } else {
      append({
        productId: product.id,
        variantId: variant?.id,
        name: variant ? `${product.name} - ${variant.name}` : product.name,
        sku: variant?.sku || product.sku,
        price: variant?.effective_wholesale_price ?? product.wholesale_price,
        quantity: 1,
      });
    }
    setVariantDialogProduct(null);
  };

  const totalAmount = fields.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const filteredProducts = storeProducts.filter((p) =>
    p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => createOrderMutation.mutate(v))} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* 左側：產品選擇 */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>產品目錄</CardTitle></CardHeader>
              <CardContent>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="搜尋產品..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredProducts.map((product) => {
                    const inCartCount = fields
                      .filter(f => f.productId === product.id)
                      .reduce((sum, f) => sum + f.quantity, 0);
                    
                    return (
                      <div 
                        key={product.id} 
                        className="p-3 border rounded-lg hover:border-primary cursor-pointer transition-colors"
                        onClick={() => product.has_variants ? setVariantDialogProduct(product) : addToCart(product)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{product.name}</div>
                            <div className="text-sm text-muted-foreground font-mono">{product.sku}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">${product.wholesale_price}</div>
                            {inCartCount > 0 && <div className="text-sm text-primary">x{inCartCount}</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 右側：購物車與提交 */}
          <div className="space-y-6">
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" /> 購物車 ({fields.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {fields.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">購物車是空的</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {fields.map((field, index) => (
                        <div key={field.id} className="flex items-center justify-between p-2 border rounded">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate text-sm">{field.name}</div>
                            <div className="text-xs text-muted-foreground">${field.price}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => update(index, { ...field, quantity: Math.max(0, field.quantity - 1) })}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm">{field.quantity}</span>
                            <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => update(index, { ...field, quantity: field.quantity + 1 })}>
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(index)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t pt-2 flex justify-between font-bold">
                      <span>總計</span>
                      <span>${totalAmount.toLocaleString()}</span>
                    </div>

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl><Textarea placeholder="訂單備註" {...field} /></FormControl>
                        </FormItem>
                      )}
                    />

                    <Button type="submit" className="w-full" disabled={createOrderMutation.isPending || fields.length === 0}>
                      <Send className="h-4 w-4 mr-2" />
                      {createOrderMutation.isPending ? "處理中..." : "送出訂單"}
                    </Button>
                    {form.formState.errors.items && (
                      <p className="text-xs text-destructive text-center">{form.formState.errors.items.message}</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </form>
      </Form>

      {/* 變體選擇 Dialog 同原先邏輯，但 onClick 調用新的 addToCart */}
      <Dialog open={!!variantDialogProduct} onOpenChange={() => setVariantDialogProduct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>選擇規格</DialogTitle></DialogHeader>
          {variantDialogProduct?.variants?.map((v) => (
            <div 
              key={v.id} 
              className="p-3 border rounded-lg cursor-pointer hover:border-primary"
              onClick={() => addToCart(variantDialogProduct, v as VariantWithPricing)}
            >
              <div className="flex justify-between items-center">
                <span>{v.name}</span>
                <span className="font-bold">${v.wholesale_price}</span>
              </div>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}