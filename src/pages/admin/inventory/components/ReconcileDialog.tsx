import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, XCircle, ShieldCheck, RefreshCw } from 'lucide-react';

interface ReconcileResult {
    ok: boolean;
    checks: Array<{
        check: string;
        status: string;
        product_id?: string | null;
        variant_id?: string | null;
        warehouse_id?: string | null;
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
    const [recalcResult, setRecalcResult] = useState<any[] | null>(null);
    const [nameMap, setNameMap] = useState<{ products: Record<string, string>; variants: Record<string, string>; warehouses: Record<string, string> }>({ products: {}, variants: {}, warehouses: {} });

    const resolveNames = async (checks: any[]) => {
        const productIds = Array.from(new Set(checks.map(c => c.product_id).filter(Boolean))) as string[];
        const variantIds = Array.from(new Set(checks.map(c => c.variant_id).filter(Boolean))) as string[];
        const warehouseIds = Array.from(new Set(checks.map(c => c.warehouse_id).filter(Boolean))) as string[];
        const [pRes, vRes, wRes] = await Promise.all([
            productIds.length ? (supabase as any).from('products').select('id,name').in('id', productIds) : Promise.resolve({ data: [] }),
            variantIds.length ? (supabase as any).from('product_variants').select('id,name,sku').in('id', variantIds) : Promise.resolve({ data: [] }),
            warehouseIds.length ? (supabase as any).from('warehouses').select('id,name,code').in('id', warehouseIds) : Promise.resolve({ data: [] }),
        ]);
        const products: Record<string, string> = {};
        (pRes.data || []).forEach((p: any) => { products[p.id] = p.name; });
        const variants: Record<string, string> = {};
        (vRes.data || []).forEach((v: any) => { variants[v.id] = `${v.name || '-'}${v.sku ? ` (${v.sku})` : ''}`; });
        const warehouses: Record<string, string> = {};
        (wRes.data || []).forEach((w: any) => { warehouses[w.id] = `${w.name}${w.code ? ` (${w.code})` : ''}`; });
        setNameMap({ products, variants, warehouses });
    };

    const runCheckAndRecalc = async () => {
        setLoading(true);
        setRecalcResult(null);
        try {
            const { data, error } = await (supabase as any).rpc('reconcile_fifo_integrity', {
                p_product_id: null,
                p_variant_id: null,
            });
            if (error) throw error;
            const r = data as ReconcileResult;
            setResult(r);
            await resolveNames(r?.checks || []);

            const { data: recalc, error: recalcErr } = await (supabase as any).rpc('recalculate_inventory', {
                p_created_by: null,
            });
            if (recalcErr) throw recalcErr;
            setRecalcResult(recalc || []);
            const changed = (recalc || []).filter((x: any) => x.diff !== 0).length;
            const created = (recalc || []).filter((x: any) => x.old_quantity === 0 && x.diff > 0).length;
            const failed = (r?.checks || []).filter((c: any) => c.status === 'FAIL');

            if (failed.length === 0 && changed === 0) {
                toast.success('檢查通過，無需重算');
            } else {
                toast.success(`檢查完成：${failed.length} 項異常，重算更新 ${changed} 項${created ? `（${created} 項新建）` : ''}`);
            }
        } catch (e: any) {
            toast.error(e?.message || '檢查/重算失敗');
        } finally {
            setLoading(false);
        }
    };

    const detailOf = (c: any) => {
        const parts: string[] = [];
        if (c.product_id) parts.push(`商品：${nameMap.products[c.product_id] || c.product_id}`);
        if (c.variant_id) parts.push(`變體：${nameMap.variants[c.variant_id] || c.variant_id}`);
        if (c.warehouse_id) parts.push(`倉庫：${nameMap.warehouses[c.warehouse_id] || c.warehouse_id}`);
        if (c.status === 'FAIL') {
            if (c.delta !== undefined) parts.push(`異動量 ${c.movement_qty} vs 帳面 ${c.inventory_qty}（差 ${c.delta}）`);
            if (c.over_consumed_count !== undefined) parts.push(`超耗: ${c.over_consumed_count}`);
            if (c.over_allocated_count !== undefined) parts.push(`超配: ${c.over_allocated_count}`);
        }
        if (c.status === 'INFO') {
            if (c.pending_match_count !== undefined) parts.push(`待配對: ${c.pending_match_count}, 已配對: ${c.matched_count}`);
            if (c.suspense_quantity !== undefined) parts.push(`懸空數量: ${c.suspense_quantity}`);
        }
        if (parts.length === 0) parts.push(c.status === 'PASS' ? '-' : '詳情請見系統記錄');
        return parts.join(' / ');
    };

    const hasFail = (result?.checks || []).some((c: any) => c.status === 'FAIL');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>檢查並重算</DialogTitle>
                    <DialogDescription>
                        先執行 FIFO 一致性檢查（唯讀），再自動重算帳面數量
                    </DialogDescription>
                </DialogHeader>

                <div className="flex justify-center py-4">
                    <Button onClick={runCheckAndRecalc} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                        {loading ? '執行中...' : '檢查並重算'}
                    </Button>
                </div>

                {result && (
                    <ScrollArea className="max-h-[400px] overflow-x-auto">
                        <div className="mb-3 flex items-center gap-2 flex-wrap">
                            {result.ok ? (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                                    <CheckCircle2 className="mr-1 h-3 w-3" /> 全部通過
                                </Badge>
                            ) : (
                                <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                                    <XCircle className="mr-1 h-3 w-3" /> 發現異常
                                </Badge>
                            )}
                            {recalcResult && (
                                <Badge variant="outline" className="text-[10px]">
                                    重算更新 {recalcResult.filter((x: any) => x.diff !== 0).length} 項
                                </Badge>
                            )}
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-xs">檢查項目</TableHead>
                                    <TableHead className="text-xs">狀態</TableHead>
                                    <TableHead className="text-xs max-w-[360px]">詳情</TableHead>
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
                                        <TableCell className="text-xs text-muted-foreground max-w-[360px] whitespace-normal break-words">
                                            {detailOf(c)}
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