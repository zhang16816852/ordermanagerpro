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
import { Search, Package, Truck, Send, Store } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

interface DraftSalesNote {
  id: string;
  store_id: string;
  notes: string | null;
  created_at: string;
  store: { name: string; code: string | null };
  sales_note_items: {
    id: string;
    quantity: number;
    order_item: {
      id: string;
      quantity: number;
      shipped_quantity: number;
      product: { name: string; sku: string };
    };
  }[];
}

interface GroupedByStore {
  storeId: string;
  storeName: string;
  storeCode: string | null;
  salesNotes: DraftSalesNote[];
}

export default function AdminShippingPool() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
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

  // 獲取所有草稿狀態的銷售單（出貨池）
  const { data: draftSalesNotes, isLoading } = useQuery({
    queryKey: ["draft-sales-notes", storeFilter],
    queryFn: async () => {
      let query = supabase
        .from("sales_notes")
        .select(`
          id,
          store_id,
          notes,
          created_at,
          store:stores(name, code),
          sales_note_items(
            id,
            quantity,
            order_item:order_items(
              id,
              quantity,
              shipped_quantity,
              product:products(name, sku)
            )
          )
        `)
        .eq("status", "draft")
        .order("created_at", { ascending: true });

      if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as DraftSalesNote[];
    },
  });

  // 按店家分組
  const groupedByStore: GroupedByStore[] = draftSalesNotes?.reduce((acc, note) => {
    const existingGroup = acc.find(g => g.storeId === note.store_id);
    if (existingGroup) {
      existingGroup.salesNotes.push(note);
    } else {
      acc.push({
        storeId: note.store_id,
        storeName: note.store?.name || '',
        storeCode: note.store?.code || null,
        salesNotes: [note],
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
      group.salesNotes.some(note =>
        note.sales_note_items.some(item =>
          item.order_item?.product?.name.toLowerCase().includes(searchLower) ||
          item.order_item?.product?.sku.toLowerCase().includes(searchLower)
        )
      )
    );
  });

  const toggleNote = (noteId: string) => {
    const newSelected = new Set(selectedNotes);
    if (newSelected.has(noteId)) {
      newSelected.delete(noteId);
    } else {
      newSelected.add(noteId);
    }
    setSelectedNotes(newSelected);
  };

  const toggleStoreNotes = (storeId: string) => {
    const storeNotes = draftSalesNotes?.filter(n => n.store_id === storeId) || [];
    const allSelected = storeNotes.every(n => selectedNotes.has(n.id));
    
    const newSelected = new Set(selectedNotes);
    if (allSelected) {
      storeNotes.forEach(n => newSelected.delete(n.id));
    } else {
      storeNotes.forEach(n => newSelected.add(n.id));
    }
    setSelectedNotes(newSelected);
  };

  // 確認出貨（將草稿銷售單標記為已出貨）
  const shipMutation = useMutation({
    mutationFn: async () => {
      if (selectedNotes.size === 0) throw new Error("請選擇至少一個銷售單");

      // 更新選定的銷售單狀態為 shipped
      const { error } = await supabase
        .from("sales_notes")
        .update({
          status: "shipped",
          shipped_at: new Date().toISOString(),
          notes: notes || null,
        })
        .in("id", Array.from(selectedNotes));

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`已出貨 ${selectedNotes.size} 個銷售單`);
      setSelectedNotes(new Set());
      setShowShipDialog(false);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["draft-sales-notes"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // 刪除銷售單（從出貨池移除）
  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      // 先刪除銷售單項目
      const { error: itemsError } = await supabase
        .from("sales_note_items")
        .delete()
        .eq("sales_note_id", noteId);

      if (itemsError) throw itemsError;

      // 再刪除銷售單
      const { error } = await supabase
        .from("sales_notes")
        .delete()
        .eq("id", noteId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已從出貨池移除");
      queryClient.invalidateQueries({ queryKey: ["draft-sales-notes"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const getSelectedSummary = () => {
    const selectedNotesList = draftSalesNotes?.filter(n => selectedNotes.has(n.id)) || [];
    const storeCount = new Set(selectedNotesList.map(n => n.store_id)).size;
    const itemCount = selectedNotesList.reduce((sum, n) => sum + n.sales_note_items.length, 0);
    return { storeCount, itemCount };
  };

  const summary = getSelectedSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">出貨池</h1>
        <p className="text-muted-foreground">管理待出貨的銷售單，按店家分組顯示</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              待出貨銷售單
            </div>
            <Button
              onClick={() => setShowShipDialog(true)}
              disabled={selectedNotes.size === 0}
            >
              <Truck className="h-4 w-4 mr-2" />
              確認出貨 ({selectedNotes.size})
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
              目前沒有待出貨的銷售單
            </div>
          ) : (
            <Accordion type="multiple" defaultValue={filteredGroups.map(g => g.storeId)} className="space-y-4">
              {filteredGroups.map((group) => {
                const storeNotes = group.salesNotes;
                const allSelected = storeNotes.every(n => selectedNotes.has(n.id));
                const someSelected = storeNotes.some(n => selectedNotes.has(n.id));
                const totalItems = storeNotes.reduce((sum, n) => sum + n.sales_note_items.length, 0);

                return (
                  <AccordionItem key={group.storeId} value={group.storeId} className="border rounded-lg">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center gap-4 flex-1">
                        <Checkbox
                          checked={allSelected}
                          className={someSelected && !allSelected ? 'data-[state=checked]:bg-muted' : ''}
                          onCheckedChange={() => toggleStoreNotes(group.storeId)}
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
                          <Badge variant="secondary">{storeNotes.length} 單</Badge>
                          <Badge variant="outline">{totalItems} 項</Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-4">
                        {storeNotes.map((note) => (
                          <div key={note.id} className="border rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={selectedNotes.has(note.id)}
                                  onCheckedChange={() => toggleNote(note.id)}
                                />
                                <div>
                                  <span className="font-mono text-sm">{note.id.slice(0, 8)}...</span>
                                  <span className="text-muted-foreground text-sm ml-2">
                                    {format(new Date(note.created_at), "MM/dd HH:mm")}
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => deleteMutation.mutate(note.id)}
                              >
                                移除
                              </Button>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>SKU</TableHead>
                                  <TableHead>產品</TableHead>
                                  <TableHead className="text-right">出貨數量</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {note.sales_note_items.map((item) => (
                                  <TableRow key={item.id}>
                                    <TableCell className="font-mono text-sm">
                                      {item.order_item?.product?.sku}
                                    </TableCell>
                                    <TableCell>{item.order_item?.product?.name}</TableCell>
                                    <TableCell className="text-right">{item.quantity}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
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
            <div className="rounded-lg border p-4 bg-muted/50">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">銷售單數量：</span>
                  <span className="font-medium">{selectedNotes.size}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">店家數量：</span>
                  <span className="font-medium">{summary.storeCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">商品項目：</span>
                  <span className="font-medium">{summary.itemCount}</span>
                </div>
              </div>
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
