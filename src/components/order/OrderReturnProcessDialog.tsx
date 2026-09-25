import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RotateCcw, Warehouse as WarehouseIcon, Wallet, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { formatCurrency } from '@/lib/formatters';
import { useWarehouses } from '@/pages/admin/inventory/hooks/useWarehouses';
import { Account, AccountingCategory } from '@/pages/admin/accounting/types';
import { Order, OrderItem } from '@/types/order';

type ReturnAction = 'stock' | 'exchange' | 'repaired';

const ACTION_LABELS: Record<ReturnAction, string> = {
  stock: '退庫存（含退款）',
  exchange: '換貨',
  repaired: '送修歸還',
};

const ACTION_DESCRIPTIONS: Record<ReturnAction, string> = {
  stock: '退回自有倉庫並開立退款分錄',
  exchange: '僅標記結清（不退款、不異動庫存）',
  repaired: '僅標記結清（送修歸還、不退款、不異動庫存）',
};

interface OrderReturnProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
}

export function OrderReturnProcessDialog({ open, onOpenChange, order }: OrderReturnProcessDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { warehouses, defaultWarehouse } = useWarehouses();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ReturnAction>('stock');
  const [warehouseId, setWarehouseId] = useState('');
  const [refundAccountId, setRefundAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounts')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Account[];
    },
  });

  const { data: categories = [] } = useQuery<AccountingCategory[]>({
    queryKey: ['accounting-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounting_categories')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as AccountingCategory[];
    },
  });

  const returnLines = useMemo(() => {
    if (!order) return [];
    return [...order.order_items]
      .filter((i) => i.line_type === 'return' && i.return_status === 'pending')
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [order]);

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories]);

  useEffect(() => {
    if (open) {
      setAction('stock');
      setWarehouseId(defaultWarehouse?.id || '');
      setRefundAccountId('');
      setCategoryId('');
      setDescription('');
      setSelectedIds(new Set(returnLines.map((i) => i.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const selectedLines = useMemo(() => returnLines.filter((i) => selectedIds.has(i.id)), [returnLines, selectedIds]);

  const totalRefund = useMemo(() => {
    if (action !== 'stock') return 0;
    return selectedLines.reduce((sum, i) => sum + (i.unit_price || 0) * i.quantity, 0);
  }, [selectedLines, action]);

  const allSelected = returnLines.length > 0 && selectedLines.length === returnLines.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(returnLines.map((i) => i.id)));
  };

  const toggleLine = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const processMutation = useMutation({
    mutationFn: async () => {
      if (!order || !user) throw new Error('無訂單資料');
      const { data, error } = await (supabase.rpc as any)('process_order_return_lines', {
        p_line_ids: selectedLines.map((i) => i.id),
        p_action: action,
        p_warehouse_id: action === 'stock' ? warehouseId || null : null,
        p_refund_account_id: action === 'stock' ? refundAccountId || null : null,
        p_category_id: action === 'stock' ? categoryId || null : null,
        p_description: description.trim() || null,
        p_created_by: user.id,
      });
      if (error) throw error;
      const r = data as { ok?: boolean; reason?: string; processed?: number; total_refund?: number };
      if (r && r.ok === false) throw new Error(r.reason || '處理退貨失敗');
      return r;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      onOpenChange(false);
      const processed = r?.processed ?? selectedLines.length;
      const refund = r?.total_refund;
      toast.success(
        action === 'stock' && refund ? `已處理 ${processed} 個退貨列，退款 ${formatCurrency(refund)}` : `已處理 ${processed} 個退貨列`
      );
    },
    onError: (error: Error) => toast.error(getErrorMessage(error, '處理退貨失敗')),
  });

  const handleSubmit = () => {
    if (selectedLines.length === 0) {
      toast.error('請至少勾選一個退貨列');
      return;
    }
    if (action === 'stock' && totalRefund > 0 && !refundAccountId) {
      toast.error('退貨退款金額大於 0，請選擇退款帳戶');
      return;
    }
    processMutation.mutate();
  };

  const itemName = (item: OrderItem) => item.product_variant?.name || item.product?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            處理退貨列
          </DialogTitle>
          <DialogDescription>
            結清訂單中標記為「退貨／換貨／送修」的待處理品項{action === 'stock' && '，退貨數量將回勾庫存並開立退款分錄'}。
          </DialogDescription>
        </DialogHeader>

        {returnLines.length === 0 ? (
          <div className="text-muted-foreground text-sm py-8 text-center">
            此訂單沒有待處理的退貨列。
          </div>
        ) : (
          <div className="space-y-4">
            {/* 待處理退貨列 */}
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="全選退貨列"
                      />
                    </TableHead>
                    <TableHead>產品名稱</TableHead>
                    <TableHead className="text-right">單價</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">小計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returnLines.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleLine(item.id)}
                          aria-label={`選取 ${itemName(item)}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{itemName(item)}</div>
                        {item.line_note && (
                          <div className="text-xs text-muted-foreground mt-0.5">{item.line_note}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unit_price * item.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* 處理動作 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium">處理動作</Label>
                <Select value={action} onValueChange={(v) => setAction(v as ReturnAction)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTION_LABELS) as ReturnAction[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ACTION_DESCRIPTIONS[action]}</p>
              </div>

              {action === 'stock' && (
                <div className="space-y-1">
                  <Label className="text-sm font-medium flex items-center gap-1">
                    <WarehouseIcon className="h-3.5 w-3.5" /> 退貨入庫倉
                  </Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="預設自有倉" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses
                        .filter((w) => w.is_active !== false)
                        .map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name} ({w.code})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {action === 'stock' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5" /> 退款帳戶
                    </Label>
                    <Select value={refundAccountId} onValueChange={setRefundAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="選擇退款帳戶" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}（{a.currency}）餘額 {formatCurrency(a.balance, a.currency)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">退款會計分類</Label>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger>
                        <SelectValue placeholder="使用預設（客戶退貨退款）" />
                      </SelectTrigger>
                      <SelectContent>
                        {expenseCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {totalRefund > 0 && (
                  <div className="flex justify-end items-baseline gap-2 bg-muted/30 rounded-md px-4 py-2">
                    <span className="text-sm text-muted-foreground">退款總計</span>
                    <span className="text-lg font-bold text-red-600">{formatCurrency(totalRefund)}</span>
                  </div>
                )}
              </>
            )}

            <div className="space-y-1">
              <Label className="text-sm font-medium flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" /> 處理備註
              </Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例：客人退貨、瑕疵換貨、送修中……（會附加至退貨紀錄與退款說明）"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={processMutation.isPending}>
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={processMutation.isPending || selectedLines.length === 0}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {processMutation.isPending
                  ? '處理中...'
                  : action === 'stock'
                    ? `退庫存退款（${selectedLines.length} 列）`
                    : `標記${ACTION_LABELS[action]}（${selectedLines.length} 列）`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}