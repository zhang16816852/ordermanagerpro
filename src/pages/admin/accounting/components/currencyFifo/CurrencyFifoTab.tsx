// Currency FIFO Tab Component
// src/pages/admin/accounting/components/currencyFifo/CurrencyFifoTab.tsx

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, RefreshCw, DollarSign, Wallet, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { Account } from '../../types';
import { useCurrencyBatchesWithInventory, useCurrencyMovements, useCurrencyFifoMutations } from './useCurrencyFifo';
import { CurrencyBatchWithInventory, CurrencyMovement, SOURCE_TYPE_LABELS, OPERATION_TYPE_LABELS } from './currencyFifoTypes';
import { CurrencyInboundDialog } from './CurrencyInboundDialog';

// Exchange is handled via EntryForm's currency exchange view (幣值換算)
import { CurrencyTransferDialog } from './CurrencyTransferDialog';
import { CurrencyOpeningBalanceDialog } from './CurrencyOpeningBalanceDialog';

interface CurrencyFifoTabProps {
  accounts: Account[];
  isLoading: boolean;
  onOpenConsume?: (accountId: string) => void;
}

export function CurrencyFifoTab({ accounts, isLoading, onOpenConsume }: CurrencyFifoTabProps) {
  const foreignAccounts = accounts.filter((a) => a.currency !== 'TWD');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(foreignAccounts[0]?.id || '');
  const [activeSubTab, setActiveSubTab] = useState('batches');
  const [showInboundDialog, setShowInboundDialog] = useState(false);
  const [showConsumeDialog, setShowConsumeDialog] = useState(false);
  // Exchange is handled via EntryForm's currency exchange view
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showOpeningDialog, setShowOpeningDialog] = useState(false);

  const { data: batches = [] } = useCurrencyBatchesWithInventory(selectedAccountId || null);
  const { data: movements = [] } = useCurrencyMovements(selectedAccountId || null);
  const mutations = useCurrencyFifoMutations();

  const selectedAccount = foreignAccounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="space-y-4">
      {/* Account Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Label className="text-sm text-muted-foreground">選擇外幣帳戶</Label>
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="選擇帳戶" />
            </SelectTrigger>
            <SelectContent>
              {foreignAccounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowInboundDialog(true)} disabled={!selectedAccountId}>
            <Plus className="h-4 w-4 mr-1" /> 外幣入帳
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpenConsume?.(selectedAccountId)} disabled={!selectedAccountId}>
            <DollarSign className="h-4 w-4 mr-1" /> 外幣消耗
          </Button>
          {/* Exchange is handled via EntryForm's currency exchange view (幣值換算) */}
          <Button size="sm" variant="outline" onClick={() => setShowTransferDialog(true)} disabled={!selectedAccountId}>
            <RefreshCw className="h-4 w-4 mr-1" /> 轉帳
          </Button>
        </div>
      </div>

      {selectedAccount && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {selectedAccount.name} ({selectedAccount.currency})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              批次數：{batches.length} | 異動數：{movements.length}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="batches">批次明細</TabsTrigger>
          <TabsTrigger value="movements">異動紀錄</TabsTrigger>
          <TabsTrigger value="reconcile">驗算</TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">外幣批次列表</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">批次 ID</TableHead>
                      <TableHead className="text-xs">來源</TableHead>
                      <TableHead className="text-xs text-right">原始金額</TableHead>
                      <TableHead className="text-xs text-right">匯率</TableHead>
                      <TableHead className="text-xs text-right">台幣等值</TableHead>
                      <TableHead className="text-xs text-right">剩餘</TableHead>
                      <TableHead className="text-xs text-right">已消耗</TableHead>
                      <TableHead className="text-xs">取得時間</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">
                          尚無批次記錄
                        </TableCell>
                      </TableRow>
                    ) : (
                      batches.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell className="text-xs font-mono">{batch.id.slice(0, 8)}</TableCell>
                          <TableCell className="text-xs">{batch.source_type}</TableCell>
                          <TableCell className="text-xs text-right">{batch.amount.toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right">{batch.exchange_rate.toFixed(4)}</TableCell>
                          <TableCell className="text-xs text-right">{batch.twd_equivalent.toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right font-bold">{batch.remaining_amount.toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right">{batch.consumed_amount.toLocaleString()}</TableCell>
                          <TableCell className="text-xs">{new Date(batch.transaction_date).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">外幣異動紀錄</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">時間</TableHead>
                      <TableHead className="text-xs text-right">異動</TableHead>
                      <TableHead className="text-xs text-right">台幣等值</TableHead>
                      <TableHead className="text-xs">來源</TableHead>
                      <TableHead className="text-xs">單號</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                          尚無異動記錄
                        </TableCell>
                      </TableRow>
                    ) : (
                      movements.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {m.transaction_date ? new Date(m.transaction_date).toLocaleString() : '-'}
                          </TableCell>
                          <TableCell className={`text-xs text-right font-mono tabular-nums ${m.amount_change > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {m.amount_change > 0 ? '+' : ''}{m.amount_change.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono tabular-nums">
                            {m.twd_equivalent > 0 ? '+' : ''}{m.twd_equivalent.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {SOURCE_TYPE_LABELS[m.source_type] || m.source_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {m.reference_id ? m.reference_id.slice(0, 8) : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconcile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">外幣 FIFO 驗算</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                onClick={() => {
                  if (selectedAccountId) {
                    mutations.reconcileMutation.mutate({ accountId: selectedAccountId, currency: selectedAccount?.currency || 'CNY' });
                  }
                }}
                disabled={mutations.reconcileMutation.isPending || !selectedAccountId}
              >
                {mutations.reconcileMutation.isPending ? '驗算中...' : '執行驗算'}
              </Button>
              {mutations.reconcileMutation.data && (
                <div className="mt-4 space-y-2">
                  <div className={`flex items-center gap-2 text-sm ${mutations.reconcileMutation.data.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {mutations.reconcileMutation.data.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {mutations.reconcileMutation.data.ok ? '驗算通過，無差異' : '驗算發現差異'}
                  </div>
                  <div className="text-xs space-y-1 text-muted-foreground">
                    <p>異動加總：{mutations.reconcileMutation.data.movement_sum?.toLocaleString()}</p>
                    <p>批次剩餘：{mutations.reconcileMutation.data.batch_remaining?.toLocaleString()}</p>
                    <p>消耗加總：{mutations.reconcileMutation.data.consumption_sum?.toLocaleString()}</p>
                    <p>歷史成本：{mutations.reconcileMutation.data.historical_cost_sum?.toLocaleString()}</p>
                  </div>
                  {mutations.reconcileMutation.data.discrepancies?.length > 0 && (
                    <div className="text-xs text-rose-600 space-y-1">
                      {mutations.reconcileMutation.data.discrepancies.map((d: any, i: number) => (
                        <p key={i}>{d.type}: 預期 {d.expected}, 實際 {d.actual}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Inbound Dialog */}
      <CurrencyInboundDialog
        open={showInboundDialog}
        onOpenChange={setShowInboundDialog}
        accountId={selectedAccountId}
        currency={selectedAccount?.currency || 'CNY'}
        onSubmit={(params) => mutations.createInboundMutation.mutate(params)}
        isLoading={mutations.createInboundMutation.isPending}
      />


      {/* Exchange is handled via EntryForm's currency exchange view (幣值換算) */}

      {/* Transfer Dialog */}
      <CurrencyTransferDialog
        open={showTransferDialog}
        onOpenChange={setShowTransferDialog}
        fromAccountId={selectedAccountId}
        toAccountId={foreignAccounts.find((a) => a.id !== selectedAccountId && a.currency === (selectedAccount?.currency || ''))?.id || ''}
        fromCurrency={selectedAccount?.currency || 'CNY'}
        accounts={accounts}
        onSubmit={(params) => mutations.transferMutation.mutate(params)}
        isLoading={mutations.transferMutation.isPending}
      />

      {/* Opening Balance Dialog */}
      <CurrencyOpeningBalanceDialog
        open={showOpeningDialog}
        onOpenChange={setShowOpeningDialog}
        accountId={selectedAccountId}
        currency={selectedAccount?.currency || 'CNY'}
        onSubmit={(params) => mutations.openingBalanceMutation.mutate(params)}
        isLoading={mutations.openingBalanceMutation.isPending}
      />
    </div>
  );
}