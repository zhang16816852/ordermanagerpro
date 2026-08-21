import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Search, FileText, CalendarIcon, X } from "lucide-react";
import { SalesNoteListTable } from "@/components/sales/SalesNoteListTable";
import { SalesNoteDetailDialog, SalesNoteDetail } from "@/components/sales/SalesNoteDetailDialog";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import type { DateRange } from "react-day-picker";

export default function AdminSalesNotes() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [storeFilter, setStoreFilter] = useState<string>(searchParams.get("store") || "all");
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get("status") || "all");
  const [selectedNote, setSelectedNote] = useState<typeof salesNotes[number] | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      return {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      };
    }
    return undefined;
  });
  const { data: stores } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("stores") as any).select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ["admin-sales-notes", storeFilter, statusFilter, dateRange?.from, dateRange?.to],
    queryFn: async () => {
      let query = (supabase
        .from("sales_notes") as any)
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
              product:products(name, code),
              product_variant:product_variants(name)
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }
      if (statusFilter !== "all") {
        if (statusFilter === "unreceived") {
          query = query.in("status", ["draft", "shipped"]);
        } else if (statusFilter === "received") {
          query = query.eq("status", "received");
        }
      }
      if (dateRange?.from) {
        query = query.gte("created_at", dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte("created_at", dateRange.to.toISOString());
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
      (note.code && note.code.toLowerCase().includes(searchLower)) ||
      note.store?.name?.toLowerCase().includes(searchLower) ||
      note.store?.code?.toLowerCase().includes(searchLower)
    );
  });

  const unreceivedCount = salesNotes?.filter(n => n.status !== "received").length || 0;
  const receivedCount = salesNotes?.filter(n => n.status === "received").length || 0;
  const totalAmount = salesNotes?.reduce((sum, note) =>
    sum + (note.sales_note_items || []).reduce((s, item) =>
      s + (item.quantity * (item.order_item?.unit_price || 0)), 0
    ), 0
  ) || 0;

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
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
    },
    onError: (error: Error) => {
      toast.error(`刪除失敗：${getErrorMessage(error)}`);
    },
  });

  // Map data for the table component
  const tableData = filteredNotes?.map(note => ({
    id: note.id,
    code: note.code,
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
    code: selectedNote.code,
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
      productSku: item.order_item?.product?.code || "-",
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
          {/* Summary */}
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="flex items-center gap-3 text-sm">
              <span>全部: <strong>{salesNotes?.length || 0}</strong></span>
              <span className="text-muted-foreground">|</span>
              <span className="text-amber-600">未收: <strong>{unreceivedCount}</strong></span>
              <span className="text-muted-foreground">|</span>
              <span className="text-green-600">已收: <strong>{receivedCount}</strong></span>
              <span className="text-muted-foreground">|</span>
               <span>金額總計: <strong>{formatCurrency(totalAmount)}</strong></span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋銷售單..."
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

            {/* Date range filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[260px] justify-start text-left font-normal",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "yyyy/MM/dd")} ~ {format(dateRange.to, "yyyy/MM/dd")}
                      </>
                    ) : (
                      format(dateRange.from, "yyyy/MM/dd")
                    )
                  ) : (
                    <span>選擇日期範圍</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => {
                    setDateRange(range);
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      if (range?.from) next.set("from", range.from.toISOString());
                      else next.delete("from");
                      if (range?.to) next.set("to", range.to.toISOString());
                      else next.delete("to");
                      return next;
                    }, { replace: true });
                  }}
                  numberOfMonths={2}
                  locale={zhTW}
                />
              </PopoverContent>
            </Popover>
            {dateRange && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="清除日期篩選"
                onClick={() => {
                  setDateRange(undefined);
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete("from");
                    next.delete("to");
                    return next;
                  }, { replace: true });
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Status tabs */}
          <div className="flex gap-1 mb-4">
            {[
              { value: "all", label: "全部" },
              { value: "unreceived", label: "未收" },
              { value: "received", label: "已收" },
            ].map((tab) => (
              <Button
                key={tab.value}
                variant={statusFilter === tab.value ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setStatusFilter(tab.value);
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (tab.value !== "all") next.set("status", tab.value);
                    else next.delete("status");
                    return next;
                  }, { replace: true });
                }}
              >
                {tab.label}
              </Button>
            ))}
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
        enablePayment={true}
      />
    </div>
  );
}
