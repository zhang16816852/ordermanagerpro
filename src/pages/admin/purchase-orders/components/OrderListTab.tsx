import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, Edit, Trash2, Send, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { PurchaseOrder } from '../types';
import { poPaymentSummary } from '../paymentSummary';
import { isBatchOrderable, isBatchReceivable } from '../batchActions';
import { formatCurrency } from '@/lib/formatters';
import type { PoSortDir, PoSortField } from '../orderSort';

interface OrderListTabProps {
  orders: PurchaseOrder[];
  onView: (order: PurchaseOrder) => void;
  onEdit: (order: PurchaseOrder) => void;
  onDelete: (id: string) => void;
  onStatusChange: (orderId: string, status: string) => void;
  isLoading: boolean;
  /** 採購單 id → 已付金額；未提供（業務身分或載入中）則不顯示付款資訊 */
  paidAmountMap?: Record<string, number>;
  /** 目前排列欄位與方向（由上層自網址還原） */
  sortField: PoSortField;
  sortDir: PoSortDir;
  /** 點擊表頭：同一欄翻轉方向、換欄位則取該欄預設方向 */
  onSort: (field: PoSortField) => void;
  /** 批次模式開啟（由上層持有，預設關閉）；開啟後才顯示選取欄位 */
  batchMode?: boolean;
  /** 批次模式鎖定（mutation 進行中），鎖住所有選取與勾選框 */
  batchLocked?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (ids: string[]) => void;
}

export function OrderListTab({
  orders,
  onView,
  onEdit,
  onDelete,
  onStatusChange,
  isLoading,
  paidAmountMap,
  sortField,
  sortDir,
  onSort,
  batchMode = false,
  batchLocked = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: OrderListTabProps) {
  const selected = selectedIds ?? [];
  const selectableIds = batchMode
    ? orders.filter((o) => isBatchOrderable(o) || isBatchReceivable(o)).map((o) => o.id)
    : [];
  const selectableSet = new Set(selectableIds);
  const selectedCount = selected.filter((id) => selectableSet.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const handleSelectAll = () => {
    if (!onToggleSelectAll || batchLocked) return;
    onToggleSelectAll(allSelected ? [] : selectableIds);
  };

  /** 不可批次處理的單仍要顯示勾選框但停用，並以 title 說明原因 */
  const selectCell = (order: PurchaseOrder) => {
    const selectable = selectableSet.has(order.id);
    return (
      <TableCell className="w-10">
        <Checkbox
          checked={selected.includes(order.id)}
          disabled={batchLocked || !selectable}
          onCheckedChange={() => onToggleSelect?.(order.id)}
          aria-label={`選取採購單 ${order.supplier_order_number || order.id.slice(0, 8)}`}
        />
      </TableCell>
    );
  };
  // 與 ShippingPoolGroups / admin 訂單列表 OrderTableView 相同的表頭排序寫法
  const SortableHead = ({
    field,
    label,
    className,
  }: {
    field: PoSortField;
    label: string;
    className?: string;
  }) => {
    const active = sortField === field;
    return (
      <TableHead
        className={className}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-1 -ml-1 font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onSort(field)}
          aria-label={`依「${label}」${active && sortDir === 'asc' ? '改為由大到小' : '由小到大'}排列`}
        >
          {label}
          {active ? (
            sortDir === 'asc' ? (
              <ArrowUp className="ml-1 h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDown className="ml-1 h-3 w-3" aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" aria-hidden="true" />
          )}
        </Button>
      </TableHead>
    );
  };
  const getPaymentLine = (order: PurchaseOrder) => {
    if (!paidAmountMap) return null;
    const { unpaid, isCredit } = poPaymentSummary(order.total_amount, paidAmountMap[order.id]);
    if (unpaid > 0) {
      return (
        <span className="block text-xs font-normal text-amber-600">
          {isCredit ? '待沖帳' : '未付'} {formatCurrency(unpaid)}
        </span>
      );
    }
    return (
      <span className="block text-xs font-normal text-green-600">
        {isCredit ? '已沖帳' : '已付清'}
      </span>
    );
  };
  const getTypeBadge = (purpose?: string) => {
    if (purpose === 'repair_parts') {
      return <Badge variant="outline" className="border-violet-500 text-violet-600 whitespace-nowrap">維修叫料</Badge>;
    }
    if (purpose === 'purchase_return') {
      return <Badge variant="outline" className="border-red-500 text-red-600 whitespace-nowrap">採購退貨</Badge>;
    }
    return <Badge variant="secondary" className="whitespace-nowrap">一般進貨</Badge>;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary">草稿</Badge>;
      case 'ordered': return <Badge variant="outline" className="border-blue-500 text-blue-500">已下單</Badge>;
      case 'partial_received': return <Badge variant="outline" className="border-orange-500 text-orange-500">部分收貨</Badge>;
      case 'received': return <Badge variant="outline" className="border-green-500 text-green-500">已收貨</Badge>;
      case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground italic">目前無採購紀錄</div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: Table */}
      <div className="hidden md:block border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              {batchMode && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    disabled={batchLocked || selectableIds.length === 0}
                    onCheckedChange={handleSelectAll}
                    aria-label="全選可批次處理的採購單"
                  />
                </TableHead>
              )}
              <SortableHead field="id" label="編號" />
              <SortableHead field="supplier" label="供應商" />
              <SortableHead field="purpose" label="類型" />
              <SortableHead field="supplier_order_number" label="廠商單號" />
              <SortableHead field="order_date" label="日期" />
              <SortableHead field="total_amount" label="總額" className="text-right" />
              <SortableHead field="status" label="狀態" />
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id} className={batchMode && selected.includes(order.id) ? 'bg-muted/50' : undefined}>
                {batchMode && selectCell(order)}
                <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                <TableCell>{order.supplier?.name || '-'}</TableCell>
                <TableCell>{getTypeBadge(order.purpose)}</TableCell>
                <TableCell className="text-sm">{order.supplier_order_number || '-'}</TableCell>
                <TableCell>{order.order_date}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(order.total_amount)}
                  {getPaymentLine(order)}
                </TableCell>
                <TableCell>{getStatusBadge(order.status)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {order.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-blue-600 border-blue-500 hover:bg-blue-50"
                        onClick={() => onStatusChange(order.id, 'ordered')}
                      >
                        <Send className="h-4 w-4 mr-1" />轉為已下單
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => onView(order)} aria-label="檢視採購單">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => onEdit(order)} aria-label="編輯採購單">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => onDelete(order.id)} aria-label="刪除採購單">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: Cards */}
      <div className="md:hidden space-y-3">
        {orders.map((order) => {
          const cardSelectable = selectableSet.has(order.id);
          return (
          <div
            key={order.id}
            className={`border rounded-lg p-4 bg-card shadow-soft space-y-3 ${batchMode && selected.includes(order.id) ? 'ring-2 ring-primary/40' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0">
                {batchMode && (
                  <Checkbox
                    className="mt-1"
                    checked={selected.includes(order.id)}
                    disabled={batchLocked || !cardSelectable}
                    onCheckedChange={() => onToggleSelect?.(order.id)}
                    aria-label={`選取採購單 ${order.supplier_order_number || order.id.slice(0, 8)}`}
                  />
                )}
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}</p>
                  <p className="font-medium truncate">{order.supplier?.name || '-'}</p>
                  <div className="mt-1">{getTypeBadge(order.purpose)}</div>
                </div>
              </div>
              {getStatusBadge(order.status)}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{order.order_date}</span>
              <div className="text-right">
                <span className="font-bold">{formatCurrency(order.total_amount)}</span>
                {getPaymentLine(order)}
              </div>
            </div>
            {order.supplier_order_number && (
              <p className="text-xs text-muted-foreground">廠商單號：{order.supplier_order_number}</p>
            )}
            <div className="flex items-center gap-2 pt-1 border-t">
              {order.status === 'draft' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-blue-600 border-blue-500 hover:bg-blue-50"
                  onClick={() => onStatusChange(order.id, 'ordered')}
                >
                  <Send className="h-4 w-4 mr-1" />轉為已下單
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => onView(order)} aria-label="檢視採購單">
                <Eye className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onEdit(order)} aria-label="編輯採購單">
                <Edit className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => onDelete(order.id)} aria-label="刪除採購單">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          );
        })}
      </div>
    </>
  );
}
