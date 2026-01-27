// src/pages/admin/OrderComposer.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useStoreProductCache } from "@/hooks/useProductCache";
import { useStoreDraft } from "@/stores/useOrderDraftStore";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send } from "lucide-react";

import ProductCatalog from "@/components/order/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";

export default function AdminOrderComposer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [viewMode, setViewMode] = useState<'products' | 'variants'>('products');

  const { data: stores = [], isLoading: storesLoading } = useQuery({
    queryKey: ["admin-stores-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id, name, code")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { products, isLoading: productsLoading } = useStoreProductCache(selectedStoreId || null);
  const { items, notes, totalAmount, updateNotes, clearDraft } = useStoreDraft(selectedStoreId);

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("購物車是空的");
      if (!selectedStoreId || !user) throw new Error("無法取得店鋪或使用者資訊");

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          store_id: selectedStoreId,
          created_by: user.id,
          notes: notes.trim() || null,
          source_type: "admin_proxy",
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = items.map((item) => ({
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
      toast.success("訂單已成功建立！");
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      navigate("/admin/orders");
    },
    onError: (error: any) => {
      toast.error(error.message || "建立訂單失敗");
    },
  });

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
  };

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
                <SelectValue placeholder="請選擇店鋪" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.code ? `${store.code} - ${store.name}` : store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedStoreId ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex bg-muted p-1 rounded-lg self-start">
              <button
                onClick={() => setViewMode('products')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'products'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                產品檢視
              </button>
              <button
                onClick={() => setViewMode('variants')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'variants'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                單品檢視
              </button>
            </div>

            <ProductCatalog
              products={products}
              isLoading={productsLoading}
              storeId={selectedStoreId}
              viewMode={viewMode}
            />
          </div>

          <div className="space-y-4">
            <CartPanel
              storeId={selectedStoreId}
              showCheckoutButton={false}
            />

            {items.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>訂單備註</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="訂單備註..."
                    value={notes}
                    onChange={(e) => updateNotes(e.target.value)}
                    rows={3}
                  />
                  <div className="flex justify-between text-lg font-semibold">
                    <span>總計</span>
                    <span>${totalAmount.toLocaleString()}</span>
                  </div>
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => createOrderMutation.mutate()}
                    disabled={createOrderMutation.isPending}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {createOrderMutation.isPending ? "處理中..." : "送出訂單"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          請先選擇店鋪以開始建立訂單
        </div>
      )}
    </div>
  );
}
