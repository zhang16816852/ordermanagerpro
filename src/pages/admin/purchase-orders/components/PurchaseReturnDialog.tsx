import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag, RotateCcw, Warehouse as WarehouseIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessages";
import { formatCurrency } from "@/lib/formatters";
import { useWarehouses } from "@/pages/admin/inventory/hooks/useWarehouses";
import { Account } from "@/pages/admin/accounting/types";
import { PurchaseOrderItem } from "../types";

interface PurchaseReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId?: string;
  items: PurchaseOrderItem[];
  accounts: Account[];
}

export function PurchaseReturnDialog({
  open,
  onOpenChange,
  purchaseOrderId,
  items,
  accounts,
}: PurchaseReturnDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { warehouses, defaultWarehouse } = useWarehouses();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [creditAccountId, setCreditAccountId] = useState<string>("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setQuantities({});
      setWarehouseId(defaultWarehouse?.id || "");
      setCreditAccountId("");
      setReason("");
    }
  }, [open, defaultWarehouse?.id]);

  const rows = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        available: (item.received_quantity || 0) - (item.returned_quantity || 0),
      })),
    [items]
  );

  const selectedItems = rows.filter((item) => (quantities[item.id] || 0) > 0);

  const totalCredit = useMemo(
    () =>
      selectedItems.reduce(
        (sum, item) => sum + (quantities[item.id] || 0) * (item.unit_cost || 0),
        0
      ),
    [selectedItems, quantities]
  );

  const hasAnyReturn = rows.some((item) => item.available > 0);
  const activeWarehouses = warehouses.filter((w) => w.is_active !== false);
  const hasReturnedYet = items.some((item) => (item.returned_quantity || 0) > 0);

  const returnMutation = useMutation({
    mutationFn: async (payload: {
      items: { id: string; quantity: number }[];
      warehouseId?: string;
      creditAccountId?: string;
      reason?: string;
    }) => {
      if (!purchaseOrderId) throw new Error("無採購單資料");
      const { data, error } = await (supabase as any).rpc("process_purchase_return", {
        p_purchase_order_id: purchaseOrderId,
        p_items: payload.items.map((it) => ({
          purchase_order_item_id: it.id,
          quantity: it.quantity,
        })),
        p_warehouse_id: payload.warehouseId || null,
        p_reason: payload.reason || null,
        p_credit_account_id: payload.creditAccountId || null,
        p_created_by: user?.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", purchaseOrderId] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-list"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-entries"] });
      onOpenChange(false);
      toast.success("廠商退貨已登記");
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
      toast.error("請選擇退貨倉庫");
      return;
    }
    if (totalCredit > 0 && !creditAccountId) {
      toast.error("請選擇沖帳入帳帳戶");
      return;
    }
    returnMutation.mutate({
      items: selectedItems.map((item) => ({
        id: item.id,
        quantity: quantities[item.id] || 0,
      })),
      warehouseId,
      creditAccountId: creditAccountId || undefined,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            廠商退貨
          </DialogTitle>
          <DialogDescription>
            退回已收貨之品項，退貨數量將自庫存扣除{hasReturnedYet ? "（本採購單已有退貨紀錄）" : "並自動開立沖帳分錄"}。
          </DialogDescription>
        </DialogHeader>

        {!hasAnyReturn ? (
          <div className="text-muted-foreground text-sm py-8 text-center">
            此採購單無已收且未退貨之品項。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>產品名稱</TableHead>
                    <TableHead className="text-right">已收</TableHead>
                    <TableHead className="text-right">已退</TableHead>
                    <TableHead className="text-right w-24">退貨數量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => {
                    const maxQty = item.available;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {item.variant?.name ? item.variant.name : item.product?.name}
                          </div>
                          {item.unit_cost > 0 && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatCurrency(item.unit_cost)} / 件
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{item.received_quantity}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {item.returned_quantity || 0}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <WarehouseIcon className="h-3.5 w-3.5" /> 退貨倉庫
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
                <Label className="text-sm font-medium">沖帳入帳帳戶</Label>
                <Select value={creditAccountId} onValueChange={setCreditAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇帳戶" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.currency}) 餘額 {formatCurrency(a.balance, a.currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                placeholder="例：品質不良、交錯貨、退貨入庫……"
              />
            </div>

            {totalCredit > 0 && (
              <div className="flex justify-end items-baseline gap-2 bg-muted/30 rounded-md px-4 py-2">
                <span className="text-sm text-muted-foreground">沖帳總計</span>
                <span className="text-lg font-bold text-emerald-600">{formatCurrency(totalCredit)}</span>
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