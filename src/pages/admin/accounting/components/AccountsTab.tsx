import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, Building, Plus } from 'lucide-react';
import { Account } from '../types';

interface AccountsTabProps {
  accounts: Account[];
  onAdd: () => void;
  isLoading: boolean;
}

export function AccountsTab({ accounts, onAdd, isLoading }: AccountsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">帳戶列表 ({accounts.length})</h2>
        <Button onClick={onAdd} size="sm">
          <Plus className="h-4 w-4 mr-2" /> 新增帳戶
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {isLoading ? (
          <p className="col-span-full text-center py-12 text-muted-foreground italic">載入中...</p>
        ) : accounts.map((account) => (
          <Card key={account.id} className="hover:shadow-md transition-shadow">
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
        {accounts.length === 0 && !isLoading && (
          <div className="col-span-full border-2 border-dashed rounded-lg p-12 text-center text-muted-foreground">
            尚未建立任何帳戶。
          </div>
        )}
      </div>
    </div>
  );
}
