import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileText } from "lucide-react";
import { SalesNoteListTable } from "@/components/sales/SalesNoteListTable";
import { SalesNoteDetailDialog, SalesNoteDetail } from "@/components/sales/SalesNoteDetailDialog";
import { toast } from "sonner";

export default function AdminSalesNotes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedNote, setSelectedNote] = useState<any>(null); // Keep as any from react-query for now, or map it

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
              product:products(name, sku),
              product_variant:product_variants(name)
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_sales_note", {
        p_sales_note_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("銷貨單已刪除並回滾至出貨池");
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
    },
    onError: (error: Error) => {
      toast.error(`刪除失敗：${error.message}`);
    },
  });

  // Map data for the table component
  const tableData = filteredNotes?.map(note => ({
    id: note.id,
    storeName: note.store?.name,
    storeCode: note.store?.code,
    status: note.status,
    access_token: note.access_token,
    itemCount: note.sales_note_items?.length || 0,
    created_at: note.created_at,
    shipped_at: note.shipped_at,
    received_at: note.received_at
  }));

  // Map data for the dialog component
  const dialogData: SalesNoteDetail | null = selectedNote ? {
    id: selectedNote.id,
    storeName: selectedNote.store?.name,
    storeCode: selectedNote.store?.code,
    status: selectedNote.status,
    created_at: selectedNote.created_at,
    shipped_at: selectedNote.shipped_at,
    received_at: selectedNote.received_at,
    notes: selectedNote.notes,
    items: selectedNote.sales_note_items?.map((item: any) => ({
      id: item.id,
      quantity: item.quantity,
      productName: item.order_item?.product?.name || "未知產品",
      productSku: item.order_item?.product?.sku || "-",
      variantName: item.order_item?.product_variant?.name,
      unitPrice: item.order_item?.unit_price
    })) || []
  } : null;

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
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="relative flex-1 min-w-[200px]">
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

          <SalesNoteListTable
            data={tableData}
            isLoading={isLoading}
            onView={(note) => {
              // Note: the 'note' from tableData is just summary, we find the full note from salesNotes
              const fullNote = salesNotes?.find(n => n.id === note.id);
              setSelectedNote(fullNote);
            }}
            onDelete={(id) => {
              if (window.confirm("確定要刪除此銷貨單嗎？\n\n注意：刪除後，商品將會回滾至出貨池（變回未出貨狀態）。")) {
                deleteMutation.mutate(id);
              }
            }}
            showStoreColumn={true}
          />
        </CardContent>
      </Card>

      <SalesNoteDetailDialog
        open={!!selectedNote}
        onOpenChange={(open) => !open && setSelectedNote(null)}
        note={dialogData}
      />
    </div>
  );
}
