// src/pages/admin/OrderComposer.tsx
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { ProductWithPricing } from "@/types/product";
import { useStoreProductCache } from "@/hooks/useProductCache";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Send, Copy, Check } from "lucide-react";
import ProductCatalog from "@/components/order/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";

export default function AdminOrderComposer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [createdOrder, setCreatedOrder] = useState<{ id: string; code?: string | null; access_token: string } | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [search, setSearch] = useState("");

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

  const { products: storefrontItems, isLoading: productsLoading } = useStoreProductCache(selectedStoreId || null);

  const products = useMemo(() => {
    return (storefrontItems || []).map(item => ({
      ...item,
      device_model_name: (item.effective_model_names || [])[0] || '',
      physical_product_id: item.id,
      physical_variant_id: undefined,
    }));
  }, [storefrontItems]) as unknown as ProductWithPricing[];

  const { createOrder, isPending, items, notes, totalAmount, updateNotes } = useCreateOrder({
    storeId: selectedStoreId,
    userId: user?.id ?? "",
    sourceType: "admin_proxy",
    queryKeyToInvalidate: ["admin-orders"],
    onSuccess: (data) => {
      setCreatedOrder({ id: data.id, code: data.code, access_token: data.access_token });
    },
  });

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
  };

  const getShareLink = () => {
    if (!createdOrder) return "";
    return `${window.location.origin}/share/order/${createdOrder.code || createdOrder.id}?token=${createdOrder.access_token}`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getShareLink());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast.success("連結已複製");
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
          <div className="lg:col-span-2">
            <ProductCatalog
              products={products}
              isLoading={productsLoading}
              storeId={selectedStoreId}
              search={search}
              onSearchChange={setSearch}
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
                    onClick={() => createOrder()}
                    disabled={isPending}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {isPending ? "處理中..." : "送出訂單"}
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

      <Dialog open={!!createdOrder} onOpenChange={(open) => !open && navigate("/admin/orders")}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>訂單建立成功</DialogTitle>
            <DialogDescription>
              您可以複製以下連結並傳送給客戶，以便他們查看訂單詳情。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2">
            <Input value={getShareLink()} readOnly />
            <Button size="icon" variant="outline" onClick={copyToClipboard}>
              {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => navigate("/admin/orders")}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
