import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Check, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SalesNoteStatusBadge } from "./SalesNoteStatusBadge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// Define a flexible interface that covers both Admin and Store data structures
// Admin uses join types, Store uses nested objects. We'll try to support both or standardize.
// For now, let's use a standard interface that the parents need to map to or match.

export interface SalesNoteItem {
    id: string;
    quantity: number;
    // Support both structures or normalized one
    productName: string;
    productSku: string;
    variantName?: string | null;
    unitPrice?: number;
}

export interface SalesNoteDetail {
    id: string;
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

    // Calculate total amount if unit prices are available
    const totalAmount = note ? note.items.reduce((sum, item) => sum + (item.quantity * (item.unitPrice || 0)), 0) : 0;

    const { data: accounts = [] } = useQuery({
        queryKey: ['accounts-for-sales-note-payment'],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
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
            const { data, error } = await (supabase as any)
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
            const { data, error } = await (supabase as any)
                .from('accounting_entries')
                .select('id, amount, transaction_date')
                .eq('reference_id', note.id)
                .eq('reference_type', 'sales_note')
                .eq('type', 'income')
                .maybeSingle();

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        },
        enabled: open && enablePayment && !!note
    });

    const receivePaymentMutation = useMutation({
        mutationFn: async ({ accountId, amount, date }: { accountId: string; amount: number; date: string }) => {
            if (!note) throw new Error("No sales note selected");

            // Auto-assign category
            let categoryId = null;
            if (categories.length > 0) {
                // Try to find a 'Sales' or 'Income' category
                const salesCategory = categories.find((c: any) =>
                    c.type === 'income' && (c.name.includes('銷貨') || c.name.includes('銷售') || c.name.includes('收入') || c.name.includes('Sales') || c.name.includes('Revenue'))
                );
                if (salesCategory) {
                    categoryId = salesCategory.id;
                } else {
                    const anyIncome = categories.find((c: any) => c.type === 'income');
                    if (anyIncome) categoryId = anyIncome.id;
                }
            }

            // 1. Create Accounting Entry
            const { error: entryError } = await (supabase as any)
                .from('accounting_entries')
                .insert({
                    type: 'income',
                    amount: amount,
                    paid_amount: amount,
                    payment_status: 'paid',
                    transaction_date: date,
                    description: `銷貨單收款: ${note.id.slice(0, 8)}`,
                    reference_type: 'sales_note',
                    reference_id: note.id,
                    account_id: accountId,
                    category_id: categoryId,
                    created_by: user?.id,
                });

            if (entryError) {
                console.error("Payment Error", entryError);
                throw entryError;
            }

            // 2. Update Account Balance
            const account = accounts.find((a: any) => a.id === accountId);
            if (account) {
                const { error: accError } = await (supabase as any)
                    .from('accounts')
                    .update({ balance: account.balance + amount }) // Income adds to balance
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
            toast.error(`收款記錄失敗: ${error.message || '未知錯誤'}`);
        },
    });

    if (!note) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        銷售單詳情
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground block mb-1">編號</span>
                            <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{note.id}</span>
                        </div>

                        {note.storeName && (
                            <div>
                                <span className="text-muted-foreground block mb-1">店鋪</span>
                                <span className="font-medium">{note.storeName}</span>
                                {note.storeCode && <span className="text-xs text-muted-foreground ml-2">({note.storeCode})</span>}
                            </div>
                        )}

                        <div>
                            <span className="text-muted-foreground block mb-1">狀態</span>
                            <SalesNoteStatusBadge status={note.status} />
                        </div>

                        <div>
                            <span className="text-muted-foreground block mb-1">建立時間</span>
                            <span>{format(new Date(note.created_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
                        </div>

                        {note.shipped_at && (
                            <div>
                                <span className="text-muted-foreground block mb-1">出貨時間</span>
                                <span>{format(new Date(note.shipped_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
                            </div>
                        )}

                        {note.received_at && (
                            <div>
                                <span className="text-muted-foreground block mb-1">收貨時間</span>
                                <span>{format(new Date(note.received_at), "yyyy/MM/dd HH:mm", { locale: zhTW })}</span>
                            </div>
                        )}
                    </div>

                    {note.notes && (
                        <div className="bg-muted/30 p-3 rounded-md text-sm">
                            <span className="text-muted-foreground font-medium mb-1 block">備註：</span>
                            <p>{note.notes}</p>
                        </div>
                    )}

                    <div>
                        <h4 className="font-medium mb-2 text-sm flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary" />
                            銷售項目 ({note.items.length})
                        </h4>
                        <div className="rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>
                                            {showSku ? "產品 / SKU" : "產品"}
                                        </TableHead>
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
                                                        <Badge variant="secondary" className="ml-2 text-[10px] h-5 px-1 font-normal">
                                                            {item.variantName}
                                                        </Badge>
                                                    )}
                                                </div>
                                                {showSku && (
                                                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                                        {item.productSku}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {item.quantity}
                                            </TableCell>
                                            {item.unitPrice !== undefined && (
                                                <TableCell className="text-right text-muted-foreground">
                                                    ${item.unitPrice}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {totalAmount > 0 && (
                        <div className="flex justify-end text-lg font-semibold text-primary">
                            總計：${totalAmount.toLocaleString()}
                        </div>
                    )}

                    {/* Actions Row */}
                    <div className="flex justify-between items-center pt-2 border-t mt-4">
                        <div className="flex gap-2">
                            {enablePayment && totalAmount > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPaymentDialogOpen(true)}
                                    disabled={!!existingPayment}
                                >
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    {existingPayment ? "已收款" : "收款"}
                                </Button>
                            )}
                        </div>

                        {/* Confirm Receive Action (Only for Store view when shipped) */}
                        {onConfirmReceive && note.status === 'shipped' && (
                            <Button
                                onClick={() => onConfirmReceive(note.id)}
                                disabled={isConfirming}
                                className="bg-green-600 hover:bg-green-700 text-white"
                            >
                                <Check className="mr-2 h-4 w-4" />
                                {isConfirming ? "確認中..." : "確認收貨"}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>

            {/* Payment Dialog */}
            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>記錄收款</DialogTitle>
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

function PaymentForm({
    accounts,
    amount: initialAmount,
    onSubmit,
    isLoading,
}: {
    accounts: any[];
    amount: number;
    onSubmit: (data: { accountId: string; amount: number; date: string }) => void;
    isLoading: boolean;
}) {
    const [accountId, setAccountId] = useState('');
    const [amount, setAmount] = useState(initialAmount.toString());
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>收款帳戶</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger>
                        <SelectValue placeholder="選擇帳戶" />
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
                <Label>金額</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>收款日期</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <DialogFooter>
                <Button
                    onClick={() => onSubmit({ accountId, amount: parseFloat(amount), date })}
                    disabled={!accountId || !amount || isLoading}
                >
                    {isLoading ? '處理中...' : '確認收款'}
                </Button>
            </DialogFooter>
        </div>
    );
}
