import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, DollarSign, Wallet, Calculator, ArrowRightLeft } from 'lucide-react';
import { AccountingEntry, Account } from '../types';
import { formatCurrency } from '@/lib/formatters';

interface StatsCardsProps {
  entries: AccountingEntry[];
  accounts: Account[];
}

export function StatsCards({ entries, accounts }: StatsCardsProps) {
  const totalIncome = entries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = entries.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  const unpaidIncome = entries.filter(e => e.type === 'income' && e.payment_status !== 'paid').reduce((sum, e) => sum + (e.amount - e.paid_amount), 0);
  const unpaidExpense = entries.filter(e => e.type === 'expense' && e.payment_status !== 'paid').reduce((sum, e) => sum + (e.amount - e.paid_amount), 0);

  // Group accounts by currency for balance display
  const currencyGroups = accounts.reduce((groups, acc) => {
    const curr = acc.currency || 'TWD';
    groups[curr] = (groups[curr] || 0) + acc.balance;
    return groups;
  }, {} as Record<string, number>);

  const primaryCurrency = Object.entries(currencyGroups).sort((a, b) => b[1] - a[1])[0];
  const totalBalance = primaryCurrency ? primaryCurrency[1] : 0;
  const totalBalanceCurrency = primaryCurrency ? primaryCurrency[0] : 'TWD';
  const hasMultipleCurrencies = Object.keys(currencyGroups).length > 1;

  const transferCount = entries.filter(e => e.type === 'transfer' || e.type === 'currency_exchange' || e.type === 'topup').length;
  const settlementCount = entries.filter(e => e.type === 'settlement').length;

  return (
    <div className="grid gap-4 md:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">總收入</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</div>
          <p className="text-xs text-muted-foreground">未收: {formatCurrency(unpaidIncome)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">總支出</CardTitle>
          <TrendingDown className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{formatCurrency(totalExpense)}</div>
          <p className="text-xs text-muted-foreground">未付: {formatCurrency(unpaidExpense)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">淨收益</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${totalIncome - totalExpense >= 0 ? 'text-green-600' : 'text-destructive'}`}>
            {formatCurrency(totalIncome - totalExpense)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">帳戶餘額</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalBalance, totalBalanceCurrency)}</div>
          {hasMultipleCurrencies && (
            <p className="text-xs text-muted-foreground">
              多幣別：{Object.entries(currencyGroups).map(([c, b]) => `${c} ${formatCurrency(b, c)}`).join(' / ')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">記錄筆數</CardTitle>
          <Calculator className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{entries.length}</div>
          {(transferCount > 0 || settlementCount > 0) && (
            <p className="text-xs text-muted-foreground">
              {transferCount > 0 && <span>互轉 {transferCount} 筆</span>}
              {transferCount > 0 && settlementCount > 0 && <span> / </span>}
              {settlementCount > 0 && <span>結帳 {settlementCount} 筆</span>}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
