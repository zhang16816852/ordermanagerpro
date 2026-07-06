import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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
    order?: { code: string };
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [storeFilter, setStoreFilter] = useState<string>(searchParams.get("store") || "all");
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
            order:orders(code),
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
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const shipMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("未登入");
      if (selectedStores.size === 0) throw new Error("請選擇至少一個店家");

      const { data, error } = await supabase.rpc("ship_from_pool", {
        p_store_ids: Array.from(selectedStores),
        p_created_by: user.id,
        p_notes: notes || null,
      });

      if (error) throw error;
      return data as Array<{ sales_note_id: string; store_id: string }>;
    },
    onSuccess: (data) => {
      toast.success(`已建立 ${selectedStores.size} 個銷售單並出貨`, {
        action: data?.length > 0 ? {
          label: "檢視銷貨單",
          onClick: () => window.location.href = "/admin/sales-notes",
        } : undefined,
      });
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (e.target.value) next.set("search", e.target.value);
                    else next.delete("search");
                    return next;
                  }, { replace: true });
                }}
                className="pl-10"
              />
            </div>
            <Select value={storeFilter} onValueChange={(v) => {
              setStoreFilter(v);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (v && v !== "all") next.set("store", v);
                else next.delete("store");
                return next;
              }, { replace: true });
            }}>
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
                        <div
                          role="checkbox"
                          aria-checked={isSelected}
                          onClick={(e) => { toggleStore(group.storeId); e.stopPropagation(); }}
                          className={`w-4 h-4 border rounded ${isSelected ? 'bg-primary' : ''}`}
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
                                <div className="text-[10px] text-muted-foreground mt-1">
                                  來源單號: {item.order_item?.order?.code || item.order_item?.order_id.slice(0, 8)}
                                </div>
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
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              確認出貨
            </DialogTitle>
            <DialogDescription>
              將選定店家的待出貨品項合併產生銷售單，並更新系統訂單狀態。出貨後資料將從集貨池中移除。
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 space-y-4">
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
            {groupedByStore.filter(g => selectedStores.has(g.storeId)).map(group => {
              const groupTotal = group.items.reduce((sum, item) => sum + item.quantity * (item.order_item?.unit_price || 0), 0);
              return (
                <div key={group.storeId} className="space-y-2 border rounded p-3">
                  <div className="flex items-center justify-between border-b pb-1">
                    <h3 className="font-bold text-primary">{group.storeName}</h3>
                    <Badge variant="outline">{group.items.length} 項 / {group.totalQuantity} 件</Badge>
                  </div>
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>產品</TableHead>
                        <TableHead className="text-right">數量</TableHead>
                        <TableHead className="text-right">單價</TableHead>
                        <TableHead className="text-right">小計</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">{item.order_item?.product?.sku}</TableCell>
                          <TableCell className="text-sm">{item.order_item?.product?.name}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">${item.order_item?.unit_price.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">${(item.quantity * (item.order_item?.unit_price || 0)).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="text-right text-sm font-bold">
                    合計：${groupTotal.toFixed(2)}
                  </div>
                </div>
              );
            })}
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
          <DialogFooter className="p-6 pt-2 bg-muted/20 border-t">
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
