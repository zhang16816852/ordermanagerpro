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
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errorMessages";
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
} from "lucide-react";
import type { DateRange } from "react-day-picker";

interface CustomerStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatDay = (d: Date | undefined) => (d ? format(d, "yyyy/MM/dd") : "");

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