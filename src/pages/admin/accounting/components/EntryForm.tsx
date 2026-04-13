import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { AccountingEntry, AccountingCategory } from '../types';

interface EntryFormProps {
  entry: AccountingEntry | null;
  categories: AccountingCategory[];
  onSubmit: (data: Partial<AccountingEntry>) => void;
  isLoading: boolean;
}

export function EntryForm({
  entry,
  categories,
  onSubmit,
  isLoading,
}: EntryFormProps) {
  const [mode, setMode] = useState<'manual' | 'import'>('manual');
  const [type, setType] = useState<'income' | 'expense'>(entry?.type || 'expense');
  const [categoryId, setCategoryId] = useState(entry?.category_id || '');
  const [amount, setAmount] = useState(entry?.amount?.toString() || '');
  const [description, setDescription] = useState(entry?.description || '');
  const [transactionDate, setTransactionDate] = useState(entry?.transaction_date || format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(entry?.due_date || '');

  // Import mode states
  const [importType, setImportType] = useState<'purchase' | 'order'>('purchase');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredCategories = categories.filter(c => c.type === type);

  // Queries for import data
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['available-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select(`
          id,
          total_amount,
          order_date,
          status,
          supplier:suppliers(name)
        `)
        .neq('status', 'cancelled')
        .order('order_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data;
    },
    enabled: mode === 'import' && importType === 'purchase',
  });

  const { data: salesOrders = [] } = useQuery({
    queryKey: ['available-sales-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          created_at,
          status,
          store:stores(name),
          order_items(quantity, unit_price)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return (data || []).map((order: any) => ({
        ...order,
        total_amount: order.order_items.reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0)
      }));
    },
    enabled: mode === 'import' && importType === 'order',
  });

  const handleImportSelection = (id: string, itemAmount: number, itemDesc: string, checked: boolean) => {
    const newResult = new Set(selectedIds);
    if (checked) {
      newResult.add(id);
    } else {
      newResult.delete(id);
    }
    setSelectedIds(newResult);

    // Recalculate total amount and description
    const currentList = importType === 'purchase' ? purchaseOrders : salesOrders;
    const selectedItems = currentList.filter((item: any) => newResult.has(item.id));

    const total = selectedItems.reduce((sum: number, item: any) => sum + (item.total_amount || 0), 0);
    setAmount(total.toString());

    if (selectedItems.length > 0) {
      const ids = selectedItems.map((item: any) => item.id.slice(0, 8));
      const prefix = importType === 'purchase' ? '採購單' : '銷售單';
      setDescription(`${prefix}: ${ids.join(', ')}`);
    } else {
      setDescription('');
    }
  };

  return (
    <div className="space-y-4">
      {!entry && (
        <div className="flex items-center space-x-2 pb-4 border-b">
          <Button
            variant={mode === 'manual' ? 'default' : 'outline'}
            onClick={() => { setMode('manual'); setAmount(''); setDescription(''); }}
            size="sm"
          >
            手動輸入
          </Button>
          <Button
            variant={mode === 'import' ? 'default' : 'outline'}
            onClick={() => {
              setMode('import');
              setAmount('');
              setDescription('');
              if (importType === 'purchase') setType('expense');
            }}
            size="sm"
          >
            從單據匯入
          </Button>
        </div>
      )}

      {mode === 'import' && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          <div className="space-y-2">
            <Label>來源類型</Label>
            <Select
              value={importType}
              onValueChange={(v: 'purchase' | 'order') => {
                setImportType(v);
                setSelectedIds(new Set());
                setAmount('');
                setDescription('');
                setType(v === 'purchase' ? 'expense' : 'income');
                setCategoryId('');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="purchase">採購單 (支出)</SelectItem>
                <SelectItem value="order">銷售單 (收入)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>選擇單據</Label>
            <div className="border rounded-md max-h-[200px] overflow-y-auto bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>單號/名稱</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importType === 'purchase' ? (
                    purchaseOrders.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">無資料</TableCell></TableRow>
                    ) : (
                      purchaseOrders.map((po: any) => (
                        <TableRow key={po.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(po.id)}
                              onCheckedChange={(c) => handleImportSelection(po.id, po.total_amount, `採購單 ${po.id.slice(0, 8)}`, !!c)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="line-clamp-1">{po.supplier?.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{po.id.slice(0, 8)}</div>
                          </TableCell>
                          <TableCell className="text-xs">{format(new Date(po.order_date), 'MM/dd')}</TableCell>
                          <TableCell className="text-right">${po.total_amount.toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    )
                  ) : (
                    salesOrders.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">無資料</TableCell></TableRow>
                    ) : (
                      salesOrders.map((order: any) => (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(order.id)}
                              onCheckedChange={(c) => handleImportSelection(order.id, order.total_amount, `銷售單 ${order.id.slice(0, 8)}`, !!c)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="line-clamp-1">{order.store?.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{order.id.slice(0, 8)}</div>
                          </TableCell>
                          <TableCell className="text-xs">{format(new Date(order.created_at), 'MM/dd')}</TableCell>
                          <TableCell className="text-right">${order.total_amount.toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>類型</Label>
        <Select value={type} onValueChange={(v: 'income' | 'expense') => { setType(v); setCategoryId(''); }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">收入</SelectItem>
            <SelectItem value="expense">支出</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>分類</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
            <SelectValue placeholder="選擇分類" />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>金額</Label>
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="輸入金額"
        />
      </div>

      <div className="space-y-2">
        <Label>說明</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="輸入說明"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>交易日期</Label>
          <Input
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>到期日（選填）</Label>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            type,
            category_id: categoryId || null,
            amount: parseFloat(amount),
            description: description || null,
            transaction_date: transactionDate,
            due_date: dueDate || null,
            reference_type: mode === 'import' && selectedIds.size === 1 ? (importType === 'purchase' ? 'purchase_order' : 'order') : null,
            reference_id: mode === 'import' && selectedIds.size === 1 ? Array.from(selectedIds)[0] : null,
          })}
          disabled={!amount || isLoading}
        >
          {isLoading ? '處理中...' : entry ? '更新' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
