import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SalesNoteDetail } from "./SalesNoteDetailDialog";
import type { PoolItem, OrderItemCandidate, NoteReference } from "./salesNoteCorrectTypes";

export function useSalesNoteCorrectQueries(note: SalesNoteDetail | null, open: boolean) {
    const storeId = note?.store_id;
    const noteOrderItemIds = useMemo(() =>
        (note?.items || []).map((i) => i.orderItemId).filter((x): x is string => !!x),
    [note?.items]);

    // ─── 其他銷貨單對同一 order_item 的引用（警告用） ───
    const { data: otherNoteRefs = {} } = useQuery({
        queryKey: ["sales-note-correct-other-refs", note?.id, noteOrderItemIds.join(",")],
        queryFn: async () => {
            if (!note?.id || noteOrderItemIds.length === 0) return {};
            const { data, error } = await (supabase
                .from("sales_note_items") as any)
                .select("order_item_id, sales_notes!inner(code, payment_status)")
                .in("order_item_id", noteOrderItemIds)
                .neq("sales_note_id", note.id);
            if (error) throw error;
            const map: Record<string, NoteReference[]> = {};
            (data || []).forEach((r: any) => {
                const sn = r.sales_notes;
                if (!sn) return;
                (Array.isArray(sn) ? sn : [sn]).forEach((n: any) => {
                    if (!map[r.order_item_id]) map[r.order_item_id] = [];
                    map[r.order_item_id].push({ code: n.code, payment_status: n.payment_status });
                });
            });
            return map;
        },
        enabled: open && !!note?.id && noteOrderItemIds.length > 0,
    });

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

    return { noteOrderItemIds, otherNoteRefs, poolItems, orderCandidates };
}