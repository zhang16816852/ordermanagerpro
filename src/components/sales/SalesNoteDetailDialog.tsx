import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Check, CreditCard, Calendar, Store, Info, FileText } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SalesNoteStatusBadge } from "./SalesNoteStatusBadge";
import { exportToPDF } from "@/lib/exportUtils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Card, CardContent } from '@/components/ui/card';
import z from "zod";

export interface SalesNoteItem {
    id: string;
    quantity: number;
    productName: string;
    productSku: string;
    variantName?: string | null;
    unitPrice?: number;
}

export interface SalesNoteDetail {
    id: string;
    code?: string;
    storeName?: string;
    storeCode?: string;
    status: string;
    created_at: string;
    shipped_at?: string | null;
    received_at?: string | null;
    notes?: string | null;
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
}

export function SalesNoteDetailDialog({
    open,
    onOpenChange,
    note,
    onConfirmReceive,
    isConfirming,
    enablePayment = false,
    showSku = true
}: SalesNoteDetailDialogProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

    const totalAmount = note ? note.items.reduce((sum, item) => sum + (item.quantity * (item.unitPrice || 0)), 0) : 0;

    // --- Queries ---
    const { data: accounts = [] } = useQuery({
        queryKey: ['accounts-for-sales-note-payment'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('accounts')
                .select('id, name, balance')
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            return data;
        },
        enabled: open && enablePayment,
    });

    const { data: categories = [] } = useQuery({
        queryKey: ['accounting-categories'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('accounting_categories')
                .select('id, name, type')
                .eq('is_active', true);
            if (error) throw error;
            return data;
        },
        enabled: open && enablePayment
    });

    const { data: existingPayment } = useQuery({
        queryKey: ['sales-note-payment', note?.id],
        queryFn: async () => {
            if (!note) return null;
            const { data, error } = await supabase
                .from('accounting_entries')
                .select('id, amount, transaction_date')
                .eq('reference_id', note.id)
                .eq('reference_type', 'sales_note')
                .eq('type', 'income')
                .maybeSingle();

            if (error) throw error;
            return data;
        },
        enabled: open && enablePayment && !!note
    });

    // --- Mutation ---
    const receivePaymentMutation = useMutation({
        mutationFn: async ({ accountId, amount, date }: { accountId: string; amount: number; date: string }) => {
            if (!note) throw new Error("No sales note selected");

            let categoryId = null;
            if (categories.length > 0) {
                const salesCategory = categories.find((c: any) =>
                    c.type === 'income' && (c.name.includes('銷貨') || c.name.includes('銷售'))
                );
                categoryId = salesCategory?.id || categories.find((c: any) => c.type === 'income')?.id;
            }

            const { error: entryError } = await supabase
                .from('accounting_entries')
                .insert({
                    type: 'income',
                    amount,
                    paid_amount: amount,
                    payment_status: 'paid',
                    transaction_date: date,
                    description: `銷貨單收款: ${note.code || note.id.slice(0, 8)}`,
                    reference_type: 'sales_note',
                    reference_id: note.id,
                    account_id: accountId,
                    category_id: categoryId,
                    created_by: user?.id,
                });

            if (entryError) throw entryError;

            const account = accounts.find((a: any) => a.id === accountId);
            if (account) {
                const { error: accError } = await supabase
                    .from('accounts')
                    .update({ balance: account.balance + amount })
                    .eq('id', accountId);
                if (accError) throw accError;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['accounts-for-sales-note-payment'] });
            queryClient.invalidateQueries({ queryKey: ['sales-note-payment'] });
            setPaymentDialogOpen(false);
            toast.success('收款已記錄');
        },
        onError: (error: any) => {
            toast.error(`收款記錄失敗: ${error.message}`);
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
                            <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> 建立時間</span>
                            <div>{format(new Date(note.created_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</div>
                        </div>

                        {(note.shipped_at || note.received_at) && (
                            <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4 pt-2 border-t border-muted">
                                {note.shipped_at && (
                                    <div>
                                        <span className="text-muted-foreground block text-xs">出貨時間</span>
                                        <span className="text-xs">{format(new Date(note.shipped_at), "MM/dd HH:mm")}</span>
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
                            <Package className="h-4 w-4" /> 銷售項目 ({note.items.length})
                        </h3>

                        {/* 電腦版表格 */}
                        <div className="hidden md:block rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>產品名稱</TableHead>
                                        <TableHead className="text-right">數量</TableHead>
                                        {note.items[0]?.unitPrice !== undefined && (
                                            <TableHead className="text-right">單價</TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {note.items.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <div className="font-medium">
                                                    {item.productName}
                                                    {item.variantName && (
                                                        <Badge variant="secondary" className="ml-2 text-[10px] h-5 px-1">
                                                            {item.variantName}
                                                        </Badge>
                                                    )}
                                                </div>
                                                {showSku && <div className="text-xs text-muted-foreground font-mono mt-0.5">{item.productSku}</div>}
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
                            {note.items.map((item) => (
                                <Card key={item.id} className="rounded-xl shadow-none border-muted/60">
                                    <CardContent className="p-3 space-y-2 text-sm">
                                        <div className="font-medium flex flex-wrap gap-1 items-center">
                                            {item.productName}
                                            {item.variantName && <Badge variant="secondary" className="text-[10px] px-1">{item.variantName}</Badge>}
                                        </div>
                                        {showSku && <div className="text-xs text-muted-foreground font-mono">{item.productSku}</div>}
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
                            <span className="text-xl font-bold text-primary">${totalAmount.toLocaleString()}</span>
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
                                    onClick={() => setPaymentDialogOpen(true)}
                                    disabled={!!existingPayment}
                                >
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    {existingPayment ? "已完成收款登記" : "登記收款"}
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full sm:w-auto"
                                onClick={() => exportToPDF("sales-note-content", `銷售單_${note.code || note.id.slice(0, 8)}`)}
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                匯出 PDF
                            </Button>
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

            {/* 收款對話框 */}
            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>記錄收款金額</DialogTitle>
                        <DialogDescription>
                            請選擇入帳帳戶並確認實收金額，提交後將自動更新帳戶餘額。
                        </DialogDescription>
                    </DialogHeader>
                    <PaymentForm
                        accounts={accounts}
                        amount={totalAmount}
                        onSubmit={(data) => receivePaymentMutation.mutate(data)}
                        isLoading={receivePaymentMutation.isPending}
                    />
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}

// --- 分離出的付款表單組件 ---
function PaymentForm({ accounts, amount: initialAmount, onSubmit, isLoading }: {
    accounts: any[];
    amount: number;
    onSubmit: (data: { accountId: string; amount: number; date: string }) => void;
    isLoading: boolean;
}) {
    const [accountId, setAccountId] = useState('');
    const [amount, setAmount] = useState(initialAmount.toString());
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

    return (
        <div className="space-y-4 py-2">
            <div className="space-y-2">
                <Label htmlFor="account">收款帳戶</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger id="account">
                        <SelectValue placeholder="選擇入帳帳戶" />
                    </SelectTrigger>
                    <SelectContent>
                        {accounts.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>
                                {acc.name} (餘額: ${acc.balance.toLocaleString()})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label htmlFor="amount">實收金額</Label>
                <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="date">交易日期</Label>
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <DialogFooter className="mt-6">
                <Button
                    className="w-full"
                    onClick={() => onSubmit({ accountId, amount: parseFloat(amount), date })}
                    disabled={!accountId || !amount || isLoading}
                >
                    {isLoading ? '處理中...' : '確認入帳'}
                </Button>
            </DialogFooter>
        </div>
    );
}