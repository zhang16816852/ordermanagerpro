import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, ArrowRightLeft, FileText, Wallet, RefreshCw, Plus } from 'lucide-react';
import { AccountingCategory, EntryType, ENTRY_TYPE_LABELS } from '../types';

interface CategoriesTabProps {
  categories: AccountingCategory[];
  onAdd: () => void;
  isLoading: boolean;
}

const TYPE_GROUPS: { types: EntryType[]; title: string; icon: React.ReactNode; color: string }[] = [
  { types: ['income'], title: '收入類型', icon: <TrendingUp className="h-5 w-5" />, color: 'bg-green-50/50 text-green-700' },
  { types: ['expense'], title: '支出類型', icon: <TrendingDown className="h-5 w-5" />, color: 'bg-red-50/50 text-destructive' },
  { types: ['transfer', 'currency_exchange', 'topup'], title: '特殊類型', icon: <ArrowRightLeft className="h-5 w-5" />, color: 'bg-blue-50/50 text-blue-700' },
  { types: ['settlement'], title: '結帳類型', icon: <FileText className="h-5 w-5" />, color: 'bg-purple-50/50 text-purple-700' },
];

const TYPE_ICONS: Record<EntryType, React.ReactNode> = {
  income: <TrendingUp className="h-3 w-3" />,
  expense: <TrendingDown className="h-3 w-3" />,
  transfer: <ArrowRightLeft className="h-3 w-3" />,
  settlement: <FileText className="h-3 w-3" />,
  topup: <Wallet className="h-3 w-3" />,
  currency_exchange: <RefreshCw className="h-3 w-3" />,
};

export function CategoriesTab({ categories, onAdd, isLoading }: CategoriesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">類型管理</h2>
        <Button onClick={onAdd} size="sm">
          <Plus className="h-4 w-4 mr-2" /> 新增類型
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {TYPE_GROUPS.map((group) => {
          const groupCategories = categories.filter(c => group.types.includes(c.type));
          return (
            <Card key={group.title}>
              <CardHeader className={group.color}>
                <CardTitle className="text-lg flex items-center gap-2">
                  {group.icon}
                  {group.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground italic">載入中...</p>
                  ) : groupCategories.map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        {TYPE_ICONS[cat.type]}
                        <span>{cat.name}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">{ENTRY_TYPE_LABELS[cat.type]}</Badge>
                    </div>
                  ))}
                  {groupCategories.length === 0 && !isLoading && (
                    <p className="text-sm text-muted-foreground italic">尚無{group.title}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
