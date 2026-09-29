import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CalendarDays, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { GroupFooter, PartnerHeader } from './consignmentViewParts';
import type { ColumnMode, PivotGroup, PivotProduct } from './consignmentViewData';
import type {
  ConsignmentProductDateCell,
  ConsignmentProductRow,
  ConsignmentViewOrder,
} from './consignmentViewTypes';

export interface ConsignmentProductsViewProps<T extends ConsignmentViewOrder> {
  pivotGroups: PivotGroup<T>[];
  columnMode: ColumnMode;
  renderProductActions?: (product: ConsignmentProductRow) => ReactNode;
}

export function ConsignmentProductsView<T extends ConsignmentViewOrder>({
  pivotGroups,
  columnMode,
  renderProductActions,
}: ConsignmentProductsViewProps<T>) {
  const hasProductActions = !!renderProductActions;
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!keyword) return pivotGroups;
    const hit = (p: PivotProduct) =>
      p.name.toLowerCase().includes(keyword) ||
      (p.productName ?? '').toLowerCase().includes(keyword);
    return pivotGroups
      .map(({ group, dates, products }) => ({
        group,
        dates,
        products: products.filter(hit),
      }))
      .filter((g) => g.products.length > 0);
  }, [pivotGroups, keyword]);

  const totalCount = useMemo(
    () => pivotGroups.reduce((sum, g) => sum + g.products.length, 0),
    [pivotGroups]
  );
  const matchCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.products.length, 0),
    [filteredGroups]
  );

  const searchBox = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋產品名稱"
          aria-label="搜尋產品名稱"
          className="pl-8 pr-8"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清除搜尋"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {keyword && (
        <p className="text-sm text-muted-foreground">
          共 {matchCount} 項符合（全部 {totalCount} 項）
        </p>
      )}
    </div>
  );

  if (keyword && filteredGroups.length === 0) {
    return (
      <div className="space-y-4">
        {searchBox}
        <div className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">
          查無符合「{query.trim()}」的產品
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {searchBox}
      {filteredGroups.map(({ group, dates, products }) => {
        const pivotColSpan =
          (columnMode === 'all' ? dates.length + 3 : 2) + (hasProductActions ? 1 : 0);
        return (
          <div key={`${group.kind}:${group.partnerId}`} className="border rounded-lg bg-card shadow-soft">
            <PartnerHeader group={group} />

            {/* 桌機：商品 × 日期矩陣，日期為欄（ROW TITLE），儲存格＝該日給貨數 */}
            <div className="hidden md:block px-3 py-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40">
                    <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap sticky left-0 bg-muted/40">
                      商品
                    </th>
                    {columnMode === 'all' &&
                      dates.map((d) => (
                        <th key={d.key} className="text-right py-1.5 px-2 font-medium whitespace-nowrap">
                          {d.label}
                        </th>
                      ))}
                    {columnMode === 'all' && (
                      <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">合計</th>
                    )}
                    <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">剩餘</th>
                    {hasProductActions && (
                      <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap w-24">
                        操作
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 && (
                    <tr>
                      <td
                        colSpan={pivotColSpan}
                        className="py-3 px-2 text-center text-muted-foreground"
                      >
                        無品項
                      </td>
                    </tr>
                  )}
                  {products.map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="py-1.5 px-2 font-medium whitespace-nowrap sticky left-0 bg-card">
                        {row.name}
                      </td>
                      {columnMode === 'all' &&
                        dates.map((d) => (
                          <td key={d.key} className="text-right py-1.5 px-2 tabular-nums">
                            {row.byDate[d.key] ?? ''}
                          </td>
                        ))}
                      {columnMode === 'all' && (
                        <td className="text-right py-1.5 px-2 font-medium tabular-nums">
                          {row.delivered}
                        </td>
                      )}
                      <td className="text-right py-1.5 px-2 font-medium tabular-nums">
                        {row.remaining}
                      </td>
                      {hasProductActions && (
                        <td className="py-1.5 px-2 text-right">{renderProductActions?.(row)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 手機：每商品一張卡，各日明細預設收合 */}
            <div className="md:hidden px-3 py-2 space-y-3">
              {products.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">無品項</p>
              )}
              {products.map((row) => (
                <div key={row.key} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <p className="flex-1 min-w-0 font-medium break-words whitespace-normal">
                      {row.name}
                    </p>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold tabular-nums">{row.delivered} 件</p>
                      <p className="text-xs text-muted-foreground">剩餘 {row.remaining} 件</p>
                    </div>
                  </div>
                  {hasProductActions && (
                    <div className="flex items-center justify-end gap-2">
                      <DateBreakdown cells={row.dateCells ?? []} />
                      {renderProductActions?.(row)}
                    </div>
                  )}
                  {!hasProductActions && <DateBreakdown cells={row.dateCells ?? []} />}
                </div>
              ))}
            </div>

            <GroupFooter
              group={group}
              columnMode={columnMode}
              itemCount={products.length}
              className="hidden md:flex"
            />
            <GroupFooter group={group} columnMode="all" itemCount={products.length} className="md:hidden" />
          </div>
        );
      })}
    </div>
  );
}

function DateBreakdown({ cells }: { cells: ConsignmentProductDateCell[] }) {
  const [open, setOpen] = useState(false);
  if (cells.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
          <CalendarDays className="h-3 w-3 mr-1" />
          {cells.length} 個日期
          {open ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-1 px-1">
          {cells.map((cell) => (
            <li key={cell.key} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{cell.label}</span>
              <span className="font-medium tabular-nums">{cell.count} 件</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
