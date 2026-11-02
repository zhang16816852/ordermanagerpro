import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Minus } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { SalesNoteItem } from "./SalesNoteDetailDialog";
import type { NoteReference } from "./salesNoteCorrectTypes";
import { itemLabel } from "./salesNoteCorrectTypes";

interface CorrectItemsTableProps {
    items: SalesNoteItem[];
    keepQty: Record<string, number>;
    onKeepQtyChange: (id: string, qty: number) => void;
    priceEdits: Record<string, number>;
    onPriceEdit: (orderItemId: string, val: number, oldPrice: number) => void;
    otherNoteRefs: Record<string, NoteReference[]>;
}

export function CorrectItemsTable({
    items,
    keepQty,
    onKeepQtyChange,
    priceEdits,
    onPriceEdit,
    otherNoteRefs,
}: CorrectItemsTableProps) {
    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <Minus className="h-4 w-4 text-red-500" /> 調整品項數量與單價
            </h4>
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead>產品名稱</TableHead>
                            <TableHead className="text-right">原數量</TableHead>
                            <TableHead className="text-right">保留數量</TableHead>
                            <TableHead className="text-right">移除</TableHead>
                            <TableHead className="text-right">原價</TableHead>
                            <TableHead className="text-right w-28">調整為</TableHead>
                            <TableHead className="text-right">差異</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => {
                            const qty = item.quantity || 0;
                            const price = item.unitPrice || 0;
                            const keep = keepQty[item.id] === undefined ? qty : keepQty[item.id];
                            const remove = Math.max(0, qty - keep);
                            const disabled = (item.returnedQuantity || 0) > 0;

                            const oldPrice = item.unitPrice || 0;
                            const newPrice = priceEdits[item.orderItemId || ""];
                            const diff = newPrice !== undefined ? (newPrice - oldPrice) * (item.quantity || 1) : 0;
                            const refs = (item.orderItemId && otherNoteRefs[item.orderItemId]) || [];
                            const blockedPaid = refs.some((n) => n.payment_status === "paid");

                            return (
                                <TableRow key={item.id} className={remove > 0 ? "bg-red-50/40" : ""}>
                                    <TableCell>
                                        <div className="font-medium text-sm">{itemLabel(item.productName, item.variantName)}</div>
                                        {!!item.returnedQuantity && (
                                            <Badge variant="outline" className="mt-0.5 text-orange-600 border-orange-300 bg-orange-50">
                                                已退 {item.returnedQuantity}
                                            </Badge>
                                        )}
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
                                    <TableCell className="text-right">{qty}</TableCell>
                                    <TableCell className="text-right">
                                        <Input
                                            type="number"
                                            min={0}
                                            max={qty}
                                            className="h-8 w-20 text-right ml-auto"
                                            value={keep}
                                            disabled={disabled}
                                            onChange={(e) => {
                                                const val = Math.max(0, Math.min(qty, Number(e.target.value) || 0));
                                                onKeepQtyChange(item.id, val);
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right text-red-600 font-medium">
                                        {remove > 0 ? `-${remove}` : "—"}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">{formatCurrency(price)}</TableCell>
                                    <TableCell className="text-right">
                                        <Input
                                            type="number"
                                            min={0}
                                            disabled={blockedPaid || disabled}
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
            <p className="text-xs text-muted-foreground">
                將「保留數量」設為低於原數量，差額會退回出貨池並還原庫存；設為 0 等同整列移除。已退貨品項不可調整。調整單價會同步寫入訂單單價。
            </p>
        </div>
    );
}