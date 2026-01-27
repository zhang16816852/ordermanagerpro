import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, Check } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SalesNoteStatusBadge } from "./SalesNoteStatusBadge";

// Define a flexible interface that covers both Admin and Store data structures
// Admin uses join types, Store uses nested objects. We'll try to support both or standardize.
// For now, let's use a standard interface that the parents need to map to or match.

export interface SalesNoteItem {
    id: string;
    quantity: number;
    // Support both structures or normalized one
    productName: string;
    productSku: string;
    variantName?: string | null;
    unitPrice?: number;
}

export interface SalesNoteDetail {
    id: string;
    storeName?: string;
    storeCode?: string;
    status: string;
    created_at: string;
    shipped_at?: string | null;
    received_at?: string | null;
    notes?: string | null;
    items: SalesNoteItem[];
}

interface SalesNoteDetailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    note: SalesNoteDetail | null;
    onConfirmReceive?: (noteId: string) => void;
    isConfirming?: boolean;
}

export function SalesNoteDetailDialog({
    open,
    onOpenChange,
    note,
    onConfirmReceive,
    isConfirming
}: SalesNoteDetailDialogProps) {

    if (!note) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        銷售單詳情
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground block mb-1">編號</span>
                            <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{note.id}</span>
                        </div>

                        {note.storeName && (
                            <div>
                                <span className="text-muted-foreground block mb-1">店鋪</span>
                                <span className="font-medium">{note.storeName}</span>
                                {note.storeCode && <span className="text-xs text-muted-foreground ml-2">({note.storeCode})</span>}
                            </div>
                        )}

                        <div>
                            <span className="text-muted-foreground block mb-1">狀態</span>
                            <SalesNoteStatusBadge status={note.status} />
                        </div>

                        <div>
                            <span className="text-muted-foreground block mb-1">建立時間</span>
                            <span>{format(new Date(note.created_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
                        </div>

                        {note.shipped_at && (
                            <div>
                                <span className="text-muted-foreground block mb-1">出貨時間</span>
                                <span>{format(new Date(note.shipped_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
                            </div>
                        )}

                        {note.received_at && (
                            <div>
                                <span className="text-muted-foreground block mb-1">收貨時間</span>
                                <span>{format(new Date(note.received_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
                            </div>
                        )}
                    </div>

                    {note.notes && (
                        <div className="bg-muted/30 p-3 rounded-md text-sm">
                            <span className="text-muted-foreground font-medium mb-1 block">備註：</span>
                            <p>{note.notes}</p>
                        </div>
                    )}

                    <div>
                        <h4 className="font-medium mb-2 text-sm flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary" />
                            銷售項目 ({note.items.length})
                        </h4>
                        <div className="rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>產品 / SKU</TableHead>
                                        <TableHead className="text-right">數量</TableHead>
                                        {note.items[0]?.unitPrice !== undefined && (
                                            <TableHead className="text-right">單價</TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {note.items.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <div className="font-medium">
                                                    {item.productName}
                                                    {item.variantName && (
                                                        <Badge variant="secondary" className="ml-2 text-[10px] h-5 px-1 font-normal">
                                                            {item.variantName}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                                    {item.productSku}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {item.quantity}
                                            </TableCell>
                                            {item.unitPrice !== undefined && (
                                                <TableCell className="text-right text-muted-foreground">
                                                    ${item.unitPrice}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Confirm Receive Action (Only for Store view when shipped) */}
                    {onConfirmReceive && note.status === 'shipped' && (
                        <div className="flex justify-end pt-2 border-t mt-4">
                            <Button
                                onClick={() => onConfirmReceive(note.id)}
                                disabled={isConfirming}
                                className="bg-green-600 hover:bg-green-700 text-white"
                            >
                                <Check className="mr-2 h-4 w-4" />
                                {isConfirming ? "確認中..." : "確認收貨"}
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
