import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Plus,
  Edit,
  Trash2,
  CreditCard,
  Building,
  FileText,
  Search,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toast } from 'sonner';

type PaymentStatus = 'unpaid' | 'partial' | 'paid';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  description: string | null;
  is_active: boolean;
}

interface AccountingCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  description: string | null;
  is_active: boolean;
}

interface AccountingEntry {
  id: string;
  category_id: string | null;
  account_id: string | null;
  type: 'income' | 'expense';
  amount: number;
  paid_amount: number;
  payment_status: PaymentStatus;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  transaction_date: string;
  due_date: string | null;
  created_by: string;
  created_at: string;
  category?: AccountingCategory;
  account?: Account;
}

export default function AdminAccounting() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [activeTab, setActiveTab] = useState('entries');

  // Dialog states
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Form states
  const [editingEntry, setEditingEntry] = useState<AccountingEntry | null>(null);
  const [payingEntry, setPayingEntry] = useState<AccountingEntry | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');

  const months = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'yyyy年MM月', { locale: zhTW }),
    };
  });

  // Queries - 使用 as any 因為新表格尚未在 types.ts 中
  const { data: accounts = [] } = useQuery({
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

  const { data: categories = [] } = useQuery({
    queryKey: ['accounting-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounting_categories')
        .select('*')
        .eq('is_active', true)
        .order('type')
        .order('name');
      if (error) throw error;
      return (data || []) as AccountingCategory[];
    },
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['accounting-entries', selectedMonth],
    queryFn: async () => {
      const [year, month] = selectedMonth.split('-').map(Number);
      const startDate = startOfMonth(new Date(year, month - 1));
      const endDate = endOfMonth(new Date(year, month - 1));

      const { data, error } = await (supabase as any)
        .from('accounting_entries')
        .select('*')
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: false });

      if (error) throw error;

      return ((data || []) as any[]).map((entry) => ({
        ...entry,
        category: categories.find(c => c.id === entry.category_id),
        account: accounts.find(a => a.id === entry.account_id),
      })) as AccountingEntry[];
    },
  });

  // Mutations
  const createEntryMutation = useMutation({
    mutationFn: async (data: Partial<AccountingEntry>) => {
      const { error } = await (supabase as any).from('accounting_entries').insert({
        ...data,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      setEntryDialogOpen(false);
      setEditingEntry(null);
      toast.success('記錄已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<AccountingEntry> & { id: string }) => {
      const { error } = await (supabase as any).from('accounting_entries').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      setEntryDialogOpen(false);
      setEditingEntry(null);
      toast.success('記錄已更新');
    },
    onError: () => toast.error('更新失敗'),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('accounting_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      toast.success('記錄已刪除');
    },
    onError: () => toast.error('刪除失敗'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async ({ entryId, amount, accountId }: { entryId: string; amount: number; accountId: string }) => {
      const entry = entries.find(e => e.id === entryId);
      if (!entry) throw new Error('Entry not found');

      const newPaidAmount = entry.paid_amount + amount;
      const newStatus: PaymentStatus = newPaidAmount >= entry.amount ? 'paid' : 'partial';

      const { error: entryError } = await (supabase as any)
        .from('accounting_entries')
        .update({ paid_amount: newPaidAmount, payment_status: newStatus, account_id: accountId })
        .eq('id', entryId);
      if (entryError) throw entryError;

      const account = accounts.find(a => a.id === accountId);
      if (account) {
        const balanceChange = entry.type === 'income' ? amount : -amount;
        const { error: accountError } = await (supabase as any)
          .from('accounts')
          .update({ balance: account.balance + balanceChange })
          .eq('id', accountId);
        if (accountError) throw accountError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setPaymentDialogOpen(false);
      setPayingEntry(null);
      setPaymentAmount('');
      setPaymentAccountId('');
      toast.success('付款已記錄');
    },
    onError: () => toast.error('記錄付款失敗'),
  });

  const createAccountMutation = useMutation({
    mutationFn: async (data: Partial<Account>) => {
      const { error } = await (supabase as any).from('accounts').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setAccountDialogOpen(false);
      toast.success('帳戶已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: Partial<AccountingCategory>) => {
      const { error } = await (supabase as any).from('accounting_categories').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-categories'] });
      setCategoryDialogOpen(false);
      toast.success('類型已新增');
    },
    onError: () => toast.error('新增失敗'),
  });

  // Calculate statistics
  const totalIncome = entries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = entries.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  const unpaidIncome = entries.filter(e => e.type === 'income' && e.payment_status !== 'paid').reduce((sum, e) => sum + (e.amount - e.paid_amount), 0);
  const unpaidExpense = entries.filter(e => e.type === 'expense' && e.payment_status !== 'paid').reduce((sum, e) => sum + (e.amount - e.paid_amount), 0);
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

  const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-600 hover:bg-green-700">已付清</Badge>;
      case 'partial': return <Badge className="bg-amber-500 hover:bg-amber-600">部分付款</Badge>;
      case 'unpaid': return <Badge variant="destructive">未付</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">會計管理</h1>
          <p className="text-muted-foreground">管理收入、支出和帳戶餘額</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map(month => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總收入</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">${totalIncome.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">未收: ${unpaidIncome.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總支出</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">${totalExpense.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">未付: ${unpaidExpense.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">淨收益</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalIncome - totalExpense >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              ${(totalIncome - totalExpense).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">帳戶餘額</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalBalance.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">記錄筆數</CardTitle>
            <Calculator className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{entries.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="entries">收支明細</TabsTrigger>
          <TabsTrigger value="accounts">帳戶管理</TabsTrigger>
          <TabsTrigger value="categories">收支類型</TabsTrigger>
        </TabsList>

        {/* Entries Tab */}
        <TabsContent value="entries" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditingEntry(null)}>
                  <Plus className="h-4 w-4 mr-2" /> 新增記錄
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingEntry ? '編輯記錄' : '新增記錄'}</DialogTitle>
                </DialogHeader>
                <EntryForm
                  entry={editingEntry}
                  categories={categories}
                  onSubmit={(data) => {
                    if (editingEntry) {
                      updateEntryMutation.mutate({ id: editingEntry.id, ...data });
                    } else {
                      createEntryMutation.mutate(data);
                    }
                  }}
                  isLoading={createEntryMutation.isPending || updateEntryMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="pt-6">
              {entriesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  本月沒有收支記錄
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>類型</TableHead>
                      <TableHead>分類</TableHead>
                      <TableHead>說明</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                      <TableHead className="text-right">已付</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{format(new Date(entry.transaction_date), 'MM/dd')}</TableCell>
                        <TableCell>
                          <Badge variant={entry.type === 'income' ? 'default' : 'secondary'}>
                            {entry.type === 'income' ? '收入' : '支出'}
                          </Badge>
                        </TableCell>
                        <TableCell>{entry.category?.name || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{entry.description || '-'}</TableCell>
                        <TableCell className={`text-right font-medium ${entry.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                          {entry.type === 'income' ? '+' : '-'}${entry.amount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">${entry.paid_amount.toLocaleString()}</TableCell>
                        <TableCell>{getStatusBadge(entry.payment_status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {entry.payment_status !== 'paid' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setPayingEntry(entry);
                                  setPaymentAmount((entry.amount - entry.paid_amount).toString());
                                  setPaymentDialogOpen(true);
                                }}
                              >
                                <CreditCard className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingEntry(entry);
                                setEntryDialogOpen(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm('確定要刪除這筆記錄嗎？')) {
                                  deleteEntryMutation.mutate(entry.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accounts Tab */}
        <TabsContent value="accounts" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> 新增帳戶
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新增帳戶</DialogTitle>
                </DialogHeader>
                <AccountForm
                  onSubmit={(data) => createAccountMutation.mutate(data)}
                  isLoading={createAccountMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{account.name}</CardTitle>
                  {account.type === 'cash' ? (
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Building className="h-4 w-4 text-muted-foreground" />
                  )}
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${account.balance.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    {account.type === 'cash' ? '現金' : '銀行帳戶'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> 新增類型
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新增收支類型</DialogTitle>
                </DialogHeader>
                <CategoryForm
                  onSubmit={(data) => createCategoryMutation.mutate(data)}
                  isLoading={createCategoryMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  收入類型
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.filter(c => c.type === 'income').map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <span>{cat.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-destructive" />
                  支出類型
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.filter(c => c.type === 'expense').map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <span>{cat.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>記錄付款</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>待付金額</Label>
              <p className="text-2xl font-bold">
                ${payingEntry ? (payingEntry.amount - payingEntry.paid_amount).toLocaleString() : 0}
              </p>
            </div>
            <div className="space-y-2">
              <Label>付款金額</Label>
              <Input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="輸入付款金額"
              />
            </div>
            <div className="space-y-2">
              <Label>付款帳戶</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇帳戶" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} (${account.balance.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (payingEntry && paymentAmount && paymentAccountId) {
                  recordPaymentMutation.mutate({
                    entryId: payingEntry.id,
                    amount: parseFloat(paymentAmount),
                    accountId: paymentAccountId,
                  });
                }
              }}
              disabled={!paymentAmount || !paymentAccountId || recordPaymentMutation.isPending}
            >
              確認付款
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Entry Form Component
function EntryForm({
  entry,
  categories,
  onSubmit,
  isLoading,
}: {
  entry: AccountingEntry | null;
  categories: AccountingCategory[];
  onSubmit: (data: Partial<AccountingEntry>) => void;
  isLoading: boolean;
}) {
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
        //.neq('status', 'cancelled') // Assuming there is a cancelled status, otherwise check logic
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return data.map((order: any) => ({
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

    // Auto generate description
    if (selectedItems.length > 0) {
      const ids = selectedItems.map((item: any) => item.id.slice(0, 8));
      const prefix = importType === 'purchase' ? '採購單' : '銷售單';
      setDescription(`${prefix}: ${ids.join(', ')}`);

      // If single item, we might want to set reference_type/id in the future, 
      // currently just using description as requested.
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
              // Default type based on import type
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
                // Auto switch income/expense
                setType(v === 'purchase' ? 'expense' : 'income');
                setCategoryId(''); // Reset category as types switched
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
            // If single item imported, we could potentially set reference
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

// Account Form Component
function AccountForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: Partial<Account>) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('bank');
  const [balance, setBalance] = useState('0');
  const [description, setDescription] = useState('');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>帳戶名稱</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：玉山銀行" />
      </div>
      <div className="space-y-2">
        <Label>類型</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">現金</SelectItem>
            <SelectItem value="bank">銀行</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>初始餘額</Label>
        <Input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>備註</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({ name, type, balance: parseFloat(balance), description: description || null })}
          disabled={!name || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Category Form Component
function CategoryForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: Partial<AccountingCategory>) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>類型名稱</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：運費" />
      </div>
      <div className="space-y-2">
        <Label>收支類型</Label>
        <Select value={type} onValueChange={(v: 'income' | 'expense') => setType(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">收入</SelectItem>
            <SelectItem value="expense">支出</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({ name, type })}
          disabled={!name || isLoading}
        >
          {isLoading ? '處理中...' : '新增'}
        </Button>
      </DialogFooter>
    </div>
  );
}
