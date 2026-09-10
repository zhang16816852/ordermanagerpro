import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRepCommission } from "@/hooks/useRepCommission";
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
import { getErrorDetails, getErrorMessage } from '@/lib/errorMessages';
import { format, addDays } from "date-fns";
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
  const [repFilter, setRepFilter] = useState<string>(searchParams.get("rep") || "all");
  const [selectedNote, setSelectedNote] = useState<typeof salesNotes[number] | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      const parseDate = (s: string) => {
        const [y, m, d] = s.split("-").map(Number);
        return new Date(y, m - 1, d);
      };
      return {
        from: from ? parseDate(from) : undefined,
        to: to ? parseDate(to) : undefined,
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

  const { data: repsData = [] } = useQuery({
    queryKey: ["admin-reps-for-sales-filter"],
    queryFn: async () => {
      const { data: roles } = await (supabase
        .from('user_roles') as any)
        .select('user_id')
        .eq('role', 'rep');
      if (!roles || roles.length === 0) return [];
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await (supabase
        .from('profiles') as any)
        .select('id, full_name, email')
        .in('id', userIds);
      return (profiles || []).map((p: any) => ({
        user_id: p.id,
        full_name: p.full_name,
        email: p.email,
      }));
    },
  });

  const { data: repAssignedStoreIds = [] } = useQuery({
    queryKey: ['admin-rep-stores-for-sales-filter', repFilter],
    queryFn: async () => {
      if (repFilter === 'all') return [];
      const { data } = await (supabase
        .from('rep_store_assignments') as any)
        .select('store_id')
        .eq('rep_id', repFilter);
      return (data || []).map((a: any) => a.store_id as string);
    },
    enabled: repFilter !== 'all',
  });

  const { data: salesNotes, isLoading } = useQuery({
    queryKey: ["admin-sales-notes", storeFilter, statusFilter, repFilter, repAssignedStoreIds.join(','), dateRange?.from, dateRange?.to],
    queryFn: async () => {
      let query = (supabase
        .from("sales_notes") as any)
        .select(`
          *,
          store:stores(name, code),
          sales_note_items(
            id,
            quantity,
            returned_quantity,
            sort_order,
            order_item:order_items(
              id,
              quantity,
              unit_price,
              sort_order,
              product_id,
              variant_id,
              product:products(name, code),
              product_variant:product_variants(name)
            )
          )
        `)
        .order("created_at", { ascending: false })
        .order("sort_order", { foreignTable: "sales_note_items", ascending: true });

      if (repAssignedStoreIds.length > 0) {
        query = query.in("store_id", repAssignedStoreIds);
      } else if (storeFilter !== "all") {
        query = query.eq("store_id", storeFilter);
      }
      if (statusFilter !== "all") {
        if (statusFilter === "unreceived") {
          query = query.eq("payment_status", "unpaid");
        } else if (statusFilter === "received") {
          query = query.eq("payment_status", "paid");
        }
      }
      if (dateRange?.from) {
        const fromStr = format(dateRange.from, "yyyy-MM-dd");
        const toStr = dateRange.to
          ? format(addDays(dateRange.to, 1), "yyyy-MM-dd")
          : format(addDays(dateRange.from, 1), "yyyy-MM-dd");
        query = query
          .not("shipped_at", "is", null)
          .gte("shipped_at", fromStr)
          .lt("shipped_at", toStr);
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

  const unreceivedCount = salesNotes?.filter(n => n.payment_status !== "paid").length || 0;
  const receivedCount = salesNotes?.filter(n => n.payment_status === "paid").length || 0;
  const totalAmount = salesNotes?.reduce((sum, note) =>
    sum + (note.sales_note_items || []).reduce((s, item) =>
      s + (item.quantity * (item.order_item?.unit_price || 0)), 0
    ), 0
  ) || 0;

  // 業務佣金彙總（僅業務身分顯示）
  const { isRep, computeOrder: computeRepOrder } = useRepCommission();
  const repSummary = useMemo(() => {
    if (!isRep) return null;
    const lines: { productId: string; variantId?: string | null; unitPrice: number; quantity: number }[] = [];
    for (const note of filteredNotes || []) {
      for (const item of note.sales_note_items || []) {
        lines.push({
          productId: item.order_item?.product_id,
          variantId: item.order_item?.variant_id ?? null,
          unitPrice: item.order_item?.unit_price || 0,
          quantity: item.quantity || 0,
        });
      }
    }
    return computeRepOrder(lines);
  }, [isRep, filteredNotes, computeRepOrder]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("delete_sales_note", {
        p_sales_note_id: id,
      });
      if (error) throw error;
      const res = (data ?? null) as unknown as { ok?: boolean; reason?: string; adopted_by?: Array<{ label?: string }> } | null;
      if (res && res.ok !== false) return;
      const reason = res?.reason || "刪除失敗";
      const err = new Error(reason) as Error & { hint?: string };
      const labels = (res?.adopted_by || []).map((b: any) => b?.label).filter(Boolean).join("、");
      err.hint = labels ? `被引用：${labels}（請先處理後再刪除）` : "請先處理會計/佣金/寄賣紀錄後再刪除";
      throw err;
    },
    onSuccess: () => {
      toast.success("銷貨單已刪除並回滾至出貨池");
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
    },
    onError: (error: unknown) => {
      const details = getErrorDetails(error);
      console.error("[delete_sales_note]", details, error);
      const msg = getErrorMessage(error);
      const suffix = details.code ? `（${details.code}）` : "";
      const description = [details.details, details.hint].filter(Boolean).join(" | ") || undefined;
      toast.error(`刪除失敗：${msg}${suffix}`, {
        description,
        duration: 6000,
      });
    },
  });

  // Map data for the table component
  const tableData = filteredNotes?.map(note => ({
    id: note.id,
    code: note.code,
    storeName: note.store?.name,
    storeCode: note.store?.code,
    status: note.status,
    payment_status: note.payment_status,
    access_token: note.access_token,
    itemCount: note.sales_note_items?.length || 0,
    hasReturned: (note.sales_note_items || []).some((i: any) => (i.returned_quantity || 0) > 0),
    created_at: note.created_at,
    shipped_at: note.shipped_at,
    received_at: note.received_at
  }));

  // Map data for the dialog component — use live query data so edits refresh immediately
  const dialogData: SalesNoteDetail | null = selectedNote ? (() => {
    const live = salesNotes?.find((n) => n.id === selectedNote.id) ?? selectedNote;
    return {
      id: live.id,
      code: live.code,
      store_id: live.store_id,
      storeName: live.store?.name,
      storeCode: live.store?.code,
      status: live.status,
      payment_status: live.payment_status,
      created_at: live.created_at,
      shipped_at: live.shipped_at,
      received_at: live.received_at,
      notes: live.notes,
      access_token: live.access_token,
      items: [...(live.sales_note_items || [])]
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
          returnedQuantity: item.returned_quantity ?? 0,
          productName: item.order_item?.product?.name || "未知產品",
          productSku: item.order_item?.product?.code || "-",
          variantName: item.order_item?.product_variant?.name,
          unitPrice: item.order_item?.unit_price,
          sortOrder: item.sort_order ?? 0
        }))
    };
  })() : null;

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
              <span className="text-amber-600">未收款: <strong>{unreceivedCount}</strong></span>
              <span className="text-muted-foreground">|</span>
              <span className="text-green-600">已收款: <strong>{receivedCount}</strong></span>
              <span className="text-muted-foreground">|</span>
               <span>金額總計: <strong>{formatCurrency(totalAmount)}</strong></span>
              {repSummary && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-emerald-600">業務利潤: <strong>{formatCurrency(repSummary.totalProfit)}</strong></span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-amber-600">估佣: <strong>{formatCurrency(repSummary.totalCommission)}</strong></span>
                </>
              )}
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

            <Select value={repFilter} onValueChange={(v) => {
              setRepFilter(v);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (v && v !== "all") next.set("rep", v);
                else next.delete("rep");
                return next;
              }, { replace: true });
            }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="全部業務" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部業務</SelectItem>
                {repsData.map((r) => (
                  <SelectItem key={r.user_id} value={r.user_id}>
                    {r.full_name || r.email}
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
                    const resolved = range?.from && !range.to
                      ? { from: range.from, to: range.from }
                      : range;
                    setDateRange(resolved);
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      if (resolved?.from) next.set("from", format(resolved.from, "yyyy-MM-dd"));
                      else next.delete("from");
                      if (resolved?.to) next.set("to", format(resolved.to, "yyyy-MM-dd"));
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
              { value: "unreceived", label: "未收款" },
              { value: "received", label: "已收款" },
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
              const fullNote = salesNotes?.find(n => n.id === note.id);
              setSelectedNote(fullNote);
            }}
            onDelete={(id) => {
              const target = salesNotes?.find(n => n.id === id);
              if (target?.status === "received") {
                toast.error("已收貨的銷貨單不可刪除", { description: `單號 ${target.code || id.slice(0, 8)} 已簽收，屬收款憑證不可作廢刪除。` });
                return;
              }
              if (window.confirm("確定要刪除此銷貨單嗎？\n\n注意：刪除後，商品將會回滾至出貨池（變回未出貨狀態）。寄賣收款單（已收貨）不可刪除。")) {
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
        enableReturn={!isRep}
        enableCorrect={!isRep}
      />
    </div>
  );
}
