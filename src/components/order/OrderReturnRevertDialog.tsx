import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Undo2, Loader2, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { Order, OrderItem } from '@/types/order';

const RETURN_STATUS_LABELS: Record<string, string> = {
    pending: '待處理',
    stock: '已退庫存',
    exchange: '已換貨',
    repaired: '已送修歸還',
};

/** 與後端 revert_order_return_line 守門同源的阻擋原因 → 處理指引 */
const BLOCK_HINTS: Record<string, string> = {
    accounting: '請先至「會計」→ 該銷貨單的收款分錄執行「回退付款」或刪除分錄，再重新撤銷。',
    sales_note: '請先依銷貨單收貨流程處理後再撤銷。',
    rep_payout: '請先於會計模組撤銷該筆業務分潤發放。',
    consignment_sale: '此為寄賣確認銷售的收款單，請由寄賣管理反向處理。',
    inventory_source: '此退貨列來自寄賣庫存，請使用寄賣出貨回滾。',
};

interface RevertBlockInfo {
    blocked: boolean;
    reason?: string;
    hint?: string;
    noteCode?: string;
}

interface OrderReturnRevertDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    order: Order | null;
}

export function OrderReturnRevertDialog({ open, onOpenChange, order }: OrderReturnRevertDialogProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const returnLines = useMemo(() => {
        if (!order) return [];
        return [...order.order_items]
            .filter((i) => i.line_type === 'return')
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }, [order]);

    // 一次撈出這些品項綁定的銷貨單守門狀態（與後端同一組條件），供前端提前停用按鈕
    const { data: blockMap = {}, isLoading: blockLoading } = useQuery<Record<string, RevertBlockInfo>>({
        queryKey: ['return-revert-blocks', order?.id, returnLines.map((i) => i.id)],
        enabled: open && returnLines.length > 0,
        queryFn: async () => {
            const itemIds = returnLines.map((i) => i.id);
            if (itemIds.length === 0) return {};

            const { data, error } = await (supabase as any)
                .from('sales_note_items')
                .select('order_item_id, sales_note_id, inventory_source_type, sales_notes!inner(id, code, status)')
                .in('order_item_id', itemIds);
            if (error) throw error;
            const rows = (data || []) as any[];

            const noteIds = Array.from(new Set(rows.map((r) => r.sales_note_id))) as string[];
            const entryNoteIds = new Set<string>();
            const payoutNoteIds = new Set<string>();
            const consignmentNoteIds = new Set<string>();

            if (noteIds.length > 0) {
                const [entries, refs, payouts, consales] = await Promise.all([
                    (supabase as any)
                        .from('accounting_entries')
                        .select('reference_id')
                        .eq('reference_type', 'sales_note')
                        .in('reference_id', noteIds),
                    (supabase as any)
                        .from('accounting_entry_references')
                        .select('reference_id')
                        .eq('reference_type', 'sales_note')
                        .in('reference_id', noteIds),
                    (supabase as any)
                        .from('rep_commission_payouts')
                        .select('sales_note_id')
                        .in('sales_note_id', noteIds),
                    (supabase as any)
                        .from('consignment_sales')
                        .select('sales_note_id, reversed')
                        .in('sales_note_id', noteIds),
                ]);
                for (const e of [...(entries.data || []), ...(refs.data || [])]) {
                    entryNoteIds.add(e.reference_id);
                }
                for (const p of payouts.data || []) payoutNoteIds.add(p.sales_note_id);
                for (const c of consales.data || []) {
                    if (!c.reversed) consignmentNoteIds.add(c.sales_note_id);
                }
            }

            const result: Record<string, RevertBlockInfo> = {};
            for (const r of rows) {
                const note = Array.isArray(r.sales_notes) ? r.sales_notes[0] : r.sales_notes;
                const code: string = note?.code || '';
                let reason: string | undefined;
                let hint: string | undefined;

                if (note?.status === 'received') {
                    reason = `銷貨單 ${code} 已收貨，無法撤銷退貨`;
                    hint = BLOCK_HINTS.sales_note;
                } else if (entryNoteIds.has(r.sales_note_id)) {
                    reason = `銷貨單 ${code} 已有會計分錄（如收款），無法撤銷退貨`;
                    hint = BLOCK_HINTS.accounting;
                } else if (payoutNoteIds.has(r.sales_note_id)) {
                    reason = `銷貨單 ${code} 已完成業務佣金發放`;
                    hint = BLOCK_HINTS.rep_payout;
                } else if (consignmentNoteIds.has(r.sales_note_id)) {
                    reason = `銷貨單 ${code} 為寄賣確認銷售的收款單`;
                    hint = BLOCK_HINTS.consignment_sale;
                } else if (r.inventory_source_type !== 'self') {
                    reason = `銷貨單 ${code} 此退貨列的庫存來源為 ${r.inventory_source_type || 'unknown'}（非自有庫存）`;
                    hint = BLOCK_HINTS.inventory_source;
                }

                // 保留第一個阻擋原因（後端也是遇到第一張不符即擋下）
                if (reason && !result[r.order_item_id]) {
                    result[r.order_item_id] = { blocked: true, reason, hint, noteCode: code };
                }
            }
            return result;
        },
    });

    useEffect(() => {
        if (open) setSelectedIds(new Set());
    }, [open, order?.id]);

    const isBlocked = (itemId: string) => !!blockMap[itemId]?.blocked;
    const selectableLines = useMemo(
        () => returnLines.filter((i) => !blockMap[i.id]?.blocked),
        [returnLines, blockMap]
    );
    const selectedLines = useMemo(() => returnLines.filter((i) => selectedIds.has(i.id)), [returnLines, selectedIds]);
    const allSelected = selectableLines.length > 0 && selectableLines.every((i) => selectedIds.has(i.id));

    const toggleAll = () => {
        setSelectedIds(allSelected ? new Set() : new Set(selectableLines.map((i) => i.id)));
    };

    const toggleLine = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const revertMutation = useMutation({
        mutationFn: async () => {
            if (!user) throw new Error('無使用者資料');
            const results: any[] = [];
            for (const item of selectedLines) {
                const { data, error } = await (supabase.rpc as any)('revert_order_return_line', {
                    p_order_item_id: item.id,
                    p_created_by: user.id,
                });
                if (error) throw error;
                const r = data as { ok?: boolean; reason?: string; order_code?: string; removed_qty?: number };
                if (r && r.ok === false) throw new Error(r.reason || '撤銷退貨失敗');
                results.push(r);
            }
            return results;
        },
        onSuccess: (results) => {
            queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
            queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
            queryClient.invalidateQueries({ queryKey: ['shipping-pool-items'] });
            onOpenChange(false);

            const removedNotes = new Set<string>();
            let totalQty = 0;
            for (const r of results) {
                for (const c of r?.removed_sales_notes || []) removedNotes.add(c);
                totalQty += r?.removed_qty || 0;
            }
            const noteText = removedNotes.size > 0 ? `，已撤銷 ${Array.from(removedNotes).join('、')} 的退貨列` : '';
            toast.success(
                `已撤銷 ${results.length} 個退貨列（共 ${totalQty} 件）並還原為一般銷售${noteText}；品項已回到出貨池，請重新出貨。`
            );
        },
        onError: (error: Error) => toast.error(getErrorMessage(error, '撤銷退貨失敗')),
    });

    const itemName = (item: OrderItem) => item.product_variant?.name || item.product?.name;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Undo2 className="h-5 w-5 text-primary" />
                        撤銷退貨（還原為一般銷售）
                    </DialogTitle>
                    <DialogDescription>
                        用於<strong>誤標</strong>為退貨的品項。撤銷後會移除銷貨單上的負數退貨列並回沖庫存，
                        將品項設回一般銷售並放回出貨池（需重新出貨）。<strong>不會退款</strong>。
                    </DialogDescription>
                </DialogHeader>

                {returnLines.length === 0 ? (
                    <div className="text-muted-foreground text-sm py-8 text-center">
                        此訂單沒有退貨列。
                    </div>
                ) : (
                    <div className="space-y-4">
                        <Alert>
                            <AlertDescription className="text-xs">
                                請僅用於「誤標」情境。若客戶確實退貨，請改用訂單詳情的「處理退貨」功能
                                （可退庫存並開立退款分錄），以保留退款與會計紀錄。
                            </AlertDescription>
                        </Alert>

                        <div className="rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="w-10">
                                            <Checkbox
                                                checked={allSelected}
                                                onCheckedChange={toggleAll}
                                                disabled={blockLoading || selectableLines.length === 0}
                                                aria-label="全選可撤銷的退貨列"
                                            />
                                        </TableHead>
                                        <TableHead>產品名稱</TableHead>
                                        <TableHead>退貨狀態</TableHead>
                                        <TableHead className="text-right">數量</TableHead>
                                        <TableHead>可否撤銷</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {returnLines.map((item) => {
                                        const block = blockMap[item.id];
                                        const blocked = !!block?.blocked;
                                        return (
                                            <TableRow key={item.id} className={blocked ? 'opacity-70' : undefined}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedIds.has(item.id)}
                                                        onCheckedChange={() => toggleLine(item.id)}
                                                        disabled={blocked || blockLoading}
                                                        aria-label={`選取 ${itemName(item)}`}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium text-sm">{itemName(item)}</div>
                                                    {item.line_note && (
                                                        <div className="text-xs text-muted-foreground mt-0.5">{item.line_note}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary" className="text-xs">
                                                        {RETURN_STATUS_LABELS[item.return_status ?? 'pending'] ?? '待處理'}
                                                    </Badge>
                                                    {item.is_repair && (
                                                        <Badge variant="outline" className="text-xs ml-1">送修</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">{item.quantity}</TableCell>
                                                <TableCell>
                                                    {blockLoading ? (
                                                        <span className="text-xs text-muted-foreground">檢查中…</span>
                                                    ) : blocked ? (
                                                        <div className="text-xs">
                                                            <div className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-500">
                                                                <Lock className="h-3 w-3 shrink-0" />
                                                                需人工處理
                                                            </div>
                                                            <div className="text-muted-foreground mt-0.5">{block?.reason}</div>
                                                            {block?.hint && (
                                                                <div className="text-muted-foreground/80 mt-0.5">{block.hint}</div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-emerald-700 dark:text-emerald-500">可撤銷</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        {selectedLines.some((i) => isBlocked(i.id)) && (
                            <p className="text-xs text-amber-700 dark:text-amber-500">
                                勾選中包含被阻擋的品項，請先依上方指引人工處理。
                            </p>
                        )}

                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={revertMutation.isPending}>
                                取消
                            </Button>
                            <Button
                                onClick={() => revertMutation.mutate()}
                                disabled={
                                    revertMutation.isPending ||
                                    blockLoading ||
                                    selectedLines.length === 0 ||
                                    selectedLines.some((i) => isBlocked(i.id))
                                }
                                className="bg-orange-600 hover:bg-orange-700"
                            >
                                {revertMutation.isPending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        撤銷中...
                                    </>
                                ) : (
                                    <>撤銷退貨（{selectedLines.length} 列）</>
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
