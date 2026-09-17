import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Minus } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { SalesNoteItem } from "./SalesNoteDetailDialog";
import { itemLabel } from "./salesNoteCorrectTypes";

interface CorrectRemoveTableProps {
    items: SalesNoteItem[];
    removingIds: Set<string>;
    onToggle: (id: string) => void;
}

export function CorrectRemoveTable({ items, removingIds, onToggle }: CorrectRemoveTableProps) {
    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <Minus className="h-4 w-4 text-red-500" /> 移除品項（勾選後退回出貨池）
            </h4>
            <div className="rounded-md border overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>產品名稱</TableHead>
                            <TableHead className="text-right">數量</TableHead>
                            <TableHead className="text-right">單價</TableHead>
                            <TableHead className="text-right">小計</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item) => {
                            const qty = item.quantity || 0;
                            const price = item.unitPrice || 0;
                            return (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        <Checkbox
                                            checked={removingIds.has(item.id)}
                                            onCheckedChange={() => onToggle(item.id)}
                                            disabled={(item.returnedQuantity || 0) > 0}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium text-sm">{itemLabel(item.productName, item.variantName)}</div>
                                        {!!item.returnedQuantity && (
                                            <Badge variant="outline" className="mt-0.5 text-orange-600 border-orange-300 bg-orange-50">
                                                已退 {item.returnedQuantity}
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">{qty}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">{formatCurrency(price)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(qty * price)}</TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}