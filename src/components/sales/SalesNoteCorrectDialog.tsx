import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessages";
import { useProductCache } from "@/hooks/useProductCache";
import type { SalesNoteCorrectDialogProps, CorrectAddItem, CorrectNewItem, PriceChange } from "./salesNoteCorrectTypes";
import { useSalesNoteCorrectQueries } from "./useSalesNoteCorrectQueries";
import { CorrectPriceTable } from "./CorrectPriceTable";
import { CorrectRemoveTable } from "./CorrectRemoveTable";
import { CorrectAddTable } from "./CorrectAddTable";
import { CorrectNewItemSection } from "./CorrectNewItemSection";
import { CorrectSummary } from "./CorrectSummary";
import { itemLabel } from "./salesNoteCorrectTypes";

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
    const [newItems, setNewItems] = useState<CorrectNewItem[]>([]);
    const [priceEdits, setPriceEdits] = useState<Record<string, number>>({});

    useEffect(() => {
        if (open) {
            setRemovingIds(new Set());
            setAddedFromPool({});
            setAddedFromOrder({});
            setNewItems([]);
            setPriceEdits({});
        }
    }, [open, note?.id]);

    const { otherNoteRefs, poolItems, orderCandidates } = useSalesNoteCorrectQueries(note, open);

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

    // ─── 價格變更清單 ───
    const priceChanges = useMemo(() => {
        const changed: PriceChange[] = [];
        for (const it of note?.items || []) {
            const oiId = it.orderItemId;
            if (!oiId) continue;
            const newPrice = priceEdits[oiId];
            if (newPrice === undefined) continue;
            const oldPrice = it.unitPrice || 0;
            if (newPrice === oldPrice) continue;
            const otherNotes = otherNoteRefs[oiId] || [];
            changed.push({
                itemId: it.id,
                orderItemId: oiId,
                orderCode: it.orderCode,
                label: itemLabel(it.productName, it.variantName),
                oldPrice,
                newPrice,
                quantity: it.quantity || 1,
                otherNotes,
                blocked: otherNotes.some((n) => n.payment_status === "paid"),
            });
        }
        return changed;
    }, [note?.items, priceEdits, otherNoteRefs]);

    const priceChangeTotal = useMemo(
        () => priceChanges.reduce((sum, c) => sum + (c.newPrice - c.oldPrice) * c.quantity, 0),
        [priceChanges]
    );
    const hasBlockedPriceChange = priceChanges.some((c) => c.blocked);

    const handlePriceEdit = (orderItemId: string, val: number, oldPrice: number) => {
        setPriceEdits((prev) => {
            const next = { ...prev };
            if (val === oldPrice) delete next[orderItemId];
            else next[orderItemId] = val;
            return next;
        });
    };

    const toggleRemoving = (id: string) => {
        setRemovingIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

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
                p_price_updates: priceChanges.map((c) => ({
                    order_item_id: c.orderItemId,
                    new_unit_price: c.newPrice,
                })),
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
        newItems.length > 0 ||
        priceChanges.length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Pencil className="h-5 w-5 text-primary" />
                        銷貨單修正 {note?.code ? `（${note.code}）` : ""}
                    </DialogTitle>
                    <DialogDescription>
                        在不失效分享 QR 碼的前提下移除／追加品項或調整價格。已收款或已有會計分錄的銷貨單無法修正。
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <CorrectPriceTable
                        items={note?.items || []}
                        priceEdits={priceEdits}
                        onPriceEdit={handlePriceEdit}
                        otherNoteRefs={otherNoteRefs}
                    />

                    <CorrectRemoveTable
                        items={note?.items || []}
                        removingIds={removingIds}
                        onToggle={toggleRemoving}
                    />

                    <CorrectAddTable
                        poolItems={poolItems}
                        orderCandidates={orderCandidates}
                        addedFromPool={addedFromPool}
                        setAddedFromPool={setAddedFromPool}
                        addedFromOrder={addedFromOrder}
                        setAddedFromOrder={setAddedFromOrder}
                    />

                    <CorrectNewItemSection
                        products={products}
                        newItems={newItems}
                        onAddItem={(item) => setNewItems((prev) => [...prev, item])}
                        onRemoveItem={(index) => setNewItems((prev) => prev.filter((_, i) => i !== index))}
                    />

                    <CorrectSummary
                        originalTotal={originalTotal}
                        correctedTotal={correctedTotal}
                        totalAdded={totalAdded}
                        hasRemovals={removingIds.size > 0}
                        priceChanges={priceChanges}
                        priceChangeTotal={priceChangeTotal}
                        hasNewItems={newItems.length > 0}
                    />

                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={correctMutation.isPending}>
                            取消
                        </Button>
                        <Button
                            onClick={() => correctMutation.mutate()}
                            disabled={correctMutation.isPending || !hasChanges || hasBlockedPriceChange}
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