import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SalesNoteStatusBadge } from "./SalesNoteStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Json } from "@/integrations/supabase/types";
import { Eye, Trash2, Copy, Calendar, Package, Store } from "lucide-react";
interface SalesNoteSummary {
    id: string;
    code?: string;
    storeName?: string;
    storeCode?: string;
    status: string;
    itemCount: number;
    access_token?: string | null;
    created_at: string;
    shipped_at?: string | null;
    received_at?: string | null;
}

interface SalesNoteListTableProps {
    data: SalesNoteSummary[] | undefined;
    isLoading: boolean;
    onView: (note: any) => void; // Using any for now as the specialized data object might differ, but we pass the original object back
    onDelete?: (id: string) => void;
    showStoreColumn?: boolean;
}

export function SalesNoteListTable({
    data,
    isLoading,
    onView,
    onDelete,
    showStoreColumn = true
}: SalesNoteListTableProps) {
    const copyShareLink = (note: SalesNoteSummary) => {
        const token = note.access_token;
        if (!token) {
            toast.error("無法取得分享連結");
            return;
        }
        const link = `${window.location.origin}/share/sale/${note.code || note.id}?token=${token}`;
        navigator.clipboard.writeText(link);
        toast.success("連結已複製到剪貼簿");
    };

    // 1. Loading 狀態同樣需要手機版的 Skeleton
    if (isLoading) {
        return (
            <div className="space-y-4">
                {/* 電腦版 Skeleton */}
                <div className="hidden md:block rounded-md border bg-card">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead>編號</TableHead>
                                {showStoreColumn && <TableHead>店鋪</TableHead>}
                                <TableHead>狀態</TableHead>
                                <TableHead>項目數</TableHead>
                                <TableHead>建立時間</TableHead>
                                <TableHead>操作</TableHead>
                                <TableHead className="w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                    {showStoreColumn && <TableCell><Skeleton className="h-4 w-32" /></TableCell>}
                                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                    <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                                    <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                {/* 手機版 Skeleton */}
                <div className="md:hidden space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full rounded-xl" />
                    ))}
                </div>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="rounded-md border border-dashed p-8 text-center bg-muted/10">
                <p className="text-muted-foreground">沒有找到相關的銷貨單</p>
            </div>
        );
    }

    return (
        <div className="w-full">
            {/* --- 電腦版：表格佈局 (md 以上顯示) --- */}
            <div className="hidden md:block rounded-md border bg-card shadow-sm overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="w-[140px]">銷貨單編號</TableHead>
                            {showStoreColumn && <TableHead>店鋪</TableHead>}
                            <TableHead>狀態</TableHead>
                            <TableHead className="text-right">項目數</TableHead>
                            <TableHead>出貨 / 收貨時間</TableHead>
                            <TableHead>建立時間</TableHead>
                            <TableHead>操作</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((note) => (
                            <TableRow key={note.id} className="hover:bg-muted/50 transition-colors">
                                <TableCell className="font-mono text-xs font-medium">{note.code || note.id.slice(0, 8)}</TableCell>
                                {showStoreColumn && (
                                    <TableCell>
                                        <div className="font-medium text-sm">{note.storeName}</div>
                                        <div className="text-xs text-muted-foreground">{note.storeCode}</div>
                                    </TableCell>
                                )}
                                <TableCell><SalesNoteStatusBadge status={note.status} /></TableCell>
                                <TableCell className="text-right">{note.itemCount}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {note.received_at ? (
                                        <span className="text-success-600 font-medium">已收: {format(new Date(note.received_at), "MM/dd HH:mm")}</span>
                                    ) : note.shipped_at ? (
                                        <span className="text-primary">已出: {format(new Date(note.shipped_at), "MM/dd HH:mm")}</span>
                                    ) : "-"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {format(new Date(note.created_at), "yyyy/MM/dd HH:mm")}
                                </TableCell>
                                <TableCell>
                                    <Button variant="ghost" size="sm" onClick={() => copyShareLink(note)}>
                                        <Copy className="h-4 w-4 mr-2" />分享連結
                                    </Button>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onView(note)}>
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        {onDelete && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive ml-1" onClick={() => onDelete(note.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* --- 手機版：卡片佈局 (md 以下顯示) --- */}
            <div className="grid grid-cols-1 gap-4 md:hidden">
                {data.map((note) => (
                    <div key={note.id} className="bg-card border rounded-xl p-4 shadow-sm space-y-4">
                        {/* 頂部：狀態與編號 */}
                        <div className="flex justify-between items-start">
                            <div className="space-y-1">
                                <div className="text-xs font-mono text-muted-foreground">#{note.code || note.id.slice(0, 8)}</div>
                                <SalesNoteStatusBadge status={note.status} />
                            </div>
                            <div className="flex gap-1">
                                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onView(note)}>
                                    <Eye className="h-4 w-4" />
                                </Button>
                                {onDelete && (
                                    <Button variant="outline" size="icon" className="h-9 w-9 text-destructive" onClick={() => onDelete(note.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* 中間：店鋪與資訊 */}
                        <div className="grid grid-cols-2 gap-y-3 text-sm border-y py-3">
                            {showStoreColumn && (
                                <div className="col-span-2 flex items-start gap-2">
                                    <Store className="h-4 w-4 text-muted-foreground mt-0.5" />
                                    <div>
                                        <div className="font-medium">{note.storeName}</div>
                                        <div className="text-xs text-muted-foreground">{note.storeCode}</div>
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span>項目數: <span className="font-semibold">{note.itemCount}</span></span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Calendar className="h-4 w-4" />
                                {format(new Date(note.created_at), "MM/dd HH:mm")}
                            </div>
                        </div>

                        {/* 底部：時間狀態與分享連結 */}
                        <div className="flex items-center justify-between">
                            <div className="text-xs">
                                {note.received_at ? (
                                    <span className="text-success-600 font-medium italic">已收: {format(new Date(note.received_at), "MM/dd HH:mm")}</span>
                                ) : note.shipped_at ? (
                                    <span className="text-primary italic">已出: {format(new Date(note.shipped_at), "MM/dd HH:mm")}</span>
                                ) : <span className="text-muted-foreground">待出貨</span>}
                            </div>
                            <Button variant="secondary" size="sm" className="h-8" onClick={() => copyShareLink(note)}>
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                分享連結
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}