import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Store, ClipboardList } from 'lucide-react';

export interface AggregatedItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  totalPendingQuantity: number;
  sourceOrderIds: string[];
  storeBreakdown: {
    storeId: string;
    storeName: string;
    storeCode: string;
    quantity: number;
  }[];
}

interface AggregateTableViewProps {
  items: AggregatedItem[];
  isLoading: boolean;
  selectedItems: Map<string, { productId: string; variantId: string | null; quantity: number; maxQuantity: number; productName: string; sku: string; sourceOrderIds: string[] }>;
  onToggleSelection: (item: AggregatedItem, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onUpdateQuantity: (key: string, quantity: number) => void;
}

export function AggregateTableView({
  items,
  isLoading,
  selectedItems,
  onToggleSelection,
  onToggleAll,
  onUpdateQuantity,
}: AggregateTableViewProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getItemKey = (item: AggregatedItem) => `${item.productId}_${item.variantId || 'null'}`;

  const allSelected = items.length > 0 && items.every(item => selectedItems.has(getItemKey(item)));
  const someSelected = items.some(item => selectedItems.has(getItemKey(item)));

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
        <ClipboardList className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">目前沒有待叫貨的品項</p>
        <p className="text-sm">切換至「未確認」或「處理中」狀態查看訂單</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </TableHead>
            <TableHead>產品名稱</TableHead>
            <TableHead className="w-28">SKU</TableHead>
            <TableHead className="w-24 text-center">總需求量</TableHead>
            <TableHead className="w-32 text-center">建議叫貨量</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const key = getItemKey(item);
            const isSelected = selectedItems.has(key);
            const selectedData = selectedItems.get(key);
            const isExpanded = expandedRows.has(key);

            return [
              <TableRow
                key={key}
                className={isSelected ? 'bg-primary/5' : ''}
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => onToggleSelection(item, checked === true)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium break-words whitespace-normal">{item.productName}</div>
                  {item.variantName && (
                    <div className="text-sm text-muted-foreground break-words whitespace-normal">{item.variantName}</div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary" className="font-bold text-base px-3 py-1">
                    {item.totalPendingQuantity}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Input
                    type="number"
                    min={1}
                    max={item.totalPendingQuantity}
                    value={selectedData?.quantity ?? item.totalPendingQuantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      onUpdateQuantity(key, Math.min(Math.max(1, val), item.totalPendingQuantity));
                    }}
                    disabled={!isSelected}
                    className="w-20 text-center mx-auto h-8"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => toggleExpand(key)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>,
              isExpanded && (
                <TableRow key={`${key}-detail`}>
                  <TableCell colSpan={6} className="bg-muted/20 p-0">
                    <div className="px-12 py-3">
                      <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                        <Store className="h-4 w-4" />
                        各門市需求明細
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {item.storeBreakdown.map((store) => (
                          <div
                            key={store.storeId}
                            className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                          >
                            <span className="truncate">
                              {store.storeCode ? `${store.storeCode} - ${store.storeName}` : store.storeName}
                            </span>
                            <Badge variant="outline" className="ml-2 shrink-0">
                              {store.quantity}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}
