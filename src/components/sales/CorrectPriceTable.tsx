import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tag } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { SalesNoteItem } from "./SalesNoteDetailDialog";
import type { NoteReference } from "./salesNoteCorrectTypes";
import { itemLabel } from "./salesNoteCorrectTypes";

interface CorrectPriceTableProps {
    items: SalesNoteItem[];
    priceEdits: Record<string, number>;
    onPriceEdit: (orderItemId: string, val: number, oldPrice: number) => void;
    otherNoteRefs: Record<string, NoteReference[]>;
}

export function CorrectPriceTable({ items, priceEdits, onPriceEdit, otherNoteRefs }: CorrectPriceTableProps) {
    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-500" /> 修改價格（同步調整訂單單價）
            </h4>
            <div className="rounded-md border overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead>產品名稱</TableHead>
                            <TableHead className="text-right">數量</TableHead>
                            <TableHead className="text-right">原價</TableHead>
                            <TableHead className="text-right w-28">調整為</TableHead>
                            <TableHead className="text-right">差異</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => {
                            const oldPrice = item.unitPrice || 0;
                            const newPrice = priceEdits[item.orderItemId || ""];
                            const diff = newPrice !== undefined ? (newPrice - oldPrice) * (item.quantity || 1) : 0;
                            const refs = (item.orderItemId && otherNoteRefs[item.orderItemId]) || [];
                            const blockedPaid = refs.some((n) => n.payment_status === "paid");
                            return (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        <div className="font-medium text-sm">{itemLabel(item.productName, item.variantName)}</div>
                                        {item.orderCode && (
                                            <div className="text-xs text-muted-foreground">訂單 {item.orderCode}</div>
                                        )}
                                        {refs.length > 0 && (
                                            <div className="text-xs mt-0.5">
                                                {blockedPaid ? (
                                                    <span className="text-red-600 font-medium">
                                                        已被銷貨單 {refs.find((n) => n.payment_status === "paid")?.code}（已收款）引用 → 不可改價
                                                    </span>
                                                ) : (
                                                    <span className="text-amber-600">
                                                        同步影響其它 {refs.map((n) => n.code + (n.payment_status === "paid" ? "（已收款）" : "")).join("、")}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">{item.quantity || 1}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">{formatCurrency(oldPrice)}</TableCell>
                                    <TableCell className="text-right">
                                        <Input
                                            type="number"
                                            min={0}
                                            disabled={blockedPaid}
                                            className="h-8 w-24 text-right ml-auto"
                                            value={newPrice ?? ""}
                                            placeholder={String(oldPrice)}
                                            onChange={(e) => {
                                                if (!item.orderItemId) return;
                                                const val = Math.max(0, Number(e.target.value) || 0);
                                                onPriceEdit(item.orderItemId, val, oldPrice);
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell className={`text-right font-medium ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                                        {newPrice !== undefined && newPrice !== oldPrice
                                            ? (diff > 0 ? "+" : "") + formatCurrency(diff)
                                            : "—"}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}