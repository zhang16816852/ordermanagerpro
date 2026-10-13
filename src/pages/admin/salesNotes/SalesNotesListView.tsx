import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { CheckSquare, Banknote, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { SalesNoteListTable } from "@/components/sales/SalesNoteListTable";
import {
  SalesNoteProductView,
  type SalesNoteAggregateItem,
} from "@/components/sales/SalesNoteProductView";
import { getPageNumbers } from "./salesNotesUtils";
import type { SalesNoteTableRow } from "./salesNotesTypes";

interface SalesNotesListViewProps {
  viewMode: "notes" | "product";
  isLoading: boolean;
  tableData: SalesNoteTableRow[] | undefined;
  isRep: boolean;
  selectedNoteIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onViewNote: (id: string) => void;
  onDelete: (id: string) => void;
  aggregatedProducts: SalesNoteAggregateItem[];
  totalPages: number;
  currentPage: number;
  visibleCount: number;
  onPageChange: (page: number) => void;
  onBatchPayment: () => void;
  onExport: () => void;
  onClearSelection: () => void;
}

export function SalesNotesListView({
  viewMode,
  isLoading,
  tableData,
  isRep,
  selectedNoteIds,
  onSelectionChange,
  onViewNote,
  onDelete,
  aggregatedProducts,
  totalPages,
  currentPage,
  visibleCount,
  onPageChange,
  onBatchPayment,
  onExport,
  onClearSelection,
}: SalesNotesListViewProps) {
  return (
    <>
      {viewMode === "notes" && selectedNoteIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-1.5 rounded-md border bg-muted/30 shrink-0">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            已選取 <strong>{selectedNoteIds.length}</strong> 張銷貨單
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-8" onClick={onClearSelection}>
            取消選取
          </Button>
          <Button size="sm" className="h-8" onClick={onBatchPayment}>
            <Banknote className="h-4 w-4 mr-1.5" />批次登記收款
          </Button>
          <Button size="sm" className="h-8" onClick={onExport}>
            <Download className="h-4 w-4 mr-1.5" />匯出 Excel
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {viewMode === "notes" ? (
          <>
            <SalesNoteListTable
              data={tableData}
              isLoading={isLoading}
              onView={(note) => onViewNote(note.id)}
              onDelete={onDelete}
              showStoreColumn={true}
              showProfit={!isRep}
              selectable={true}
              selectedIds={selectedNoteIds}
              onSelectionChange={onSelectionChange}
            />
            {totalPages > 1 && (
              <div className="flex flex-col items-center justify-between gap-2 py-2 sm:flex-row">
                <div className="text-sm text-muted-foreground">
                  共 {visibleCount} 筆，第 {currentPage}/{totalPages} 頁
                </div>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        className={cn(
                          "h-8 w-8 border-none p-0",
                          currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
                        )}
                        aria-label="上一頁"
                        onClick={() => onPageChange(currentPage - 1)}
                      />
                    </PaginationItem>
                    {getPageNumbers(currentPage, totalPages).map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`ellipsis-${i}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            href="#"
                            className={cn(
                              "h-8 w-8 border-none p-0",
                              p === currentPage ? "" : "cursor-pointer"
                            )}
                            isActive={p === currentPage}
                            onClick={(e) => {
                              e.preventDefault();
                              onPageChange(p);
                            }}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext
                        className={cn(
                          "h-8 w-8 border-none p-0",
                          currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                        )}
                        aria-label="下一頁"
                        onClick={() => onPageChange(currentPage + 1)}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        ) : (
          <SalesNoteProductView
            items={aggregatedProducts}
            isLoading={isLoading}
            onViewNote={(noteId) => onViewNote(noteId)}
          />
        )}
      </div>
    </>
  );
}
