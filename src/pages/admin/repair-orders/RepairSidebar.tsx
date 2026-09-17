import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Wallet, Clock, History, Edit, Printer } from 'lucide-react';
import { REPAIR_ORDER_STATUS_LABELS } from '@/types/repair';
import { formatCurrency, formatDate } from '@/lib/formatters';

interface RepairSidebarProps {
  order: any;
  assignees: Record<string, { email: string | null; full_name: string | null }>;
  totalPartsCost: number;
  finalPrice: number;
  profit: number;
  profitPercent: string;
  onCollectPayment: () => void;
  onEdit: () => void;
  onShowReceipt: () => void;
}

export function RepairSidebar({
  order,
  assignees,
  totalPartsCost,
  finalPrice,
  profit,
  profitPercent,
  onCollectPayment,
  onEdit,
  onShowReceipt,
}: RepairSidebarProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">指派與來源</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">來源店家</span>
            <span className="font-medium">{order.store?.name || '-'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">接案人</span>
            {order.assigned_to && assignees[order.assigned_to]?.email ? (
              <span className="font-medium">{assignees[order.assigned_to]?.email}</span>
            ) : (
              <Badge variant="outline" className="text-[10px]">開放待接案</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">費用摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">零件成本</span>
            <span className="font-mono">{formatCurrency(totalPartsCost)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">工資收入</span>
            <span className="font-mono">{formatCurrency(order.labor_fee || 0)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">折扣</span>
              <span className="font-mono text-red-500">-{formatCurrency(order.discount)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-bold text-base">
            <span>應收總額</span>
            <span className="font-mono">{formatCurrency(finalPrice)}</span>
          </div>
          {order.deposit > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">已收定金</span>
              <span className="font-mono text-blue-600">{formatCurrency(order.deposit)}</span>
            </div>
          )}
          {order.deposit > 0 && (
            <div className="flex justify-between font-bold text-sm text-blue-700">
              <span>待收款</span>
              <span className="font-mono">{formatCurrency(finalPrice - order.deposit)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">收款狀態</span>
            {order.payment_status === 'paid' ? (
              <Badge variant="secondary" className="text-[11px] font-normal bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300">
                已收款
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] font-normal text-amber-600 border-amber-300 dark:text-amber-400">
                未收款
              </Badge>
            )}
          </div>
          {order.payment_status !== 'paid' && finalPrice - order.deposit > 0 && (
            <Button
              className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              onClick={onCollectPayment}
            >
              <Wallet className="h-4 w-4" />
              登記收款
            </Button>
          )}
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">利潤</span>
            <span className={`font-mono font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(profit)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">毛利率</span>
            <span className={`font-mono ${Number(profitPercent) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {profitPercent}%
            </span>
          </div>
          {order.payment_method && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">付款方式</span>
              <span>{order.payment_method}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            時間紀錄
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">單據日期</span>
            <span>{formatDate(order.order_date)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">建立</span>
            <span>{formatDate(order.created_at)}</span>
          </div>
          {order.diagnosed_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">檢測完成</span>
              <span>{formatDate(order.diagnosed_at)}</span>
            </div>
          )}
          {order.started_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">開始維修</span>
              <span>{formatDate(order.started_at)}</span>
            </div>
          )}
          {order.completed_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">維修完成</span>
              <span>{formatDate(order.completed_at)}</span>
            </div>
          )}
          {order.delivered_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">取件時間</span>
              <span>{formatDate(order.delivered_at)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            狀態紀錄
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(order.status_history || []).map((h: any, idx: number) => (
            <div key={h.id || idx} className="flex justify-between items-start text-xs py-1 border-b last:border-0">
              <div>
                <span className="font-medium">
                  {REPAIR_ORDER_STATUS_LABELS[h.to_status as keyof typeof REPAIR_ORDER_STATUS_LABELS] || h.to_status}
                </span>
                {h.changed_by && assignees[h.changed_by]?.email && (
                  <span className="text-muted-foreground ml-1">- {assignees[h.changed_by]?.email}</span>
                )}
              </div>
              <span className="text-muted-foreground">{formatDate(h.created_at)}</span>
            </div>
          ))}
          {(order.status_history || []).length === 0 && (
            <p className="text-xs text-muted-foreground text-center">尚無狀態變更紀錄</p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onEdit}>
          <Edit className="mr-2 h-4 w-4" />
          編輯
        </Button>
        <Button variant="outline" className="flex-1" onClick={onShowReceipt}>
          <Printer className="mr-2 h-4 w-4" />
          收據
        </Button>
      </div>
    </div>
  );
}