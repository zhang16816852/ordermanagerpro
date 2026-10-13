import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { DateRange } from "react-day-picker";
import { useRepCommission } from "@/hooks/useRepCommission";
import { useRepStoreAssignments } from "@/hooks/useRepStoreAssignments";
import { useDocumentProfit, type DocProfitInputItem } from "@/hooks/useDocumentProfit";
import { useBusinessProfitCalculator, businessProfitSummary } from "@/hooks/useBusinessProfit";
import { sumProfit, type ProfitLine, type ProfitSummary } from "@/utils/grossProfit";
import type { SalesNoteAggregateItem } from "@/components/sales/SalesNoteProductView";
import type { SalesNoteDetail } from "@/components/sales/SalesNoteDetailDialog";
import { useSalesNotesQueries } from "./useSalesNotesQueries";
import type { SalesNoteRow, SalesNoteTableRow, RepSalesSummary } from "./salesNotesTypes";

interface UseSalesNotesDataArgs {
  search: string;
  storeFilter: string[];
  statusFilter: string;
  repFilter: string;
  businessFilter: string;
  dateRange: DateRange | undefined;
  selectedNote: SalesNoteRow | null;
}

export function useSalesNotesData({
  search,
  storeFilter,
  statusFilter,
  repFilter,
  businessFilter,
  dateRange,
  selectedNote,
}: UseSalesNotesDataArgs) {
  const [, setSearchParams] = useSearchParams();

  const { stores, repsData, isLoading, salesNotes } = useSalesNotesQueries({
    storeFilter,
    statusFilter,
    repFilter,
    dateRange,
  });

  const { isRepStore, repNameOf, assignments } = useRepStoreAssignments();

  const filteredNotes = salesNotes?.filter((note) => {
    const searchLower = search.toLowerCase();
    if (businessFilter !== "all") {
      const hasBusiness = isRepStore(note.store_id);
      if (businessFilter === "with" && !hasBusiness) return false;
      if (businessFilter === "without" && hasBusiness) return false;
    }
    return (
      note.id.toLowerCase().includes(searchLower) ||
      (note.code && note.code.toLowerCase().includes(searchLower)) ||
      (note.store?.name?.toLowerCase().includes(searchLower)) ||
      (note.store?.code?.toLowerCase().includes(searchLower))
    );
  });

  const aggregatedProducts = useMemo<SalesNoteAggregateItem[]>(() => {
    const map = new Map<string, SalesNoteAggregateItem>();
    for (const note of salesNotes || []) {
      for (const item of note.sales_note_items || []) {
        const oi = item.order_item;
        if (!oi) continue;
        const name = oi.product_variant?.name || oi.product?.name || "未知產品";
        const sku = oi.product?.code || "-";
        const qty = item.quantity || 0;
        const unit = oi.unit_price || 0;
        const key = `${oi.product_id}_${oi.variant_id || "null"}`;
        let entry = map.get(key);
        if (!entry) {
          entry = {
            productId: oi.product_id,
            variantId: oi.variant_id ?? null,
            productName: name,
            sku,
            totalQuantity: 0,
            totalAmount: 0,
            avgUnitPrice: 0,
            noteBreakdown: [],
          };
          map.set(key, entry);
        }
        let breakdown = entry.noteBreakdown.find((b) => b.salesNoteId === note.id);
        if (!breakdown) {
          breakdown = {
            salesNoteId: note.id,
            salesNoteCode: note.code || note.id.slice(0, 8),
            storeName: note.store?.name || "-",
            quantity: 0,
            amount: 0,
          };
          entry.noteBreakdown.push(breakdown);
        }
        breakdown.quantity += qty;
        breakdown.amount += qty * unit;
        entry.totalQuantity += qty;
        entry.totalAmount += qty * unit;
      }
    }
    let products = Array.from(map.values());
    for (const p of products) {
      p.avgUnitPrice = p.totalQuantity > 0 ? p.totalAmount / p.totalQuantity : 0;
    }
    const keyword = search.trim().toLowerCase();
    if (keyword) {
      products = products.filter(
        (p) => p.productName.toLowerCase().includes(keyword) || p.sku.toLowerCase().includes(keyword)
      );
    }
    products.sort((a, b) => b.totalAmount - a.totalAmount);
    return products;
  }, [salesNotes, search]);

  const visibleNotes = useMemo(() => filteredNotes ?? [], [filteredNotes]);

  const [searchParams] = useSearchParams();
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("size")) || 20));
  const totalPages = Math.max(1, Math.ceil(visibleNotes.length / pageSize));
  const currentPage = Math.min(Math.max(1, Number(searchParams.get("page")) || 1), totalPages);
  const pagedNotes = useMemo(
    () => visibleNotes.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [visibleNotes, currentPage, pageSize],
  );
  const setPage = (page: number) => {
    const clamped = Math.min(Math.max(1, page), totalPages);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (clamped <= 1) next.delete("page");
      else next.set("page", String(clamped));
      return next;
    }, { replace: true });
  };

  const unreceivedCount = visibleNotes.filter(n => n.payment_status !== "paid").length;
  const receivedCount = visibleNotes.filter(n => n.payment_status === "paid").length;
  const totalAmount = visibleNotes.reduce((sum, note) =>
    sum + (note.sales_note_items || []).reduce((s, item) =>
      s + (item.quantity * (item.order_item?.unit_price || 0)), 0
    ), 0
  );

  const productTotalQty = aggregatedProducts.reduce((s, p) => s + p.totalQuantity, 0);
  const productTotalAmount = aggregatedProducts.reduce((s, p) => s + p.totalAmount, 0);

  // 利潤／毛利：把全部可見單據的品項攤平後一次計算，再依 noteId 分組
  // （單一 useDocumentProfit 呼叫 → 只有一份成本查詢）
  const profitInput = useMemo<DocProfitInputItem[]>(() => {
    const rows: DocProfitInputItem[] = [];
    for (const note of visibleNotes) {
      for (const item of note.sales_note_items || []) {
        const oi = item.order_item;
        if (!oi) continue;
        rows.push({
          key: `${note.id}:${item.id}`,
          productId: oi.product_id,
          variantId: oi.variant_id ?? null,
          // 退貨列以負數傳入，營業額與成本同為負自然對沖
          quantity: oi.line_type === 'return' ? -(item.quantity || 0) : item.quantity || 0,
          unitPrice: oi.unit_price || 0,
          snapshotCost: oi.unit_cost ?? null,
          lineType: oi.line_type ?? null,
        });
      }
    }
    return rows;
  }, [visibleNotes]);

  const docProfit = useDocumentProfit(profitInput);

  const profitByNoteId = useMemo(() => {
    const grouped = new Map<string, ProfitLine[]>();
    for (const row of profitInput) {
      const noteId = row.key.slice(0, row.key.lastIndexOf(':'));
      const line = docProfit.byKey.get(row.key);
      if (!line) continue;
      const list = grouped.get(noteId);
      if (list) list.push(line);
      else grouped.set(noteId, [line]);
    }
    const out = new Map<string, ProfitSummary>();
    for (const [noteId, lines] of grouped) out.set(noteId, sumProfit(lines));
    return out;
  }, [profitInput, docProfit.byKey]);

  // 有業務門市的單據改顯示「業務利潤／估佣」（與毛利互斥）
  // 業務口徑：快照 → rep_product_costs → 變體批發價（與 useRepCommission 一致）
  const { calcForStore, costOf } = useBusinessProfitCalculator(assignments.map((a) => a.rep_id));
  const businessProfitByNoteId = useMemo(() => {
    const map = new Map<string, { profit: number; commission: number; repName: string; summary: ProfitSummary }>();
    for (const note of visibleNotes) {
      if (!isRepStore(note.store_id)) continue;
      const items = (note.sales_note_items || []).map((item) => ({
        productId: item.order_item?.product_id,
        variantId: item.order_item?.variant_id ?? null,
        quantity: item.order_item?.line_type === 'return' ? -(item.quantity || 0) : item.quantity || 0,
        unitPrice: item.order_item?.unit_price || 0,
        snapshotCost: item.order_item?.unit_cost ?? null,
        lineType: item.order_item?.line_type,
      }));
      const res = calcForStore(note.store_id, items);
      if (!res) continue;
      const gross = profitByNoteId.get(note.id);
      map.set(note.id, {
        profit: res.profit,
        commission: res.commission,
        repName: res.repName ?? '未命名業務',
        summary: businessProfitSummary(gross?.revenue ?? 0, res),
      });
    }
    return map;
  }, [visibleNotes, isRepStore, calcForStore, profitByNoteId]);

  // 業務佣金彙總（僅業務身分顯示）
  const { isRep, computeOrder: computeRepOrder } = useRepCommission();
  const repSummary = useMemo<RepSalesSummary | null>(() => {
    if (!isRep) return null;
    const lines: { productId: string; variantId?: string | null; unitPrice: number; quantity: number }[] = [];
    for (const note of filteredNotes || []) {
      for (const item of note.sales_note_items || []) {
        const oi = item.order_item;
        if (!oi) continue;
        lines.push({
          productId: oi.product_id,
          variantId: oi.variant_id ?? null,
          unitPrice: oi.unit_price || 0,
          quantity: item.quantity || 0,
        });
      }
    }
    return computeRepOrder(lines);
  }, [isRep, filteredNotes, computeRepOrder]);

  // Map data for the table component
  const tableData: SalesNoteTableRow[] | undefined = (filteredNotes ? pagedNotes : undefined)?.map(note => ({
    id: note.id,
    code: note.code ?? undefined,
    storeName: note.store?.name ?? undefined,
    storeCode: note.store?.code ?? undefined,
    status: note.status,
    payment_status: note.payment_status ?? undefined,
    access_token: note.access_token,
    itemCount: note.sales_note_items?.length || 0,
    totalQty: (note.sales_note_items || []).reduce((s, i) => s + (i.quantity || 0), 0),
    amount: (note.sales_note_items || []).reduce((s, i) => s + (i.quantity || 0) * (i.order_item?.unit_price || 0), 0),
    hasReturned: (note.sales_note_items || []).some((i) => (i.returned_quantity || 0) > 0),
    created_at: note.created_at,
    shipped_at: note.shipped_at,
    received_at: note.received_at,
    // 有業務門市 → 只顯示業務利潤／估佣；無業務門市 → 只顯示毛利／毛利率（互斥）
    profit: (() => {
      const biz = businessProfitByNoteId.get(note.id);
      if (biz) return biz.summary;
      return profitByNoteId.get(note.id) || null;
    })(),
    profitMode: (isRepStore(note.store_id) ? "business" : "gross") as "business" | "gross",
    commission: businessProfitByNoteId.get(note.id)?.commission ?? null,
    repName: repNameOf(note.store_id),
  }));

  // Map data for the dialog component — use live query data so edits refresh immediately
  const dialogData: SalesNoteDetail | null = selectedNote ? (() => {
    const live = salesNotes?.find((n) => n.id === selectedNote.id) ?? selectedNote;
    return {
      id: live.id,
      code: live.code ?? undefined,
      store_id: live.store_id,
      storeName: live.store?.name ?? undefined,
      storeCode: live.store?.code ?? undefined,
      status: live.status,
      payment_status: live.payment_status ?? undefined,
      created_at: live.created_at,
      shipped_at: live.shipped_at,
      received_at: live.received_at,
      notes: live.notes,
      access_token: live.access_token,
      delivery_type: live.delivery_type,
      shipping_fee: live.shipping_fee,
      shipping_cost: live.shipping_cost,
      delivery_method_id: live.delivery_method_id,
      delivery_method_title: live.delivery_method_title,
      delivery_method_code: live.delivery_method_code,
      shipping_address: live.shipping_address,
      // 利潤／毛利：有業務門市顯示業務利潤與估佣，無業務門市顯示毛利（互斥）
      profit: (() => {
        const biz = businessProfitByNoteId.get(live.id);
        if (biz) return biz.summary;
        return profitByNoteId.get(live.id) || null;
      })(),
      profitMode: (isRepStore(live.store_id) ? "business" : "gross") as "business" | "gross",
      commission: businessProfitByNoteId.get(live.id)?.commission ?? null,
      repName: repNameOf(live.store_id),
      items: [...(live.sales_note_items || [])]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((item) => {
          const line = docProfit.byKey.get(`${live.id}:${item.id}`);
          // 有業務門市時逐列成本改用「業務口徑」，避免總額是業務利潤但明細成本是毛利口徑
          const bizLine = isRepStore(live.store_id)
            ? costOf(live.store_id, {
                productId: item.order_item?.product_id,
                variantId: item.order_item?.variant_id ?? null,
                quantity: item.quantity || 0,
                unitPrice: item.order_item?.unit_price || 0,
                snapshotCost: item.order_item?.unit_cost ?? null,
                lineType: item.order_item?.line_type,
              })
            : null;
          return {
            id: item.id,
            orderItemId: item.order_item?.id,
            orderCode: item.order_item?.order?.code ?? undefined,
            quantity: item.quantity,
            returnedQuantity: item.returned_quantity ?? 0,
            productName: item.order_item?.product?.name || "未知產品",
            productSku: item.order_item?.product?.code || "-",
            variantName: item.order_item?.product_variant?.name,
            unitPrice: item.order_item?.unit_price ?? undefined,
            unitCost: bizLine ? bizLine.unitCost : line?.cost ?? null,
            costKnown: bizLine ? bizLine.costKnown : line?.costKnown ?? false,
            lineType: item.order_item?.line_type,
            lineNote: item.order_item?.line_note,
            sortOrder: item.sort_order ?? 0,
          };
        })
    };
  })() : null;

  return {
    stores,
    repsData,
    isLoading,
    salesNotes,
    filteredNotes,
    visibleNotes,
    aggregatedProducts,
    pageSize,
    totalPages,
    currentPage,
    pagedNotes,
    setPage,
    unreceivedCount,
    receivedCount,
    totalAmount,
    productTotalQty,
    productTotalAmount,
    tableData,
    dialogData,
    repSummary,
    isRep,
  };
}
