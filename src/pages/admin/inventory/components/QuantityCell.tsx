import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { UseMutationResult } from '@tanstack/react-query';
import { Save, AlertTriangle } from 'lucide-react';

export function QuantityCell({ row, updateInventory }: { row: any; updateInventory: UseMutationResult<any, Error, { id: string; quantity: number; note?: string }, unknown> }) {
    const [val, setVal] = useState(row.original.quantity);
    const [showAdjust, setShowAdjust] = useState(false);
    const [adjustNote, setAdjustNote] = useState('');
    const isDirty = val !== row.original.quantity;

    return (
        <>
            <div className="flex items-center gap-2">
                <Input
                    type="number"
                    value={val}
                    onChange={(e) => setVal(parseInt(e.target.value, 10) || 0)}
                    className={cn(
                        "w-20 h-8 text-right text-xs",
                        row.original.isLowStock && !isDirty ? "border-rose-300 bg-rose-50 text-rose-700" : "",
                        isDirty ? "border-blue-400 ring-1 ring-blue-400" : ""
                    )}
                />
                {isDirty && (
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-blue-600"
                        onClick={() => setShowAdjust(true)}
                        disabled={updateInventory.isPending}
                        aria-label="儲存庫存"
                    >
                        <Save className="h-4 w-4" />
                    </Button>
                )}
                {row.original.isLowStock && !isDirty && (
                    <AlertTriangle className="h-4 w-4 text-rose-500 animate-pulse" />
                )}
            </div>

            <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>庫存調整確認</DialogTitle>
                        <DialogDescription>
                            {row.original.name}
                            <Badge variant="secondary" className="ml-2 text-[10px]">{row.original.warehouseName}</Badge>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="flex items-center gap-4 justify-center text-lg">
                            <span className="font-mono tabular-nums text-muted-foreground line-through">{row.original.quantity}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono tabular-nums font-bold text-lg">{val}</span>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="adjust-reason" className="text-xs text-muted-foreground">調整原因</Label>
                            <select
                                id="adjust-reason"
                                defaultValue=""
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (v && v !== 'other') setAdjustNote(v);
                                    else if (v === 'other') setAdjustNote('');
                                }}
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">請選擇原因...</option>
                                <option value="盤點差異">盤點差異</option>
                                <option value="破損報廢">破損報廢</option>
                                <option value="遺失">遺失</option>
                                <option value="退貨補正">退貨補正</option>
                                <option value="系統校正">系統校正</option>
                                <option value="other">其他（手動輸入）</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="adjust-note" className="text-xs text-muted-foreground">補充說明（選填）</Label>
                            <Input
                                id="adjust-note"
                                value={adjustNote}
                                onChange={(e) => setAdjustNote(e.target.value)}
                                placeholder="可輸入更詳細的調整原因..."
                                className="text-sm"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => { setShowAdjust(false); setAdjustNote(''); }}>
                            取消
                        </Button>
                        <Button size="sm" onClick={() => {
                            updateInventory.mutate({ id: row.original.id, quantity: val, note: adjustNote || undefined });
                            setShowAdjust(false);
                            setAdjustNote('');
                        }}>
                            確認調整
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}