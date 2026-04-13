import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Plus } from 'lucide-react';
import { AccountingCategory } from '../types';

interface CategoriesTabProps {
  categories: AccountingCategory[];
  onAdd: () => void;
  isLoading: boolean;
}

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
        {/* Income Categories */}
        <Card>
          <CardHeader className="bg-green-50/50">
            <CardTitle className="text-lg flex items-center gap-2 text-green-700">
              <TrendingUp className="h-5 w-5" />
              收入類型
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-2">
              {isLoading ? (
                <p className="text-sm text-muted-foreground italic">載入中...</p>
              ) : categories.filter(c => c.type === 'income').map((cat) => (
                <div key={cat.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm font-medium">
                  <span>{cat.name}</span>
                </div>
              ))}
              {categories.filter(c => c.type === 'income').length === 0 && !isLoading && (
                <p className="text-sm text-muted-foreground italic">尚無收入類型</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Expense Categories */}
        <Card>
          <CardHeader className="bg-red-50/50">
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <TrendingDown className="h-5 w-5" />
              支出類型
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-2">
              {isLoading ? (
                <p className="text-sm text-muted-foreground italic">載入中...</p>
              ) : categories.filter(c => c.type === 'expense').map((cat) => (
                <div key={cat.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm font-medium">
                  <span>{cat.name}</span>
                </div>
              ))}
              {categories.filter(c => c.type === 'expense').length === 0 && !isLoading && (
                <p className="text-sm text-muted-foreground italic">尚無支出類型</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
