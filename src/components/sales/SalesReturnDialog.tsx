import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tag, RotateCcw, Warehouse as WarehouseIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessages";
import { formatCurrency } from "@/lib/formatters";
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { Account } from "@/pages/admin/accounting/types";
import { SalesNoteDetail } from "./SalesNoteDetailDialog";

export interface SalesReturnPayloadItem {
  sales_note_item_id: string;
  quantity: number;
  refund_amount: number;
}

interface SalesReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: SalesNoteDetail | null;
  accounts: Account[];
}

export function SalesReturnDialog({
  open,
  onOpenChange,
  note,
  accounts,
}: SalesReturnDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { warehouses, defaultWarehouse } = useWarehouses();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [refundEnabled, setRefundEnabled] = useState(true);
  const [refundAccountId, setRefundAccountId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setQuantities({});
      setWarehouseId(defaultWarehouse?.id || "");
      setReason("");
      setRefundEnabled(true);
      setRefundAccountId("");
    }
  }, [open, defaultWarehouse?.id]);

  const items = useMemo(() => {
    if (!note?.items) return [];
    return note.items.map((item) => ({
      ...item,
      available: (item.quantity || 0) - (item.returnedQuantity || 0),
    }));
  }, [note?.items]);

  const selectedItems = items.filter((item) => (quantities[item.id] || 0) > 0);

  const totalRefund = useMemo(() => {
    if (!refundEnabled) return 0;
    return selectedItems.reduce(
      (sum, item) => sum + (quantities[item.id] || 0) * (item.unitPrice || 0),
      0
    );
  }, [selectedItems, quantities, refundEnabled]);

  const hasAnyReturn = items.some((item) => item.available > 0);
  const activeWarehouses = warehouses.filter((w) => w.is_active !== false);

  const returnMutation = useMutation({
    mutationFn: async (payload: { items: SalesReturnPayloadItem[]; warehouseId: string; reason?: string; refundAccountId?: string }) => {
      if (!note) throw new Error("無銷貨單資料");
      const { data, error } = await (supabase as any)
        .rpc("process_sales_note_return", {
          p_sales_note_id: note.id,
          p_items: payload.items,
          p_warehouse_id: payload.warehouseId,
          p_reason: payload.reason || null,
          p_refund_account_id: payload.refundAccountId || null,
          p_created_by: user?.id,
        });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["store-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-entries"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-list"] });
      onOpenChange(false);
      toast.success("退貨已登記");
    },
    onError: (error: any) => {
      toast.error(getErrorMessage(error, "退貨登記失敗"));
    },
  });

  const handleSubmit = () => {
    if (selectedItems.length === 0) {
      toast.error("請至少選擇一個退貨品項");
      return;
    }
    if (!warehouseId) {
      toast.error("請選擇退貨入庫倉庫");
      return;
    }
    if (refundEnabled && totalRefund > 0 && !refundAccountId) {
      toast.error("退貨退款金額大於 0，請選擇退款帳戶");
      return;
    }
    returnMutation.mutate({
      items: selectedItems.map((item) => ({
        sales_note_item_id: item.id,
        quantity: quantities[item.id] || 0,
        refund_amount: refundEnabled ? (quantities[item.id] || 0) * (item.unitPrice || 0) : 0,
      })),
      warehouseId,
      reason: reason.trim() || undefined,
      refundAccountId: refundEnabled ? refundAccountId || undefined : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            退貨登記
          </DialogTitle>
          <DialogDescription>
            登記店鋪退回商品，退貨數量將回勾庫存{refundEnabled && "並自動開立退款分錄"}。
          </DialogDescription>
        </DialogHeader>

        {!hasAnyReturn ? (
          <div className="text-muted-foreground text-sm py-8 text-center">
            此銷貨單所有品項皆已退貨，無可退數量。
          </div>
        ) : (
          <div className="space-y-4">
            {/* 品項 */}
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>產品名稱</TableHead>
                    <TableHead className="text-right">已訂</TableHead>
                    <TableHead className="text-right">已退</TableHead>
                    <TableHead className="text-right w-24">退貨數量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const maxQty = item.available;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {item.variantName ? item.variantName : item.productName}
                          </div>
                          {item.unitPrice !== undefined && item.unitPrice > 0 && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatCurrency(item.unitPrice)} / 件
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {item.returnedQuantity || 0}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={maxQty}
                            className="h-8 w-20 text-right ml-auto"
                            value={quantities[item.id] || ""}
                            disabled={maxQty <= 0}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(maxQty, Number(e.target.value) || 0));
                              setQuantities((prev) => ({ ...prev, [item.id]: val }));
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* 倉庫 + 退款 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <WarehouseIcon className="h-3.5 w-3.5" /> 退貨入庫倉
                </Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇倉庫" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeWarehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-1">
                    退款
                  </Label>
                  <Switch
                    checked={refundEnabled}
                    onCheckedChange={setRefundEnabled}
                  />
                </div>
                {refundEnabled && (
                  <Select value={refundAccountId} onValueChange={setRefundAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="選擇退款帳戶" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.currency}) 餘額 {formatCurrency(a.balance, a.currency)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium flex items-center gap-1">
                <Tag className="h-3.5 w-3.5" /> 退貨原因
              </Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：瑕疵換貨、尺寸不合、客人退貨……"
              />
            </div>

            {refundEnabled && totalRefund > 0 && (
              <div className="flex justify-end items-baseline gap-2 bg-muted/30 rounded-md px-4 py-2">
                <span className="text-sm text-muted-foreground">退款總計</span>
                <span className="text-lg font-bold text-red-600">{formatCurrency(totalRefund)}</span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={returnMutation.isPending}>
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={returnMutation.isPending}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {returnMutation.isPending ? "處理中..." : "登記退貨"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}