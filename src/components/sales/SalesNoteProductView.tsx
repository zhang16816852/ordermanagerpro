import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, ChevronUp, Package, ReceiptText } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

export interface SalesNoteBreakdown {
  salesNoteId: string;
  salesNoteCode: string;
  storeName: string;
  quantity: number;
  amount: number;
}

export interface SalesNoteAggregateItem {
  productId: string;
  variantId: string | null;
  productName: string;
  sku: string;
  totalQuantity: number;
  totalAmount: number;
  avgUnitPrice: number;
  noteBreakdown: SalesNoteBreakdown[];
}

type SortKey = 'name' | 'quantity' | 'unitPrice' | 'amount';

interface SalesNoteProductViewProps {
  items: SalesNoteAggregateItem[];
  isLoading: boolean;
  onViewNote?: (noteId: string) => void;
}

export function SalesNoteProductView({ items, isLoading, onViewNote }: SalesNoteProductViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey | 'none'; dir: 'asc' | 'desc' }>({
    key: 'none',
    dir: 'desc',
  });

  const getKey = (item: SalesNoteAggregateItem) => `${item.productId}_${item.variantId || 'null'}`;

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cycleSort = (key: SortKey) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: 'none', dir: 'asc' };
    });
  };

  const sortedItems = useMemo(() => {
    if (sort.key === 'none') return items;
    const arr = [...items];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'name':
          cmp = a.productName.localeCompare(b.productName, 'zh-Hant-TW');
          break;
        case 'quantity':
          cmp = a.totalQuantity - b.totalQuantity;
          break;
        case 'unitPrice':
          cmp = a.avgUnitPrice - b.avgUnitPrice;
          break;
        case 'amount':
          cmp = a.totalAmount - b.totalAmount;
          break;
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sort]);

  const sortIndicator = (key: SortKey) => {
    if (sort.key !== key) return null;
    return sort.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const sortPills: { key: SortKey; label: string }[] = [
    { key: 'name', label: '商品' },
    { key: 'quantity', label: '數量' },
    { key: 'unitPrice', label: '單價' },
    { key: 'amount', label: '金額' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        載入中...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">沒有找到售出的商品</p>
        <p className="text-sm">調整篩選條件後再試</p>
      </div>
    );
  }

  const renderBreakdown = (item: SalesNoteAggregateItem) => (
    <div className="space-y-1.5">
      {item.noteBreakdown.map((b) => (
        <div
          key={b.salesNoteId}
          className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          <button
            type="button"
            className="min-w-0 flex items-center gap-2 text-left hover:underline"
            onClick={() => onViewNote?.(b.salesNoteId)}
          >
            <ReceiptText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs font-medium truncate">{b.salesNoteCode}</span>
            <span className="text-xs text-muted-foreground truncate">{b.storeName}</span>
          </button>
          <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
            {b.quantity} 件・{formatCurrency(b.amount)}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      {/* 電腦版：表格 */}
      <div className="hidden md:flex flex-col flex-1 min-h-0 rounded-md border bg-card shadow-sm overflow-hidden">
        <Table containerClassName="flex-1">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>
                <Button variant="ghost" size="sm" className="h-7 px-1.5 -ml-1.5 text-xs font-medium" onClick={() => cycleSort('name')}>
                  商品名稱 {sortIndicator('name')}
                </Button>
              </TableHead>
              <TableHead className="w-20 text-center">
                <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs font-medium" onClick={() => cycleSort('quantity')}>
                  數量 {sortIndicator('quantity')}
                </Button>
              </TableHead>
              <TableHead className="w-24 text-right">
                <Button variant="ghost" size="sm" className="h-7 px-1.5 -mr-1.5 text-xs font-medium" onClick={() => cycleSort('unitPrice')}>
                  單價 {sortIndicator('unitPrice')}
                </Button>
              </TableHead>
              <TableHead className="w-28 text-right">
                <Button variant="ghost" size="sm" className="h-7 px-1.5 -mr-1.5 text-xs font-medium" onClick={() => cycleSort('amount')}>
                  銷售金額 {sortIndicator('amount')}
                </Button>
              </TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.map((item) => {
              const key = getKey(item);
              const isExpanded = expanded.has(key);
              return [
                <TableRow key={key} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">{item.productName}</TableCell>
                  <TableCell className="text-center font-semibold">{item.totalQuantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.avgUnitPrice)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(item.totalAmount)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => toggle(key)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                </TableRow>,
                isExpanded && (
                  <TableRow key={`${key}-detail`}>
                    <TableCell colSpan={5} className="bg-muted/20 p-0">
                      <div className="px-6 py-3">
                        <div className="mb-2 text-sm text-muted-foreground">
                          銷售明細（{item.noteBreakdown.length} 張銷貨單）
                        </div>
                        {renderBreakdown(item)}
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              ];
            })}
          </TableBody>
        </Table>
      </div>

      {/* 手機版：卡片 */}
      <div className="grid grid-cols-1 gap-4 md:hidden flex-1 min-h-0 overflow-y-auto content-start py-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">排序:</span>
          {sortPills.map(({ key, label }) => (
            <Button
              key={key}
              variant={sort.key === key ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => cycleSort(key)}
            >
              {label} {sortIndicator(key)}
            </Button>
          ))}
        </div>
        {sortedItems.map((item) => {
          const key = getKey(item);
          const isExpanded = expanded.has(key);
          return (
            <Collapsible key={key} open={isExpanded} onOpenChange={() => toggle(key)} asChild>
              <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium break-words whitespace-normal">{item.productName}</h3>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-bold">{item.totalQuantity} 件</div>
                    <div className="text-xs text-muted-foreground">單價 {formatCurrency(item.avgUnitPrice)}</div>
                    <div className="text-xs text-muted-foreground">{formatCurrency(item.totalAmount)}</div>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
                    <ReceiptText className="h-3 w-3 mr-1" />
                    {item.noteBreakdown.length} 張銷貨單
                    {isExpanded ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {renderBreakdown(item)}
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}