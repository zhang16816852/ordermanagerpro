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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Search, Package, Truck, Send, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

interface ShippingPoolItem {
  id: string;
  order_item_id: string;
  quantity: number;
  store_id: string;
  created_at: string;
  order_item: {
    id: string;
    order_id: string;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    product: { name: string; sku: string };
    product_variant?: { name: string } | null;
  };
}

interface GroupedByStore {
  storeId: string;
  storeName: string;
  storeCode: string | null;
  items: ShippingPoolItem[];
  totalQuantity: number;
}

export default function AdminShippingPool() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [showShipDialog, setShowShipDialog] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: stores } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  // 獲取出貨池項目
  const { data: shippingPoolItems, isLoading } = useQuery({
    queryKey: ["shipping-pool", storeFilter],
    queryFn: async () => {
      let query = supabase
        .from("shipping_pool")
        .select(`
          id,
          order_item_id,
          quantity,
          store_id,
          created_at,
          order_item:order_items(
            id,
            order_id,
            quantity,
            shipped_quantity,
            unit_price,
            product:products(name, sku),
            product_variant:product_variants(name)
          )
        `)
        .order("created_at", { ascending: true });

      if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ShippingPoolItem[];
    },
  });

  // 按店家分組
  const groupedByStore: GroupedByStore[] = shippingPoolItems?.reduce((acc, item) => {
    const store = stores?.find(s => s.id === item.store_id);
    const existingGroup = acc.find(g => g.storeId === item.store_id);

    if (existingGroup) {
      existingGroup.items.push(item);
      existingGroup.totalQuantity += item.quantity;
    } else {
      acc.push({
        storeId: item.store_id,
        storeName: store?.name || '未知店家',
        storeCode: store?.code || null,
        items: [item],
        totalQuantity: item.quantity,
      });
    }
    return acc;
  }, [] as GroupedByStore[]) || [];

  // 過濾搜索結果
  const filteredGroups = groupedByStore.filter(group => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      group.storeName.toLowerCase().includes(searchLower) ||
      group.storeCode?.toLowerCase().includes(searchLower) ||
      group.items.some(item =>
        item.order_item?.product?.name.toLowerCase().includes(searchLower) ||
        item.order_item?.product?.sku.toLowerCase().includes(searchLower)
      )
    );
  });

  const toggleStore = (storeId: string) => {
    const newSelected = new Set(selectedStores);
    if (newSelected.has(storeId)) {
      newSelected.delete(storeId);
    } else {
      newSelected.add(storeId);
    }
    setSelectedStores(newSelected);
  };

  // 從出貨池移除單個項目
  const removeItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("shipping_pool")
        .delete()
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已從出貨池移除");
      queryClient.invalidateQueries({ queryKey: ["shipping-pool"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // 確認出貨：將選中店家的出貨池項目合併為銷售單
  const shipMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("未登入");
      if (selectedStores.size === 0) throw new Error("請選擇至少一個店家");

      for (const storeId of selectedStores) {
        const group = groupedByStore.find(g => g.storeId === storeId);
        if (!group) continue;

        // 建立銷售單
        const { data: salesNote, error: noteError } = await supabase
          .from("sales_notes")
          .insert({
            store_id: storeId,
            created_by: user.id,
            status: "shipped",
            shipped_at: new Date().toISOString(),
            notes: notes || null,
          })
          .select()
          .single();

        if (noteError) throw noteError;

        // 建立銷售單項目
        const noteItems = group.items.map(item => ({
          sales_note_id: salesNote.id,
          order_item_id: item.order_item_id,
          quantity: item.quantity,
        }));

        const { error: itemsError } = await supabase
          .from("sales_note_items")
          .insert(noteItems);

        if (itemsError) throw itemsError;

        // 更新訂單項目的已出貨數量
        for (const item of group.items) {
          const newShippedQty = (item.order_item?.shipped_quantity || 0) + item.quantity;
          const newStatus = newShippedQty >= (item.order_item?.quantity || 0) ? 'shipped' : 'partial';

          const { error: updateError } = await supabase
            .from("order_items")
            .update({
              shipped_quantity: newShippedQty,
              status: newStatus,
            })
            .eq("id", item.order_item_id);

          if (updateError) throw updateError;
        }

        // 刪除出貨池項目
        const poolItemIds = group.items.map(i => i.id);
        const { error: deleteError } = await supabase
          .from("shipping_pool")
          .delete()
          .in("id", poolItemIds);

        if (deleteError) throw deleteError;
      }

      // Check and update order status for affected orders
      const affectedOrderIds = new Set<string>();
      for (const storeId of selectedStores) {
        const group = groupedByStore.find(g => g.storeId === storeId);
        if (group) {
          group.items.forEach(item => {
            if (item.order_item?.order_id) {
              affectedOrderIds.add(item.order_item.order_id);
            }
          });
        }
      }

      for (const orderId of affectedOrderIds) {
        const { data: items } = await supabase
          .from('order_items')
          .select('quantity, shipped_quantity')
          .eq('order_id', orderId);

        if (items && items.length > 0) {
          const allShipped = items.every(i => i.shipped_quantity >= i.quantity);
          if (allShipped) {
            await supabase
              .from('orders')
              .update({ status: 'shipped' })
              .eq('id', orderId);
          }
        }
      }
    },
    onSuccess: () => {
      toast.success(`已建立 ${selectedStores.size} 個銷售單並出貨`);
      setSelectedStores(new Set());
      setShowShipDialog(false);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["shipping-pool"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const getSelectedSummary = () => {
    const selectedGroups = groupedByStore.filter(g => selectedStores.has(g.storeId));
    const itemCount = selectedGroups.reduce((sum, g) => sum + g.items.length, 0);
    const totalQuantity = selectedGroups.reduce((sum, g) => sum + g.totalQuantity, 0);
    return { storeCount: selectedStores.size, itemCount, totalQuantity };
  };

  const summary = getSelectedSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">出貨池</h1>
        <p className="text-muted-foreground">將待出貨項目合併為銷售單後出貨</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              待出貨項目
            </div>
            <Button
              onClick={() => setShowShipDialog(true)}
              disabled={selectedStores.size === 0}
            >
              <Truck className="h-4 w-4 mr-2" />
              確認出貨 ({selectedStores.size} 店家)
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋店鋪或產品..."
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

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              目前沒有待出貨的項目
            </div>
          ) : (
            <Accordion type="multiple" defaultValue={filteredGroups.map(g => g.storeId)} className="space-y-4">
              {filteredGroups.map((group) => {
                const isSelected = selectedStores.has(group.storeId);

                return (
                  <AccordionItem key={group.storeId} value={group.storeId} className="border rounded-lg">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center gap-4 flex-1">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleStore(group.storeId)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Store className="h-5 w-5 text-muted-foreground" />
                        <div className="flex-1 text-left">
                          <span className="font-medium">{group.storeName}</span>
                          {group.storeCode && (
                            <span className="text-muted-foreground ml-2">({group.storeCode})</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="secondary">{group.items.length} 項</Badge>
                          <Badge variant="outline">共 {group.totalQuantity} 件</Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>產品</TableHead>
                            <TableHead className="text-right">出貨數量</TableHead>
                            <TableHead className="text-right">單價</TableHead>
                            <TableHead className="text-right">小計</TableHead>
                            <TableHead>加入時間</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-mono text-sm">
                                {item.order_item?.product?.sku}
                              </TableCell>
                              <TableCell>
                                {item.order_item?.product?.name}
                                {item.order_item?.product_variant && (
                                  <span className="text-muted-foreground ml-1">
                                    - {item.order_item.product_variant.name}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{item.quantity}</TableCell>
                              <TableCell className="text-right">
                                ${item.order_item?.unit_price.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                ${(item.quantity * (item.order_item?.unit_price || 0)).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {format(new Date(item.created_at), "MM/dd HH:mm")}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => removeItemMutation.mutate(item.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Dialog open={showShipDialog} onOpenChange={setShowShipDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              確認出貨
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              將選中店家的出貨池項目合併為銷售單並標記為已出貨：
            </p>
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">店家數量：</span>
                  <span className="font-medium">{summary.storeCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">商品項目：</span>
                  <span className="font-medium">{summary.itemCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">總數量：</span>
                  <span className="font-medium">{summary.totalQuantity}</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {groupedByStore.filter(g => selectedStores.has(g.storeId)).map(group => (
                <div key={group.storeId} className="flex items-center justify-between text-sm border rounded p-2">
                  <span className="font-medium">{group.storeName}</span>
                  <Badge variant="outline">{group.items.length} 項 / {group.totalQuantity} 件</Badge>
                </div>
              ))}
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
            <Button variant="outline" onClick={() => setShowShipDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => shipMutation.mutate()}
              disabled={shipMutation.isPending}
            >
              {shipMutation.isPending ? "處理中..." : "確認出貨"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
