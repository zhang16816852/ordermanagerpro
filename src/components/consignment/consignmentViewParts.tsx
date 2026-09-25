import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Store, Factory, UnfoldVertical, FoldVertical } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { directionLabel, type ColumnMode, type PartnerGroup, type ViewMode } from './consignmentViewData';
import type { ConsignmentViewStatus } from './consignmentViewTypes';

export function StatusBadge({ status }: { status: ConsignmentViewStatus }) {
  switch (status) {
    case 'draft':
      return <Badge variant="secondary">草稿</Badge>;
    case 'active':
      return <Badge variant="outline" className="border-blue-500 text-blue-500">進行中</Badge>;
    case 'settled':
      return <Badge variant="outline" className="border-green-500 text-green-600">已結算</Badge>;
    case 'cancelled':
      return <Badge variant="destructive">已取消</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function ReceivedBadge() {
  return <Badge variant="outline" className="border-green-500 text-green-600">已收貨</Badge>;
}

export function PartnerHeader<T>({ group }: { group: PartnerGroup<T> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 border-b bg-muted/20 rounded-t-lg">
      <div
        className={`h-10 w-10 rounded-lg flex items-center justify-center ${
          group.kind === 'store' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600'
        }`}
      >
        {group.kind === 'store' ? <Store className="h-5 w-5" /> : <Factory className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate">{group.name}</p>
        <p className="text-xs text-muted-foreground">
          {group.kind === 'store' ? '店家' : '供應商'}・{directionLabel[group.direction]}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground">寄賣 {group.orders.length} 單</p>
        <p className="font-bold text-primary">{formatCurrency(group.totalValue)}</p>
      </div>
    </div>
  );
}

export function GroupFooter<T>({
  group,
  columnMode,
  itemCount,
  className,
}: {
  group: PartnerGroup<T>;
  columnMode: ColumnMode;
  itemCount?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-4 px-4 py-2.5 border-t bg-muted/20 rounded-b-lg text-sm',
        className
      )}
    >
      {columnMode === 'all' && (
        <>
          <span className="text-muted-foreground">商品總計（所有產品數量加總）</span>
          <span className="font-semibold">{group.totalDelivered} 件</span>
        </>
      )}
      {itemCount != null && (
        <span className="text-xs text-muted-foreground">合計 {itemCount} 項</span>
      )}
      <span className="text-muted-foreground">剩餘合計</span>
      <span className="font-semibold">{group.totalRemaining} 件</span>
    </div>
  );
}

export function ViewToolbar({
  viewMode,
  onViewModeChange,
  columnMode,
  onColumnModeChange,
  columnToggleOnMobile,
  showExpandAll,
  onToggleAll,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  columnMode: ColumnMode;
  onColumnModeChange: (mode: ColumnMode) => void;
  /** 商品視角的日期欄在手機版改由可展開區塊呈現，故切換鈕僅桌機顯示 */
  columnToggleOnMobile: boolean;
  showExpandAll: boolean;
  onToggleAll: (collapsed: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 w-full sm:w-auto">
        <Button
          variant={viewMode === 'orders' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={() => onViewModeChange('orders')}
        >
          全部訂單
        </Button>
        <Button
          variant={viewMode === 'items' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={() => onViewModeChange('items')}
        >
          商品
        </Button>
      </div>
      <div className="flex flex-wrap gap-1 ml-auto">
        <Button
          variant={columnMode === 'all' ? 'outline' : 'default'}
          size="sm"
          className={cn(!columnToggleOnMobile && 'hidden md:inline-flex')}
          onClick={() => onColumnModeChange(columnMode === 'all' ? 'remaining' : 'all')}
        >
          {columnMode === 'all' ? '只看剩餘' : '全部欄位'}
        </Button>
        {showExpandAll && (
          <>
            <Button variant="outline" size="sm" onClick={() => onToggleAll(false)}>
              <UnfoldVertical className="h-3.5 w-3.5 mr-1" />全部展開
            </Button>
            <Button variant="outline" size="sm" onClick={() => onToggleAll(true)}>
              <FoldVertical className="h-3.5 w-3.5 mr-1" />全部收合
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
