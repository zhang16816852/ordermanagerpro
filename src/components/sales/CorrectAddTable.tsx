import { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Warehouse as PoolIcon } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { PoolItem, OrderItemCandidate } from "./salesNoteCorrectTypes";
import { itemLabel } from "./salesNoteCorrectTypes";

interface CorrectAddTableProps {
    poolItems: PoolItem[];
    orderCandidates: OrderItemCandidate[];
    addedFromPool: Record<string, number>;
    setAddedFromPool: Dispatch<SetStateAction<Record<string, number>>>;
    addedFromOrder: Record<string, number>;
    setAddedFromOrder: Dispatch<SetStateAction<Record<string, number>>>;
}

export function CorrectAddTable({
    poolItems,
    orderCandidates,
    addedFromPool,
    setAddedFromPool,
    addedFromOrder,
    setAddedFromOrder,
}: CorrectAddTableProps) {
    const noCandidates = poolItems.length === 0 && orderCandidates.length === 0;

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
                <PoolIcon className="h-4 w-4 text-blue-500" /> 追加品項（自同店家出貨池或訂單未出貨量）
            </h4>

            {noCandidates ? (
                <div className="text-muted-foreground text-sm py-4 text-center border rounded-md">
                    此店家目前沒有可追加的品項（出貨池為空、且無訂單有未出貨量）。
                </div>
            ) : (
                <>
                    {poolItems.length > 0 && (
                        <div className="rounded-md border overflow-hidden">
                            <div className="bg-blue-50/60 px-3 py-1.5 text-xs font-medium text-blue-700">出貨池</div>
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>產品名稱</TableHead>
                                        <TableHead className="text-right">池中量</TableHead>
                                        <TableHead className="text-right">單價</TableHead>
                                        <TableHead className="text-right w-28">追加數量</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {poolItems.map((p) => {
                                        const oi = p.order_item;
                                        const qty = addedFromPool[oi.id] || 0;
                                        return (
                                            <TableRow key={p.id}>
                                                <TableCell>
                                                    <div className="font-medium text-sm">{itemLabel(oi?.product?.name, oi?.product_variant?.name)}</div>
                                                    {oi?.order?.code && (
                                                        <div className="text-xs text-muted-foreground">訂單 {oi.order.code}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">{p.quantity}</TableCell>
                                                <TableCell className="text-right text-muted-foreground">{formatCurrency(oi?.unit_price || 0)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        max={p.quantity}
                                                        className="h-8 w-20 text-right ml-auto"
                                                        value={qty || ""}
                                                        placeholder="0"
                                                        onChange={(e) => {
                                                            const val = Math.max(0, Math.min(p.quantity, Number(e.target.value) || 0));
                                                            setAddedFromPool((prev) => ({ ...prev, [oi.id]: val }));
                                                        }}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {orderCandidates.length > 0 && (
                        <div className="rounded-md border overflow-hidden">
                            <div className="bg-indigo-50/60 px-3 py-1.5 text-xs font-medium text-indigo-700">
                                訂單未出貨品項（同店家）
                            </div>
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>產品名稱</TableHead>
                                        <TableHead className="text-right">可出貨</TableHead>
                                        <TableHead className="text-right">單價</TableHead>
                                        <TableHead className="text-right w-28">追加數量</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {orderCandidates.map((c) => {
                                        const qty = addedFromOrder[c.id] || 0;
                                        return (
                                            <TableRow key={c.id}>
                                                <TableCell>
                                                    <div className="font-medium text-sm">{itemLabel(c.product?.name, c.product_variant?.name)}</div>
                                                    <div className="text-xs text-muted-foreground">訂單 {c.code}</div>
                                                </TableCell>
                                                <TableCell className="text-right">{c.available}</TableCell>
                                                <TableCell className="text-right text-muted-foreground">{formatCurrency(c.unit_price)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        max={c.available}
                                                        className="h-8 w-20 text-right ml-auto"
                                                        value={qty || ""}
                                                        placeholder="0"
                                                        onChange={(e) => {
                                                            const val = Math.max(0, Math.min(c.available, Number(e.target.value) || 0));
                                                            setAddedFromOrder((prev) => ({ ...prev, [c.id]: val }));
                                                        }}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}