import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Search, Package, Truck, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

interface PendingItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  shipped_quantity: number;
  store_id: string;
  unit_price: number;
  product: { name: string; sku: string };
  store: { name: string; code: string };
  order: { created_at: string };
}

export default function AdminShippingPool() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: stores } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  const { data: pendingItems, isLoading } = useQuery({
    queryKey: ["pending-order-items", storeFilter],
    queryFn: async () => {
      let query = supabase
        .from("order_items")
        .select(`
          id,
          order_id,
          product_id,
          quantity,
          shipped_quantity,
          store_id,
          unit_price,
          product:products(name, sku),
          store:stores(name, code),
          order:orders(created_at)
        `)
        .in("status", ["waiting", "partial"])
        .order("created_at", { ascending: true });

      if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as PendingItem[];
    },
  });

  const createSalesNoteMutation = useMutation({
    mutationFn: async () => {
      if (selectedItems.size === 0) throw new Error("請選擇至少一個項目");
      if (!user) throw new Error("未登入");

      const items = pendingItems?.filter((item) => selectedItems.has(item.id)) || [];
      const storeId = items[0]?.store_id;

      // Check all items are from the same store
      if (!items.every((item) => item.store_id === storeId)) {
        throw new Error("請選擇同一店鋪的項目");
      }

      // Create sales note
      const { data: salesNote, error: noteError } = await supabase
        .from("sales_notes")
        .insert({
          store_id: storeId,
          created_by: user.id,
          notes,
          status: "shipped",
        })
        .select()
        .single();

      if (noteError) throw noteError;

      // Create sales note items
      const noteItems = items.map((item) => ({
        sales_note_id: salesNote.id,
        order_item_id: item.id,
        quantity: item.quantity - item.shipped_quantity,
      }));

      const { error: itemsError } = await supabase
        .from("sales_note_items")
        .insert(noteItems);

      if (itemsError) throw itemsError;

      return salesNote;
    },
    onSuccess: () => {
      toast.success("銷售單已建立並出貨");
      setSelectedItems(new Set());
      setShowCreateDialog(false);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["pending-order-items"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const filteredItems = pendingItems?.filter((item) => {
    const searchLower = search.toLowerCase();
    return (
      item.product?.name?.toLowerCase().includes(searchLower) ||
      item.product?.sku?.toLowerCase().includes(searchLower) ||
      item.store?.name?.toLowerCase().includes(searchLower)
    );
  });

  const toggleItem = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const toggleAll = () => {
    if (selectedItems.size === filteredItems?.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems?.map((item) => item.id)));
    }
  };

  const getSelectedStoreId = () => {
    const selectedItemsArray = pendingItems?.filter((item) =>
      selectedItems.has(item.id)
    );
    if (!selectedItemsArray?.length) return null;
    const storeId = selectedItemsArray[0].store_id;
    if (selectedItemsArray.every((item) => item.store_id === storeId)) {
      return storeId;
    }
    return null;
  };

  const canCreateSalesNote = selectedItems.size > 0 && getSelectedStoreId() !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">出貨池</h1>
        <p className="text-muted-foreground">管理待出貨的訂單項目</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              待出貨項目
            </div>
            <Button
              onClick={() => setShowCreateDialog(true)}
              disabled={!canCreateSalesNote}
            >
              <Truck className="h-4 w-4 mr-2" />
              建立銷售單出貨 ({selectedItems.size})
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋產品..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="篩選店鋪" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有店鋪</SelectItem>
                {stores?.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedItems.size > 0 && getSelectedStoreId() === null && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
              請選擇同一店鋪的項目以建立銷售單
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={
                        filteredItems?.length > 0 &&
                        selectedItems.size === filteredItems?.length
                      }
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>店鋪</TableHead>
                  <TableHead>產品</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">訂購數量</TableHead>
                  <TableHead className="text-right">已出貨</TableHead>
                  <TableHead className="text-right">待出貨</TableHead>
                  <TableHead>訂單日期</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems?.map((item) => {
                  const pending = item.quantity - item.shipped_quantity;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(item.id)}
                          onCheckedChange={() => toggleItem(item.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{item.store?.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.store?.code}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{item.product?.name}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {item.product?.sku}
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        {item.shipped_quantity}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={pending > 0 ? "default" : "secondary"}>
                          {pending}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(item.order?.created_at), "yyyy/MM/dd")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {filteredItems?.length === 0 && !isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              目前沒有待出貨的項目
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              建立銷售單並出貨
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                將建立銷售單包含 {selectedItems.size} 個項目
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">備註（選填）</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="輸入出貨備註..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => createSalesNoteMutation.mutate()}
              disabled={createSalesNoteMutation.isPending}
            >
              {createSalesNoteMutation.isPending ? "處理中..." : "確認出貨"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
