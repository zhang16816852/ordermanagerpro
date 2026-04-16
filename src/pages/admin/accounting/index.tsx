import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { zhTW } from 'date-fns/locale';

import { useAccounting } from './hooks/useAccounting';
import { StatsCards } from './components/StatsCards';
import { EntriesTab } from './components/EntriesTab';
import { AccountsTab } from './components/AccountsTab';
import { CategoriesTab } from './components/CategoriesTab';
import { EntryForm } from './components/EntryForm';
import { AccountForm } from './components/AccountForm';
import { CategoryForm } from './components/CategoryForm';
import { PaymentDialog } from './components/PaymentDialog';
import { AccountingEntry } from './types';

export default function AdminAccounting() {
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [activeTab, setActiveTab] = useState('entries');

  // Dialog States
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Form selections
  const [editingEntry, setEditingEntry] = useState<AccountingEntry | null>(null);
  const [payingEntry, setPayingEntry] = useState<AccountingEntry | null>(null);

  const months = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'yyyy年MM月', { locale: zhTW }),
    };
  });

  const {
    accounts,
    isLoadingAccounts,
    categories,
    entries,
    isLoadingEntries,
    createEntryMutation,
    updateEntryMutation,
    deleteEntryMutation,
    recordPaymentMutation,
    createAccountMutation,
    createCategoryMutation,
  } = useAccounting(selectedMonth);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">會計管理</h1>
          <p className="text-muted-foreground">管理收入、支出和帳戶餘額</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40 bg-background">
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

      {/* Overview Stats */}
      <StatsCards entries={entries} accounts={accounts} />

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="entries">收支明細</TabsTrigger>
          <TabsTrigger value="accounts">帳戶管理</TabsTrigger>
          <TabsTrigger value="categories">收支類型</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingEntry(null); setEntryDialogOpen(true); }} size="sm">
              <Plus className="h-4 w-4 mr-2" /> 新增記錄
            </Button>
          </div>
          <EntriesTab
            entries={entries}
            isLoading={isLoadingEntries}
            onEdit={(entry) => { setEditingEntry(entry); setEntryDialogOpen(true); }}
            onDelete={(id) => { if (confirm('確定要刪除這筆記錄嗎？')) deleteEntryMutation.mutate(id); }}
            onPay={(entry) => { setPayingEntry(entry); setPaymentDialogOpen(true); }}
          />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <AccountsTab
            accounts={accounts}
            onAdd={() => setAccountDialogOpen(true)}
            isLoading={isLoadingAccounts}
          />
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <CategoriesTab
            categories={categories}
            onAdd={() => setCategoryDialogOpen(true)}
            isLoading={false} // Categories are usually fast
          />
        </TabsContent>
      </Tabs>

      {/* Entry Dialog */}
      <Dialog
        open={entryDialogOpen}
        onOpenChange={(open) => {
          setEntryDialogOpen(open);
          if (!open) setEditingEntry(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingEntry ? '編輯收支記錄' : '新增收支記錄'}</DialogTitle>
            <DialogDescription>
              記錄店鋪的日常收入或支出明細，包含日期、類型以及金額。
            </DialogDescription>
          </DialogHeader>
          <EntryForm
            entry={editingEntry}
            categories={categories}
            isLoading={createEntryMutation.isPending || updateEntryMutation.isPending}
            onSubmit={(data) => {
              if (editingEntry) {
                updateEntryMutation.mutate({ id: editingEntry.id, ...data }, {
                  onSuccess: () => setEntryDialogOpen(false)
                });
              } else {
                createEntryMutation.mutate(data, {
                  onSuccess: () => setEntryDialogOpen(false)
                });
              }
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Account Dialog */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增帳戶</DialogTitle>
            <DialogDescription>
              建立新的資金帳戶（如銀行帳戶、現金或電子錢包），以便追蹤資金流向。
            </DialogDescription>
          </DialogHeader>
          <AccountForm
            isLoading={createAccountMutation.isPending}
            onSubmit={(data) => {
              createAccountMutation.mutate(data, {
                onSuccess: () => setAccountDialogOpen(false)
              });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增收支類型</DialogTitle>
            <DialogDescription>
              自定義會計分類標籤，方便後續產出收支分析報告。
            </DialogDescription>
          </DialogHeader>
          <CategoryForm
            isLoading={createCategoryMutation.isPending}
            onSubmit={(data) => {
              createCategoryMutation.mutate(data, {
                onSuccess: () => setCategoryDialogOpen(false)
              });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        entry={payingEntry}
        accounts={accounts}
        isLoading={recordPaymentMutation.isPending}
        onSubmit={(data) => {
          recordPaymentMutation.mutate(data, {
            onSuccess: () => {
              setPaymentDialogOpen(false);
              setPayingEntry(null);
            }
          });
        }}
      />
    </div>
  );
}
