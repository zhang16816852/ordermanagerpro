import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, XCircle, Info, ShieldCheck } from 'lucide-react';

interface ReconcileResult {
    ok: boolean;
    checks: Array<{
        check: string;
        status: string;
        [key: string]: any;
    }>;
    product_id: string | null;
    variant_id: string | null;
}

const CHECK_LABELS: Record<string, string> = {
    movement_vs_inventory: '庫存異動 vs 帳面庫存',
    batch_vs_inventory: '批次庫存 vs 帳面庫存',
    suspense_summary: '懸空 movement 摘要',
    consumed_vs_received: '已耗用量 vs 已收貨量',
    allocation_vs_movement: '配對量 vs 異動量',
};

export function ReconcileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<ReconcileResult | null>(null);

    const runReconcile = async () => {
        setLoading(true);
        try {
            const { data, error } = await (supabase.rpc('reconcile_fifo_integrity' as any) as any)({
                p_product_id: null,
                p_variant_id: null,
            });
            if (error) throw error;
            setResult(data as ReconcileResult);
            const failed = (data?.checks || []).filter((c: any) => c.status === 'FAIL');
            if (failed.length === 0) {
                toast.success('FIFO 驗算通過，無異常');
            } else {
                toast.error(`FIFO 驗算發現 ${failed.length} 項異常`);
            }
        } catch (e: any) {
            toast.error(e?.message || '驗算失敗');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>FIFO 驗算</DialogTitle>
                    <DialogDescription>
                        檢查庫存異動、批次庫存、懸空配對的一致性
                    </DialogDescription>
                </DialogHeader>

                <div className="flex justify-center py-4">
                    <Button onClick={runReconcile} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                        {loading ? '驗算中...' : '開始驗算'}
                    </Button>
                </div>

                {result && (
                    <ScrollArea className="max-h-[400px]">
                        <div className="mb-3 flex items-center gap-2">
                            {result.ok ? (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                                    <CheckCircle2 className="mr-1 h-3 w-3" /> 全部通過
                                </Badge>
                            ) : (
                                <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                                    <XCircle className="mr-1 h-3 w-3" /> 發現異常
                                </Badge>
                            )}
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-xs">檢查項目</TableHead>
                                    <TableHead className="text-xs">狀態</TableHead>
                                    <TableHead className="text-xs">詳情</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(result.checks || []).map((c: any, i: number) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs">{CHECK_LABELS[c.check] || c.check}</TableCell>
                                        <TableCell className="text-xs">
                                            {c.status === 'PASS' && <Badge variant="outline" className="text-emerald-600 border-emerald-200 text-[10px]">通過</Badge>}
                                            {c.status === 'FAIL' && <Badge variant="outline" className="text-rose-600 border-rose-200 text-[10px]">異常</Badge>}
                                            {c.status === 'INFO' && <Badge variant="outline" className="text-blue-600 border-blue-200 text-[10px]">資訊</Badge>}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {c.status === 'FAIL' && c.delta !== undefined && `差異: ${c.delta}`}
                                            {c.status === 'FAIL' && c.over_consumed_count !== undefined && `超耗: ${c.over_consumed_count}`}
                                            {c.status === 'FAIL' && c.over_allocated_count !== undefined && `超配: ${c.over_allocated_count}`}
                                            {c.status === 'INFO' && c.pending_match_count !== undefined && `待配對: ${c.pending_match_count}, 已配對: ${c.matched_count}`}
                                            {c.status === 'PASS' && '-'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}