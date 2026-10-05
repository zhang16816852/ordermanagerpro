import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { isSameDay, format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { CalendarIcon, X, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { Supplier } from '../types';
import type { PurchaseOrderFilters } from '../hooks/usePurchaseOrders';
import { PO_SORT_OPTIONS, type PoSortDir, type PoSortField } from '../orderSort';

/**
 * 'YYYY-MM-DD' 逐段解析成本地時間。
 * ⚠️ 不可用 `new Date('2026-09-01')`：那是 UTC midnight，在負時區（UTC-5）會顯示成 8/31。
 */
const parseYmdLocal = (s?: string): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
};

interface OrderFilterBarProps {
  suppliers: Supplier[];
  filters: PurchaseOrderFilters;
  /** 以 patch 合併篩選條件（由上層寫進網址） */
  onFiltersChange: (patch: PurchaseOrderFilters) => void;
  onClearFilters: () => void;
  /** 排序狀態（由上層自網址還原），寫入網址的動作也交給上層 */
  sortField: PoSortField;
  sortDir: PoSortDir;
  onSortFieldChange: (field: PoSortField) => void;
  onToggleSortDir: () => void;
}

export function OrderFilterBar({
  suppliers,
  filters,
  onFiltersChange,
  onClearFilters,
  sortField,
  sortDir,
  onSortFieldChange,
  onToggleSortDir,
}: OrderFilterBarProps) {
  // 日期選擇器的視覺狀態由本元件持有；真正的篩選值仍以 filters（網址）為準
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>(() => {
    const from = parseYmdLocal(filters.dateFrom);
    const to = parseYmdLocal(filters.dateTo);
    return from && to ? { from, to } : {};
  });

  const hasFilters = !!(
    filters.supplierId || filters.purpose || filters.status || filters.dateFrom || filters.dateTo
  );

  const applyDateRange = (range: { from?: Date; to?: Date }) => {
    setDateRange(range);
    onFiltersChange({
      dateFrom: range.from ? format(range.from, 'yyyy-MM-dd') : undefined,
      dateTo: range.to ? format(range.to, 'yyyy-MM-dd') : undefined,
    });
  };

  const sortFieldLabel =
    PO_SORT_OPTIONS.find((o) => o.value === sortField)?.label ?? '排序';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.supplierId || 'all'}
        onValueChange={(v) => onFiltersChange({ supplierId: v })}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="全部供應商" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部供應商</SelectItem>
          {suppliers.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.purpose || 'all'}
        onValueChange={(v) => onFiltersChange({ purpose: v })}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="全部類型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部類型</SelectItem>
          <SelectItem value="general">一般進貨</SelectItem>
          <SelectItem value="repair_parts">維修叫料</SelectItem>
          <SelectItem value="purchase_return">採購退貨</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.status || 'all'}
        onValueChange={(v) => onFiltersChange({ status: v })}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="全部狀態" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部狀態</SelectItem>
          <SelectItem value="draft">草稿</SelectItem>
          <SelectItem value="ordered">已下單</SelectItem>
          <SelectItem value="partial_received">部分收貨</SelectItem>
          <SelectItem value="received">已收貨</SelectItem>
          <SelectItem value="cancelled">已取消</SelectItem>
        </SelectContent>
      </Select>

      {/* Date range filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'w-[260px] justify-start text-left font-normal',
              !dateRange.from && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange.from ? (
              dateRange.to && !isSameDay(dateRange.from, dateRange.to) ? (
                <>
                  {format(dateRange.from, 'yyyy/MM/dd')} ~ {format(dateRange.to, 'yyyy/MM/dd')}
                </>
              ) : (
                format(dateRange.from, 'yyyy/MM/dd')
              )
            ) : (
              <span>選擇日期範圍</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange as never}
            onSelect={(range) => {
              // 只選到起日時（range.to 為 undefined）直接視為單日區間
              const resolved: { from?: Date; to?: Date } =
                range?.from && !range.to ? { from: range.from, to: range.from } : range || {};
              applyDateRange(resolved);
            }}
            numberOfMonths={2}
            locale={zhTW}
          />
        </PopoverContent>
      </Popover>

      {(filters.dateFrom || filters.dateTo) && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="清除日期篩選"
          onClick={() => applyDateRange({})}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onClearFilters}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />清除篩選
        </Button>
      )}

      {/*
        手機版排列入口：<md 沒有可點擊的表頭（OrderListTab 的 Table 是 hidden md:block），
        故此處提供排序欄位下拉 + 方向切換。桌機用表頭排序即可，故整段 md:hidden。
      */}
      <div className="ml-auto flex items-center gap-2 md:hidden">
        <span className="text-xs text-muted-foreground">排序</span>
        <Select value={sortField} onValueChange={(v) => onSortFieldChange(v as PoSortField)}>
          <SelectTrigger className="w-28" aria-label={`排列依據，目前為${sortFieldLabel}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PO_SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label={sortDir === 'asc' ? '改為由大到小排列' : '改為由小到大排列'}
          title={sortDir === 'asc' ? '由小到大' : '由大到小'}
          onClick={onToggleSortDir}
        >
          {sortDir === 'asc' ? (
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
