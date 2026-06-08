import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Upload, AlertCircle } from "lucide-react";

export interface ImportColumn<T = any> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  render?: (value: any, row: T, index: number) => React.ReactNode;
}

interface ImportPreviewDialogProps<T = any> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  data: T[];
  columns: ImportColumn<T>[];
  onConfirm: () => void;
  isLoading?: boolean;
  confirmText?: string;
  error?: string | null;
  summary?: React.ReactNode;
  statusKey?: string;
}

export function ImportPreviewDialog<T extends Record<string, any>>({
  open,
  onOpenChange,
  title,
  description,
  data,
  columns,
  onConfirm,
  isLoading = false,
  confirmText = "確認匯入",
  error = null,
  summary,
  statusKey,
}: ImportPreviewDialogProps<T>) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  useEffect(() => {
    setStatusFilter(null);
    console.log(data)
  }, [data]);

  const statusCounts = useMemo(() => {
    if (!statusKey) return null;
    const counts = new Map<string, number>();
    data.forEach((row) => {
      const val = row[statusKey];
      if (val != null) counts.set(val, (counts.get(val) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data, statusKey]);

  const filteredData = useMemo(() => {
    let result = data;
    if (statusFilter && statusKey) {
      result = result.filter((row) => row[statusKey] === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((row) =>
        columns.some((col) => {
          const val = row[col.key];
          return val != null && String(val).toLowerCase().includes(q);
        })
      );
    }
    return result;
  }, [data, search, columns, statusFilter, statusKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Upload className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-sm px-3 py-1">
              共 {data.length} 筆
            </Badge>
            {filteredData.length < data.length && (
              <Badge variant="outline" className="text-sm">
                篩選後 {filteredData.length} 筆
              </Badge>
            )}
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
        </div>

        {summary && <div className="px-6">{summary}</div>}

        {statusCounts && (
          <div className="px-6 pt-1 flex flex-wrap gap-2">
            <Button
              variant={statusFilter === null ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(null)}
              className="h-7 text-xs"
            >
              全部 {data.length}
            </Button>
            {statusCounts.map(([status, count]) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                className="h-7 text-xs"
              >
                {status} {count}
              </Button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-auto px-6 py-2 min-h-0">
          <div className="border rounded-md">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-10 text-center text-xs text-muted-foreground">#</TableHead>
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={`text-${col.align || "left"}`}
                      style={{ width: col.width, minWidth: col.width }}
                    >
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">
                      無符合資料
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((row, i) => (
                    <TableRow key={i} className="hover:bg-muted/50">
                      <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                      {columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={`text-${col.align || "left"} text-sm`}
                        >
                          {col.render
                            ? col.render(row[col.key], row, i)
                            : row[col.key] != null
                              ? String(row[col.key])
                              : "-"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {error && (
          <div className="px-6">
            <div className="flex items-center gap-2 text-destructive bg-destructive/5 p-3 rounded-md text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          </div>
        )}

        <DialogFooter className="p-6 pt-4 border-t">
          <Button variant="outline" onClick={() => { setSearch(""); onOpenChange(false); }} disabled={isLoading}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={isLoading || data.length === 0}>
            {isLoading ? "處理中..." : `${confirmText} (${data.length} 筆)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
