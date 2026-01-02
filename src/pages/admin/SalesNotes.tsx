import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileText, Package, Truck } from "lucide-react";
import { format } from "date-fns";

export default function AdminSalesNotes() {
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedNote, setSelectedNote] = useState<any>(null);

  const { data: stores } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ["admin-sales-notes", storeFilter, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("sales_notes")
        .select(`
          *,
          store:stores(name, code),
          sales_note_items(
            id,
            quantity,
            order_item:order_items(
              id,
              quantity,
              unit_price,
              product:products(name, sku)
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }
      if (statusFilter !== "all" && (statusFilter === "draft" || statusFilter === "shipped" || statusFilter === "received")) {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const filteredNotes = salesNotes?.filter((note) => {
    const searchLower = search.toLowerCase();
    return (
      note.id.toLowerCase().includes(searchLower) ||
      note.store?.name?.toLowerCase().includes(searchLower) ||
      note.store?.code?.toLowerCase().includes(searchLower)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <Badge variant="secondary">草稿</Badge>;
      case "shipped":
        return <Badge className="bg-blue-500">已出貨</Badge>;
      case "received":
        return <Badge className="bg-green-500">已收貨</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">銷售單管理</h1>
        <p className="text-muted-foreground">管理所有店鋪的銷售單</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            銷售單列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋銷售單..."
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="篩選狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有狀態</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="shipped">已出貨</SelectItem>
                <SelectItem value="received">已收貨</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>銷售單編號</TableHead>
                  <TableHead>店鋪</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>項目數</TableHead>
                  <TableHead>出貨時間</TableHead>
                  <TableHead>收貨時間</TableHead>
                  <TableHead>建立時間</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNotes?.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell className="font-mono text-sm">
                      {note.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{note.store?.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {note.store?.code}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(note.status)}</TableCell>
                    <TableCell>{note.sales_note_items?.length || 0}</TableCell>
                    <TableCell>
                      {note.shipped_at
                        ? format(new Date(note.shipped_at), "yyyy/MM/dd HH:mm")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {note.received_at
                        ? format(new Date(note.received_at), "yyyy/MM/dd HH:mm")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {format(new Date(note.created_at), "yyyy/MM/dd HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedNote(note)}
                      >
                        查看
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedNote} onOpenChange={() => setSelectedNote(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              銷售單詳情
            </DialogTitle>
          </DialogHeader>
          {selectedNote && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">編號：</span>
                  <span className="font-mono">{selectedNote.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">店鋪：</span>
                  <span>{selectedNote.store?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">狀態：</span>
                  {getStatusBadge(selectedNote.status)}
                </div>
                <div>
                  <span className="text-muted-foreground">建立時間：</span>
                  <span>
                    {format(new Date(selectedNote.created_at), "yyyy/MM/dd HH:mm")}
                  </span>
                </div>
              </div>

              {selectedNote.notes && (
                <div>
                  <span className="text-muted-foreground text-sm">備註：</span>
                  <p className="mt-1">{selectedNote.notes}</p>
                </div>
              )}

              <div>
                <h4 className="font-medium mb-2">銷售項目</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>產品</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedNote.sales_note_items?.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.order_item?.product?.name}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {item.order_item?.product?.sku}
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          ${item.order_item?.unit_price}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
