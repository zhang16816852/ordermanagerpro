import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  useCustomerStatements,
  statementShareLink,
  CustomerStatement,
} from "@/hooks/useCustomerStatements";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StorePicker } from "@/components/ui/StorePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errorMessages";
import { formatCurrency } from "@/lib/formatters";
import {
  ReceiptText,
  Copy,
  Check,
  Plus,
  Pencil,
  Trash2,
  CalendarIcon,
  ArrowLeft,
  Loader2,
  Package,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

interface CustomerStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PreviewNote {
  id: string;
  code?: string | null;
  status?: string | null;
  payment_status?: string | null;
  shipped_at?: string | null;
  shipping_fee?: number | null;
  delivery_method_title?: string | null;
  sales_note_items?:
    | { quantity?: number | null; order_item?: { unit_price?: number | null } | null }[]
    | null;
}

const PREVIEW_ROW_LIMIT = 200;

const formatDay = (d: Date | undefined) => (d ? format(d, "yyyy/MM/dd") : "");

const previewNoteTotal = (note: PreviewNote) => {
  const items = note.sales_note_items || [];
  const subtotal = items.reduce(
    (s, i) => s + (i.quantity || 0) * Number(i.order_item?.unit_price || 0),
    0
  );
  return subtotal + Number(note.shipping_fee || 0);
};

const previewNoteQty = (note: PreviewNote) =>
  (note.sales_note_items || []).reduce((s, i) => s + (i.quantity || 0), 0);

export function CustomerStatementDialog({ open, onOpenChange }: CustomerStatementDialogProps) {
  const { user } = useAuth();
  const { statements, isLoading, createStatementMutation, updateStatementMutation, deleteStatementMutation } =
    useCustomerStatements();

  const { data: stores = [] } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("stores") as any).select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  const [view, setView] = useState<"list" | "create" | "created">("list");
  const [storeId, setStoreId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [createdStatement, setCreatedStatement] = useState<CustomerStatement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCreated, setCopiedCreated] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const storeOptions = stores.map((s: any) => ({
    id: s.id,
    name: s.name,
    code: s.code,
  }));

  const selectedStore = useMemo(
    () => storeOptions.find((s) => s.id === storeId) || null,
    [storeOptions, storeId]
  );

  const previewFrom = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
  const previewTo = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : "";
  // 分享頁 RPC 以 `shipped_at >= date_from` 且 `< date_to + 1 天` 篩選，
  // 這裡用相同邊界（UTC）以確保預覽與實際產出完全一致。
  const previewToExclusive = dateRange?.to
    ? format(addDays(dateRange.to, 1), "yyyy-MM-dd")
    : "";

  const {
    data: previewNotes,
    isFetching: isPreviewFetching,
    isError: isPreviewError,
  } = useQuery<PreviewNote[]>({
    queryKey: ["customer-statement-preview", storeId, previewFrom, previewTo],
    enabled: view === "create" && !!storeId && !!previewFrom && !!previewTo,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sales_notes")
        .select(
          `
          id, code, status, payment_status, shipped_at,
          shipping_fee, delivery_method_title,
          sales_note_items(quantity, order_item:order_items(unit_price))
        `
        )
        .eq("store_id", storeId)
        .not("shipped_at", "is", null)
        .gte("shipped_at", `${previewFrom}T00:00:00Z`)
        .lt("shipped_at", `${previewToExclusive}T00:00:00Z`)
        .order("shipped_at", { ascending: true })
        .order("code", { ascending: true })
        .order("id", { ascending: true })
        .limit(PREVIEW_ROW_LIMIT);
      if (error) throw error;
      return (data || []) as PreviewNote[];
    },
  });

  const previewSummary = useMemo(() => {
    const notes = previewNotes || [];
    return {
      noteCount: notes.length,
      qty: notes.reduce((s, n) => s + previewNoteQty(n), 0),
      amount: notes.reduce((s, n) => s + previewNoteTotal(n), 0),
    };
  }, [previewNotes]);

  // 切換到建立視圖時給預設日期區間（本月）＋重設標題狀態
  useEffect(() => {
    if (view === "create") {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateRange({ from, to: now });
      setTitleEdited(false);
    }
  }, [view, open]);

  // 店家/日期變更且使用者尚未手動改標題時，自動重組預設標題
  useEffect(() => {
    if (view !== "create" || titleEdited) return;
    const from = formatDay(dateRange?.from);
    const to = formatDay(dateRange?.to);
    const prefix = selectedStore?.name || "客戶";
    setTitle(to ? `${prefix}對帳單 ${from} ~ ${to}` : `${prefix}對帳單 ${from}`);
  }, [view, selectedStore, dateRange, titleEdited]);

  const resetCreate = () => {
    setStoreId("");
    setDateRange(undefined);
    setTitle("");
    setTitleEdited(false);
    setCreatedStatement(null);
  };

  const copyLink = async (stmt: CustomerStatement, key: "list" | "created") => {
    const link = statementShareLink(stmt);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("對帳單連結已複製到剪貼簿");
      if (key === "list") setCopiedId(stmt.id);
      else setCopiedCreated(true);
      setTimeout(() => {
        if (key === "list") setCopiedId(null);
        else setCopiedCreated(false);
      }, 2000);
    } catch {
      toast.error("複製失敗，請手動複製");
    }
  };

  const handleCreate = () => {
    if (!user) {
      toast.error("無法取得使用者");
      return;
    }
    if (!storeId) {
      toast.error("請選擇客戶（店家）");
      return;
    }
    if (!dateRange?.from || !dateRange?.to) {
      toast.error("請選擇日期區間");
      return;
    }
    createStatementMutation.mutate(
      {
        title: title.trim() || (selectedStore?.name || "客戶") + "對帳單",
        storeId,
        dateFrom: format(dateRange.from, "yyyy-MM-dd"),
        dateTo: format(dateRange.to, "yyyy-MM-dd"),
        createdBy: user.id,
      },
      {
        onSuccess: (stmt) => {
          setCreatedStatement(stmt);
          setView("created");
          toast.success("對帳單已建立");
        },
        onError: (error) => {
          toast.error(`建立失敗：${getErrorMessage(error)}`);
        },
      }
    );
  };

  const handleSaveTitle = (stmt: CustomerStatement) => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      toast.error("標題不可為空");
      return;
    }
    updateStatementMutation.mutate(
      { id: stmt.id, title: trimmed },
      {
        onSuccess: () => {
          toast.success("標題已更新");
          setEditingId(null);
        },
        onError: (error) => {
          toast.error(`更新失敗：${getErrorMessage(error)}`);
        },
      }
    );
  };

  const handleDelete = (stmt: CustomerStatement) => {
    if (
      !window.confirm(
        `確定要刪除「${stmt.title}」的分享連結嗎？\n\n刪除後此對帳單連結將立即失效（不會影響銷貨單本身）。`
      )
    ) {
      return;
    }
    deleteStatementMutation.mutate(stmt.id, {
      onSuccess: () => toast.success("對帳單分享連結已刪除"),
      onError: (error) => toast.error(`刪除失敗：${getErrorMessage(error)}`),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            客戶對帳單分享
          </DialogTitle>
        </DialogHeader>

        {view === "list" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                建立後任何人持連結（免登入）即可查看該店家、該日期區間內所有銷貨單與價格。
              </p>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => {
                  resetCreate();
                  setView("create");
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> 建立對帳單
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : statements && statements.length > 0 ? (
              <div className="space-y-2">
                {statements.map((stmt) => (
                  <div
                    key={stmt.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      {editingId === stmt.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="h-8"
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => handleSaveTitle(stmt)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{stmt.title}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="編輯標題"
                            onClick={() => {
                              setEditingId(stmt.id);
                              setEditTitle(stmt.title);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {stmt.store?.name || "未知店家"}
                        </Badge>
                        <span>
                          {format(new Date(stmt.date_from), "yyyy/MM/dd")} ~{" "}
                          {format(new Date(stmt.date_to), "yyyy/MM/dd")}
                        </span>
                        <span>建立於 {format(new Date(stmt.created_at), "yyyy/MM/dd HH:mm")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => copyLink(stmt, "list")}
                        title="複製分享連結"
                      >
                        {copiedId === stmt.id ? (
                          <Check className="h-4 w-4 mr-1" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        複製連結
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(stmt)}
                        title="刪除分享連結"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                尚無任何對帳單。點擊右上角「建立對帳單」開始。
              </div>
            )}
          </div>
        )}

        {view === "create" && (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setView("list")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> 返回列表
            </Button>

            <div className="space-y-2">
              <Label>客戶（店家）</Label>
              <StorePicker
                stores={storeOptions}
                value={storeId}
                onChange={(v) => setStoreId(v as string)}
                placeholder="選擇客戶（店家）..."
                searchPlaceholder="搜尋店家..."
                disabled={stores.length === 0}
              />
            </div>

            <div className="space-y-2">
              <Label>日期區間（依出貨日）</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateRange?.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        `${formatDay(dateRange.from)} ~ ${formatDay(dateRange.to)}`
                      ) : (
                        formatDay(dateRange.from)
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
                      const resolved =
                        range?.from && !range.to ? { from: range.from, to: range.from } : range;
                      setDateRange(resolved);
                    }}
                    numberOfMonths={2}
                    locale={zhTW}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>將包含的銷貨單（依出貨日）</Label>
                {isPreviewFetching && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> 更新中
                  </span>
                )}
              </div>

              {!storeId || !previewFrom || !previewTo ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  請先選擇客戶與日期區間，即可預覽會納入的銷貨單。
                </p>
              ) : isPreviewError ? (
                <p className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-center text-sm text-destructive">
                  載入預覽失敗，請稍後再試。
                </p>
              ) : (previewNotes || []).length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  此日期區間內查無已出貨的銷貨單。
                </p>
              ) : (
                <div className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
                    <span>
                      共 <span className="font-medium text-foreground">{previewSummary.noteCount}</span> 張
                    </span>
                    <span className="text-muted-foreground">|</span>
                    <span>
                      總件數 <span className="font-medium text-foreground">{previewSummary.qty}</span> 件
                    </span>
                    <span className="text-muted-foreground">|</span>
                    <span>
                      總金額{" "}
                      <span className="font-semibold text-foreground">
                        {formatCurrency(previewSummary.amount)}
                      </span>
                    </span>
                  </div>

                  <ul className="max-h-56 divide-y overflow-y-auto">
                    {(previewNotes || []).map((note) => (
                      <li
                        key={note.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs"
                      >
                        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{note.code || note.id.slice(0, 8)}</span>
                        <span className="text-muted-foreground">
                          {note.shipped_at ? format(new Date(note.shipped_at), "yyyy/MM/dd") : "-"}
                        </span>
                        <span className="text-muted-foreground">
                          {(note.sales_note_items || []).length} 品項 ・ 共 {previewNoteQty(note)} 件
                        </span>
                        <Badge
                          variant="secondary"
                          className={
                            note.payment_status === "paid"
                              ? "bg-green-600 text-white hover:bg-green-600"
                              : "text-amber-600"
                          }
                        >
                          {note.payment_status === "paid"
                            ? "已收款"
                            : note.payment_status === "partial"
                              ? "部分收款"
                              : "未收款"}
                        </Badge>
                        <span className="ml-auto font-medium">{formatCurrency(previewNoteTotal(note))}</span>
                      </li>
                    ))}
                  </ul>

                  {previewSummary.noteCount >= PREVIEW_ROW_LIMIT && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      僅顯示前 {PREVIEW_ROW_LIMIT} 張，實際對帳單將包含此區間內全部已出貨單據。
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>標題（可自行修改）</Label>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleEdited(true);
                }}
                placeholder="對帳單標題..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setView("list")}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={createStatementMutation.isPending}>
                {createStatementMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                建立並產生分享連結
              </Button>
            </div>
          </div>
        )}

        {view === "created" && createdStatement && (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setView("list")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> 返回列表
            </Button>

            <div className="rounded-md border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ReceiptText className="h-4 w-4" />
                {createdStatement.title}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  客戶：{createdStatement.store?.name || "未知店家"}（
                  {createdStatement.store?.code || "-"}）
                </div>
                <div>
                  日期：{format(new Date(createdStatement.date_from), "yyyy/MM/dd")} ~{" "}
                  {format(new Date(createdStatement.date_to), "yyyy/MM/dd")}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <QRCodeSVG
                  value={statementShareLink(createdStatement)}
                  size={96}
                  className="rounded border bg-white p-1"
                />
                <div className="flex-1 min-w-[200px] space-y-2">
                  <Button
                    className="w-full"
                    onClick={() => copyLink(createdStatement, "created")}
                  >
                    {copiedCreated ? (
                      <Check className="h-4 w-4 mr-1" />
                    ) : (
                      <Copy className="h-4 w-4 mr-1" />
                    )}
                    複製分享連結
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    持此連結者（免登入）即可查看對帳單內容與價格。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}