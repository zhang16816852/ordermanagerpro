import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { X, Plus, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { AccountingEntry, AccountingCategory, Account, AccountingEntryReference, CURRENCY_OPTIONS, ENTRY_TYPE_LABELS, EntryType } from '../types';
import { formatCurrency } from '@/lib/formatters';

interface EntryFormProps {
  entry: AccountingEntry | null;
  categories: AccountingCategory[];
  accounts: Account[];
  onSubmit: (data: Partial<AccountingEntry>, references?: AccountingEntryReference[]) => void;
  isLoading: boolean;
}

type SettlementRefType = 'order' | 'sales_note' | 'purchase_order' | 'repair_order';

interface SettlementRef {
  refType: SettlementRefType;
  refId: string;
  itemName: string;
  amount: number;
  amountApplied: number;
}

const SETTLEMENT_REF_TYPE_LABELS: Record<SettlementRefType, string> = {
  order: '訂單',
  sales_note: '銷貨單',
  purchase_order: '採購單',
  repair_order: '維修單',
};

export function EntryForm({
  entry,
  categories,
  accounts,
  onSubmit,
  isLoading,
}: EntryFormProps) {
  const [mode, setMode] = useState<'manual' | 'import'>('manual');
  const [entryType, setEntryType] = useState<EntryType>(entry?.type || 'expense');
  const [categoryId, setCategoryId] = useState(entry?.category_id || '');
  const [accountId, setAccountId] = useState(entry?.account_id || '');
  const [transferToAccountId, setTransferToAccountId] = useState(entry?.transfer_to_account_id || '');
  const [exchangeRate, setExchangeRate] = useState(entry?.exchange_rate?.toString() || '');
  const [originalCurrency, setOriginalCurrency] = useState(entry?.original_currency || '');
  const [originalAmount, setOriginalAmount] = useState(entry?.original_amount?.toString() || '');
  const [amount, setAmount] = useState(entry?.amount?.toString() || '');
  const [description, setDescription] = useState(entry?.description || '');
  const [transactionDate, setTransactionDate] = useState(entry?.transaction_date || format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(entry?.due_date || '');

  // Settlement states
  const [settlementRefType, setSettlementRefType] = useState<SettlementRefType>('order');
  const [settlementRefs, setSettlementRefs] = useState<SettlementRef[]>([]);

  // Import mode states
  const [importType, setImportType] = useState<'purchase' | 'order'>('purchase');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedCategory = categories.find(c => c.id === categoryId);
  const effectiveType: EntryType = selectedCategory?.type || entryType;

  const isTransferType = effectiveType === 'transfer' || effectiveType === 'currency_exchange';
  const isSettlementType = effectiveType === 'settlement';

  const filteredCategories = categories.filter(c => {
    if (isTransferType || isSettlementType) return c.type === effectiveType;
    return c.type === 'income' || c.type === 'expense';
  });

  const sourceCurrency = accounts.find(a => a.id === accountId)?.currency || 'TWD';
  const destCurrency = accounts.find(a => a.id === transferToAccountId)?.currency || 'TWD';

  useEffect(() => {
    if (!entry) {
      setEntryType('expense');
      setCategoryId('');
      setAccountId('');
      setTransferToAccountId('');
      setExchangeRate('');
      setOriginalCurrency('');
      setOriginalAmount('');
      setAmount('');
      setDescription('');
      setSettlementRefs([]);
    }
  }, [entry]);

  useEffect(() => {
    if (isTransferType && sourceCurrency !== destCurrency && !exchangeRate) {
      setOriginalCurrency(sourceCurrency);
    }
  }, [sourceCurrency, destCurrency, isTransferType]);

  useEffect(() => {
    if (isTransferType && exchangeRate && originalAmount) {
      const rate = parseFloat(exchangeRate);
      const orig = parseFloat(originalAmount);
      if (!isNaN(rate) && !isNaN(orig)) {
        setAmount((rate * orig).toString());
      }
    }
  }, [exchangeRate, originalAmount, isTransferType]);

  useEffect(() => {
    if (isSettlementType) {
      const total = settlementRefs.reduce((sum, r) => sum + r.amountApplied, 0);
      setAmount(total.toString());
    }
  }, [settlementRefs, isSettlementType]);

  const handleTypeChange = (newType: EntryType) => {
    setEntryType(newType);
    setCategoryId('');
  };

  // Settlement document queries
  const { data: availableOrders = [] } = useQuery({
    queryKey: ['settlement-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('orders')
        .select('id, code, created_at, status, store:stores(name)')
        .in('status', ['pending', 'processing', 'shipped'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((o: any) => ({
        id: o.id,
        code: o.code || o.id.slice(0, 8),
        name: o.store?.name || '未知店家',
        date: o.created_at,
        status: o.status,
      }));
    },
    enabled: isSettlementType && settlementRefType === 'order',
  });

  const { data: availableSalesNotes = [] } = useQuery({
    queryKey: ['settlement-sales-notes'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sales_notes')
        .select(`
          id, code, created_at, status,
          store:stores(name),
          sales_note_items(quantity, order_item:order_items(unit_price))
        `)
        .eq('status', 'received')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((note: any) => ({
        id: note.id,
        code: note.code || note.id.slice(0, 8),
        name: note.store?.name || '未知店家',
        date: note.created_at,
        amount: (note.sales_note_items || []).reduce(
          (sum: number, item: any) => sum + (item.quantity * (item.order_item?.unit_price || 0)), 0
        ),
      }));
    },
    enabled: isSettlementType && settlementRefType === 'sales_note',
  });

  const { data: availablePurchaseOrders = [] } = useQuery({
    queryKey: ['settlement-purchase-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, total_amount, order_date, status, supplier:suppliers(name)')
        .neq('status', 'cancelled')
        .order('order_date', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((po: any) => ({
        id: po.id,
        code: po.id.slice(0, 8),
        name: po.supplier?.name || '未知供應商',
        date: po.order_date,
        amount: po.total_amount,
      }));
    },
    enabled: isSettlementType && settlementRefType === 'purchase_order',
  });

  const { data: availableRepairOrders = [] } = useQuery({
    queryKey: ['settlement-repair-orders'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('repair_orders')
        .select('id, code, created_at, status')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []).map((ro: any) => ({
        id: ro.id,
        code: ro.code || ro.id.slice(0, 8),
        name: ro.code || '維修單',
        date: ro.created_at,
      }));
    },
    enabled: isSettlementType && settlementRefType === 'repair_order',
  });

  const currentSettlementList = useMemo(() => {
    switch (settlementRefType) {
      case 'order': return availableOrders;
      case 'sales_note': return availableSalesNotes;
      case 'purchase_order': return availablePurchaseOrders;
      case 'repair_order': return availableRepairOrders;
    }
  }, [settlementRefType, availableOrders, availableSalesNotes, availablePurchaseOrders, availableRepairOrders]);

  const addSettlementRef = (item: any) => {
    const alreadyAdded = settlementRefs.some(r => r.refType === settlementRefType && r.refId === item.id);
    if (alreadyAdded) return;
    setSettlementRefs(prev => [...prev, {
      refType: settlementRefType,
      refId: item.id,
      itemName: `${SETTLEMENT_REF_TYPE_LABELS[settlementRefType]} ${item.code}`,
      amount: item.amount || 0,
      amountApplied: item.amount || 0,
    }]);
  };

  const removeSettlementRef = (index: number) => {
    setSettlementRefs(prev => prev.filter((_, i) => i !== index));
  };

  const updateSettlementAmount = (index: number, newAmount: string) => {
    const parsed = parseFloat(newAmount);
    if (isNaN(parsed) || parsed < 0) return;
    setSettlementRefs(prev => prev.map((r, i) => i === index ? { ...r, amountApplied: parsed } : r));
  };

  const handleImportSelection = (id: string, itemAmount: number, checked: boolean) => {
    const newResult = new Set(selectedIds);
    if (checked) {
      newResult.add(id);
    } else {
      newResult.delete(id);
    }
    setSelectedIds(newResult);

    const currentList = importType === 'purchase' ? availablePurchaseOrders : availableSalesNotes;
    const selectedItems = currentList.filter((item: any) => newResult.has(item.id));
    const total = selectedItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
    setAmount(total.toString());

    if (selectedItems.length > 0) {
      const refs = selectedItems.map((item: any) => item.code);
      const prefix = importType === 'purchase' ? '採購單' : '銷貨單';
      setDescription(`${prefix}: ${refs.join(', ')}`);
    } else {
      setDescription('');
    }
  };

  const buildSubmitData = (): { data: Partial<AccountingEntry>; references?: AccountingEntryReference[] } => {
    const baseData: Partial<AccountingEntry> = {
      type: effectiveType,
      category_id: categoryId || null,
      account_id: accountId || null,
      transfer_to_account_id: isTransferType ? (transferToAccountId || null) : null,
      exchange_rate: isTransferType && exchangeRate ? parseFloat(exchangeRate) : null,
      original_currency: isTransferType ? (originalCurrency || null) : null,
      original_amount: isTransferType && originalAmount ? parseFloat(originalAmount) : null,
      amount: parseFloat(amount) || 0,
      description: description || null,
      transaction_date: transactionDate,
      due_date: dueDate || null,
      reference_type: mode === 'import' && selectedIds.size === 1
        ? (importType === 'purchase' ? 'purchase_order' : 'sales_note')
        : null,
      reference_id: mode === 'import' && selectedIds.size === 1
        ? Array.from(selectedIds)[0]
        : null,
    };

    if (isSettlementType && settlementRefs.length > 0) {
      const references: AccountingEntryReference[] = settlementRefs.map((r) => ({
        id: '',
        entry_id: '',
        reference_type: r.refType,
        reference_id: r.refId,
        item_name: r.itemName,
        amount_applied: r.amountApplied,
        created_at: '',
      }));
      return { data: baseData, references };
    }

    return { data: baseData };
  };

  return (
    <div className="space-y-4">
      {!entry && (
        <div className="flex items-center space-x-2 pb-4 border-b">
          <Button
            variant={mode === 'manual' ? 'default' : 'outline'}
            onClick={() => { setMode('manual'); setAmount(''); setDescription(''); setSettlementRefs([]); }}
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
              setSettlementRefs([]);
              if (importType === 'purchase') setEntryType('expense');
            }}
            size="sm"
          >
            從單據匯入
          </Button>
        </div>
      )}

      {mode === 'import' && !isSettlementType && (
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
                setEntryType(v === 'purchase' ? 'expense' : 'income');
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
                  {currentSettlementList.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">無資料</TableCell></TableRow>
                  ) : (
                    currentSettlementList.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={(c) => handleImportSelection(item.id, item.amount || 0, !!c)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="line-clamp-1">{item.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{item.code}</div>
                        </TableCell>
                        <TableCell className="text-xs">{format(new Date(item.date), 'MM/dd')}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.amount || 0)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>分類</Label>
        <Select value={categoryId} onValueChange={(v) => {
          setCategoryId(v);
          const cat = categories.find(c => c.id === v);
          if (cat) setEntryType(cat.type);
        }}>
          <SelectTrigger>
            <SelectValue placeholder="選擇分類" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
                {cat.type !== 'income' && cat.type !== 'expense' && (
                  <Badge variant="secondary" className="ml-2 text-xs">{ENTRY_TYPE_LABELS[cat.type]}</Badge>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isTransferType && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>來源帳戶</Label>
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); }}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇來源帳戶" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountId && (
                <p className="text-xs text-muted-foreground">幣別：{sourceCurrency}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>目的地帳戶</Label>
              <Select value={transferToAccountId} onValueChange={setTransferToAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇目的地帳戶" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.id !== accountId).map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {transferToAccountId && (
                <p className="text-xs text-muted-foreground">幣別：{destCurrency}</p>
              )}
            </div>
          </div>

          {accountId && transferToAccountId && sourceCurrency !== destCurrency && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>原始幣別</Label>
                <Select value={originalCurrency} onValueChange={setOriginalCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>原始金額</Label>
                <Input
                  type="number"
                  value={originalAmount}
                  onChange={(e) => setOriginalAmount(e.target.value)}
                  placeholder="轉換前金額"
                />
              </div>
              <div className="space-y-2">
                <Label>匯率（1 {originalCurrency || sourceCurrency} = ? {destCurrency}）</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  placeholder="匯率"
                />
              </div>
            </div>
          )}

          {accountId && transferToAccountId && sourceCurrency === destCurrency && (
            <div className="space-y-2">
              <Label>金額</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="輸入轉帳金額"
              />
              <p className="text-xs text-muted-foreground">同幣別轉帳，無需匯率</p>
            </div>
          )}

          {accountId && transferToAccountId && sourceCurrency !== destCurrency && exchangeRate && originalAmount && (
            <div className="p-3 bg-background rounded-md border">
              <p className="text-sm text-muted-foreground">換算結果</p>
              <p className="text-lg font-bold">
                {originalAmount} {originalCurrency || sourceCurrency} × {exchangeRate} = {amount} {destCurrency}
              </p>
            </div>
          )}
        </div>
      )}

      {isSettlementType && (
        <div className="space-y-4 border rounded-md p-4 bg-muted/20">
          <div className="space-y-2">
            <Label>來源帳戶</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇收款/付款帳戶" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>關聯單據類型</Label>
            <div className="flex gap-2">
              {(Object.keys(SETTLEMENT_REF_TYPE_LABELS) as SettlementRefType[]).map((rt) => (
                <Button
                  key={rt}
                  variant={settlementRefType === rt ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettlementRefType(rt)}
                >
                  {SETTLEMENT_REF_TYPE_LABELS[rt]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>選擇單據</Label>
            <div className="border rounded-md max-h-[200px] overflow-y-auto bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>單號</TableHead>
                    <TableHead>名稱</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentSettlementList.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">無可關聯的單據</TableCell></TableRow>
                  ) : (
                    currentSettlementList.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => addSettlementRef(item)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                        <TableCell className="text-sm">{item.name}</TableCell>
                        <TableCell className="text-xs">{format(new Date(item.date), 'MM/dd')}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(item.amount || 0)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {settlementRefs.length > 0 && (
            <div className="space-y-2">
              <Label>已關聯單據（可調整金額）</Label>
              <div className="border rounded-md bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>類型</TableHead>
                      <TableHead>項目</TableHead>
                      <TableHead className="text-right">原始金額</TableHead>
                      <TableHead className="text-right w-[120px]">分配金額</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settlementRefs.map((ref, index) => (
                      <TableRow key={`${ref.refType}-${ref.refId}`}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{SETTLEMENT_REF_TYPE_LABELS[ref.refType]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{ref.itemName}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(ref.amount)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={ref.amountApplied}
                            onChange={(e) => updateSettlementAmount(index, e.target.value)}
                            className="h-8 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={() => removeSettlementRef(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold">
                      <TableCell colSpan={2}>合計</TableCell>
                      <TableCell className="text-right">{formatCurrency(settlementRefs.reduce((s, r) => s + r.amount, 0))}</TableCell>
                      <TableCell className="text-right">{formatCurrency(settlementRefs.reduce((s, r) => s + r.amountApplied, 0))}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>總金額（自動加總）</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="母單總金額"
            />
          </div>
        </div>
      )}

      {!isTransferType && !isSettlementType && (
        <>
          <div className="space-y-2">
            <Label>類型</Label>
            <Select value={entryType} onValueChange={(v: 'income' | 'expense') => handleTypeChange(v)}>
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
            <Label>帳戶</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇帳戶（錢歸入/支出自哪個帳戶）" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency} {formatCurrency(acc.balance, acc.currency)})
                  </SelectItem>
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
        </>
      )}

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
          onClick={() => {
            const { data, references } = buildSubmitData();
            onSubmit(data, references);
          }}
          disabled={!amount || isLoading}
        >
          {isLoading ? '處理中...' : entry ? '更新' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
