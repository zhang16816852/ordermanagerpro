import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Minus } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { SalesNoteItem } from "./SalesNoteDetailDialog";
import { itemLabel } from "./salesNoteCorrectTypes";

interface CorrectRemoveTableProps {
    items: SalesNoteItem[];
    keepQty: Record<string, number>;
    onKeepQtyChange: (id: string, qty: number) => void;
}

export function CorrectRemoveTable({ items, keepQty, onKeepQtyChange }: CorrectRemoveTableProps) {
    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <Minus className="h-4 w-4 text-red-500" /> 調整品項數量（保留數量，低於原數量即移除多餘）
            </h4>
            <div className="rounded-md border overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead>產品名稱</TableHead>
                            <TableHead className="text-right">原數量</TableHead>
                            <TableHead className="text-right">保留數量</TableHead>
                            <TableHead className="text-right">移除</TableHead>
                            <TableHead className="text-right">單價</TableHead>
                            <TableHead className="text-right">小計</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => {
                            const qty = item.quantity || 0;
                            const price = item.unitPrice || 0;
                            const keep = keepQty[item.id] === undefined ? qty : keepQty[item.id];
                            const remove = Math.max(0, qty - keep);
                            const disabled = (item.returnedQuantity || 0) > 0;
                            return (
                                <TableRow key={item.id} className={remove > 0 ? "bg-red-50/40" : ""}>
                                    <TableCell>
                                        <div className="font-medium text-sm">{itemLabel(item.productName, item.variantName)}</div>
                                        {!!item.returnedQuantity && (
                                            <Badge variant="outline" className="mt-0.5 text-orange-600 border-orange-300 bg-orange-50">
                                                已退 {item.returnedQuantity}
                                            </Badge>
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
                                    <TableCell className="text-right">{formatCurrency(qty * price)}</TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            <p className="text-xs text-muted-foreground">
                將「保留數量」設為低於原數量，差額會退回出貨池並還原庫存；設為 0 等同整列移除。已退貨品項不可調整。
            </p>
        </div>
    );
}