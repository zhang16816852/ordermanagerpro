import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { DialogFooter } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { Search, X } from 'lucide-react';
import { ProductWithPrice } from '../types';

interface ImportFromOrdersDialogProps {
  products: ProductWithPrice[];
  onSubmit: (items: { product_id: string; variant_id: string | null; quantity: number; unit_cost: number }[]) => void;
  isLoading: boolean;
}

export function ImportFromOrdersDialog({
  products,
  onSubmit,
  isLoading
}: ImportFromOrdersDialogProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Fetch pending order items
  const { data: pendingItems = [], isLoading: dataLoading } = useQuery({
    queryKey: ['pending-order-items-for-po'],
    queryFn: async () => {
      // Fetch orders processing or pending
      const { data: orders, error } = await (supabase
        .from('orders') as any)
        .select(`
          id,
          code,
          created_at,
          order_items (
            id,
            quantity,
            shipped_quantity,
            product_id,
            variant_id,
            products (id, name, code),
            product_variants (id, name, sku, wholesale_price)
          )
        `)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Flatten items and filter those that need purchasing (simple logic: not fully shipped)
      const items: any[] = [];
      orders?.forEach((order: any) => {
        order.order_items?.forEach((item: any) => {
          if (item.quantity > item.shipped_quantity) {
            items.push({
              _id: item.id, // Unique Key
              order_id: order.id,
              order_code: order.code,
              order_date: order.created_at,
              product_id: item.product_id,
              variant_id: item.variant_id,
              product_name: item.products?.name,
              variant_name: item.product_variants?.name,
              sku: item.product_variants?.sku || item.products?.code,
              quantity: item.quantity - item.shipped_quantity, // Remaining needed
              estimated_cost: item.product_variants?.wholesale_price || 0,
            });
          }
        });
      });
      return items;
    }
  });

  const keywords = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const filteredItems = useMemo(() => {
    if (keywords.length === 0) return pendingItems;
    return pendingItems.filter((item: any) => {
      const haystack = [
        item.order_code,
        item.sku,
        item.variant_name,
        item.product_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return keywords.every((kw) => haystack.includes(kw));
    });
  }, [pendingItems, keywords]);

  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((item: any) => selectedItems.has(item._id));

  const handleToggle = (id: string, checked: boolean) => {
    const next = new Set(selectedItems);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedItems(next);
  };

  const handleConfirm = () => {
    const itemsToImport = pendingItems
      .filter((item: any) => selectedItems.has(item._id))
      .map((item: any) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_cost: item.estimated_cost
      }));
    onSubmit(itemsToImport);
  };

  return (
    <div className="space-y-4">
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
            placeholder="搜尋訂單號 / 產品 / SKU"
            aria-label="搜尋訂單號、產品名稱或 SKU"
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
        {keywords.length > 0 && (
          <p className="text-sm text-muted-foreground">
            共 {filteredItems.length} 項符合（全部 {pendingItems.length} 項）
          </p>
        )}
      </div>
      <Table containerClassName="max-h-[400px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">
              <Checkbox
                checked={allFilteredSelected}
                onCheckedChange={(c) => {
                  const next = new Set(selectedItems);
                  if (c) filteredItems.forEach((i: any) => next.add(i._id));
                  else filteredItems.forEach((i: any) => next.delete(i._id));
                  setSelectedItems(next);
                }}
              />
            </TableHead>
            <TableHead>來源訂單</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>產品</TableHead>
            <TableHead className="text-right">需採購數</TableHead>
            <TableHead className="text-right">預估成本</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dataLoading ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8">載入中...</TableCell></TableRow>
          ) : filteredItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                {keywords.length > 0
                  ? `查無符合「${query.trim()}」的項目`
                  : '沒有待採購項目'}
              </TableCell>
            </TableRow>
          ) : (
            filteredItems.map((item: any) => (
              <TableRow key={item._id}>
                <TableCell>
                  <Checkbox
                    checked={selectedItems.has(item._id)}
                    onCheckedChange={(c) => handleToggle(item._id, !!c)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-mono text-xs max-w-[140px] truncate" title={item.order_code || undefined}>
                    {item.order_code || item.order_id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground">{format(new Date(item.order_date), 'MM/dd')}</div>
                </TableCell>
                <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                <TableCell>
                  {item.variant_name || item.product_name}
                </TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right text-muted-foreground">${item.estimated_cost}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <DialogFooter>
        <div className="flex-1 text-sm text-muted-foreground self-center">
          已選擇 {selectedItems.size} 個項目
          {keywords.length > 0 && `（清單顯示 ${filteredItems.length} / ${pendingItems.length} 項）`}
        </div>
        <Button onClick={handleConfirm} disabled={selectedItems.size === 0 || isLoading}>
          {isLoading ? '處理中...' : '匯入選取項目'}
        </Button>
      </DialogFooter>
    </div>
  );
}
