import { useState, useMemo, useLayoutEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import type { DateRange } from "react-day-picker";
import type { SalesNoteRow } from "./salesNotes/salesNotesTypes";
import type { BatchEligibleNote } from "@/components/sales/SalesNoteBatchPaymentDialog";
import { useSalesNotesData } from "./salesNotes/useSalesNotesData";
import { useSalesNotesMutations } from "./salesNotes/useSalesNotesMutations";
import { exportSalesNotesExcel } from "./salesNotes/salesNotesUtils";
import { SalesNotesHeader } from "./salesNotes/SalesNotesHeader";
import { SalesNotesSummary } from "./salesNotes/SalesNotesSummary";
import { SalesNotesFilterBar } from "./salesNotes/SalesNotesFilterBar";
import { SalesNotesListView } from "./salesNotes/SalesNotesListView";
import { SalesNotesDialogs } from "./salesNotes/SalesNotesDialogs";

export default function AdminSalesNotes() {
  const { setPageHeader } = usePageHeader();

  // 「銷售單管理」標題交由共用 Header 呈現（桌面/手機皆適用），省下頁面內大標題空間
  useLayoutEffect(() => {
    setPageHeader({ title: "銷售單管理" });
    return () => setPageHeader(null);
  }, [setPageHeader]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [viewMode, setViewMode] = useState<"notes" | "product">(() => {
    const v = searchParams.get("view");
    return v === "product" ? "product" : "notes";
  });
  const [storeFilter, setStoreFilter] = useState<string[]>(() => {
    const raw = searchParams.get("store");
    if (!raw || raw === "all") return [];
    return raw.split(",").filter(Boolean);
  });
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get("status") || "all");
  const [repFilter, setRepFilter] = useState<string>(searchParams.get("rep") || "all");
  const [businessFilter, setBusinessFilter] = useState<string>(searchParams.get("business") || "all");
  const [selectedNote, setSelectedNote] = useState<SalesNoteRow | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [batchPaymentOpen, setBatchPaymentOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
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

  const {
    stores,
    repsData,
    isLoading,
    salesNotes,
    filteredNotes,
    visibleNotes,
    aggregatedProducts,
    totalPages,
    currentPage,
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
  } = useSalesNotesData({
    search,
    storeFilter,
    statusFilter,
    repFilter,
    businessFilter,
    dateRange,
    selectedNote,
  });

  const { deleteMutation } = useSalesNotesMutations();

  const productCount = aggregatedProducts.length;
  const totalCount = visibleNotes.length;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("search", value);
      else next.delete("search");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleStoreFilterChange = (value: string[]) => {
    setStoreFilter(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value.length > 0) next.set("store", value.join(","));
      else next.delete("store");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleRepFilterChange = (value: string) => {
    setRepFilter(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all") next.set("rep", value);
      else next.delete("rep");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleBusinessFilterChange = (value: string) => {
    setBusinessFilter(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all") next.set("business", value);
      else next.delete("business");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value !== "all") next.set("status", value);
      else next.delete("status");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (range?.from) next.set("from", format(range.from, "yyyy-MM-dd"));
      else next.delete("from");
      if (range?.to) next.set("to", format(range.to, "yyyy-MM-dd"));
      else next.delete("to");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleClearDateRange = () => {
    setDateRange(undefined);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("from");
      next.delete("to");
      next.delete("page");
      return next;
    }, { replace: true });
  };

  const handleViewModeChange = (mode: "notes" | "product") => {
    setViewMode(mode);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "product") next.set("view", "product");
      else next.delete("view");
      return next;
    }, { replace: true });
  };

  const handleViewNote = (id: string) => {
    const fullNote = salesNotes?.find((n) => n.id === id);
    if (fullNote) setSelectedNote(fullNote);
  };

  const handleDelete = (id: string) => {
    const target = salesNotes?.find((n) => n.id === id);
    if (target?.status === "received") {
      toast.error("已收貨的銷貨單不可刪除", { description: `單號 ${target.code || id.slice(0, 8)} 已簽收，屬收款憑證不可作廢刪除。` });
      return;
    }
    if (window.confirm("確定要刪除此銷貨單嗎？\n\n注意：刪除後，商品將會回滾至出貨池（變回未出貨狀態）。寄賣收款單（已收貨）不可刪除。")) {
      deleteMutation.mutate(id);
    }
  };

  const batchEligibleNotes = useMemo<BatchEligibleNote[]>(
    () =>
      (filteredNotes || [])
        .filter((note) => selectedNoteIds.includes(note.id) && note.payment_status !== "paid")
        .map((note) => ({
          id: note.id,
          code: note.code || note.id.slice(0, 8),
          storeId: note.store_id,
          storeName: note.store?.name ?? undefined,
          created_at: note.created_at,
          totalAmount:
            (note.sales_note_items || []).reduce(
              (sum, item) => sum + (item.quantity * (item.order_item?.unit_price || 0)),
              0
            ) + (note.shipping_fee || 0),
        })),
    [filteredNotes, selectedNoteIds]
  );

  const handleOpenBatchPayment = () => {
    if (batchEligibleNotes.length === 0) {
      toast.info("選取的銷貨單均已收款或金額為 0");
      return;
    }
    setBatchPaymentOpen(true);
  };

  const handleExport = () => {
    exportSalesNotesExcel(salesNotes, selectedNoteIds);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-6.5rem)] overflow-hidden space-y-4">
      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <SalesNotesHeader
          viewMode={viewMode}
          isRep={isRep}
          onViewModeChange={handleViewModeChange}
          onImport={() => setImportOpen(true)}
          onStatement={() => setStatementOpen(true)}
        />
        <CardContent className="flex-1 min-h-0 overflow-hidden flex flex-col px-4 pb-4">
          <SalesNotesSummary
            viewMode={viewMode}
            productCount={productCount}
            productTotalQty={productTotalQty}
            productTotalAmount={productTotalAmount}
            totalCount={totalCount}
            unreceivedCount={unreceivedCount}
            receivedCount={receivedCount}
            totalAmount={totalAmount}
            repSummary={repSummary}
          />
          <SalesNotesFilterBar
            viewMode={viewMode}
            search={search}
            onSearchChange={handleSearchChange}
            stores={stores}
            storeFilter={storeFilter}
            onStoreFilterChange={handleStoreFilterChange}
            repsData={repsData}
            repFilter={repFilter}
            onRepFilterChange={handleRepFilterChange}
            businessFilter={businessFilter}
            onBusinessFilterChange={handleBusinessFilterChange}
            dateRange={dateRange}
            onDateRangeChange={handleDateRangeChange}
            onClearDateRange={handleClearDateRange}
            statusFilter={statusFilter}
            onStatusFilterChange={handleStatusFilterChange}
            aggregatedProducts={aggregatedProducts}
          />
          <SalesNotesListView
            viewMode={viewMode}
            isLoading={isLoading}
            tableData={tableData}
            isRep={isRep}
            selectedNoteIds={selectedNoteIds}
            onSelectionChange={setSelectedNoteIds}
            onViewNote={handleViewNote}
            onDelete={handleDelete}
            aggregatedProducts={aggregatedProducts}
            totalPages={totalPages}
            currentPage={currentPage}
            visibleCount={totalCount}
            onPageChange={setPage}
            onBatchPayment={handleOpenBatchPayment}
            onExport={handleExport}
            onClearSelection={() => setSelectedNoteIds([])}
          />
        </CardContent>
      </Card>

      <SalesNotesDialogs
        selectedNote={selectedNote}
        dialogData={dialogData}
        onCloseDetail={() => setSelectedNote(null)}
        isRep={isRep}
        batchPaymentOpen={batchPaymentOpen}
        onBatchPaymentOpenChange={setBatchPaymentOpen}
        batchEligibleNotes={batchEligibleNotes}
        onBatchCompleted={() => setSelectedNoteIds([])}
        importOpen={importOpen}
        onImportOpenChange={setImportOpen}
        statementOpen={statementOpen}
        onStatementOpenChange={setStatementOpen}
      />
    </div>
  );
}
