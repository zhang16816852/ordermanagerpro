import { useState, useMemo, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Plus, Trash2, Warehouse as PoolIcon, PackagePlus, Minus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessages";
import { formatCurrency } from "@/lib/formatters";
import { SalesNoteDetail } from "./SalesNoteDetailDialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useProductCache } from "@/hooks/useProductCache";

interface CorrectAddItem {
  order_item_id: string;
  quantity: number;
}

interface CorrectNewItem {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  unit_price: number;
}

interface SalesNoteCorrectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: SalesNoteDetail | null;
}

interface PoolItem {
  id: string;
  order_item_id: string;
  quantity: number;
  store_id: string;
  sort_order: number;
  order_item: {
    id: string;
    order_id: string;
    product_id: string;
    variant_id: string | null;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    order: { code: string | null; consignment_mode: boolean } | null;
    product: { name: string; code: string } | null;
    product_variant: { name: string; sku: string } | null;
  };
}

interface OrderItemCandidate {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  shipped_quantity: number;
  unit_price: number;
  available: number;
  code: string;
  product: { name: string; code: string } | null;
  product_variant: { name: string; sku: string } | null;
}

const itemLabel = (productName?: string | null, variantName?: string | null) =>
  variantName ? variantName : productName || "未知品項";

export function SalesNoteCorrectDialog({
  open,
  onOpenChange,
  note,
}: SalesNoteCorrectDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { products } = useProductCache();

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [addedFromPool, setAddedFromPool] = useState<Record<string, number>>({});
  const [addedFromOrder, setAddedFromOrder] = useState<Record<string, number>>({});
  const [newItemDraft, setNewItemDraft] = useState<CorrectNewItem>({
    product_id: "",
    variant_id: null,
    quantity: 1,
    unit_price: 0,
  });
  const [newItems, setNewItems] = useState<CorrectNewItem[]>([]);

  const storeId = note?.store_id;

  useEffect(() => {
    if (open) {
      setRemovingIds(new Set());
      setAddedFromPool({});
      setAddedFromOrder({});
      setNewItemDraft({ product_id: "", variant_id: null, quantity: 1, unit_price: 0 });
      setNewItems([]);
    }
  }, [open, note?.id]);

  // ─── 出貨池候選（同店家） ───
  const { data: poolItems = [] } = useQuery({
    queryKey: ["sales-note-correct-pool", storeId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("shipping_pool") as any)
        .select(`
          id,
          order_item_id,
          quantity,
          store_id,
          sort_order,
          order_item:order_items(
            id,
            order_id,
            product_id,
            variant_id,
            quantity,
            shipped_quantity,
            unit_price,
            order:orders(code, consignment_mode),
            product:products(name, code),
            product_variant:product_variants(name, sku)
          )
        `)
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as PoolItem[];
    },
    enabled: open && !!storeId,
  });

  // ─── 同店家可追加訂單品項（pending/processing + 未出貨量） ───
  const { data: orderCandidates = [] } = useQuery({
    queryKey: ["sales-note-correct-order-items", storeId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("orders") as any)
        .select(`
          id, code, status,
          order_items(
            id,
            order_id,
            product_id,
            variant_id,
            quantity,
            shipped_quantity,
            unit_price,
            product:products(name, code),
            product_variant:product_variants(name, sku)
          )
        `)
        .eq("store_id", storeId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false });
      if (error) throw error;

      const candidates: OrderItemCandidate[] = [];
      (data || []).forEach((o: any) => {
        (o.order_items || []).forEach((oi: any) => {
          const available = (oi.quantity || 0) - (oi.shipped_quantity || 0);
          if (available > 0) {
            candidates.push({
              id: oi.id,
              order_id: oi.order_id,
              product_id: oi.product_id,
              variant_id: oi.variant_id,
              quantity: oi.quantity,
              shipped_quantity: oi.shipped_quantity,
              unit_price: oi.unit_price,
              available,
              code: o.code || "",
              product: oi.product,
              product_variant: oi.product_variant,
            });
          }
        });
      });
      return candidates;
    },
    enabled: open && !!storeId,
  });

  // ─── 產品快取 → 新品項選項（排除維修零件/運費/隱藏） ───
  const newItemOptions = useMemo(() => {
    const visible = products.filter((p: any) => {
      const itemType = p.item_type;
      return itemType !== "repair_part" && itemType !== "shipping" && !p.is_hidden;
    });
    const options: { id: string; name: string; subLabel?: string; badge?: string; group?: string }[] = [];
    visible.forEach((p: any) => {
      if (p.variants && p.variants.length > 0) {
        p.variants.forEach((v: any) => {
          options.push({
            id: v.id,
            name: `${p.name} · ${v.name}`,
            subLabel: `${v.sku || ""}${p.code ? ` (${p.code})` : ""}`,
            group: p.name,
          });
        });
      } else {
        options.push({
          id: p.id,
          name: p.name,
          subLabel: p.code || undefined,
        });
      }
    });
    return options;
  }, [products]);

  // ─── 金額計算 ───
  const originalTotal = note ? note.items.reduce((sum, item) => sum + (item.quantity * (item.unitPrice || 0)), 0) : 0;

  const totalRemoved = note ? note.items
    .filter((item) => removingIds.has(item.id))
    .reduce((sum, item) => sum + (item.quantity * (item.unitPrice || 0)), 0) : 0;

  const totalAdded = useMemo(() => {
    const poolSum = Object.entries(addedFromPool).reduce((sum, [oiId, qty]) => {
      const it = poolItems.find((p) => p.order_item_id === oiId);
      return sum + (qty || 0) * (it?.order_item?.unit_price || 0);
    }, 0);
    const orderSum = Object.entries(addedFromOrder).reduce((sum, [oiId, qty]) => {
      const it = orderCandidates.find((c) => c.id === oiId);
      return sum + (qty || 0) * (it?.unit_price || 0);
    }, 0);
    const newSum = newItems.reduce((sum, it) => sum + (it.quantity || 0) * (it.unit_price || 0), 0);
    return poolSum + orderSum + newSum;
  }, [addedFromPool, addedFromOrder, newItems, poolItems, orderCandidates]);

  const correctedTotal = Math.max(0, originalTotal - totalRemoved + totalAdded);

  // ─── Mutation ───
  const correctMutation = useMutation({
    mutationFn: async () => {
      if (!note) throw new Error("無銷貨單資料");
      const itemsToRemove = Array.from(removingIds);
      const itemsToAdd: CorrectAddItem[] = [
        ...Object.entries(addedFromPool).map(([order_item_id, quantity]) => ({ order_item_id, quantity })),
        ...Object.entries(addedFromOrder).map(([order_item_id, quantity]) => ({ order_item_id, quantity })),
      ];
      const { data, error } = await (supabase as any).rpc("correct_sales_note", {
        p_sales_note_id: note.id,
        p_items_to_remove: itemsToRemove,
        p_items_to_add: itemsToAdd,
        p_new_items: newItems,
        p_created_by: user?.id,
      });
      if (error) throw error;
      const res = typeof data === "string" ? JSON.parse(data) : data;
      if (res && res.ok === false) {
        throw new Error(res.reason || "修正被拒");
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["store-sales-notes"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["shipping-pool-items"] });
      queryClient.invalidateQueries({ queryKey: ["sales-note-correct-pool"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-list"] });
      onOpenChange(false);
      toast.success("銷貨單已修正");
    },
    onError: (error: any) => {
      toast.error(getErrorMessage(error, "銷貨單修正失敗"));
    },
  });

  const hasChanges =
    removingIds.size > 0 ||
    Object.values(addedFromPool).some((q) => q > 0) ||
    Object.values(addedFromOrder).some((q) => q > 0) ||
    newItems.length > 0;

  const handleAddNewItem = () => {
    if (!newItemDraft.product_id) {
      toast.error("請選擇要新增的產品");
      return;
    }
    if (!newItemDraft.quantity || newItemDraft.quantity < 1) {
      toast.error("請輸入有效數量");
      return;
    }
    setNewItems((prev) => [...prev, { ...newItemDraft }]);
    setNewItemDraft({ product_id: "", variant_id: null, quantity: 1, unit_price: 0 });
  };

  const handleRemoveNewItem = (index: number) => {
    setNewItems((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleRemoving = useCallback((id: string) => {
    setRemovingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const noCandidates = poolItems.length === 0 && orderCandidates.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            銷貨單修正 {note?.code ? `（${note.code}）` : ""}
          </DialogTitle>
          <DialogDescription>
            在不失效分享 QR 碼的前提下移除／追加品項。已收款或已有會計分錄的銷貨單無法修正。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── 1. 目前品項：可勾選移除 ── */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Minus className="h-4 w-4 text-red-500" /> 移除品項（勾選後退回出貨池）
            </h4>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>產品名稱</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">單價</TableHead>
                    <TableHead className="text-right">小計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {note?.items.map((item) => {
                    const qty = item.quantity || 0;
                    const price = item.unitPrice || 0;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Checkbox
                            checked={removingIds.has(item.id)}
                            onCheckedChange={() => toggleRemoving(item.id)}
                            disabled={(item.returnedQuantity || 0) > 0}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{itemLabel(item.productName, item.variantName)}</div>
                          {!!item.returnedQuantity && (
                            <Badge variant="outline" className="mt-0.5 text-orange-600 border-orange-300 bg-orange-50">
                              已退 {item.returnedQuantity}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{qty}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(price)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(qty * price)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* ── 2. 追加品項（出貨池 / 訂單未出貨） ── */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <PoolIcon className="h-4 w-4 text-blue-500" /> 追加品項（自同店家出貨池或訂單未出貨量）
            </h4>

            {noCandidates ? (
              <div className="text-muted-foreground text-sm py-4 text-center border rounded-md">
                此店家目前沒有可追加的品項（出貨池為空、且無訂單有未出貨量）。
              </div>
            ) : (
              <>
                {poolItems.length > 0 && (
                  <div className="rounded-md border overflow-hidden">
                    <div className="bg-blue-50/60 px-3 py-1.5 text-xs font-medium text-blue-700">出貨池</div>
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>產品名稱</TableHead>
                          <TableHead className="text-right">池中量</TableHead>
                          <TableHead className="text-right">單價</TableHead>
                          <TableHead className="text-right w-28">追加數量</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {poolItems.map((p) => {
                          const oi = p.order_item;
                          const qty = addedFromPool[oi.id] || 0;
                          return (
                            <TableRow key={p.id}>
                              <TableCell>
                                <div className="font-medium text-sm">{itemLabel(oi?.product?.name, oi?.product_variant?.name)}</div>
                                {oi?.order?.code && (
                                  <div className="text-xs text-muted-foreground">訂單 {oi.order.code}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{p.quantity}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{formatCurrency(oi?.unit_price || 0)}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  max={p.quantity}
                                  className="h-8 w-20 text-right ml-auto"
                                  value={qty || ""}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val = Math.max(0, Math.min(p.quantity, Number(e.target.value) || 0));
                                    setAddedFromPool((prev) => ({ ...prev, [oi.id]: val }));
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {orderCandidates.length > 0 && (
                  <div className="rounded-md border overflow-hidden">
                    <div className="bg-indigo-50/60 px-3 py-1.5 text-xs font-medium text-indigo-700">
                      訂單未出貨品項（同店家）
                    </div>
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>產品名稱</TableHead>
                          <TableHead className="text-right">可出貨</TableHead>
                          <TableHead className="text-right">單價</TableHead>
                          <TableHead className="text-right w-28">追加數量</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderCandidates.map((c) => {
                          const qty = addedFromOrder[c.id] || 0;
                          return (
                            <TableRow key={c.id}>
                              <TableCell>
                                <div className="font-medium text-sm">{itemLabel(c.product?.name, c.product_variant?.name)}</div>
                                <div className="text-xs text-muted-foreground">訂單 {c.code}</div>
                              </TableCell>
                              <TableCell className="text-right">{c.available}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{formatCurrency(c.unit_price)}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  max={c.available}
                                  className="h-8 w-20 text-right ml-auto"
                                  value={qty || ""}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val = Math.max(0, Math.min(c.available, Number(e.target.value) || 0));
                                    setAddedFromOrder((prev) => ({ ...prev, [c.id]: val }));
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── 3. 新增品項（完全新品：自動建立訂單） ── */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <PackagePlus className="h-4 w-4 text-emerald-500" /> 新增品項（完全新品）
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-6 space-y-1">
                <Label className="text-xs text-muted-foreground">產品／變體</Label>
                <SearchableSelect
                  options={newItemOptions}
                  value={newItemDraft.variant_id || newItemDraft.product_id || null}
                  onChange={(id) => {
                    if (!id) {
                      setNewItemDraft((prev) => ({ ...prev, product_id: "", variant_id: null }));
                      return;
                    }
                    const opt = newItemOptions.find((o) => o.id === id);
                    const foundProduct = products.find((p: any) =>
                      p.id === id || (p.variants || []).some((v: any) => v.id === id)
                    );
                    const isVariant = foundProduct && id !== foundProduct.id;
                    const basePrice = isVariant
                      ? (foundProduct.variants || []).find((v: any) => v.id === id)?.retail_price || 0
                      : (foundProduct as any)?.unified_retail_price || 0;
                    setNewItemDraft((prev) => ({
                      ...prev,
                      product_id: foundProduct?.id || "",
                      variant_id: isVariant ? id : null,
                      quantity: prev.quantity || 1,
                      unit_price: basePrice || 0,
                    }));
                  }}
                  placeholder="搜尋產品／變體..."
                  searchPlaceholder="輸入產品名稱、SKU、料號..."
                  emptyText="找不到產品"
                />
              </div>
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">數量</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-9"
                  value={newItemDraft.quantity || ""}
                  onChange={(e) =>
                    setNewItemDraft((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value) || 1) }))
                  }
                />
              </div>
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">單價</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-9"
                  value={newItemDraft.unit_price || ""}
                  onChange={(e) =>
                    setNewItemDraft((prev) => ({ ...prev, unit_price: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  type="button"
                  className="w-full"
                  onClick={handleAddNewItem}
                  disabled={!newItemDraft.product_id}
                >
                  <Plus className="h-4 w-4 mr-1" /> 加入
                </Button>
              </div>
            </div>

            {newItems.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>產品名稱</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                      <TableHead className="text-right">小計</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newItems.map((it, idx) => {
                      const opt = newItemOptions.find((o) => o.id === (it.variant_id || it.product_id));
                      return (
                        <TableRow key={`${it.variant_id || it.product_id}-${idx}`}>
                          <TableCell className="font-medium text-sm">{opt?.name || "未知品項"}</TableCell>
                          <TableCell className="text-right">{it.quantity}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatCurrency(it.unit_price)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(it.quantity * it.unit_price)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRemoveNewItem(idx)}>
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* ── 確認區 ── */}
          <div className="bg-muted/30 rounded-lg px-4 py-3 space-y-1">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">原始總額</span>
              <span>{formatCurrency(originalTotal)}</span>
            </div>
            {(removingIds.size > 0 || totalAdded > 0) && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">
                  修正後（−移除 +追加）
                </span>
                <span className="font-semibold text-primary">{formatCurrency(correctedTotal)}</span>
              </div>
            )}
            {newItems.length > 0 && (
              <div className="text-xs text-amber-600 flex items-center gap-1">
                <PackagePlus className="h-3.5 w-3.5" />
                新增品項將自動建立一張新訂單（訂單與銷貨單 QR 碼不會失效）。
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={correctMutation.isPending}>
              取消
            </Button>
            <Button
              onClick={() => correctMutation.mutate()}
              disabled={correctMutation.isPending || !hasChanges}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {correctMutation.isPending ? "處理中..." : "確認修正"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}