import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getPaginationRowModel,
} from "@tanstack/react-table";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
    PaginationEllipsis,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function getPageNumbers(page: number, totalPages: number): (number | 'ellipsis')[] {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (page > 3) pages.push('ellipsis');
        const start = Math.max(2, page - 1);
        const end = Math.min(totalPages - 1, page + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (page < totalPages - 2) pages.push('ellipsis');
        pages.push(totalPages);
    }
    return pages;
}

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    isLoading?: boolean;
    skeletonCount?: number;
    pagination?: boolean | {
        pageIndex: number;
        pageSize: number;
        pageCount: number;
        onPageChange: (pageIndex: number) => void;
    };
    pageIndex?: number;
    pageSize?: number;
    onPageIndexChange?: (pageIndex: number) => void;
    className?: string;
    onRowClick?: (row: TData) => void;
}

export function DataTable<TData, TValue>({
    columns,
    data,
    isLoading,
    skeletonCount = 5,
    pagination = true,
    pageIndex,
    pageSize,
    onPageIndexChange,
    className,
    onRowClick,
}: DataTableProps<TData, TValue>) {
    const isManualPagination = typeof pagination === 'object';
    const isControlled = !isManualPagination && !!pagination && pageIndex !== undefined && !!onPageIndexChange;
    const resolvedPageSize = pageSize ?? 10;

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: !isManualPagination && pagination ? getPaginationRowModel() : undefined,
        manualPagination: isManualPagination,
        ...(isManualPagination ? {
            pageCount: pagination.pageCount,
            state: {
                pagination: {
                    pageIndex: pagination.pageIndex,
                    pageSize: pagination.pageSize,
                }
            },
            onPaginationChange: (updater: any) => {
                if (typeof updater === 'function') {
                    const newState = updater({
                        pageIndex: pagination.pageIndex,
                        pageSize: pagination.pageSize,
                    });
                    pagination.onPageChange(newState.pageIndex);
                }
            },
        } : isControlled ? {
            state: {
                pagination: {
                    pageIndex,
                    pageSize: resolvedPageSize,
                }
            },
            autoResetPageIndex: false,
            onPaginationChange: (updater: any) => {
                const prev = { pageIndex, pageSize: resolvedPageSize };
                const next = typeof updater === 'function' ? updater(prev) : updater;
                onPageIndexChange?.(next.pageIndex);
            },
        } : {}),
    });

    const currentPageIndex = isManualPagination
        ? pagination.pageIndex
        : isControlled
            ? (pageIndex ?? 0)
            : table.getState().pagination.pageIndex;
    const totalPages = isManualPagination ? pagination.pageCount : table.getPageCount();
    const showPager = !!pagination && totalPages > 1;

    const goToPage = (idx: number) => {
        if (idx < 0 || idx > totalPages - 1) return;
        if (isManualPagination) pagination.onPageChange(idx);
        else if (isControlled) onPageIndexChange?.(idx);
        else table.setPageIndex(idx);
    };

    return (
        <div className={cn("space-y-4", className)}>
            <div className="rounded-xl border bg-card shadow-soft overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id} className="hover:bg-transparent border-b">
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id} className="text-xs font-bold text-muted-foreground py-4">
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: skeletonCount }).map((_, i) => (
                                <TableRow key={i}>
                                    {columns.map((_, j) => (
                                        <TableCell key={j} className="py-4">
                                            <Skeleton className="h-4 w-full opacity-50" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    onClick={() => onRowClick?.(row.original)}
                                    className={cn(
                                        "hover:bg-muted/30 transition-colors border-b last:border-0",
                                        onRowClick && "cursor-pointer"
                                    )}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="py-2.5 text-sm">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground border-none">
                                    尚無符合條件的資料
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {showPager && (
                <div className="flex flex-col items-center justify-between gap-2 py-2 sm:flex-row">
                    <div className="text-xs text-muted-foreground">
                        {isManualPagination ? (
                            <span>第 {pagination.pageIndex + 1} 頁，共 {pagination.pageCount} 頁</span>
                        ) : (
                            <span>共 {data.length} 筆，第 {currentPageIndex + 1}/{totalPages} 頁</span>
                        )}
                    </div>
                    <Pagination className="mx-0 w-auto justify-end">
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    onClick={() => goToPage(currentPageIndex - 1)}
                                    className={currentPageIndex <= 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                />
                            </PaginationItem>
                            {getPageNumbers(currentPageIndex + 1, totalPages).map((p, i) =>
                                p === 'ellipsis' ? (
                                    <PaginationItem key={`ellipsis-${i}`}>
                                        <PaginationEllipsis />
                                    </PaginationItem>
                                ) : (
                                    <PaginationItem key={p}>
                                        <PaginationLink
                                            isActive={p === currentPageIndex + 1}
                                            onClick={() => goToPage(p - 1)}
                                            className="cursor-pointer"
                                        >
                                            {p}
                                        </PaginationLink>
                                    </PaginationItem>
                                )
                            )}
                            <PaginationItem>
                                <PaginationNext
                                    onClick={() => goToPage(currentPageIndex + 1)}
                                    className={currentPageIndex >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            )}
        </div>
    );
}
