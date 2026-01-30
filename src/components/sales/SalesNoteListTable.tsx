import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SalesNoteStatusBadge } from "./SalesNoteStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Json } from "@/integrations/supabase/types";
interface SalesNoteSummary {
    id: string;
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
        console.log("note:", note);

        const token = note.access_token;
        if (!token) {
            toast.error("無法取得分享連結");
            return;
        }

        const link = `${window.location.origin}/share/sale/${note.id}?token=${token}`;
        navigator.clipboard.writeText(link);
        toast.success("連結已複製到剪貼簿");
    };


    if (isLoading) {
        return (
            <div className="rounded-md border bg-card">
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
                                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
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
        <div className="rounded-md border bg-card shadow-sm overflow-hidden">
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
                            <TableCell className="font-mono text-xs font-medium">
                                {note.id.slice(0, 8)}...
                            </TableCell>

                            {showStoreColumn && (
                                <TableCell>
                                    <div className="font-medium text-sm">{note.storeName}</div>
                                    <div className="text-xs text-muted-foreground">{note.storeCode}</div>
                                </TableCell>
                            )}

                            <TableCell>
                                <SalesNoteStatusBadge status={note.status} />
                            </TableCell>

                            <TableCell className="text-right">
                                {note.itemCount}
                            </TableCell>

                            <TableCell className="text-xs text-muted-foreground">
                                {note.received_at ? (
                                    <div className="flex flex-col">
                                        <span className="text-success-600 font-medium">已收: {format(new Date(note.received_at), "MM/dd HH:mm")}</span>
                                    </div>
                                ) : note.shipped_at ? (
                                    <div className="flex flex-col">
                                        <span className="text-primary">已出: {format(new Date(note.shipped_at), "MM/dd HH:mm")}</span>
                                    </div>
                                ) : (
                                    "-"
                                )}
                            </TableCell>

                            <TableCell className="text-xs text-muted-foreground">
                                {format(new Date(note.created_at), "yyyy/MM/dd HH:mm")}
                            </TableCell>
                            <TableCell>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyShareLink(note)}
                                    title="複製分享連結"
                                >
                                    <Copy className="h-4 w-4 mr-2" />
                                    分享連結
                                </Button>
                            </TableCell>
                            <TableCell>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    onClick={() => onView(note)}
                                >
                                    <Eye className="h-4 w-4" />
                                </Button>
                                {onDelete && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive ml-1"
                                        onClick={() => onDelete(note.id)}
                                        title="刪除並回滾"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}