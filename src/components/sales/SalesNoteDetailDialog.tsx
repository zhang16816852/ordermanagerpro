import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Package, Check, CreditCard, Calendar, Store, Info, Pencil, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SalesNoteStatusBadge } from "./SalesNoteStatusBadge";
import { SalesReturnDialog } from "./SalesReturnDialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { formatCurrency } from '@/lib/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { SharedReceiptExport } from "@/pages/share/SharedReceiptExport";
import { EntryDialog } from "@/pages/admin/accounting/components/EntryDialog";
import { AccountingEntry, AccountingEntryReference, Account, AccountingCategory } from "@/pages/admin/accounting/types";

export interface SalesNoteItem {
    id: string;
    quantity: number;
    productName: string;
    productSku: string;
    variantName?: string | null;
    unitPrice?: number;
    sortOrder?: number;
    returnedQuantity?: number;
}

export interface SalesNoteDetail {
    id: string;
    code?: string;
    storeName?: string;
    storeCode?: string;
    status: string;
    payment_status?: string;
    created_at: string;
    shipped_at?: string | null;
    received_at?: string | null;
    notes?: string | null;
    access_token?: string | null;
    items: SalesNoteItem[];
}

interface SalesNoteDetailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    note: SalesNoteDetail | null;
    onConfirmReceive?: (noteId: string) => void;
    isConfirming?: boolean;
    enablePayment?: boolean;
    showSku?: boolean;
    enableReturn?: boolean;
}

export function SalesNoteDetailDialog({
    open,
    onOpenChange,
    note,
    onConfirmReceive,
    isConfirming,
    enablePayment = false,
    showSku = true,
    enableReturn = false
}: SalesNoteDetailDialogProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [entryDialogOpen, setEntryDialogOpen] = useState(false);
    const [returnDialogOpen, setReturnDialogOpen] = useState(false);
    const [editingDate, setEditingDate] = useState(false);
    const [newShippedDate, setNewShippedDate] = useState("");

    const sortedItems = useMemo(() => {
        if (!note?.items) return [];
        return [...note.items].sort((a, b) => {
            if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
                return a.sortOrder - b.sortOrder;
            }
            return 0;
        });
    }, [note?.items]);

    const totalAmount = note ? note.items.reduce((sum, item) => sum + (item.quantity * (item.unitPrice || 0)), 0) : 0;

    // --- Queries for EntryDialog ---
    const { data: accounts = [] } = useQuery({
        queryKey: ['accounts'],
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('accounts') as any)
                .select('id, name, type, currency, balance, description, is_active')
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            return (data || []) as Account[];
        },
        enabled: open && (enablePayment || enableReturn),
    });

    const { data: categories = [] } = useQuery({
        queryKey: ['accounting-categories'],
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('accounting_categories') as any)
                .select('id, name, type, description, is_active')
                .eq('is_active', true);
            if (error) throw error;
            return (data || []) as AccountingCategory[];
        },
        enabled: open && enablePayment
    });

    const { data: existingPayment } = useQuery({
        queryKey: ['sales-note-payment', note?.id],
        queryFn: async () => {
            if (!note) return null;
            // 先確認該銷貨單是否已收款（由 sync_sales_note_payment_status RPC 維護）
            if (note.payment_status !== 'paid') return null;
            // 查找對應的會計分錄（先查 entry row，再查 references 子表）
            const { data: entryByRef, error: e1 } = await (supabase
                .from('accounting_entries') as any)
                .select('id, amount, paid_amount, transaction_date')
                .eq('reference_id', note.id)
                .eq('reference_type', 'sales_note')
                .eq('type', 'income')
                .gt('paid_amount', 0)
                .limit(1)
                .maybeSingle();
            if (e1) throw e1;
            if (entryByRef) return entryByRef;
            // 向下相容：查 references 子表
            const { data: refs } = await (supabase as any)
                .from('accounting_entry_references')
                .select('entry_id')
                .eq('reference_type', 'sales_note')
                .eq('reference_id', note.id)
                .limit(1);
            if (!refs || refs.length === 0) return null;
            const { data: entry, error: e2 } = await (supabase
                .from('accounting_entries') as any)
                .select('id, amount, paid_amount, transaction_date')
                .eq('id', refs[0].entry_id)
                .maybeSingle();
            if (e2) throw e2;
            return entry;
        },
        enabled: open && enablePayment && !!note
    });

    // --- Mutation: create paid entry via EntryDialog ---
    const receivePaymentMutation = useMutation({
        mutationFn: async ({ data, references }: { data: Partial<AccountingEntry>; references?: AccountingEntryReference[] }) => {
            if (!note) throw new Error("No sales note selected");

            const { data: newEntry, error: entryError } = await (supabase
                .from('accounting_entries') as any)
                .insert({ ...data, created_by: user?.id })
                .select('id')
                .single();
            if (entryError) throw entryError;

            if (references && references.length > 0 && newEntry) {
                const refsToInsert = references.map(ref => ({
                    entry_id: newEntry.id,
                    reference_type: ref.reference_type,
                    reference_id: ref.reference_id,
                    item_name: ref.item_name,
                    amount_applied: ref.amount_applied,
                }));
                const { error: refError } = await (supabase as any)
                    .from('accounting_entry_references')
                    .insert(refsToInsert);
                if (refError) throw refError;
            }

            if (data.account_id && data.amount) {
                const account = accounts.find((a: Account) => a.id === data.account_id);
                if (account) {
                    const { error: accError } = await (supabase
                        .from('accounts') as any)
                        .update({ balance: account.balance + (data.amount || 0) })
                        .eq('id', data.account_id);
                    if (accError) throw accError;
                }
            }

            // 用 RPC 統一同步收款狀態（同時檢查 entry row 和 references 子表）
            const { error: noteError } = await (supabase as any)
                .rpc('sync_sales_note_payment_status', { p_sales_note_id: note.id });
            if (noteError) throw noteError;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['accounts'] });
            queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
            queryClient.invalidateQueries({ queryKey: ['sales-note-payment'] });
            queryClient.invalidateQueries({ queryKey: ['admin-sales-notes'] });
            queryClient.invalidateQueries({ queryKey: ['store-sales-notes'] });
            setEntryDialogOpen(false);
            toast.success('收款已記錄');
        },
        onError: (error: any) => {
            toast.error(`收款記錄失敗: ${getErrorMessage(error)}`);
        },
    });

    // --- 更新出貨日期 ---
    const updateShippedDateMutation = useMutation({
        mutationFn: async ({ noteId, date }: { noteId: string; date: string }) => {
            const { error } = await supabase.rpc("update_sales_note_shipped_date" as any, {
                p_sales_note_id: noteId,
                p_date: date,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-sales-notes"] });
            setEditingDate(false);
            toast.success("出貨日期已更新");
        },
        onError: (error: any) => {
            toast.error(`更新失敗：${getErrorMessage(error, "更新出貨日期失敗，請稍後再試")}`);
        },
    });

    if (!note) return null;

    return (

        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-primary" />
                        銷售單詳情
                    </DialogTitle>
                    <DialogDescription>
                        檢視此銷售單的產品細節、店鋪資訊與目前的物流狀態。
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6" id="sales-note-content">
                    {/* 基本資訊區塊 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-muted/20 p-4 rounded-lg border">
                        <div className="space-y-1">
                            <span className="text-muted-foreground flex items-center gap-1"><Info className="h-3.5 w-3.5" /> 編號</span>
                            <div className="font-mono text-xs font-bold break-all">{note.code || note.id}</div>
                        </div>

                        {note.storeName && (
                            <div className="space-y-1">
                                <span className="text-muted-foreground flex items-center gap-1"><Store className="h-3.5 w-3.5" /> 店鋪</span>
                                <div className="font-medium">
                                    {note.storeName}
                                    {note.storeCode && <span className="text-xs text-muted-foreground ml-2">({note.storeCode})</span>}
                                </div>
                            </div>
                        )}

                        <div className="space-y-1">
                            <span className="text-muted-foreground flex items-center gap-1">當前狀態</span>
                            <div><SalesNoteStatusBadge status={note.status} /></div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-muted-foreground flex items-center gap-1">收款狀態</span>
                            <div>
                                {note.payment_status === "paid" ? (
                                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50">已收款</Badge>
                                ) : (
                                    <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">未收款</Badge>
                                )}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> 建立時間</span>
                            <div>{format(new Date(note.created_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</div>
                        </div>

                        {(note.shipped_at || note.received_at) && (
                            <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4 pt-2 border-t border-muted">
                                {note.shipped_at && (
                                    <div>
                                        <span className="text-muted-foreground block text-xs">出貨時間</span>
                                        {editingDate ? (
                                            <div className="flex items-center gap-1 mt-1">
                                                <Input
                                                    type="date"
                                                    className="h-7 text-xs w-36"
                                                    value={newShippedDate}
                                                    onChange={(e) => setNewShippedDate(e.target.value)}
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 px-2"
                                                    onClick={() => {
                                                        if (newShippedDate) {
                                                            updateShippedDateMutation.mutate({ noteId: note.id, date: newShippedDate });
                                                        }
                                                    }}
                                                    disabled={updateShippedDateMutation.isPending}
                                                >
                                                    <Check className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 px-2"
                                                    onClick={() => setEditingDate(false)}
                                                >
                                                    ✕
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 group">
                                                <span className="text-xs">{format(new Date(note.shipped_at), "yyyy/MM/dd")}</span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title="編輯出貨日期"
                                                    onClick={() => {
                                                        setNewShippedDate(format(new Date(note.shipped_at!), "yyyy-MM-dd"));
                                                        setEditingDate(true);
                                                    }}
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {note.received_at && (
                                    <div>
                                        <span className="text-muted-foreground block text-xs">收貨時間</span>
                                        <span className="text-xs">{format(new Date(note.received_at), "MM/dd HH:mm")}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {note.notes && (
                        <div className="bg-amber-50/50 border border-amber-100 p-3 rounded-md text-sm">
                            <span className="text-amber-800 font-medium mb-1 block">備註：</span>
                            <p className="text-amber-900">{note.notes}</p>
                        </div>
                    )}

                    {/* 銷售項目列表 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                            <Package className="h-4 w-4" /> 銷售項目 ({sortedItems.length})
                        </h3>

                        {/* 電腦版表格 */}
                        <div className="hidden md:block rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>產品名稱</TableHead>
                                        <TableHead className="text-right">數量</TableHead>
                                        {sortedItems[0]?.unitPrice !== undefined && (
                                            <TableHead className="text-right">單價</TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedItems.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <div className="font-medium product-name-cell">
                                                    {item.variantName ? item.variantName : item.productName}
                                                </div>
                                                {showSku && <div className="text-xs text-muted-foreground font-mono mt-0.5">{item.productSku}</div>}
                                                {!!item.returnedQuantity && (
                                                    <Badge variant="outline" className="mt-1 text-orange-600 border-orange-300 bg-orange-50">
                                                        已退 {item.returnedQuantity}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                                            {item.unitPrice !== undefined && (
                                                <TableCell className="text-right text-muted-foreground">${item.unitPrice}</TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* 手機版卡片 */}
                        <div className="md:hidden space-y-3">
                            {sortedItems.map((item) => (
                                <Card key={item.id} className="rounded-xl shadow-none border-muted/60">
                                    <CardContent className="p-3 space-y-2 text-sm">
                                        <div className="font-medium flex flex-wrap gap-1 items-center product-name-cell">
                                            {item.variantName ? item.variantName : item.productName}
                                        </div>
                                        {showSku && <div className="text-xs text-muted-foreground font-mono">{item.productSku}</div>}
                                        {!!item.returnedQuantity && (
                                            <div>
                                                <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50">
                                                    已退 {item.returnedQuantity}
                                                </Badge>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center pt-1">
                                            <div><span className="text-muted-foreground">數量：</span>{item.quantity}</div>
                                            {item.unitPrice !== undefined && <div className="font-semibold">${item.unitPrice}</div>}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>

                    {totalAmount > 0 && (
                        <div className="flex justify-end items-baseline gap-2 pt-2">
                            <span className="text-sm text-muted-foreground">總計</span>
                            <span className="text-xl font-bold text-primary">{formatCurrency(totalAmount)}</span>
                        </div>
                    )}

                    {/* 操作按鈕 */}
                    <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4 border-t print:hidden">
                        <div className="flex flex-wrap gap-2">
                            {enablePayment && totalAmount > 0 && (
                                <Button
                                    variant={existingPayment ? "secondary" : "outline"}
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    onClick={() => setEntryDialogOpen(true)}
                                    disabled={!!existingPayment}
                                >
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    {existingPayment ? "已完成收款登記" : "登記收款"}
                                </Button>
                            )}
                            {enableReturn && (note.status === 'shipped' || note.status === 'received') && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full sm:w-auto text-orange-600 border-orange-300 hover:bg-orange-50"
                                    onClick={() => setReturnDialogOpen(true)}
                                >
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                    退貨登記
                                </Button>
                            )}
                            {note.access_token && (
                                <SharedReceiptExport
                                    items={sortedItems.map((item) => ({
                                        name: item.productName,
                                        variant: item.variantName,
                                        quantity: item.quantity,
                                        unit_price: item.unitPrice ?? null,
                                    }))}
                                    title="銷貨單"
                                    docTitleLabel="店名"
                                    storeName={note.storeName || ""}
                                    code={note.code || note.id}
                                    createdAt={note.created_at}
                                    status={note.status === "received" ? "已收貨" : "已出貨"}
                                    notes={note.notes || undefined}
                                    qrValue={`${window.location.origin}/share/sale/${note.code || note.id}?token=${note.access_token}`}
                                    filenamePrefix="銷貨單"
                                    canViewPrice={totalAmount > 0}
                                    printButtonLabel="列印 / PDF / Excel"
                                />
                            )}
                        </div>

                        {onConfirmReceive && note.status === 'shipped' && (
                            <Button
                                onClick={() => onConfirmReceive(note.id)}
                                disabled={isConfirming}
                                className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
                            >
                                <Check className="mr-2 h-4 w-4" />
                                {isConfirming ? "處理中..." : "確認收到貨物"}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>

            {/* 收款對話框 — 統一使用 EntryDialog */}
            <EntryDialog
                open={entryDialogOpen}
                onOpenChange={setEntryDialogOpen}
                categories={categories}
                accounts={accounts}
                isLoading={receivePaymentMutation.isPending}
                prefill={{
                    amount: totalAmount,
                    categoryId: (() => {
                        if (categories.length === 0) return undefined;
                        const salesCategory = categories.find((c: AccountingCategory) =>
                            c.type === 'income' && (c.name.includes('銷貨') || c.name.includes('銷售'))
                        );
                        return salesCategory?.id || categories.find((c: AccountingCategory) => c.type === 'income')?.id;
                    })(),
                    description: `銷貨單收款: ${note.code || note.id.slice(0, 8)}`,
                    referenceType: 'sales_note',
                    referenceId: note.id,
                    transactionDate: format(new Date(), 'yyyy-MM-dd'),
                    markAsPaid: true,
                    docItems: [{
                        docType: 'sales_note',
                        docId: note.id,
                        code: note.code || note.id.slice(0, 8),
                        name: note.storeName || '未知店家',
                        date: note.created_at,
                        originalAmount: totalAmount,
                        amountApplied: totalAmount,
                    }],
                }}
                onSubmit={(data, references) => receivePaymentMutation.mutate({ data, references })}
            />

            {/* 退貨對話框 */}
            <SalesReturnDialog
                open={returnDialogOpen}
                onOpenChange={setReturnDialogOpen}
                note={note}
                accounts={accounts}
            />
        </Dialog>
    );
}

// PaymentForm removed — unified into EntryDialog