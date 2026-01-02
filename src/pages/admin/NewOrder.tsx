// src/pages/admin/NewOrder.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import OrderCreator from "@/components/order/OrderCreator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
export default function AdminNewOrder() {
  const { user } = useAuth();
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

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

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
    // 可在此額外清空其他狀態如果需要的話
  };

  return (
    <div className="space-y-6">
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
        <OrderCreator
          storeId={selectedStoreId}
          sourceType="admin_proxy"
          successRedirect="/admin/orders"
          userId={user!.id}
          queryKeyToInvalidate="admin-orders"
          title="代訂訂單"
          description="為選定的店鋪建立訂單"
        />
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          請先選擇店鋪以開始建立訂單
        </div>
      )}
    </div>
  );
}