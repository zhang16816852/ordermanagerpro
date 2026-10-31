import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { UseMutationResult } from '@tanstack/react-query';

interface StocktakeItem {
    id: string;
    name: string;
    code: string;
    warehouseName: string;
    warehouseCode: string;
    systemQty: number;
    countedQty: string;
}

interface StocktakeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    items: { id: string; name: string; code: string; quantity: number; warehouseName: string; warehouseCode: string }[];
    warehouses: { code: string; name: string }[];
    updateInventory: UseMutationResult<any, Error, { id: string; quantity: number; note?: string }, unknown>;
    isPending: boolean;
}

export function StocktakeDialog({ open, onOpenChange, items, warehouses, updateInventory, isPending }: StocktakeDialogProps) {
    const [warehouseFilter, setWarehouseFilter] = useState('all');
    const [counts, setCounts] = useState<Record<string, string>>({});
    const [reason, setReason] = useState('盤點差異');
    const [submitting, setSubmitting] = useState(false);

    const filteredItems = useMemo(() => {
        if (warehouseFilter === 'all') return items;
        return items.filter(i => i.warehouseCode === warehouseFilter);
    }, [items, warehouseFilter]);

    const diffs = useMemo(() => {
        return filteredItems.map(item => {
            const counted = counts[item.id];
            const countedNum = counted === undefined || counted === '' ? null : parseInt(counted);
            const diff = countedNum === null ? 0 : countedNum - item.quantity;
            return { ...item, countedNum, diff };
        });
    }, [filteredItems, counts]);

    const totalDiff = diffs.reduce((s, d) => s + d.diff, 0);
    const changedCount = diffs.filter(d => d.diff !== 0).length;

    const handleSubmit = async () => {
        const toUpdate = diffs.filter(d => d.diff !== 0 && d.countedNum !== null);
        if (toUpdate.length === 0) {
            toast.info('沒有需要調整的品項');
            return;
        }
        if (!window.confirm(`將調整 ${toUpdate.length} 項品項，總差異 ${totalDiff > 0 ? '+' : ''}${totalDiff}，確定繼續？`)) return;

        setSubmitting(true);
        let success = 0;
        let fail = 0;
        for (const d of toUpdate) {
            try {
                await new Promise<void>((resolve, reject) => {
                    updateInventory.mutate(
                        { id: d.id, quantity: d.countedNum!, note: `盤點調整：${reason}` },
                        { onSuccess: () => resolve(), onError: (e: any) => reject(e) }
                    );
                });
                success++;
            } catch {
                fail++;
            }
        }
        setSubmitting(false);
        toast.success(`盤點完成：${success} 項已調整${fail > 0 ? `，${fail} 項失敗` : ''}`);
        if (fail === 0) {
            setCounts({});
            onOpenChange(false);
        }
    };

    const handleReset = () => {
        setCounts({});
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>系統盤點</DialogTitle>
                    <DialogDescription>
                        輸入實際盤點數量，系統將自動計算差異並調整庫存
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-3 py-2">
                    <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">倉庫</Label>
                        <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                            <SelectTrigger className="h-8 w-40 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部倉庫</SelectItem>
                                {warehouses.map(w => (
                                    <SelectItem key={w.code} value={w.code}>{w.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">原因</Label>
                        <Select value={reason} onValueChange={setReason}>
                            <SelectTrigger className="h-8 w-40 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="盤點差異">盤點差異</SelectItem>
                                <SelectItem value="破損報廢">破損報廢</SelectItem>
                                <SelectItem value="遺失">遺失</SelectItem>
                                <SelectItem value="系統校正">系統校正</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">已變更 {changedCount} 項</span>
                        <span className={cn("font-mono font-bold", totalDiff > 0 ? "text-emerald-600" : totalDiff < 0 ? "text-rose-600" : "text-muted-foreground")}>
                            總差異：{totalDiff > 0 ? '+' : ''}{totalDiff}
                        </span>
                    </div>
                </div>

                <ScrollArea className="flex-1 min-h-0 border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="text-xs">商品</TableHead>
                                <TableHead className="text-xs">SKU</TableHead>
                                <TableHead className="text-xs">倉庫</TableHead>
                                <TableHead className="text-xs text-right">系統數量</TableHead>
                                <TableHead className="text-xs text-right">盤點數量</TableHead>
                                <TableHead className="text-xs text-right">差異</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {diffs.map(d => (
                                <TableRow key={d.id} className={d.diff !== 0 ? "bg-amber-50/50" : ""}>
                                    <TableCell className="text-xs font-medium max-w-[200px] truncate">{d.name}</TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground">{d.code}</TableCell>
                                    <TableCell className="text-xs">{d.warehouseName}</TableCell>
                                    <TableCell className="text-xs text-right font-mono tabular-nums">{d.quantity}</TableCell>
                                    <TableCell className="text-xs text-right">
                                        <Input
                                            type="number"
                                            value={counts[d.id] ?? ''}
                                            onChange={(e) => setCounts(prev => ({ ...prev, [d.id]: e.target.value }))}
                                            placeholder={String(d.quantity)}
                                            className="w-20 h-7 text-right text-xs ml-auto"
                                        />
                                    </TableCell>
                                    <TableCell className={cn(
                                        "text-xs text-right font-mono tabular-nums font-bold",
                                        d.diff > 0 ? "text-emerald-600" : d.diff < 0 ? "text-rose-600" : "text-muted-foreground"
                                    )}>
                                        {d.countedNum === null ? '-' : (d.diff > 0 ? '+' : '') + d.diff}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>

                <DialogFooter className="gap-2">
                    <Button variant="outline" size="sm" onClick={handleReset} disabled={submitting}>
                        清除輸入
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
                        取消
                    </Button>
                    <Button size="sm" onClick={handleSubmit} disabled={submitting || changedCount === 0}>
                        {submitting ? '調整中...' : `確認調整（${changedCount} 項）`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}