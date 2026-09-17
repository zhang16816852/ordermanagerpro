import { PackagePlus } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { PriceChange } from "./salesNoteCorrectTypes";

interface CorrectSummaryProps {
    originalTotal: number;
    correctedTotal: number;
    totalAdded: number;
    hasRemovals: boolean;
    priceChanges: PriceChange[];
    priceChangeTotal: number;
    hasNewItems: boolean;
}

export function CorrectSummary({
    originalTotal,
    correctedTotal,
    totalAdded,
    hasRemovals,
    priceChanges,
    priceChangeTotal,
    hasNewItems,
}: CorrectSummaryProps) {
    return (
        <div className="bg-muted/30 rounded-lg px-4 py-3 space-y-1">
            <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">原始總額</span>
                <span>{formatCurrency(originalTotal)}</span>
            </div>
            {(hasRemovals || totalAdded > 0 || priceChanges.length > 0) && (
                <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                        修正後（−移除 +追加 {priceChanges.length > 0 ? "±調價" : ""}）
                    </span>
                    <span className="font-semibold text-primary">
                        {formatCurrency(Math.max(0, correctedTotal + priceChangeTotal))}
                    </span>
                </div>
            )}
            {priceChanges.length > 0 && (
                <div className="text-xs space-y-1 pt-1">
                    {priceChanges.map((c) => (
                        <div key={c.itemId} className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground truncate">
                                {c.label}{c.orderCode ? `（訂單 ${c.orderCode}）` : ""}
                                {c.otherNotes.length > 0 && (
                                    <span className="ml-1 text-amber-600">同步影響其它 {c.otherNotes.map((n) => n.code).join("、")}</span>
                                )}
                            </span>
                            <span className="shrink-0">
                                {formatCurrency(c.oldPrice)} → <span className="font-semibold">{formatCurrency(c.newPrice)}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {hasNewItems && (
                <div className="text-xs text-amber-600 flex items-center gap-1">
                    <PackagePlus className="h-3.5 w-3.5" />
                    新增品項將自動建立一張新訂單（訂單與銷貨單 QR 碼不會失效）。
                </div>
            )}
        </div>
    );
}