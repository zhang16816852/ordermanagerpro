import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, CheckCircle, Truck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

export default function StoreReceiving() {
  const { user, storeId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedNote, setSelectedNote] = useState<any>(null);

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ["store-receiving", storeId],
    queryFn: async () => {
      if (!storeId) return [];

      const { data, error } = await supabase
        .from("sales_notes")
        .select(`
          *,
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
        .eq("store_id", storeId)
        .eq("status", "shipped")
        .order("shipped_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!storeId,
  });

  const confirmReceiveMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!user) throw new Error("未登入");

      const { error } = await supabase
        .from("sales_notes")
        .update({
          status: "received",
          received_at: new Date().toISOString(),
          received_by: user.id,
        })
        .eq("id", noteId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已確認收貨");
      setSelectedNote(null);
      queryClient.invalidateQueries({ queryKey: ["store-receiving"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">請先選擇店鋪</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">收貨確認</h1>
        <p className="text-muted-foreground">確認已收到的銷售單</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            待收貨銷售單
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : salesNotes?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              目前沒有待收貨的銷售單
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>銷售單編號</TableHead>
                  <TableHead>項目數</TableHead>
                  <TableHead>出貨時間</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesNotes?.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell className="font-mono text-sm">
                      {note.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{note.sales_note_items?.length || 0}</TableCell>
                    <TableCell>
                      {note.shipped_at
                        ? format(new Date(note.shipped_at), "yyyy/MM/dd HH:mm")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedNote(note)}
                      >
                        查看並確認
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
                  <span className="text-muted-foreground">出貨時間：</span>
                  <span>
                    {selectedNote.shipped_at
                      ? format(new Date(selectedNote.shipped_at), "yyyy/MM/dd HH:mm")
                      : "-"}
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedNote(null)}>
              取消
            </Button>
            <Button
              onClick={() => confirmReceiveMutation.mutate(selectedNote.id)}
              disabled={confirmReceiveMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {confirmReceiveMutation.isPending ? "處理中..." : "確認收貨"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
