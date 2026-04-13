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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
    className?: string;
    onRowClick?: (row: TData) => void;
}

export function DataTable<TData, TValue>({
    columns,
    data,
    isLoading,
    skeletonCount = 5,
    pagination = true,
    className,
    onRowClick,
}: DataTableProps<TData, TValue>) {
    const isManualPagination = typeof pagination === 'object';
    
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: !isManualPagination && pagination ? getPaginationRowModel() : undefined,
        manualPagination: isManualPagination,
        pageCount: isManualPagination ? pagination.pageCount : undefined,
        state: isManualPagination ? {
            pagination: {
                pageIndex: pagination.pageIndex,
                pageSize: pagination.pageSize,
            }
        } : undefined,
        onPaginationChange: isManualPagination ? (updater) => {
            if (typeof updater === 'function') {
                const newState = updater({
                    pageIndex: pagination.pageIndex,
                    pageSize: pagination.pageSize,
                });
                pagination.onPageChange(newState.pageIndex);
            }
        } : undefined,
    });

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

            {pagination && (isManualPagination || data.length > (table.getState().pagination?.pageSize || 10)) && (
                <div className="flex items-center justify-between py-2">
                    <div className="text-xs text-muted-foreground">
                        {isManualPagination && (
                            <span>第 {pagination.pageIndex + 1} 頁，共 {pagination.pageCount} 頁</span>
                        )}
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => isManualPagination ? pagination.onPageChange(pagination.pageIndex - 1) : table.previousPage()}
                            disabled={isManualPagination ? pagination.pageIndex === 0 : !table.getCanPreviousPage()}
                            className="h-8 text-xs bg-card"
                        >
                            上一頁
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => isManualPagination ? pagination.onPageChange(pagination.pageIndex + 1) : table.nextPage()}
                            disabled={isManualPagination ? pagination.pageIndex >= pagination.pageCount - 1 : !table.getCanNextPage()}
                            className="h-8 text-xs bg-card"
                        >
                            下一頁
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
